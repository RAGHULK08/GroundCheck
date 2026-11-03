import { NLIProbabilities } from '../types/groundcheck';

export interface NLIPair {
  premise: string;
  hypothesis: string;
}

export interface NLIBatchResult {
  pairs: NLIPair[];
  results: NLIProbabilities[];
}

const NLI_CACHE_KEY = 'groundcheck_nli_cache_v1';

/**
 * In-memory NLI cache
 */
const inMemoryNliCache = new Map<string, NLIProbabilities>();

/**
 * Deterministic hash key for (premise, hypothesis) pair
 */
export function hashPair(premise: string, hypothesis: string): string {
  const combined = `${premise.trim()}|||${hypothesis.trim()}`;
  let hash = 5381;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash * 33) ^ combined.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Load persisted NLI cache from localStorage
 */
function loadPersistedNliCache(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(NLI_CACHE_KEY);
      if (stored) {
        const parsed: Record<string, NLIProbabilities> = JSON.parse(stored);
        for (const [key, val] of Object.entries(parsed)) {
          if (
            typeof val.entailment === 'number' &&
            typeof val.neutral === 'number' &&
            typeof val.contradiction === 'number'
          ) {
            inMemoryNliCache.set(key, val);
          }
        }
      }
    }
  } catch {
    // Graceful storage fallback
  }
}

/**
 * Persist in-memory NLI cache to localStorage
 */
function persistNliCache(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const obj: Record<string, NLIProbabilities> = {};
      const entries = Array.from(inMemoryNliCache.entries()).slice(-500);
      for (const [key, val] of entries) {
        obj[key] = val;
      }
      localStorage.setItem(NLI_CACHE_KEY, JSON.stringify(obj));
    }
  } catch {
    // Graceful storage fallback
  }
}

// Load cache on module initialization
loadPersistedNliCache();

/**
 * Normalize probabilities so entailment + neutral + contradiction = 1
 */
export function normalizeNliProbabilities(
  rawEntailment: number,
  rawNeutral: number,
  rawContradiction: number,
  error?: string
): NLIProbabilities {
  const e = Math.max(0, rawEntailment);
  const n = Math.max(0, rawNeutral);
  const c = Math.max(0, rawContradiction);
  const sum = e + n + c;

  if (sum > 0) {
    const normE = Math.round((e / sum) * 1000) / 1000;
    const normN = Math.round((n / sum) * 1000) / 1000;
    const normC = Math.round((1 - normE - normN) * 1000) / 1000;
    return {
      entailment: Math.max(0, normE),
      neutral: Math.max(0, normN),
      contradiction: Math.max(0, normC),
      error,
      source: 'gemini-3.8-flash',
    };
  }

  return {
    entailment: 0,
    neutral: 1,
    contradiction: 0,
    error: error || 'Zero probability sum',
    source: 'fallback',
  };
}

/**
 * Default safe fallback for errors: neutral = 1 with error flag
 */
function makeNeutralFallback(errorMessage: string): NLIProbabilities {
  return {
    entailment: 0,
    neutral: 1,
    contradiction: 0,
    error: errorMessage,
    source: 'error-fallback',
  };
}

/**
 * Call server-side /api/nli/judge with timeout
 */
async function callServerNliJudge(
  premise: string,
  hypothesis: string,
  timeoutMs = 10000
): Promise<NLIProbabilities> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('/api/nli/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ premise, hypothesis }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text();
      return makeNeutralFallback(`Server responded with ${res.status}: ${errorText}`);
    }

    const data = (await res.json()) as {
      entailment?: number;
      neutral?: number;
      contradiction?: number;
      error?: string;
    };

    if (data.error) {
      return makeNeutralFallback(data.error);
    }

    return normalizeNliProbabilities(
      data.entailment ?? 0,
      data.neutral ?? 1,
      data.contradiction ?? 0
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return makeNeutralFallback(`NLI request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Judge entailment for a premise and hypothesis.
 * Uses cached result if available, otherwise queries server endpoint.
 */
export async function judgeEntailment(
  premise: string,
  hypothesis: string
): Promise<NLIProbabilities> {
  const trimmedPremise = premise.trim();
  const trimmedHypothesis = hypothesis.trim();

  if (!trimmedPremise || !trimmedHypothesis) {
    return makeNeutralFallback('Empty premise or hypothesis');
  }

  const cacheKey = hashPair(trimmedPremise, trimmedHypothesis);
  if (inMemoryNliCache.has(cacheKey)) {
    return inMemoryNliCache.get(cacheKey)!;
  }

  const result = await callServerNliJudge(trimmedPremise, trimmedHypothesis);

  // Only cache valid non-error judgments
  if (!result.error) {
    inMemoryNliCache.set(cacheKey, result);
    persistNliCache();
  }

  return result;
}

/**
 * Judge a batch of premise-hypothesis pairs with concurrency limit (4) and per-call timeout.
 */
export async function judgeEntailmentBatch(
  pairs: NLIPair[],
  concurrency = 4,
  timeoutMs = 10000
): Promise<NLIProbabilities[]> {
  if (pairs.length === 0) {
    return [];
  }

  const results: NLIProbabilities[] = new Array(pairs.length);
  const uncachedIndices: number[] = [];
  const uncachedPairs: NLIPair[] = [];

  // Check cache first
  for (let i = 0; i < pairs.length; i++) {
    const key = hashPair(pairs[i].premise, pairs[i].hypothesis);
    if (inMemoryNliCache.has(key)) {
      results[i] = inMemoryNliCache.get(key)!;
    } else {
      uncachedIndices.push(i);
      uncachedPairs.push(pairs[i]);
    }
  }

  if (uncachedIndices.length === 0) {
    return results;
  }

  // Attempt batch call to server if available
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs * 2);

    const res = await fetch('/api/nli/judge-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairs: uncachedPairs }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.ok) {
      const data = (await res.json()) as {
        results?: { entailment: number; neutral: number; contradiction: number; error?: string }[];
      };

      if (data.results && data.results.length === uncachedPairs.length) {
        let cacheUpdated = false;
        for (let j = 0; j < uncachedIndices.length; j++) {
          const originalIdx = uncachedIndices[j];
          const rawItem = data.results[j];
          const normalized = normalizeNliProbabilities(
            rawItem.entailment,
            rawItem.neutral,
            rawItem.contradiction,
            rawItem.error
          );
          results[originalIdx] = normalized;

          if (!normalized.error) {
            const key = hashPair(uncachedPairs[j].premise, uncachedPairs[j].hypothesis);
            inMemoryNliCache.set(key, normalized);
            cacheUpdated = true;
          }
        }

        if (cacheUpdated) {
          persistNliCache();
        }

        return results;
      }
    }
  } catch {
    // Fall back to client concurrent worker pool below
  }

  // Concurrent worker execution
  let nextIdx = 0;
  const executeWorker = async (): Promise<void> => {
    while (nextIdx < uncachedIndices.length) {
      const current = nextIdx++;
      const originalIdx = uncachedIndices[current];
      const pair = uncachedPairs[current];
      const judgment = await judgeEntailment(pair.premise, pair.hypothesis);
      results[originalIdx] = judgment;
    }
  };

  const pool: Promise<void>[] = [];
  const workerCount = Math.min(concurrency, uncachedIndices.length);
  for (let w = 0; w < workerCount; w++) {
    pool.push(executeWorker());
  }

  await Promise.all(pool);
  return results;
}
