import { WebSearchResult } from '../services/webSearch';

export type Verdict = 'GROUNDED' | 'PARTIAL' | 'HALLUCINATED' | 'UNVERIFIABLE';

export type ClaimStatus = 'GROUNDED' | 'HALLUCINATED' | 'UNVERIFIABLE';

export interface KnowledgeBaseDoc {
  docId: string;
  title: string;
  content: string;
  source: string;
  embedding: number[];
  createdAt: string;
}

export interface Citation {
  sourceType: 'local' | 'web';
  title: string;
  source: string;
  url?: string;
  docId?: string;
  snippet: string;
  similarityScore: number;
  claimText?: string;
  /** 'lower' for web evidence (model-summarized grounding text), 'high' for the local KB. */
  trust?: 'high' | 'lower';
}

/** A web snippet scored against a claim. */
export interface WebEvidenceMatch {
  result: WebSearchResult;
  /** Embedding similarity between claim and snippet (0..1). */
  similarity: number;
  /** NLI judgment with the snippet as premise; only set for the best 3 snippets. */
  nli?: NLIProbabilities;
}

export interface NLIProbabilities {
  entailment: number;
  neutral: number;
  contradiction: number;
  error?: string;
  source?: string;
}

export interface ChunkMatch {
  chunkId: string;
  docId: string;
  docTitle: string;
  text: string;
  similarity: number;
  nli: NLIProbabilities;
}

export interface ClaimAnalysis {
  claimId: string;
  text: string;
  status: ClaimStatus;
  statusReason: string;
  bestKbScore: number;
  top3Chunks: ChunkMatch[];
  webResults: WebSearchResult[];
  bestWebScore: number;
  isContradicted: boolean;
  /** What triggered the contradiction, when isContradicted is true. */
  contradictionSource?: ContradictionSource;
  /** Chunk whose entailment grounded the claim, when grounded by the KB. */
  supportingChunkId?: string;
  /** Exact web search query sent for this claim. */
  searchQuery?: string;
  /** Prompt entities/terms appended to the claim in searchQuery. */
  searchEntities?: string[];
  /** True when term extraction failed and searchQuery is the claim alone. */
  searchQueryDegraded?: boolean;
  /** Reason the query was degraded. */
  searchQueryError?: string;
  /** Scored web snippets (best first); echo snippets excluded. */
  webMatches?: WebEvidenceMatch[];
  /** Set when web search was enabled but failed or was unavailable. */
  webSearchError?: string;
  /** Number of web snippets discarded because they restate the claim/query. */
  webEchoesDiscarded?: number;
}

export type ContradictionSource = 'quantity' | 'nli';

export interface FlaggedSpan {
  text: string;
  reason: string;
  closestDocId: string;
  closestDocTitle: string;
  score: number;
  status?: ClaimStatus;
  webSearched?: boolean;
}

export interface CheckRecord {
  checkId: string;
  prompt: string;
  response: string;
  modelName: string;
  verdict: Verdict;
  confidenceScore: number;
  flaggedSpans: FlaggedSpan[];
  sourceDocIds: string[];
  latencyMs: number;
  createdAt: string;
  citations?: Citation[];
  claimsAnalysis?: ClaimAnalysis[];
  usedWebSearch?: boolean;
}

export interface DailyModelStat {
  checkDate: string;
  modelName: string;
  totalChecks: number;
  hallucinatedCount: number;
  partialCount: number;
  groundedCount: number;
  unverifiableCount?: number;
  avgConfidence: number;
  hallucinationRate: number;
}

export interface VerificationResult {
  checkId: string;
  verdict: Verdict;
  confidenceScore: number;
  flaggedSpans: FlaggedSpan[];
  claimsAnalysis: ClaimAnalysis[];
  numClaims: number;
  numFlagged: number;
  latencyMs: number;
  citations: Citation[];
  usedWebSearch: boolean;
  promptKbScore?: number;
}
