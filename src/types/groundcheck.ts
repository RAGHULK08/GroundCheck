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
}

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
