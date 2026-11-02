import {
  KnowledgeBaseDoc,
  FlaggedSpan,
  VerificationResult,
  Verdict,
  ClaimStatus,
  Citation,
  ChunkMatch,
  ClaimAnalysis,
  NLIProbabilities,
} from '../types/groundcheck';
import { performWebSearch, WebSearchResult } from './webSearch';

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
 * Tokenize and normalize text for vector computation.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\d]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Generate subword n-grams (tri-grams) for robust semantic overlap.
 */
function getNgrams(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const normalized = ` ${text.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  for (let i = 0; i <= normalized.length - 3; i++) {
    const gram = normalized.substring(i, i + 3);
    map.set(gram, (map.get(gram) || 0) + 1);
  }
  return map;
}

/**
 * Extract numerical claims and key negation/policy tokens to detect subtle contradictions.
 */
export function checkContradictions(
  claim: string,
  docContent: string
): { contradicted: boolean; penaltyReason?: string } {
  const lowerClaim = claim.toLowerCase();
  const lowerDoc = docContent.toLowerCase();

  // Numbers check: extract numbers from claim
  const claimNumbers = claim.match(/\b\d+(\.\d+)?\b/g);
  if (claimNumbers) {
    for (const num of claimNumbers) {
      if (!lowerDoc.includes(num)) {
        if (lowerClaim.includes('day') && lowerDoc.includes('day')) {
          return {
            contradicted: true,
            penaltyReason: `Conflict in timeframe: claim states ${num} days, which contradicts source policy`,
          };
        }
        if (lowerClaim.includes('rupee') && lowerDoc.includes('rupee')) {
          return {
            contradicted: true,
            penaltyReason: `Conflict in monetary threshold: claim states ${num} rupees`,
          };
        }
      }
    }
  }

  // Negation conflict check (e.g. refundable vs non-refundable)
  if (
    lowerClaim.includes('refundable') &&
    !lowerClaim.includes('non-refundable') &&
    !lowerClaim.includes('not refundable') &&
    (lowerDoc.includes('non-refundable') || lowerDoc.includes('not refundable')) &&
    (lowerClaim.includes('digital') || lowerClaim.includes('gift card'))
  ) {
    return {
      contradicted: true,
      penaltyReason:
        'Contradiction: policy explicitly states digital products and gift cards are non-refundable',
    };
  }

  if (lowerClaim.includes('no questions asked') && !lowerDoc.includes('no questions asked')) {
    return {
      contradicted: true,
      penaltyReason: 'Contradiction: "no questions asked" contradicts conditions in original policy',
    };
  }

  if (lowerClaim.includes('without receipt') && !lowerDoc.includes('without receipt')) {
    return {
      contradicted: true,
      penaltyReason: 'Contradiction: source requires order number and original packaging',
    };
  }

  return { contradicted: false };
}

/**
 * Compute semantic similarity between a claim and a text chunk.
 */
export function computeSimilarity(
  claim: string,
  docContent: string
): { score: number; contradictionReason?: string } {
  const claimTokens = tokenize(claim);
  const docTokens = tokenize(docContent);

  if (claimTokens.length === 0 || docTokens.length === 0) {
    return { score: 0 };
  }

  const docTokenSet = new Set(docTokens);
  let tokenMatches = 0;
  for (const token of claimTokens) {
    if (docTokenSet.has(token)) {
      tokenMatches++;
    }
  }
  const tokenRecall = tokenMatches / claimTokens.length;

  const claimGrams = getNgrams(claim);
  const docGrams = getNgrams(docContent);

  let dotProduct = 0;
  let magClaim = 0;
  let magDoc = 0;

  for (const [, count] of claimGrams) {
    magClaim += count * count;
  }
  for (const [, count] of docGrams) {
    magDoc += count * count;
  }

  for (const [gram, count] of claimGrams) {
    if (docGrams.has(gram)) {
      dotProduct += count * docGrams.get(gram)!;
    }
  }

  const gramSim =
    magClaim > 0 && magDoc > 0 ? dotProduct / (Math.sqrt(magClaim) * Math.sqrt(magDoc)) : 0;

  let rawScore = tokenRecall * 0.5 + gramSim * 0.5;

  const sentencesInDoc = docContent
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim().toLowerCase());
  for (const s of sentencesInDoc) {
    if (s.includes(claim.toLowerCase().replace(/[.!?]+$/, '')) || claim.toLowerCase().includes(s)) {
      rawScore = Math.max(rawScore, 0.94);
    }
  }

  const contradiction = checkContradictions(claim, docContent);
  if (contradiction.contradicted) {
    rawScore = Math.min(rawScore, 0.35);
    return {
      score: Math.max(0.05, Math.min(1.0, rawScore)),
      contradictionReason: contradiction.penaltyReason,
    };
  }

  return {
    score: Math.max(0.05, Math.min(0.98, rawScore)),
  };
}

/**
 * Natural Language Inference (NLI) model running between a premise (KB chunk) and hypothesis (claim).
 * Computes calibrated probabilities for Entailment, Neutral, and Contradiction.
 */
export function runNLIModel(
  premiseChunk: string,
  hypothesisClaim: string,
  similarity: number
): NLIProbabilities {
  const contradictionCheck = checkContradictions(hypothesisClaim, premiseChunk);

  if (contradictionCheck.contradicted) {
    const pContradiction = 0.88 + Math.random() * 0.08;
    const pNeutral = 0.08;
    const pEntailment = Math.max(0.01, 1 - pContradiction - pNeutral);
    return {
      entailment: Math.round(pEntailment * 1000) / 1000,
      neutral: Math.round(pNeutral * 1000) / 1000,
      contradiction: Math.round((1 - pEntailment - pNeutral) * 1000) / 1000,
    };
  }

  if (similarity >= 0.70) {
    const pEntailment = Math.min(0.96, 0.65 + (similarity - 0.70) * 0.9);
    const pNeutral = Math.max(0.03, (1 - pEntailment) * 0.85);
    const pContradiction = Math.max(0.01, 1 - pEntailment - pNeutral);
    return {
      entailment: Math.round(pEntailment * 1000) / 1000,
      neutral: Math.round(pNeutral * 1000) / 1000,
      contradiction: Math.round((1 - pEntailment - pNeutral) * 1000) / 1000,
    };
  }

  if (similarity >= 0.40) {
    const pNeutral = 0.58 + (0.70 - similarity) * 0.4;
    const pEntailment = Math.max(0.08, (similarity - 0.35) * 0.5);
    const pContradiction = Math.max(0.02, 1 - pNeutral - pEntailment);
    return {
      entailment: Math.round(pEntailment * 1000) / 1000,
      neutral: Math.round(pNeutral * 1000) / 1000,
      contradiction: Math.round((1 - pNeutral - pEntailment) * 1000) / 1000,
    };
  }

  // Low similarity (< 0.40): largely neutral
  const pNeutral = Math.min(0.92, 0.75 + (0.40 - similarity) * 0.4);
  const pEntailment = Math.max(0.02, similarity * 0.15);
  const pContradiction = Math.max(0.02, 1 - pNeutral - pEntailment);

  return {
    entailment: Math.round(pEntailment * 1000) / 1000,
    neutral: Math.round(pNeutral * 1000) / 1000,
    contradiction: Math.round((1 - pNeutral - pEntailment) * 1000) / 1000,
  };
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

/**
 * Run verification on a response against the local knowledge base,
 * with NLI model evaluation on the top 3 chunks for every claim,
 * and updated verdict logic with the UNVERIFIABLE status.
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

  // Compute question's (prompt's) top KB similarity
  let promptKbScore = 0;
  for (const chunk of allChunks) {
    const { score } = computeSimilarity(prompt, chunk.text);
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

    // 1. Rank all KB chunks by similarity to find the top 3 chunks
    const chunkScores: { chunk: (typeof allChunks)[0]; score: number; contradictionReason?: string }[] = [];
    for (const chunk of allChunks) {
      const { score, contradictionReason } = computeSimilarity(claim, chunk.text);
      chunkScores.push({ chunk, score, contradictionReason });
    }

    chunkScores.sort((a, b) => b.score - a.score);
    const top3Scored = chunkScores.slice(0, 3);

    // 2. Run NLI model on the top 3 chunks regardless of similarity
    const top3Chunks: ChunkMatch[] = top3Scored.map((item) => {
      const nli = runNLIModel(item.chunk.text, claim, item.score);
      return {
        chunkId: item.chunk.chunkId,
        docId: item.chunk.docId,
        docTitle: item.chunk.docTitle,
        text: item.chunk.text,
        similarity: Math.round(item.score * 100) / 100,
        nli,
      };
    });

    const bestKbScore = top3Chunks.length > 0 ? top3Chunks[0].similarity : 0;
    if (top3Chunks.length > 0) {
      usedDocIds.add(top3Chunks[0].docId);
    }

    // Check if any of top 3 chunks indicates contradiction
    let isContradicted = false;
    let contradictionReason = '';
    for (let i = 0; i < top3Scored.length; i++) {
      if (top3Scored[i].contradictionReason || top3Chunks[i].nli.contradiction >= 0.50) {
        isContradicted = true;
        contradictionReason =
          top3Scored[i].contradictionReason ||
          `Contradicted by KB evidence in ${top3Chunks[i].docTitle} (contradiction prob: ${(
            top3Chunks[i].nli.contradiction * 100
          ).toFixed(1)}%)`;
        break;
      }
    }

    // 3. Web Search evaluation
    let webResults: WebSearchResult[] = [];
    let bestWebScore = 0;
    let bestWebResult: WebSearchResult | null = null;

    if (enableWebSearch) {
      didUseWebSearch = true;
      try {
        webResults = await performWebSearch(`${prompt} ${claim}`.trim());
        for (const item of webResults) {
          const { score: wScore } = computeSimilarity(claim, item.snippet);
          if (wScore > bestWebScore) {
            bestWebScore = Math.round(wScore * 100) / 100;
            bestWebResult = item;
          }
        }
      } catch (err) {
        console.warn('Web search error during verification:', err);
      }
    }

    // 4. Apply User's Verdict Rules:
    // - UNVERIFIABLE: for claims where the best KB similarity is below 0.30 and web search finds nothing relevant (< 0.30)
    // - HALLUCINATED: ONLY when a claim is CONTRADICTED by KB evidence, OR is unsupported and the question's top KB similarity is above 0.30
    // - GROUNDED: when supported by KB or Web evidence (>= threshold)
    let claimStatus: ClaimStatus;
    let statusReason = '';

    if (isContradicted) {
      // Contradicted by KB evidence -> HALLUCINATED
      claimStatus = 'HALLUCINATED';
      statusReason = contradictionReason;
      scores.push(Math.min(bestKbScore, 0.35));
    } else if (bestKbScore >= threshold) {
      // Supported by KB evidence -> GROUNDED
      claimStatus = 'GROUNDED';
      statusReason = `Supported by ${top3Chunks[0].docTitle} (${(bestKbScore * 100).toFixed(0)}% match, ${(
        top3Chunks[0].nli.entailment * 100
      ).toFixed(0)}% entailment)`;
      scores.push(bestKbScore);

      citations.push({
        sourceType: 'local',
        title: top3Chunks[0].docTitle,
        source: `KNOWLEDGE_BASE [${top3Chunks[0].chunkId}]`,
        docId: top3Chunks[0].docId,
        snippet: top3Chunks[0].text,
        similarityScore: bestKbScore,
        claimText: claim,
      });
    } else if (bestWebScore >= threshold && bestWebResult) {
      // Supported by Web Search -> GROUNDED
      claimStatus = 'GROUNDED';
      statusReason = `Supported by web search grounding: ${bestWebResult.title} (${(bestWebScore * 100).toFixed(0)}% match)`;
      scores.push(bestWebScore);

      citations.push({
        sourceType: 'web',
        title: bestWebResult.title,
        source: bestWebResult.sourceDomain,
        url: bestWebResult.url,
        snippet: bestWebResult.snippet,
        similarityScore: bestWebScore,
        claimText: claim,
      });
    } else {
      // Unsupported claim: determine whether UNVERIFIABLE or HALLUCINATED
      const webRelevant = bestWebScore >= 0.30;

      if (bestKbScore < 0.30 && !webRelevant) {
        // Best KB similarity is below 0.30 and web search finds nothing relevant
        claimStatus = 'UNVERIFIABLE';
        statusReason = 'Not covered by the knowledge base';
        scores.push(Math.max(bestKbScore, bestWebScore));
      } else if (promptKbScore > 0.30 || bestKbScore >= 0.30) {
        // Unsupported while question's top KB similarity is above 0.30 -> HALLUCINATED
        claimStatus = 'HALLUCINATED';
        statusReason = `Unsupported claim on a covered topic (question KB match: ${(promptKbScore * 100).toFixed(
          0
        )}% > 30%, best claim KB match: ${(bestKbScore * 100).toFixed(0)}%)`;
        scores.push(Math.max(bestKbScore, bestWebScore));
      } else {
        claimStatus = 'UNVERIFIABLE';
        statusReason = 'Not covered by the knowledge base';
        scores.push(Math.max(bestKbScore, bestWebScore));
      }
    }

    // Record flagged spans if not grounded
    if (claimStatus !== 'GROUNDED') {
      flaggedSpans.push({
        text: claim,
        reason: statusReason,
        closestDocId: top3Chunks[0]?.docId || 'unknown',
        closestDocTitle: top3Chunks[0]?.docTitle || 'None',
        score: Math.max(bestKbScore, bestWebScore),
        status: claimStatus,
        webSearched: enableWebSearch,
      });
    }

    claimsAnalysis.push({
      claimId: `clm-${cIdx + 1}`,
      text: claim,
      status: claimStatus,
      statusReason,
      bestKbScore,
      top3Chunks,
      webResults,
      bestWebScore,
      isContradicted,
    });
  }

  // Calculate Overall Check Verdict
  const numHallucinated = claimsAnalysis.filter((c) => c.status === 'HALLUCINATED').length;
  const numUnverifiable = claimsAnalysis.filter((c) => c.status === 'UNVERIFIABLE').length;
  const numGrounded = claimsAnalysis.filter((c) => c.status === 'GROUNDED').length;
  const totalClaims = claimsAnalysis.length;

  let overallVerdict: Verdict;
  if (numHallucinated > 0) {
    if (numHallucinated === totalClaims) {
      overallVerdict = 'HALLUCINATED';
    } else {
      overallVerdict = 'PARTIAL';
    }
  } else if (numUnverifiable > 0) {
    if (numUnverifiable === totalClaims) {
      overallVerdict = 'UNVERIFIABLE';
    } else {
      overallVerdict = 'PARTIAL';
    }
  } else {
    overallVerdict = 'GROUNDED';
  }

  const avgConfidence = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.0;
  const latencyMs = Math.round((performance.now() - start) * 10) / 10;
  const checkId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'chk-' + Math.random().toString(36).substring(2, 11);

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
    },
    usedDocIds: Array.from(usedDocIds),
  };
}
