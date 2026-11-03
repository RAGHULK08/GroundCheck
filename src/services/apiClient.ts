/**
 * Single typed entry point for every browser call to the backend /api routes.
 *
 * - Checks res.ok AND that the response is JSON before parsing, so an HTML page
 *   (stale server, missing route, SPA fallback) produces a clear typed error
 *   instead of "Unexpected token '<'".
 * - Maps quota / overload / timeout failures to typed upstream codes so callers
 *   can show them as infrastructure warnings, never as verdicts.
 */

export type ApiErrorCode =
  | 'QUOTA_EXCEEDED' // 429 / RESOURCE_EXHAUSTED
  | 'UPSTREAM_UNAVAILABLE' // 503 / 500 / 502 / overloaded
  | 'TIMEOUT' // client abort, 504, upstream deadline
  | 'HTML_RESPONSE' // got a page instead of JSON
  | 'BACKEND_UNREACHABLE' // network error: server not running
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'INVALID_RESPONSE' // JSON content-type but unparseable body
  | 'HTTP_ERROR';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  readonly url: string;

  constructor(code: ApiErrorCode, url: string, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.url = url;
    this.status = status;
  }
}

export interface FetchJsonInit extends Omit<RequestInit, 'body'> {
  /** JSON-serialized and sent with Content-Type: application/json. */
  json?: unknown;
  /** Abort after this many milliseconds (TIMEOUT). */
  timeoutMs?: number;
}

/**
 * Classify upstream error text (e.g. a Gemini error body relayed by the server) into a
 * typed infrastructure code, or null if it does not look like an infrastructure failure.
 */
export function classifyUpstreamText(text: string): ApiErrorCode | null {
  const t = text.toLowerCase();
  if (/"code"\s*:\s*429|resource_exhausted|exceeded your current quota|\bquota\b|rate limit/.test(t)) return 'QUOTA_EXCEEDED';
  if (/timed out|timeout|deadline_exceeded|"code"\s*:\s*504/.test(t)) return 'TIMEOUT';
  if (/"code"\s*:\s*50[023]|"status"\s*:\s*"unavailable"|high demand|overloaded|internal error/.test(t)) {
    return 'UPSTREAM_UNAVAILABLE';
  }
  return null;
}

function codeForStatus(status: number, bodyText: string): ApiErrorCode {
  if (status === 429) return 'QUOTA_EXCEEDED';
  if (status === 504) return 'TIMEOUT';
  if (status === 404) return 'NOT_FOUND';
  if (status === 400) return 'BAD_REQUEST';
  if (status === 502 || status === 503) return 'UPSTREAM_UNAVAILABLE';
  return classifyUpstreamText(bodyText) ?? (status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'HTTP_ERROR');
}

function errorMessageFromBody(bodyText: string): string {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed === 'object' && parsed !== null) {
      const e = (parsed as { error?: unknown }).error;
      if (typeof e === 'string') return e;
      if (e !== undefined) return JSON.stringify(e);
    }
  } catch {
    // not JSON; fall through
  }
  return bodyText;
}

/** Fetch an /api route and parse its JSON body. Throws ApiError on any failure. */
export async function fetchJson<T>(url: string, init: FetchJsonInit = {}): Promise<T> {
  const { json, timeoutMs, headers, signal, ...rest } = init;
  const controller = new AbortController();
  const timer = timeoutMs !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: json !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ApiError('TIMEOUT', url, `API route ${url} timed out${timeoutMs !== undefined ? ` after ${timeoutMs}ms` : ''}`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError('BACKEND_UNREACHABLE', url, `Could not reach API route ${url} — the backend server is not running (${msg})`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  const contentType = res.headers.get('content-type') ?? '';
  const bodyText = await res.text().catch(() => '');

  if (!contentType.includes('application/json')) {
    if (contentType.includes('text/html') || /^\s*<(!doctype|html)/i.test(bodyText)) {
      throw new ApiError(
        'HTML_RESPONSE',
        url,
        `API route ${url} returned HTML (status ${res.status}) — the backend server is not running or the route is missing.`,
        res.status
      );
    }
    if (!res.ok) {
      throw new ApiError(codeForStatus(res.status, bodyText), url, `API route ${url} failed with status ${res.status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ''}`, res.status);
    }
    throw new ApiError('INVALID_RESPONSE', url, `API route ${url} returned non-JSON content-type "${contentType || 'none'}" (status ${res.status})`, res.status);
  }

  if (!res.ok) {
    const detail = errorMessageFromBody(bodyText);
    throw new ApiError(codeForStatus(res.status, detail), url, `API route ${url} failed with status ${res.status}: ${detail.slice(0, 300)}`, res.status);
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new ApiError('INVALID_RESPONSE', url, `API route ${url} returned invalid JSON (status ${res.status})`, res.status);
  }
}

/** "[CODE] message" for ApiError (and upstream text that classifies), plain message otherwise. */
export function formatApiError(err: unknown): string {
  if (err instanceof ApiError) return `[${err.code}] ${err.message}`;
  const msg = err instanceof Error ? err.message : String(err);
  const code = classifyUpstreamText(msg);
  return code ? `[${code}] ${msg}` : msg;
}

/** Tag an upstream error string relayed inside a 200 response (e.g. { error: "..." }) with its code. */
export function tagUpstreamError(message: string): string {
  if (/^\[[A-Z_]+\]/.test(message)) return message;
  const code = classifyUpstreamText(message);
  return code ? `[${code}] ${message}` : message;
}
