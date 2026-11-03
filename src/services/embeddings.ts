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

/**
 * Embedding model used by the server-side /api/embeddings route (informational)
 */
export const EMBEDDING_MODEL = 'gemini-embedding-2-preview';

const VECTOR_CACHE_KEY = 'groundcheck_vector_cache_v1';

/**
 * In-memory vector cache
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

/**
 * Initialize cache from localStorage
 */
function loadPersistedCache(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(VECTOR_CACHE_KEY);
      if (stored) {
        const parsed: Record<string, number[]> = JSON.parse(stored);
        for (const [key, vector] of Object.entries(parsed)) {
          if (Array.isArray(vector)) {
            inMemoryCache.set(key, vector);
          }
        }
      }
    }
  } catch {
    // Gracefully handle storage errors without breaking runtime
  }
}

/**
 * Mirror in-memory cache to localStorage
 */
function persistCache(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const obj: Record<string, number[]> = {};
      // Save last 500 entries to prevent exceeding quota
      const entries = Array.from(inMemoryCache.entries()).slice(-500);
      for (const [key, vector] of entries) {
        obj[key] = vector;
      }
      localStorage.setItem(VECTOR_CACHE_KEY, JSON.stringify(obj));
    }
  } catch {
    // Gracefully handle storage quota errors
  }
}

// Load cache on module initialization
loadPersistedCache();

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
async function callServerEmbeddings(texts: string[]): Promise<number[][]> {
  const res = await fetch('/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new EmbeddingError(`Server embedding endpoint error (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as { embeddings?: number[][]; error?: string };
  if (data.error) {
    throw new EmbeddingError(data.error);
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

  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  // Check cache first
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const key = hashText(text);
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
    const embeddedVectors = await callServerEmbeddings(uncachedTexts);

    let cacheUpdated = false;

    for (let j = 0; j < uncachedIndices.length; j++) {
      const originalIndex = uncachedIndices[j];
      const vector = embeddedVectors[j];

      if (!vector || vector.length === 0) {
        throw new EmbeddingError(`Embedding vector missing for text index ${j}`);
      }

      results[originalIndex] = vector;

      const key = hashText(uncachedTexts[j]);
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
