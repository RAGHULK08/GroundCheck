import { NLIProbabilities } from '../types/groundcheck';
import { fetchJson, formatApiError, tagUpstreamError } from './apiClient';
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

/** Bumped from v1: v1 entries came from a non-deterministic (temperature != 0) judge. */
const NLI_CACHE_KEY = 'groundcheck_nli_cache_v2';
const MAX_PERSISTED_ENTRIES = 500;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;
/** Extra client-side allowance on top of the server's own per-call timeouts. */
const NETWORK_SLACK_MS = 3_000;
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
  const { error, source } = raw as { error?: unknown; source?: unknown };
  const src = typeof source === 'string' ? source : UNKNOWN_SOURCE;
  if (typeof error === 'string' && error) {
    return makeNeutralFallback(tagUpstreamError(error), src);
  }
  const validation = validateAndNormalizeScores(raw, src);
  return validation.ok ? validation.value : makeNeutralFallback(`Server NLI response rejected: ${validation.error}`);
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  return fetchJson<unknown>(url, { method: 'POST', json: body, timeoutMs });
}

/**
 * Judge whether `premise` entails, is neutral to, or contradicts `hypothesis`.
 * Never throws. On any failure returns neutral = 1 with `error` set.
 */
export async function judgeEntailment(
  premise: string,
  hypothesis: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<NLIProbabilities> {
  const p = premise.trim();
  const h = hypothesis.trim();
  if (!p || !h) return makeNeutralFallback('Empty premise or hypothesis');

  const key = hashPair(p, h);
  const cached = inMemoryNliCache.get(key);
  if (cached) return cached;

  let result: NLIProbabilities;
  try {
    const data = await postJson('/api/nli/judge', { premise: p, hypothesis: h }, timeoutMs + NETWORK_SLACK_MS);
    result = parseServerJudgment(data);
  } catch (err) {
    result = makeNeutralFallback(formatApiError(err));
  }

  if (cacheIfValid(key, result)) persistNliCache();
  return result;
}

/**
 * Judge many pairs with a concurrency limit and per-call timeout.
 * Uses the server batch endpoint; if that request itself fails, falls back to
 * individual calls through a client-side worker pool (logged, not silent).
 * Result order matches input order.
 */
export async function judgeEntailmentBatch(
  pairs: NLIPair[],
  concurrency: number = DEFAULT_CONCURRENCY,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
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
  // Server runs ceil(n / concurrency) sequential rounds, each bounded by timeoutMs.
  const batchTimeoutMs = Math.ceil(pending.length / safeConcurrency) * timeoutMs + NETWORK_SLACK_MS;

  try {
    const data = await postJson(
      '/api/nli/judge-batch',
      { pairs: pending.map((x) => x.pair), concurrency: safeConcurrency, timeoutMs },
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
    console.warn(
      'NLI batch endpoint failed; falling back to individual calls.',
      err instanceof Error ? err.message : err
    );
  }

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < pending.length) {
      const item = pending[next++];
      results[item.index] = await judgeEntailment(item.pair.premise, item.pair.hypothesis, timeoutMs);
    }
  };
  const pool: Promise<void>[] = [];
  for (let w = 0; w < Math.min(safeConcurrency, pending.length); w++) {
    pool.push(worker());
  }
  await Promise.all(pool);
  return results;
}
