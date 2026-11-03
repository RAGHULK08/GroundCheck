import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Server-side cache of successful Gemini results (NLI judgments, search terms, grounded
 * searches), persisted to .cache/gemini-cache.json so restarts and repeated test-suite
 * runs do not spend quota again. Calls run at temperature 0 (near-deterministic, though
 * Gemini does not guarantee identical output), so a cached answer for the same model +
 * input stands in for a fresh one. Errors and fallback-model answers are never cached.
 *
 * Set GEMINI_CACHE=off to disable. Delete the .cache folder to clear it.
 */

const CACHE_DIR = path.resolve(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'gemini-cache.json');
const MAX_ENTRIES = 5000;
const SAVE_DEBOUNCE_MS = 1000;

const enabled = (process.env.GEMINI_CACHE ?? '').trim().toLowerCase() !== 'off';
const entries = new Map<string, unknown>();
let saveTimer: NodeJS.Timeout | undefined;

function load(): void {
  if (!enabled) return;
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const parsed: unknown = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) entries.set(k, v);
    }
    console.log(`Gemini cache: loaded ${entries.size} entr${entries.size === 1 ? 'y' : 'ies'} from .cache/gemini-cache.json`);
  } catch (err) {
    console.warn('Gemini cache could not be loaded; starting empty:', err instanceof Error ? err.message : String(err));
  }
}

function scheduleSave(): void {
  if (!enabled || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const tmp = `${CACHE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries)));
      fs.renameSync(tmp, CACHE_FILE);
    } catch (err) {
      console.warn('Gemini cache could not be saved:', err instanceof Error ? err.message : String(err));
    }
  }, SAVE_DEBOUNCE_MS);
  saveTimer.unref?.();
}

/** Stable key for (kind, model, input parts). */
export function cacheKey(kind: string, model: string, ...parts: string[]): string {
  const h = createHash('sha256');
  h.update(`${kind}\u0000${model}`);
  for (const part of parts) h.update(`\u0000${part}`);
  return `${kind}:${h.digest('hex').slice(0, 32)}`;
}

export function cacheGet<T>(key: string): T | undefined {
  if (!enabled) return undefined;
  return entries.get(key) as T | undefined;
}

export function cacheSet(key: string, value: unknown): void {
  if (!enabled) return;
  entries.delete(key); // re-insert so eviction drops the least recently written entry
  entries.set(key, value);
  scheduleSave();
}

load();
