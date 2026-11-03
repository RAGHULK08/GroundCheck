/**
 * Central Gemini model configuration (server-side only).
 *
 * - Chat default: gemini-3.1-flash-lite, chosen for its larger free-tier quota.
 * - Fallback chain (tried in order on 429 / 500 / 503 / 504 by the NLI judge and term
 *   extraction): gemini-flash-lite-latest, then gemini-3.8-flash, then gemini-3.5-flash.
 *   Grounded web search uses the primary model only. Results record the model that
 *   actually answered (NLIProbabilities.source, SearchTermsResult.source).
 * - Embeddings: gemini-embedding-2.
 * Validation: on 2026-11-03 the live model list (`npm run models`) showed generateContent
 * support for all four chat models and embedContent support for gemini-embedding-2.
 * That confirms availability only; verdict quality is measured by the test suite.
 * Override with GEMINI_CHAT_MODEL / GEMINI_EMBED_MODEL in .env.
 */

export const DEFAULT_GEMINI_CHAT_MODEL = 'gemini-3.1-flash-lite';
export const FALLBACK_GEMINI_CHAT_MODELS: readonly string[] = [
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
];
export const DEFAULT_GEMINI_EMBED_MODEL = 'gemini-embedding-2';

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/** Model used for every generateContent call (NLI judge, search-term extraction, grounded search). */
export const GEMINI_CHAT_MODEL: string = envOrDefault('GEMINI_CHAT_MODEL', DEFAULT_GEMINI_CHAT_MODEL);

/** Candidate models to try in order if the primary model returns 503 (high demand) or 429 quota. */
export const GEMINI_CHAT_MODELS: readonly string[] = [
  GEMINI_CHAT_MODEL,
  ...FALLBACK_GEMINI_CHAT_MODELS.filter((m) => m !== GEMINI_CHAT_MODEL),
];

/** Model used for every embedContent call. */
export const GEMINI_EMBED_MODEL: string = envOrDefault('GEMINI_EMBED_MODEL', DEFAULT_GEMINI_EMBED_MODEL);

