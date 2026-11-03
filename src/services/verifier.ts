import {
  KnowledgeBaseDoc,
  FlaggedSpan,
  VerificationResult,
  Verdict,
  Citation,
  ChunkMatch,
  ClaimAnalysis,
  NLIProbabilities,
  WebEvidenceMatch,
} from '../types/groundcheck';
import { performWebSearchDetailed, WebSearchResult } from './webSearch';
import { embedTexts, cosineSimilarity, EmbeddingError } from './embeddings';
import { judgeEntailment, judgeEntailmentBatch } from './nli';
import { findQuantityConflict, QuantityConflictResult } from './conflictCheck';
import { classifyClaim, computeOverallVerdict, infrastructureFailure, DecisionBasis } from './claimClassifier';
import { buildSearchQuery, SearchQuery } from './queryBuilder';

export interface SimilarityResult {
  score: number;
}

/**
 * Split text into individual claims (sentences).
 */
export function splitIntoClaims(text: string): string[] {
  if (!text || !text.trim()) return [];
  const rawSentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return rawSentences;
}

/**
 * Deterministic quantity-conflict check against the BEST-matching chunk only.
 * Checking only the best match avoids flagging values that are merely absent from,
 * or stated for a different topic in, unrelated chunks.
 */
export function checkBestChunkQuantityConflict(
  claim: string,
  bestChunk: ChunkMatch | undefined
): QuantityConflictResult {
  if (!bestChunk) return { conflict: false };
  return findQuantityConflict(claim, bestChunk.text);
}

/**
 * Compute semantic similarity between two texts using real Gemini embeddings.
 * Backed by embeddings.ts, returning { score: number }.
 */
export async function computeSimilarity(
  claim: string,
  docContent: string
): Promise<SimilarityResult> {
  const vectors = await embedTexts([claim, docContent]);
  if (!vectors[0] || !vectors[1]) {
    throw new EmbeddingError('Failed to generate embeddings for similarity comparison');
  }
  const rawScore = cosineSimilarity(vectors[0], vectors[1]);
  return {
    score: Math.max(0, Math.min(1, rawScore)),
  };
}

/**
 * Natural Language Inference (NLI) model running between a premise (KB chunk) and hypothesis (claim).
 * Thin async wrapper around judgeEntailment in nli.ts for backwards compatibility.
 */
export async function runNLIModel(
  premiseChunk: string,
  hypothesisClaim: string,
  _similarity?: number
): Promise<NLIProbabilities> {
  return judgeEntailment(premiseChunk, hypothesisClaim);
}

/**
 * Split all Knowledge Base documents into granular sentence-level chunks for NLI evaluation.
 */
export function extractKbChunks(
  kb: KnowledgeBaseDoc[]
): { chunkId: string; docId: string; docTitle: string; text: string }[] {
  const chunks: { chunkId: string; docId: string; docTitle: string; text: string }[] = [];

  for (const doc of kb) {
    const sentences = doc.content
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);

    sentences.forEach((s, idx) => {
      chunks.push({
        chunkId: `${doc.docId}-chk-${idx + 1}`,
        docId: doc.docId,
        docTitle: doc.title,
        text: s,
      });
    });
  }

  return chunks;
}

export interface WebEvidenceResult {
  results: WebSearchResult[];
  bestScore: number;
  bestResult: WebSearchResult | null;
  /** The query actually sent, when web search was enabled. */
  query?: SearchQuery;
  /** Scored non-echo snippets, best similarity first; the best 3 carry NLI. */
  matches: WebEvidenceMatch[];
  /** Set when web search was enabled but failed or returned nothing usable. */
  error?: string;
  /** Snippets dropped because they restate the claim or query. */
  echoesDiscarded: number;
}

/** KB decisions that never read web evidence (see decideStatus), so web search can be skipped. */
const KB_DECISIVE_BASES: ReadonlySet<DecisionBasis> = new Set<DecisionBasis>([
  'contradiction',
  'kb-entailment',
  'negation-entailment',
]);

/** Number of web snippets that get an NLI judgment. */
export const WEB_NLI_TOP_K = 3;

function normalizeForEcho(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentTokens(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length >= 3);
}

/**
 * True if a snippet merely restates the claim or the search query: it contains either
 * one verbatim (after normalization), or it is a short text made almost entirely of the
 * claim's words. Such snippets would trivially "entail" the claim, so they are never scored.
 */
export function snippetEchoesQuery(snippet: string, claim: string, query: string): boolean {
  const s = normalizeForEcho(snippet);
  const c = normalizeForEcho(claim);
  const q = normalizeForEcho(query);
  if (!s) return true;
  if ((c && s.includes(c)) || (q && s.includes(q))) return true;

  const claimTokens = contentTokens(c);
  const snippetTokens = contentTokens(s);
  if (claimTokens.length < 5 || snippetTokens.length > claimTokens.length * 1.5) return false;
  const snippetSet = new Set(snippetTokens);
  const covered = claimTokens.filter((t) => snippetSet.has(t)).length;
  return covered / claimTokens.length >= 0.9;
}

/**
 * Retrieve grounded web sources for a claim (query from queryBuilder), drop echo snippets,
 * score the rest against the claim with embeddings, and run NLI on the best 3.
 * Failures are recorded in `error`, never hidden.
 */
async function gatherWebEvidence(prompt: string, claim: string, enabled: boolean): Promise<WebEvidenceResult> {
  const evidence: WebEvidenceResult = { results: [], bestScore: 0, bestResult: null, matches: [], echoesDiscarded: 0 };
  if (!enabled) return evidence;
  try {
    evidence.query = await buildSearchQuery(prompt, claim);
    const outcome = await performWebSearchDetailed(evidence.query.text);
    evidence.results = outcome.results;
    if (outcome.error) {
      evidence.error = outcome.error;
      return evidence;
    }

    const candidates = outcome.results.filter((r) => !snippetEchoesQuery(r.snippet, claim, evidence.query?.text ?? ''));
    evidence.echoesDiscarded = outcome.results.length - candidates.length;
    if (candidates.length === 0) {
      evidence.error =
        outcome.results.length === 0
          ? 'Web search returned no grounded sources'
          : `All ${outcome.results.length} web snippet(s) restated the claim/query and were discarded`;
      return evidence;
    }

    // Batch-embed claim + snippets once; computeSimilarity then hits the cache.
    await embedTexts([claim, ...candidates.map((r) => r.snippet)]);
    const scored: WebEvidenceMatch[] = [];
    for (const result of candidates) {
      const { score } = await computeSimilarity(claim, result.snippet);
      scored.push({ result, similarity: Math.round(score * 100) / 100 });
    }
    scored.sort((a, b) => b.similarity - a.similarity);

    const top = scored.slice(0, WEB_NLI_TOP_K);
    const judgments = await judgeEntailmentBatch(top.map((m) => ({ premise: m.result.snippet, hypothesis: claim })));
    top.forEach((m, i) => {
      m.nli = judgments[i];
    });

    evidence.matches = scored;
    evidence.bestScore = scored[0].similarity;
    evidence.bestResult = scored[0].result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Web evidence scoring failed during verification:', msg);
    evidence.error = `Web evidence scoring failed: ${msg}`;
  }
  return evidence;
}

function buildKbCitation(chunk: ChunkMatch, claim: string): Citation {
  return {
    sourceType: 'local',
    title: chunk.docTitle,
    source: `KNOWLEDGE_BASE [${chunk.chunkId}]`,
    docId: chunk.docId,
    snippet: chunk.text,
    similarityScore: chunk.similarity,
    claimText: claim,
    trust: 'high',
  };
}

function buildWebCitation(result: WebSearchResult, score: number, claim: string): Citation {
  return {
    trust: 'lower',
    sourceType: 'web',
    title: result.title,
    source: result.sourceDomain,
    url: result.url,
    snippet: result.snippet,
    similarityScore: score,
    claimText: claim,
  };
}

/**
 * Run verification on a response against the local knowledge base,
 * with NLI on the top 3 chunks for every claim. Orchestrates I/O (embeddings, NLI,
 * web search) and delegates every decision to the pure helpers in claimClassifier.ts.
 */
export async function verifyResponse(
  prompt: string,
  response: string,
  modelName: string,
  kb: KnowledgeBaseDoc[],
  threshold = 0.60,
  enableWebSearch = true
): Promise<{
  result: VerificationResult;
  usedDocIds: string[];
}> {
  const start = performance.now();

  const allChunks = extractKbChunks(kb);
  const claims = splitIntoClaims(response);

  // Embed all KB chunks once per verification run (batched)
  if (allChunks.length > 0) {
    await embedTexts(allChunks.map((c) => c.text));
  }

  // Compute question's (prompt's) top KB similarity
  let promptKbScore = 0;
  for (const chunk of allChunks) {
    const { score } = await computeSimilarity(prompt, chunk.text);
    if (score > promptKbScore) {
      promptKbScore = score;
    }
  }

  const flaggedSpans: FlaggedSpan[] = [];
  const claimsAnalysis: ClaimAnalysis[] = [];
  const scores: number[] = [];
  const usedDocIds = new Set<string>();
  const citations: Citation[] = [];
  let didUseWebSearch = false;

  for (let cIdx = 0; cIdx < claims.length; cIdx++) {
    const claim = claims[cIdx];

    // 1. Rank all KB chunks by similarity to find the top 3 chunks (claim is embedded on demand)
    const chunkScores: { chunk: (typeof allChunks)[0]; score: number }[] = [];
    for (const chunk of allChunks) {
      const { score } = await computeSimilarity(claim, chunk.text);
      chunkScores.push({ chunk, score });
    }

    chunkScores.sort((a, b) => b.score - a.score);
    const top3Scored = chunkScores.slice(0, 3);

    // 2. Run NLI model on the top 3 chunks regardless of similarity
    const top3Pairs = top3Scored.map((item) => ({
      premise: item.chunk.text,
      hypothesis: claim,
    }));
    const top3NliResults = await judgeEntailmentBatch(top3Pairs);

    const top3Chunks: ChunkMatch[] = top3Scored.map((item, idx) => ({
      chunkId: item.chunk.chunkId,
      docId: item.chunk.docId,
      docTitle: item.chunk.docTitle,
      text: item.chunk.text,
      similarity: Math.round(item.score * 100) / 100,
      nli: top3NliResults[idx],
    }));

    const bestKbScore = top3Chunks.length > 0 ? top3Chunks[0].similarity : 0;
    if (top3Chunks.length > 0) {
      usedDocIds.add(top3Chunks[0].docId);
    }

    // 3. Deterministic quantity check against the best-matching chunk only.
    const quantityConflict = checkBestChunkQuantityConflict(claim, top3Chunks[0]);

    // 4. Decide from the KB first. Web evidence is only consulted when the KB neither
    //    contradicts nor supports the claim, so skipping the search in that case cannot
    //    change the verdict; it saves 3+ Gemini calls (terms, grounded search, NLI) per claim.
    const kbOnlyInput = { claim, top3Chunks, quantityConflict, threshold, promptKbScore };
    const kbDecision = classifyClaim({ ...kbOnlyInput, web: { bestScore: 0, bestResult: null, matches: [] } });
    const webSkipped = enableWebSearch && KB_DECISIVE_BASES.has(kbDecision.basis);

    // 5. Grounded web evidence (lower trust), scored with embeddings + NLI.
    const web = await gatherWebEvidence(prompt, claim, enableWebSearch && !webSkipped);
    if (enableWebSearch && !webSkipped) didUseWebSearch = true;

    // 6. Pure decision.
    const decision = webSkipped
      ? kbDecision
      : classifyClaim({
          ...kbOnlyInput,
          web: { bestScore: web.bestScore, bestResult: web.bestResult, matches: web.matches, error: web.error },
        });
    const analysis: ClaimAnalysis = {
      claimId: `clm-${cIdx + 1}`,
      text: claim,
      status: decision.status,
      statusReason: decision.reason,
      bestKbScore,
      top3Chunks,
      webResults: web.results,
      bestWebScore: web.bestScore,
      isContradicted: decision.isContradicted,
      contradictionSource: decision.contradictionSource,
      supportingChunkId: decision.supportingChunk?.chunkId,
      searchQuery: web.query?.text,
      searchEntities: web.query?.entities,
      searchQueryDegraded: web.query?.degraded,
      searchQueryError: web.query?.error,
      webMatches: enableWebSearch ? web.matches : undefined,
      webSearchError: web.error,
      webEchoesDiscarded: web.echoesDiscarded > 0 ? web.echoesDiscarded : undefined,
      webSkipped: webSkipped || undefined,
    };
    analysis.infrastructureError = infrastructureFailure(analysis, enableWebSearch && !webSkipped);
    claimsAnalysis.push(analysis);

    // A claim whose status depended on a failed upstream call is an infrastructure warning,
    // not a verdict: it adds no citation, flagged span or confidence score.
    if (analysis.infrastructureError) continue;
    scores.push(decision.score);

    if (decision.status === 'GROUNDED') {
      if (decision.supportingChunk) {
        citations.push(buildKbCitation(decision.supportingChunk, claim));
      } else if (decision.supportingWeb) {
        citations.push(buildWebCitation(decision.supportingWeb.result, decision.supportingWeb.similarity, claim));
      }
    } else {
      flaggedSpans.push({
        text: claim,
        reason: decision.reason,
        closestDocId: top3Chunks[0]?.docId || 'unknown',
        closestDocTitle: top3Chunks[0]?.docTitle || 'None',
        score: Math.max(bestKbScore, web.bestScore),
        status: decision.status,
        webSearched: enableWebSearch,
      });
    }
  }

  const totalClaims = claimsAnalysis.length;
  const verified = claimsAnalysis.filter((c) => !c.infrastructureError);
  const infrastructureErrors = totalClaims - verified.length;
  // Verdict over verified claims only. If nothing could be verified, say UNVERIFIABLE
  // (never GROUNDED by default) and report the infrastructure errors alongside.
  const overallVerdict: Verdict =
    totalClaims > 0 && verified.length === 0 ? 'UNVERIFIABLE' : computeOverallVerdict(verified.map((c) => c.status));

  const avgConfidence = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.0;
  const latencyMs = Math.round((performance.now() - start) * 10) / 10;
  const checkId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `chk-${Date.now().toString(36)}-${performance.now().toString(36).replace('.', '')}`;

  return {
    result: {
      checkId,
      verdict: overallVerdict,
      confidenceScore: Math.round(avgConfidence * 10000) / 10000,
      flaggedSpans,
      claimsAnalysis,
      numClaims: totalClaims,
      numFlagged: flaggedSpans.length,
      latencyMs: Math.max(15, latencyMs),
      citations,
      usedWebSearch: didUseWebSearch,
      promptKbScore: Math.round(promptKbScore * 100) / 100,
      infrastructureErrors: infrastructureErrors > 0 ? infrastructureErrors : undefined,
    },
    usedDocIds: Array.from(usedDocIds),
  };
}
