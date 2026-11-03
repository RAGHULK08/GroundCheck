import { UpstreamError } from './geminiRetry.ts';

/**
 * External web search providers used instead of Gemini's Google Search grounding, so web
 * retrieval does not spend the Gemini chat model's quota.
 *
 * Selection (SEARCH_PROVIDER in .env): tavily | brave | searxng | gemini.
 * If unset: tavily when TAVILY_API_KEY is set, otherwise gemini (Google Search grounding).
 *
 * Every provider returns the same shape as Gemini grounding, so the browser and the
 * verifier are unaffected. Snippets are real page text from the search engine.
 */

export type SearchProviderName = 'gemini' | 'tavily' | 'brave' | 'searxng';

export interface ProviderSource {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string;
}

const MAX_SOURCES = 5;
const MAX_SNIPPET_LENGTH = 600;
/** Cooldown when a provider reports its plan / monthly limit as exhausted. */
const PLAN_LIMIT_COOLDOWN_SECONDS = 3600;

const PROVIDER_LABEL: Record<SearchProviderName, string> = {
  gemini: 'Google Search grounding',
  tavily: 'Tavily',
  brave: 'Brave Search',
  searxng: 'SearXNG',
};

function env(name: string): string | undefined {
  const v = process.env[name]?.trim().replace(/^["']|["']$/g, '');
  return v ? v : undefined;
}

/** Resolve the configured provider (pure apart from reading env). */
export function resolveSearchProvider(): SearchProviderName {
  const explicit = env('SEARCH_PROVIDER')?.toLowerCase();
  if (explicit === 'gemini' || explicit === 'tavily' || explicit === 'brave' || explicit === 'searxng') return explicit;
  if (explicit) console.warn(`Unknown SEARCH_PROVIDER "${explicit}"; using auto-detection.`);
  return env('TAVILY_API_KEY') ? 'tavily' : 'gemini';
}

export const SEARCH_PROVIDER: SearchProviderName = resolveSearchProvider();

export function searchProviderLabel(name: SearchProviderName = SEARCH_PROVIDER): string {
  return PROVIDER_LABEL[name];
}

/** Startup check: problems that would make every search fail (null when fine). */
export function searchProviderConfigError(name: SearchProviderName = SEARCH_PROVIDER): string | null {
  if (name === 'tavily' && !env('TAVILY_API_KEY')) return 'SEARCH_PROVIDER=tavily but TAVILY_API_KEY is not set';
  if (name === 'brave' && !env('BRAVE_API_KEY')) return 'SEARCH_PROVIDER=brave but BRAVE_API_KEY is not set';
  if (name === 'searxng' && !env('SEARXNG_URL')) return 'SEARCH_PROVIDER=searxng but SEARXNG_URL is not set';
  return null;
}

/** HTTP failure from a provider; `status` lets geminiRetry classify it (5xx retried, 4xx not). */
export class ProviderHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function cleanSnippet(text: unknown): string {
  return String(text ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SNIPPET_LENGTH);
}

/** Keep usable, de-duplicated sources (pure). */
export function normalizeSources(items: { title?: unknown; url?: unknown; snippet?: unknown }[]): ProviderSource[] {
  const seen = new Set<string>();
  const out: ProviderSource[] = [];
  for (const item of items) {
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const snippet = cleanSnippet(item.snippet);
    if (!/^https?:\/\//i.test(url) || !snippet || seen.has(url)) continue;
    seen.add(url);
    const sourceDomain = domainOf(url);
    out.push({ title: cleanSnippet(item.title) || sourceDomain, url, snippet, sourceDomain });
    if (out.length === MAX_SOURCES) break;
  }
  return out;
}

function readRetryAfter(res: Response): number | undefined {
  const v = Number(res.headers.get('retry-after'));
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Map a non-OK provider response to a typed error (quota errors trip the search breaker). */
async function failFromResponse(provider: SearchProviderName, res: Response, quotaStatuses: number[]): Promise<never> {
  const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
  const label = PROVIDER_LABEL[provider];
  if (quotaStatuses.includes(res.status)) {
    const isRateLimit = res.status === 429;
    const retryAfter = readRetryAfter(res) ?? (isRateLimit ? 60 : PLAN_LIMIT_COOLDOWN_SECONDS);
    throw new UpstreamError(
      'QUOTA_EXCEEDED',
      `${label} ${isRateLimit ? 'rate limit reached' : 'plan / monthly credit limit reached'} (HTTP ${res.status}). ` +
        `Web search is paused; KB checks are unaffected.${body ? ` ${body}` : ''}`,
      1,
      res.status,
      retryAfter
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new UpstreamError('AUTH', `${label} rejected the API key (HTTP ${res.status}). Check the key in .env.${body ? ` ${body}` : ''}`, 1, res.status);
  }
  throw new ProviderHttpError(res.status, `${label} search failed with HTTP ${res.status}${body ? `: ${body}` : ''}`);
}

async function searchTavily(query: string, signal: AbortSignal): Promise<ProviderSource[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('TAVILY_API_KEY') ?? ''}` },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: MAX_SOURCES, include_answer: false }),
    signal,
  });
  // 429 = rate limit; 432 = plan credit limit; 433 = pay-as-you-go limit.
  if (!res.ok) await failFromResponse('tavily', res, [429, 432, 433]);
  const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return normalizeSources((data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content })));
}

async function searchBrave(query: string, signal: AbortSignal): Promise<ProviderSource[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_SOURCES}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': env('BRAVE_API_KEY') ?? '' },
    signal,
  });
  if (!res.ok) await failFromResponse('brave', res, [429, 402]);
  const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  return normalizeSources((data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description })));
}

async function searchSearxng(query: string, signal: AbortSignal): Promise<ProviderSource[]> {
  const base = (env('SEARXNG_URL') ?? '').replace(/\/+$/, '');
  const res = await fetch(`${base}/search?q=${encodeURIComponent(query)}&format=json`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (res.status === 403) {
    throw new UpstreamError('BAD_REQUEST', 'SearXNG returned 403: enable the json format under search.formats in settings.yml', 1, 403);
  }
  if (!res.ok) await failFromResponse('searxng', res, [429]);
  const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return normalizeSources((data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content })));
}

/** One search attempt against an external provider (not Gemini). */
export function searchWithProvider(
  provider: Exclude<SearchProviderName, 'gemini'>,
  query: string,
  signal: AbortSignal
): Promise<ProviderSource[]> {
  switch (provider) {
    case 'tavily':
      return searchTavily(query, signal);
    case 'brave':
      return searchBrave(query, signal);
    case 'searxng':
      return searchSearxng(query, signal);
  }
}
