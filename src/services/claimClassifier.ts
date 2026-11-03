import type { ChunkMatch, ClaimStatus, ContradictionSource, Verdict, WebEvidenceMatch } from '../types/groundcheck';
import type { QuantityConflictResult } from './conflictCheck';
import type { WebSearchResult } from './webSearch';

/**
 * Pure claim-decision logic. No I/O: every input (similarities, NLI judgments,
 * quantity-conflict result, web evidence) is computed by the orchestrator in
 * verifier.ts and passed in, so these functions are trivially testable.
 */

/** NLI contradiction probability at or above which a top-3 chunk contradicts the claim. */
export const CONTRADICTION_THRESHOLD = 0.6;
/** NLI entailment probability at or above which a chunk supports the claim. */
export const ENTAILMENT_THRESHOLD = 0.5;
/** Similarity below which a chunk/web result is considered off-topic. */
export const SIMILARITY_FLOOR = 0.3;
/** Confidence contribution of a contradicted claim is capped at this value. */
export const CONTRADICTED_SCORE_CAP = 0.35;
/** Web snippet must be at least this similar to the claim to count as support. */
export const WEB_SIMILARITY_MIN = 0.5;
/** Web snippet must entail the claim at least this strongly to count as support. */
export const WEB_ENTAILMENT_MIN = 0.6;

/** Which rule decided the claim status (for explanations and tests). */
export type DecisionBasis =
  | 'contradiction'
  | 'kb-entailment'
  | 'negation-entailment'
  | 'web'
  | 'nli-unavailable'
  | 'unsupported-covered'
  | 'not-covered';

export interface WebEvidence {
  /** Best claim-snippet similarity among non-echo snippets. */
  bestScore: number;
  bestResult: WebSearchResult | null;
  /** Scored snippets, best similarity first; the best 3 carry NLI judgments. */
  matches?: WebEvidenceMatch[];
  /** Set when web search was enabled but failed. */
  error?: string;
}

export interface ClaimClassificationInput {
  claim: string;
  /** Top KB chunks, sorted by similarity descending, each with its NLI judgment. */
  top3Chunks: ChunkMatch[];
  /** findQuantityConflict(claim, top3Chunks[0].text): best-matching chunk only. */
  quantityConflict: QuantityConflictResult;
  /** Similarity threshold for grounding. */
  threshold: number;
  /** Best similarity between the user's question and any KB chunk. */
  promptKbScore: number;
  web: WebEvidence;
}

export interface ContradictionFinding {
  source: ContradictionSource;
  reason: string;
  chunk?: ChunkMatch;
}

export interface ClaimClassification {
  status: ClaimStatus;
  reason: string;
  basis: DecisionBasis;
  /** Per-claim contribution to the overall confidence score. */
  score: number;
  isContradicted: boolean;
  contradictionSource?: ContradictionSource;
  /** KB chunk that entailed the claim (kb-entailment / negation-entailment). */
  supportingChunk?: ChunkMatch;
  /** Web snippet that entailed the claim (basis 'web'); lower trust than the KB. */
  supportingWeb?: WebEvidenceMatch;
}

const NEGATION_REGEX = /\b(?:not|never|no|cannot)\b|\bnon-|n't\b/i;

const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;

/** True if the claim contains a negation token (not, non-, never, no, cannot, -n't). */
export function hasNegation(text: string): boolean {
  return NEGATION_REGEX.test(text);
}

/**
 * Contradiction if the deterministic quantity check fired on the best chunk, or any
 * top-3 chunk has a valid (non-errored) NLI contradiction >= CONTRADICTION_THRESHOLD.
 * The quantity conflict wins; otherwise the strongest NLI contradiction is reported.
 */
export function findContradiction(
  top3Chunks: ChunkMatch[],
  quantityConflict: QuantityConflictResult
): ContradictionFinding | null {
  const best = top3Chunks[0];
  if (quantityConflict.conflict && best) {
    return {
      source: 'quantity',
      chunk: best,
      reason: `Contradicted by ${best.docTitle}: ${quantityConflict.reason ?? 'quantity conflict'}`,
    };
  }

  let strongest: ChunkMatch | undefined;
  for (const chunk of top3Chunks) {
    if (chunk.nli.error || chunk.nli.contradiction < CONTRADICTION_THRESHOLD) continue;
    if (!strongest || chunk.nli.contradiction > strongest.nli.contradiction) strongest = chunk;
  }
  if (!strongest) return null;
  return {
    source: 'nli',
    chunk: strongest,
    reason: `Contradicted by KB evidence in ${strongest.docTitle} (contradiction ${pct(strongest.nli.contradiction)})`,
  };
}

/**
 * First chunk (in similarity order) with a valid NLI entailment >= ENTAILMENT_THRESHOLD
 * and similarity >= minSimilarity.
 */
export function findEntailingChunk(top3Chunks: ChunkMatch[], minSimilarity: number): ChunkMatch | undefined {
  return top3Chunks.find(
    (c) => !c.nli.error && c.nli.entailment >= ENTAILMENT_THRESHOLD && c.similarity >= minSimilarity
  );
}

/**
 * First web snippet with similarity >= WEB_SIMILARITY_MIN and a valid NLI
 * entailment >= WEB_ENTAILMENT_MIN. Similarity alone never counts as support.
 */
export function findWebSupport(matches: readonly WebEvidenceMatch[]): WebEvidenceMatch | undefined {
  return matches.find(
    (m) =>
      m.similarity >= WEB_SIMILARITY_MIN &&
      m.nli !== undefined &&
      !m.nli.error &&
      m.nli.entailment >= WEB_ENTAILMENT_MIN
  );
}

/** Human-readable note about failed NLI calls, or undefined if all succeeded. */
export function describeNliFailures(top3Chunks: ChunkMatch[]): string | undefined {
  const failed = top3Chunks.filter((c) => c.nli.error);
  if (failed.length === 0) return undefined;
  return `NLI unavailable for ${failed.length} of ${top3Chunks.length} chunk(s): ${failed[0].nli.error}`;
}

function decideStatus(input: ClaimClassificationInput): ClaimClassification {
  const { claim, top3Chunks, quantityConflict, threshold, promptKbScore, web } = input;
  const best = top3Chunks[0];
  const bestKb = best?.similarity ?? 0;

  // 1. Contradiction (never gated by similarity).
  const contradiction = findContradiction(top3Chunks, quantityConflict);
  if (contradiction) {
    return {
      status: 'HALLUCINATED',
      basis: 'contradiction',
      reason: contradiction.reason,
      score: Math.min(bestKb, CONTRADICTED_SCORE_CAP),
      isContradicted: true,
      contradictionSource: contradiction.source,
    };
  }

  // 2. KB grounding: similarity alone is not enough, entailment is required.
  if (best && bestKb >= threshold) {
    const support = findEntailingChunk(top3Chunks, SIMILARITY_FLOOR);
    if (support) {
      return {
        status: 'GROUNDED',
        basis: 'kb-entailment',
        reason: `Supported by ${support.docTitle} (${pct(support.similarity)} match, ${pct(
          support.nli.entailment
        )} entailment)`,
        score: support.similarity,
        isContradicted: false,
        supportingChunk: support,
      };
    }
  }

  // 3. Negated claims are routed to entailment even when similarity is low,
  //    because embeddings barely distinguish "X" from "not X".
  if (hasNegation(claim)) {
    const support = findEntailingChunk(top3Chunks, 0);
    if (support) {
      return {
        status: 'GROUNDED',
        basis: 'negation-entailment',
        reason: `Negated claim entailed by ${support.docTitle} (${pct(support.nli.entailment)} entailment, ${pct(
          support.similarity
        )} match)`,
        score: support.similarity,
        isContradicted: false,
        supportingChunk: support,
      };
    }
  }

  // 4. Web evidence (lower trust): requires similarity AND entailment on a grounded snippet.
  const webSupport = findWebSupport(web.matches ?? []);
  if (webSupport) {
    return {
      status: 'GROUNDED',
      basis: 'web',
      reason: `Supported by web source (lower trust): ${webSupport.result.title} (${pct(webSupport.similarity)} match, ${pct(
        webSupport.nli?.entailment ?? 0
      )} entailment)`,
      score: webSupport.similarity,
      isContradicted: false,
      supportingWeb: webSupport,
    };
  }

  const fallbackScore = Math.max(bestKb, web.bestScore);

  // 5. Relevant evidence exists but its entailment could not be judged: say so instead
  //    of calling the claim hallucinated.
  if (best && bestKb >= SIMILARITY_FLOOR && best.nli.error) {
    return {
      status: 'UNVERIFIABLE',
      basis: 'nli-unavailable',
      reason: `Entailment could not be judged against ${best.docTitle} (${pct(bestKb)} match)`,
      score: fallbackScore,
      isContradicted: false,
    };
  }

  // 6. Unsupported: not covered vs. hallucinated on a covered topic.
  const webRelevant = web.bestScore >= SIMILARITY_FLOOR;
  const nothingRelevant = bestKb < SIMILARITY_FLOOR && !webRelevant;
  const topicCovered = promptKbScore > SIMILARITY_FLOOR || bestKb >= SIMILARITY_FLOOR;
  if (nothingRelevant || !topicCovered) {
    return {
      status: 'UNVERIFIABLE',
      basis: 'not-covered',
      reason: 'Not covered by the knowledge base',
      score: fallbackScore,
      isContradicted: false,
    };
  }

  const bestEntailment = top3Chunks.reduce((m, c) => (c.nli.error ? m : Math.max(m, c.nli.entailment)), 0);
  return {
    status: 'HALLUCINATED',
    basis: 'unsupported-covered',
    reason: `Unsupported claim on a covered topic (question KB match ${pct(promptKbScore)}, best claim KB match ${pct(
      bestKb
    )}, best entailment ${pct(bestEntailment)} < ${pct(ENTAILMENT_THRESHOLD)})`,
    score: fallbackScore,
    isContradicted: false,
  };
}

/** Decide one claim's status from precomputed evidence. Pure. */
export function classifyClaim(input: ClaimClassificationInput): ClaimClassification {
  const decision = decideStatus(input);
  const notes: string[] = [];
  const nliNote = describeNliFailures(input.top3Chunks);
  if (nliNote) notes.push(nliNote);
  if (input.web.error && decision.status !== 'GROUNDED') notes.push(`Web search unavailable: ${input.web.error}`);
  return notes.length > 0 ? { ...decision, reason: `${decision.reason} [${notes.join('; ')}]` } : decision;
}

/**
 * Overall verdict from claim statuses:
 * any HALLUCINATED (incl. contradicted) -> HALLUCINATED if all, else PARTIAL;
 * else any UNVERIFIABLE -> UNVERIFIABLE if all, else PARTIAL; else GROUNDED.
 */
export function computeOverallVerdict(statuses: ClaimStatus[]): Verdict {
  const total = statuses.length;
  const hallucinated = statuses.filter((s) => s === 'HALLUCINATED').length;
  const unverifiable = statuses.filter((s) => s === 'UNVERIFIABLE').length;
  if (hallucinated > 0) return hallucinated === total ? 'HALLUCINATED' : 'PARTIAL';
  if (unverifiable > 0) return unverifiable === total ? 'UNVERIFIABLE' : 'PARTIAL';
  return 'GROUNDED';
}
