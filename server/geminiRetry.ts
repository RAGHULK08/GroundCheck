import { ApiError } from '@google/genai';

/**
 * Retry with exponential backoff for Gemini calls, plus a typed UpstreamError.
 *
 * - 500 / 503 / 504, network errors and timeouts: up to MAX_ATTEMPTS attempts,
 *   waiting 1 s, 2 s, 4 s (8 s if more attempts are configured) plus jitter.
 * - 429: retried once only if the error carries a retry delay of <= 60 s; otherwise
 *   it fails at once as QUOTA_EXCEEDED.
 * - 400 / 401 / 403 / 404: never retried.
 * Randomness is used only for jitter (timing), never for results.
 * Logs never include the API key: only label, status, attempt and wait.
 */

export type UpstreamErrorCode = 'QUOTA_EXCEEDED' | 'UPSTREAM_UNAVAILABLE' | 'TIMEOUT' | 'BAD_REQUEST' | 'AUTH';

export class UpstreamError extends Error {
  readonly code: UpstreamErrorCode;
  /** HTTP status from Gemini, when known. */
  readonly status?: number;
  /** Attempts made before giving up (1 = no retry). */
  readonly attempts: number;
  /** Server-suggested wait before retrying, when known (e.g. quota reset). */
  readonly retryAfterSeconds?: number;

  constructor(code: UpstreamErrorCode, message: string, attempts: number, status?: number, retryAfterSeconds?: number) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.attempts = attempts;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const MAX_ATTEMPTS = 4;
export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000];
const MAX_JITTER_MS = 250;
/**
 * A 429 is retried in place only when Gemini asks for a short wait. Longer waits (a
 * per-day / per-minute quota window) trip the circuit breaker below instead, so calls
 * fail fast rather than holding requests open past the browser's timeout.
 */
const MAX_QUOTA_WAIT_SECONDS = 10;
/** Breaker duration when Gemini reports a quota error without a retry delay. */
const DEFAULT_QUOTA_COOLDOWN_SECONDS = 60;

/**
 * Quota circuit breaker, one per quota pool ('chat' for generateContent, 'embed' for
 * embedContent; they have separate Gemini quotas). While open, calls in that pool fail
 * immediately with QUOTA_EXCEEDED and never reach Gemini, so an exhausted free tier is
 * not hammered by every remaining claim, chunk and test case.
 */
const quotaBlockedUntil = new Map<string, { until: number; message: string }>();

/**
 * Quota pool for a call label: 'search' for external search providers (Tavily etc.),
 * 'embed' for Gemini embeddings, 'chat' for every other Gemini call. Each pool has its
 * own breaker, so an exhausted search plan never pauses KB checks and vice versa.
 */
export function quotaPoolOf(label: string): string {
  if (label.startsWith('search.provider')) return 'search';
  return label.startsWith('embed') ? 'embed' : 'chat';
}

/** Seconds until the pool's breaker closes, or 0 when calls are allowed. */
export function quotaCooldownSeconds(pool: string, now: number = Date.now()): number {
  const entry = quotaBlockedUntil.get(pool);
  if (!entry || entry.until <= now) return 0;
  return Math.ceil((entry.until - now) / 1000);
}

/** Test hook: close every breaker. */
export function resetQuotaBreakers(): void {
  quotaBlockedUntil.clear();
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

/**
 * Turn Gemini's long RESOURCE_EXHAUSTED JSON into one readable sentence, e.g.
 * "Gemini quota exhausted (free tier: 20 requests, model gemini-3). Retry in ~67 min, ...".
 */
export function summarizeQuotaMessage(raw: string, retryAfterSeconds?: number): string {
  const limit = /limit:\s*(\d+)/i.exec(raw)?.[1];
  const model = /model:\s*([\w.-]+)/i.exec(raw)?.[1];
  const freeTier = /free_tier/i.test(raw);
  const details = [freeTier ? 'free tier' : '', limit ? `${limit} requests` : '', model ? `model ${model}` : '']
    .filter(Boolean)
    .join(', ');
  const wait = retryAfterSeconds !== undefined ? ` Retry in ~${formatWait(retryAfterSeconds)}.` : '';
  return (
    `Gemini quota exhausted${details ? ` (${details})` : ''}.${wait} ` +
    'Wait for the quota to reset, enable billing on the API key, or set GEMINI_CHAT_MODEL in .env to a model with more free quota (npm run models lists them).'
  );
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
}

interface ClassifiedError {
  status?: number;
  kind: 'retryable' | 'quota' | 'fatal';
  code: UpstreamErrorCode;
  retryAfterSeconds?: number;
  message: string;
}

/** Thrown by callers' own timeouts so they are retried as TIMEOUT. */
export class AttemptTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttemptTimeoutError';
  }
}

/** Parse "retryDelay": "37s" (google.rpc.RetryInfo) or "Retry-After: 30" from an error message. */
export function parseRetryAfterSeconds(message: string): number | undefined {
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i.exec(message);
  if (delay) return Number(delay[1]);
  const header = /retry-after["']?\s*[:=]\s*["']?(\d+)/i.exec(message);
  if (header) return Number(header[1]);
  return undefined;
}

function statusOf(err: unknown): number | undefined {
  if (err instanceof ApiError && typeof err.status === 'number') return err.status;
  // Any other error carrying an HTTP status (e.g. ProviderHttpError from a search provider).
  const ownStatus = typeof err === 'object' && err !== null ? (err as { status?: unknown }).status : undefined;
  if (typeof ownStatus === 'number' && ownStatus >= 100 && ownStatus < 600) return ownStatus;
  const msg = err instanceof Error ? err.message : String(err);
  const m = /"code"\s*:\s*(\d{3})/.exec(msg);
  return m ? Number(m[1]) : undefined;
}

/** Pure classification of a thrown error. */
export function classifyError(err: unknown): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof UpstreamError) {
    // Typed quota errors (e.g. a search provider's 429/432) still go through the quota
    // path so they can trip the breaker; anything else typed is final.
    return {
      status: err.status,
      kind: err.code === 'QUOTA_EXCEEDED' ? 'quota' : 'fatal',
      code: err.code,
      retryAfterSeconds: err.retryAfterSeconds,
      message,
    };
  }
  if (err instanceof AttemptTimeoutError || (err instanceof Error && err.name === 'AbortError')) {
    return { kind: 'retryable', code: 'TIMEOUT', message };
  }
  const status = statusOf(err);
  if (status === 429) {
    const retryAfterSeconds = parseRetryAfterSeconds(message);
    return {
      status,
      kind: 'quota',
      code: 'QUOTA_EXCEEDED',
      retryAfterSeconds,
      message: summarizeQuotaMessage(message, retryAfterSeconds),
    };
  }
  if (status === 500 || status === 503) return { status, kind: 'retryable', code: 'UPSTREAM_UNAVAILABLE', message };
  if (status === 504) return { status, kind: 'retryable', code: 'TIMEOUT', message };
  if (status === 401 || status === 403) return { status, kind: 'fatal', code: 'AUTH', message };
  if (status !== undefined && status >= 400 && status < 500) return { status, kind: 'fatal', code: 'BAD_REQUEST', message };
  if (status !== undefined) return { status, kind: 'retryable', code: 'UPSTREAM_UNAVAILABLE', message };
  // No HTTP status: network-level failure (ECONNRESET, fetch failed, DNS, ...).
  return { kind: 'retryable', code: 'UPSTREAM_UNAVAILABLE', message };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Like withRetry, but also reports how many attempts were needed. */
export async function withRetryDetailed<T>(fn: () => Promise<T>, label: string): Promise<RetryResult<T>> {
  let quotaRetried = false;
  const pool = quotaPoolOf(label);
  for (let attempt = 1; ; attempt++) {
    const cooldown = quotaCooldownSeconds(pool);
    if (cooldown > 0) {
      // Breaker open: fail without calling Gemini. attempts counts real calls made.
      const entry = quotaBlockedUntil.get(pool);
      throw new UpstreamError('QUOTA_EXCEEDED', entry?.message ?? summarizeQuotaMessage('', cooldown), attempt - 1, 429, cooldown);
    }
    try {
      return { value: await fn(), attempts: attempt };
    } catch (err) {
      const c = classifyError(err);
      let waitMs: number | undefined;
      if (c.kind === 'retryable' && attempt < MAX_ATTEMPTS) {
        // Jitter spreads simultaneous retries; it affects timing only.
        waitMs = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] + Math.floor(Math.random() * MAX_JITTER_MS);
      } else if (
        c.kind === 'quota' &&
        !quotaRetried &&
        c.retryAfterSeconds !== undefined &&
        c.retryAfterSeconds <= MAX_QUOTA_WAIT_SECONDS
      ) {
        quotaRetried = true;
        waitMs = Math.ceil(c.retryAfterSeconds * 1000);
      }

      if (waitMs === undefined) {
        if (c.kind === 'quota') {
          const cooldownSeconds = c.retryAfterSeconds ?? DEFAULT_QUOTA_COOLDOWN_SECONDS;
          quotaBlockedUntil.set(pool, { until: Date.now() + cooldownSeconds * 1000, message: c.message });
          console.warn(`[quota] ${pool} calls paused for ${formatWait(cooldownSeconds)} after ${label}: QUOTA_EXCEEDED`);
        }
        throw new UpstreamError(c.code, c.message, attempt, c.status, c.retryAfterSeconds);
      }
      console.warn(`[retry] ${label} status=${c.status ?? c.code} attempt=${attempt} wait=${waitMs}`);
      await sleep(waitMs);
    }
  }
}

/** Run fn with retries; throws UpstreamError when it gives up. */
export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  return (await withRetryDetailed(fn, label)).value;
}

/** HTTP status an /api route should return for an upstream failure. */
export function httpStatusFor(code: UpstreamErrorCode): number {
  switch (code) {
    case 'QUOTA_EXCEEDED':
      return 429;
    case 'UPSTREAM_UNAVAILABLE':
      return 503;
    case 'TIMEOUT':
      return 504;
    case 'BAD_REQUEST':
    case 'AUTH':
      return 502; // Gemini rejected our request: a bad gateway from the client's point of view
  }
}

/** JSON body for an upstream failure: { error: <code>, message, attempts, retryAfterSeconds? }. */
export function upstreamErrorBody(err: UpstreamError): {
  error: UpstreamErrorCode;
  message: string;
  attempts: number;
  retryAfterSeconds?: number;
} {
  return {
    error: err.code,
    message: err.message.slice(0, 500),
    attempts: err.attempts,
    ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
  };
}
