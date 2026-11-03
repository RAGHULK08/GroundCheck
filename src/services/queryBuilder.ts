/**
 * Web search query builder.
 *
 * The query is the FULL claim plus 2 to 4 key terms extracted from the user's prompt
 * (by Gemini, server-side via /api/search/terms). The claim is never shortened: when
 * the length budget is tight, terms are dropped instead. If term extraction fails,
 * the query falls back to the claim alone and is flagged `degraded`.
 */

export interface SearchQuery {
  /** Exact text sent to the search backend. */
  text: string;
  /** Prompt terms that were appended to the claim (in order). */
  entities: string[];
  /** True when term extraction failed and the query is the claim alone. */
  degraded?: boolean;
  /** Why extraction failed, when degraded. */
  error?: string;
}

export interface PromptTerms {
  terms: string[];
  error?: string;
}

/** Soft cap on query length. The claim itself is always kept whole, even if longer. */
export const MAX_QUERY_LENGTH = 200;
const TERMS_TIMEOUT_MS = 10_000;

/** Successful extractions per prompt (terms depend only on the prompt, not the claim). */
const termsCache = new Map<string, Promise<PromptTerms>>();

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Pure: combine the whole claim with as many terms as fit within maxLength.
 * Terms already present in the claim (case-insensitive) are skipped; terms that
 * do not fit are dropped. The claim is never truncated.
 */
export function composeSearchQuery(
  claim: string,
  terms: readonly string[],
  maxLength: number = MAX_QUERY_LENGTH
): { text: string; entities: string[] } {
  const base = normalizeSpaces(claim);
  const lowerBase = base.toLowerCase();
  const entities: string[] = [];
  let text = base;
  for (const raw of terms) {
    const term = normalizeSpaces(raw);
    if (!term) continue;
    const lower = term.toLowerCase();
    if (lowerBase.includes(lower) || entities.some((e) => e.toLowerCase() === lower)) continue;
    const candidate = `${text} ${term}`;
    if (candidate.length > maxLength) continue;
    text = candidate;
    entities.push(term);
  }
  return { text, entities };
}

async function fetchPromptTerms(prompt: string): Promise<PromptTerms> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TERMS_TIMEOUT_MS);
  try {
    const res = await fetch('/api/search/terms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { terms: [], error: `Term extraction failed with ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
    }
    const data = (await res.json()) as { terms?: unknown; error?: unknown };
    if (typeof data.error === 'string' && data.error) return { terms: [], error: data.error };
    const terms = Array.isArray(data.terms) ? data.terms.filter((t): t is string => typeof t === 'string') : [];
    if (terms.length === 0) return { terms: [], error: 'Term extraction returned no terms' };
    return { terms };
  } catch (err) {
    const msg = controller.signal.aborted
      ? `Term extraction timed out after ${TERMS_TIMEOUT_MS}ms`
      : err instanceof Error
      ? err.message
      : String(err);
    return { terms: [], error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Extract key terms for a prompt once; failures are not cached so they are retried. */
export function getPromptTerms(prompt: string): Promise<PromptTerms> {
  const key = normalizeSpaces(prompt);
  if (!key) return Promise.resolve({ terms: [], error: 'Empty prompt' });
  const cached = termsCache.get(key);
  if (cached) return cached;
  const pending = fetchPromptTerms(key).then((result) => {
    if (result.error) termsCache.delete(key);
    return result;
  });
  termsCache.set(key, pending);
  return pending;
}

/** Build the web search query for one claim. Never throws. */
export async function buildSearchQuery(prompt: string, claim: string): Promise<SearchQuery> {
  const { terms, error } = await getPromptTerms(prompt);
  if (error) {
    console.warn(`Search query degraded to claim only: ${error}`);
    return { text: normalizeSpaces(claim), entities: [], degraded: true, error };
  }
  return composeSearchQuery(claim, terms);
}
