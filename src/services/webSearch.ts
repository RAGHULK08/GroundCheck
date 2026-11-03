/**
 * Web Search Service for GroundCheck.
 *
 * Retrieves real web sources through Gemini's Google Search grounding tool
 * (server-side, /api/search/web). Every result comes from the response's grounding
 * metadata: nothing is hardcoded and nothing is invented. On failure the result list
 * is empty and the failure is reported (console warning + `error` on the outcome).
 *
 * Note: `snippet` is the model's grounded text attributed to that source, not a
 * verbatim quote from the page, so callers should treat web evidence as lower trust.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string;
}

export interface WebSearchOutcome {
  results: WebSearchResult[];
  /** Queries Google Search ran, as reported by grounding metadata. */
  searchQueries: string[];
  /** Set when the search failed or was unavailable; results is then []. */
  error?: string;
  /** True when served from the in-memory cache. */
  cached?: boolean;
}

const CLIENT_TIMEOUT_MS = 10_000; // server aborts its own call at 8s
const cache = new Map<string, Promise<WebSearchOutcome>>();

function isWebSearchResult(v: unknown): v is WebSearchResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.title === 'string' &&
    typeof r.url === 'string' &&
    typeof r.snippet === 'string' &&
    typeof r.sourceDomain === 'string' &&
    r.url.length > 0 &&
    r.snippet.length > 0
  );
}

async function fetchGrounded(query: string): Promise<WebSearchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch('/api/search/web', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { results: [], searchQueries: [], error: `Web search failed with ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
    }
    const data = (await res.json()) as { results?: unknown; searchQueries?: unknown; error?: unknown };
    const searchQueries = Array.isArray(data.searchQueries)
      ? data.searchQueries.filter((q): q is string => typeof q === 'string')
      : [];
    if (typeof data.error === 'string' && data.error) {
      return { results: [], searchQueries, error: data.error };
    }
    const results = Array.isArray(data.results) ? data.results.filter(isWebSearchResult) : [];
    return { results, searchQueries };
  } catch (err) {
    const msg = controller.signal.aborted
      ? `Web search timed out after ${CLIENT_TIMEOUT_MS}ms`
      : err instanceof Error
      ? err.message
      : String(err);
    return { results: [], searchQueries: [], error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search the web with Google Search grounding. Never throws.
 * Successful outcomes are cached in memory by query text; failures are not cached.
 */
export async function performWebSearchDetailed(query: string): Promise<WebSearchOutcome> {
  const key = query.replace(/\s+/g, ' ').trim();
  if (!key) return { results: [], searchQueries: [], error: 'Empty query' };

  const cached = cache.get(key);
  if (cached) return { ...(await cached), cached: true };

  const pending = fetchGrounded(key).then((outcome) => {
    if (outcome.error) {
      cache.delete(key);
      console.warn(`Web search unavailable for "${key.slice(0, 80)}": ${outcome.error}`);
    }
    return outcome;
  });
  cache.set(key, pending);
  return pending;
}

/** Backwards-compatible wrapper: real grounded sources only, [] on failure. */
export async function performWebSearch(query: string): Promise<WebSearchResult[]> {
  return (await performWebSearchDetailed(query)).results;
}
