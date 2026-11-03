import type { NLIProbabilities } from '../types/groundcheck';

/**
 * Pure validation/normalization for NLI judgments.
 * Shared by the browser client (nli.ts) and the server judge (server/nliJudge.ts),
 * so both sides apply identical rules. Must stay dependency-free (type imports only).
 */

export const NLI_SOURCE_ERROR = 'error-fallback';

/** Outcome of validating a raw NLI payload. */
export type NliScoreValidation =
  | { ok: true; value: NLIProbabilities }
  | { ok: false; error: string };

/** The only value ever returned on failure: all mass on neutral, with the error flagged. */
export function makeNeutralFallback(errorMessage: string, source: string = NLI_SOURCE_ERROR): NLIProbabilities {
  return { entailment: 0, neutral: 1, contradiction: 0, error: errorMessage, source };
}

function isProbability(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

/**
 * Validate that `raw` carries three probabilities in [0, 1] with a positive sum,
 * then normalize them to sum to exactly 1 (rounded to 3 decimals).
 * Missing, non-numeric or out-of-range fields are rejected, never defaulted.
 */
export function validateAndNormalizeScores(raw: unknown, source: string): NliScoreValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'NLI payload is not an object' };
  }
  const { entailment, neutral, contradiction } = raw as Record<string, unknown>;
  if (!isProbability(entailment) || !isProbability(neutral) || !isProbability(contradiction)) {
    return {
      ok: false,
      error: `NLI payload has missing or out-of-range probabilities (entailment=${String(entailment)}, neutral=${String(
        neutral
      )}, contradiction=${String(contradiction)})`,
    };
  }
  const sum = entailment + neutral + contradiction;
  if (sum <= 0) {
    return { ok: false, error: 'NLI probabilities sum to zero' };
  }

  const e = Math.round((entailment / sum) * 1000) / 1000;
  const n = Math.round((neutral / sum) * 1000) / 1000;
  // Assign the rounding remainder to contradiction so the three sum to exactly 1.
  const c = Math.max(0, Math.round((1 - e - n) * 1000) / 1000);
  return { ok: true, value: { entailment: e, neutral: n, contradiction: c, source } };
}
