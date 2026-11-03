/**
 * Typed error for embedding operations
 */
export class EmbeddingError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'EmbeddingError';
    this.cause = cause;
  }
}

/** v2 cache: entries are keyed by embedding model ID + text hash (vectors from different models are not comparable). */
const VECTOR_CACHE_KEY = 'groundcheck_embeddings_v2';
/** Pre-v2 cache had no model tag and may hold gemini-embedding-2-preview vectors; it is deleted on load. */
const LEGACY_VECTOR_CACHE_KEYS = ['groundcheck_vector_cache_v1'];
const MAX_PERSISTED_VECTORS = 500;

/**
 * In-memory vector cache, keyed by cacheKey(model, text)
 */
const inMemoryCache = new Map<string, number[]>();

/**
 * Simple deterministic hash for text caching keys
 */
export function hashText(text: string): string {
  let hash = 5381;
  const str = text.trim();
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function cacheKey(model: string, text: string): string {
  return `${model}::${hashText(text)}`;
}

/**
 * Initialize cache from localStorage and drop untagged legacy caches.
 */
function loadPersistedCache(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    for (const legacy of LEGACY_VECTOR_CACHE_KEYS) localStorage.removeItem(legacy);
    const stored = localStorage.getItem(VECTOR_CACHE_KEY);
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return;
    for (const [key, vector] of Object.entries(parsed as Record<string, unknown>)) {
      if (key.includes('::') && Array.isArray(vector) && vector.every((x) => typeof x === 'number')) {
        inMemoryCache.set(key, vector as number[]);
      }
    }
  } catch (err) {
    console.warn('Embedding cache could not be loaded from localStorage; starting empty.', err);
  }
}

/**
 * Mirror in-memory cache to localStorage
 */
function persistCache(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const obj: Record<string, number[]> = {};
    for (const [key, vector] of Array.from(inMemoryCache.entries()).slice(-MAX_PERSISTED_VECTORS)) {
      obj[key] = vector;
    }
    localStorage.setItem(VECTOR_CACHE_KEY, JSON.stringify(obj));
  } catch (err) {
    console.warn('Embedding cache could not be persisted to localStorage.', err);
  }
}

// Load cache on module initialization
loadPersistedCache();

let embedModelPromise: Promise<string> | null = null;

/**
 * Embedding model configured on the server (GET /api/models; no Gemini call).
 * Fetched once per page load; a failure is not cached, so the next call retries.
 */
export function getEmbedModel(): Promise<string> {
  if (!embedModelPromise) {
    embedModelPromise = fetch('/api/models')
      .then(async (res) => {
        if (!res.ok) throw new EmbeddingError(`Model config endpoint error (${res.status})`);
        const data = (await res.json()) as { embed?: unknown };
        if (typeof data.embed !== 'string' || !data.embed) throw new EmbeddingError('Model config missing embed model');
        return data.embed;
      })
      .catch((err: unknown) => {
        embedModelPromise = null;
        throw err instanceof EmbeddingError ? err : new EmbeddingError(`Could not read model config: ${String(err)}`, err);
      });
  }
  return embedModelPromise;
}

/**
 * Normalize a vector to unit length (L2 norm)
 */
export function normalizeVector(vector: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSq += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm === 0) {
    return vector;
  }
  const normalized: number[] = new Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] / norm;
  }
  return normalized;
}

/**
 * Cosine similarity between two normalized vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  return Math.max(-1, Math.min(1, dotProduct));
}

/**
 * Call server-side /api/embeddings route
 */
async function callServerEmbeddings(texts: string[], expectedModel: string): Promise<number[][]> {
  const res = await fetch('/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new EmbeddingError(`Server embedding endpoint error (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as { embeddings?: number[][]; error?: string; model?: string };
  if (data.error) {
    throw new EmbeddingError(data.error);
  }
  if (data.model !== expectedModel) {
    // Server config changed since the model was read: refuse to mix vectors from different models.
    embedModelPromise = null;
    throw new EmbeddingError(`Embedding model changed (expected ${expectedModel}, server used ${String(data.model)}); retry`);
  }
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
    throw new EmbeddingError('Invalid embeddings returned from server');
  }

  return data.embeddings;
}

/**
 * Embed multiple texts via the server-side /api/embeddings route (Gemini),
 * with caching in-memory and mirrored to localStorage.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const model = await getEmbedModel();
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  // Check cache first
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const key = cacheKey(model, text);
    if (inMemoryCache.has(key)) {
      results[i] = inMemoryCache.get(key)!;
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(text);
    }
  }

  // If all were cached, return immediately
  if (uncachedIndices.length === 0) {
    return results as number[][];
  }

  // All Gemini calls happen server-side; the API key never reaches the browser.
  try {
    const embeddedVectors = await callServerEmbeddings(uncachedTexts, model);

    let cacheUpdated = false;

    for (let j = 0; j < uncachedIndices.length; j++) {
      const originalIndex = uncachedIndices[j];
      const vector = embeddedVectors[j];

      if (!vector || vector.length === 0) {
        throw new EmbeddingError(`Embedding vector missing for text index ${j}`);
      }

      results[originalIndex] = vector;

      const key = cacheKey(model, uncachedTexts[j]);
      inMemoryCache.set(key, vector);
      cacheUpdated = true;
    }

    if (cacheUpdated) {
      persistCache();
    }
  } catch (error) {
    if (error instanceof EmbeddingError) {
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new EmbeddingError(`Gemini embedding API call failed: ${msg}`, error);
  }

  return results as number[][];
}

/**
 * Embed single text helper
 */
export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}
