import { NLIProbabilities } from '../types/groundcheck';
import { ApiError, errorCodeOf, fetchJson, formatApiError, tagUpstreamError } from './apiClient';
import { makeNeutralFallback, validateAndNormalizeScores } from './nliScores';

/**
 * Browser-side NLI client. The Gemini judge itself runs on the server
 * (server/nliJudge.ts via @google/genai, temperature 0, strict JSON schema)
 * so the API key never reaches the browser. This module adds caching,
 * batching, timeouts and strict validation of what the server returns.
 */

export interface NLIPair {
  premise: string;
  hypothesis: string;
}

export interface NLIBatchResult {
  pairs: NLIPair[];
  results: NLIProbabilities[];
}

/** v3: v1 and v2 entries came from a judge whose temperature was not set (model default). */
const NLI_CACHE_KEY = 'groundcheck_nli_cache_v3';
const MAX_PERSISTED_ENTRIES = 500;
/** Per-attempt server timeout; one call may judge all top-3 chunks of a claim at once. */
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 4;
/** Extra client-side allowance on top of the server's own per-call timeouts. */
const NETWORK_SLACK_MS = 3_000;
/** The server retries each Gemini call up to 4 attempts with ~7 s of backoff in total. */
const SERVER_MAX_ATTEMPTS = 4;
const SERVER_BACKOFF_BUDGET_MS = 8_000;

/** Longest a server-side judgment can take with retries, plus slack. */
function retryAwareTimeout(perAttemptMs: number): number {
  return perAttemptMs * SERVER_MAX_ATTEMPTS + SERVER_BACKOFF_BUDGET_MS + NETWORK_SLACK_MS;
}

function failedJudgment(err: unknown): NLIProbabilities {
  const message = formatApiError(err);
  return {
    ...makeNeutralFallback(message),
    errorCode: err instanceof ApiError ? err.code : errorCodeOf(message),
    attempts: err instanceof ApiError ? err.attempts : undefined,
  };
}
const UNKNOWN_SOURCE = 'unknown';

const inMemoryNliCache = new Map<string, NLIProbabilities>();

/**
 * Deterministic 53-bit hash (cyrb53) of the trimmed (premise, hypothesis) pair,
 * prefixed with both lengths to make collisions between distinct pairs negligible.
 */
export function hashPair(premise: string, hypothesis: string): string {
  const p = premise.trim();
  const h = hypothesis.trim();
  const combined = `${p}\u0000${h}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < combined.length; i++) {
    const ch = combined.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `${p.length}.${h.length}.${hash.toString(16)}`;
}

function loadPersistedNliCache(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem(NLI_CACHE_KEY);
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return;
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      const source =
        typeof val === 'object' && val !== null && typeof (val as { source?: unknown }).source === 'string'
          ? (val as { source: string }).source
          : UNKNOWN_SOURCE;
      const validation = validateAndNormalizeScores(val, source);
      if (validation.ok) inMemoryNliCache.set(key, validation.value);
    }
  } catch (err) {
    console.warn('NLI cache could not be loaded from localStorage; starting empty.', err);
  }
}

function persistNliCache(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const obj: Record<string, NLIProbabilities> = {};
    for (const [key, val] of Array.from(inMemoryNliCache.entries()).slice(-MAX_PERSISTED_ENTRIES)) {
      obj[key] = val;
    }
    localStorage.setItem(NLI_CACHE_KEY, JSON.stringify(obj));
  } catch (err) {
    // Persistence is a convenience; the in-memory cache still works.
    console.warn('NLI cache could not be persisted to localStorage.', err);
  }
}

loadPersistedNliCache();

/** Store only successful judgments; errors must be retried, never replayed from cache. */
function cacheIfValid(key: string, result: NLIProbabilities): boolean {
  if (result.error) return false;
  inMemoryNliCache.set(key, result);
  return true;
}

/**
 * Normalize probabilities so entailment + neutral + contradiction = 1.
 * Kept for backwards compatibility. Invalid inputs (negative, NaN, > 1, zero sum)
 * produce an error-flagged neutral result instead of fabricated numbers.
 */
export function normalizeNliProbabilities(
  rawEntailment: number,
  rawNeutral: number,
  rawContradiction: number,
  error?: string,
  source: string = UNKNOWN_SOURCE
): NLIProbabilities {
  if (error) return makeNeutralFallback(error, source);
  const validation = validateAndNormalizeScores(
    { entailment: rawEntailment, neutral: rawNeutral, contradiction: rawContradiction },
    source
  );
  return validation.ok ? validation.value : makeNeutralFallback(validation.error, source);
}

/** Strictly interpret one judgment object returned by the server. */
function parseServerJudgment(raw: unknown): NLIProbabilities {
  if (typeof raw !== 'object' || raw === null) {
    return makeNeutralFallback('Malformed NLI response from server');
  }
  const { error, source, errorCode, attempts } = raw as {
    error?: unknown;
    source?: unknown;
    errorCode?: unknown;
    attempts?: unknown;
  };
  const src = typeof source === 'string' ? source : UNKNOWN_SOURCE;
  const att = typeof attempts === 'number' ? attempts : undefined;
  if (typeof error === 'string' && error) {
    const tagged = tagUpstreamError(error);
    return {
      ...makeNeutralFallback(tagged, src),
      errorCode: typeof errorCode === 'string' ? errorCode : errorCodeOf(tagged),
      attempts: att,
    };
  }
  const validation = validateAndNormalizeScores(raw, src);
  return validation.ok
    ? { ...validation.value, attempts: att }
    : makeNeutralFallback(`Server NLI response rejected: ${validation.error}`);
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  return fetchJson<unknown>(url, { method: 'POST', json: body, timeoutMs });
}

export interface NLIOptions {
  generationConfig?: {
    temperature?: number;
    [key: string]: unknown;
  };
}

/**
 * Judge whether `premise` entails, is neutral to, or contradicts `hypothesis`.
 * Never throws. On any failure returns neutral = 1 with `error` set.
 */
export async function judgeEntailment(
  premise: string,
  hypothesis: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  options: NLIOptions = { generationConfig: { temperature: 0 } }
): Promise<NLIProbabilities> {
  const p = premise.trim();
  const h = hypothesis.trim();
  if (!p || !h) return makeNeutralFallback('Empty premise or hypothesis');

  const key = hashPair(p, h);
  const cached = inMemoryNliCache.get(key);
  if (cached) return cached;

  let result: NLIProbabilities;
  try {
    const data = await postJson(
      '/api/nli/judge',
      {
        premise: p,
        hypothesis: h,
        generationConfig: options.generationConfig ?? { temperature: 0 },
      },
      retryAwareTimeout(timeoutMs)
    );
    result = parseServerJudgment(data);
  } catch (err) {
    result = failedJudgment(err);
  }

  if (cacheIfValid(key, result)) persistNliCache();
  return result;
}

/**
 * Judge many pairs with a concurrency limit and per-call timeout via the server batch
 * endpoint (which retries each pair). If the batch request itself fails, every pending
 * pair gets an error-flagged neutral result with the typed code. There is no per-pair
 * fallback: during an outage it would only multiply failing calls. Never cached.
 * Result order matches input order.
 */
export async function judgeEntailmentBatch(
  pairs: NLIPair[],
  concurrency: number = DEFAULT_CONCURRENCY,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  options: NLIOptions = { generationConfig: { temperature: 0 } }
): Promise<NLIProbabilities[]> {
  const results: NLIProbabilities[] = new Array(pairs.length);
  const pending: { index: number; pair: NLIPair; key: string }[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i].premise.trim();
    const h = pairs[i].hypothesis.trim();
    if (!p || !h) {
      results[i] = makeNeutralFallback('Empty premise or hypothesis');
      continue;
    }
    const key = hashPair(p, h);
    const cached = inMemoryNliCache.get(key);
    if (cached) {
      results[i] = cached;
    } else {
      pending.push({ index: i, pair: { premise: p, hypothesis: h }, key });
    }
  }

  if (pending.length === 0) return results;

  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  // The server judges all premises of one hypothesis in a single call, so it runs
  // ceil(distinctHypotheses / concurrency) rounds, each bounded by its retry budget.
  const distinctHypotheses = new Set(pending.map((x) => x.pair.hypothesis)).size;
  const batchTimeoutMs = Math.ceil(distinctHypotheses / safeConcurrency) * retryAwareTimeout(timeoutMs);

  try {
    const data = await postJson(
      '/api/nli/judge-batch',
      {
        pairs: pending.map((x) => x.pair),
        concurrency: safeConcurrency,
        timeoutMs,
        generationConfig: options.generationConfig ?? { temperature: 0 },
      },
      batchTimeoutMs
    );
    const serverResults = (data as { results?: unknown } | null)?.results;
    if (!Array.isArray(serverResults) || serverResults.length !== pending.length) {
      throw new Error(
        `Batch response length mismatch: expected ${pending.length}, got ${
          Array.isArray(serverResults) ? serverResults.length : 'none'
        }`
      );
    }

    let cacheUpdated = false;
    pending.forEach((item, j) => {
      const judgment = parseServerJudgment(serverResults[j]);
      results[item.index] = judgment;
      if (cacheIfValid(item.key, judgment)) cacheUpdated = true;
    });
    if (cacheUpdated) persistNliCache();
    return results;
  } catch (err) {
    const failed = failedJudgment(err);
    console.warn(`NLI batch request failed for ${pending.length} pair(s): ${failed.error ?? ''}`);
    for (const item of pending) results[item.index] = failed;
    return results;
  }
}
