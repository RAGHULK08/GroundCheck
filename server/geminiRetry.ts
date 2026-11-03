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
const MAX_QUOTA_WAIT_SECONDS = 60;

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
  const msg = err instanceof Error ? err.message : String(err);
  const m = /"code"\s*:\s*(\d{3})/.exec(msg);
  return m ? Number(m[1]) : undefined;
}

/** Pure classification of a thrown error. */
export function classifyError(err: unknown): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof UpstreamError) {
    return { status: err.status, kind: 'fatal', code: err.code, message };
  }
  if (err instanceof AttemptTimeoutError || (err instanceof Error && err.name === 'AbortError')) {
    return { kind: 'retryable', code: 'TIMEOUT', message };
  }
  const status = statusOf(err);
  if (status === 429) {
    return { status, kind: 'quota', code: 'QUOTA_EXCEEDED', retryAfterSeconds: parseRetryAfterSeconds(message), message };
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
  for (let attempt = 1; ; attempt++) {
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
