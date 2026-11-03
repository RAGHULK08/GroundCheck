/**
 * Central Gemini model configuration (server-side only).
 *
 * Defaults were validated against the live model list (v1beta/models):
 *  - gemini-3.8-flash: supports generateContent (chat, NLI judge, search terms, Google Search grounding)
 *  - gemini-embedding-2: supports embedContent (stable successor of gemini-embedding-2-preview)
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

