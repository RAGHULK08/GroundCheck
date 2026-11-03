import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { judgePair, judgePairs } from './server/nliJudge.ts';
import { extractSearchTerms } from './server/searchTerms.ts';
import { searchWebGrounded } from './server/webGrounding.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

/**
 * Read a required environment variable or exit with a clear message.
 * The value is never logged. Placeholder values from .env.example count as unset.
 */
function requireEnv(name: string, placeholder?: string): string {
  const value = process.env[name]?.trim();
  if (!value || value === placeholder) {
    console.error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and set ${name} (the npm scripts load .env automatically).`
    );
    process.exit(1);
  }
  return value;
}

// Shared server-side Gemini client
const apiKey = requireEnv('GEMINI_API_KEY', 'your-gemini-api-key-here');
console.log('GEMINI_API_KEY loaded from environment.');
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const EMBEDDING_MODEL = 'gemini-embedding-2-preview';

/**
 * Health check endpoint
 */
app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok', serverTime: new Date().toISOString() });
});

/**
 * Server-side Embeddings Endpoint
 */
app.post('/api/embeddings', async (req: Request, res: Response): Promise<void> => {
  try {
    const { texts } = req.body as { texts: unknown };
    if (!Array.isArray(texts) || texts.length === 0) {
      res.status(400).json({ error: 'texts must be a non-empty array of strings' });
      return;
    }

    const stringTexts = texts.map((t) => (typeof t === 'string' ? t : String(t)));

    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: stringTexts,
    });

    const embeddingsList: { values?: number[] }[] = [];
    if (Array.isArray(response.embeddings)) {
      for (const item of response.embeddings) {
        if (item) embeddingsList.push(item);
      }
    } else if ('embedding' in response && response.embedding) {
      embeddingsList.push(response.embedding as { values?: number[] });
    }

    if (embeddingsList.length !== stringTexts.length) {
      res.status(502).json({
        error: `Embedding count mismatch: expected ${stringTexts.length}, got ${embeddingsList.length}`,
      });
      return;
    }

    const vectors: number[][] = [];
    for (let i = 0; i < embeddingsList.length; i++) {
      const rawValues = embeddingsList[i].values;
      if (!rawValues || rawValues.length === 0) {
        res.status(502).json({ error: `Missing embedding vector for text index ${i}` });
        return;
      }

      // L2 Normalize
      let sumSq = 0;
      for (let j = 0; j < rawValues.length; j++) {
        sumSq += rawValues[j] * rawValues[j];
      }
      const norm = Math.sqrt(sumSq);
      const normalized: number[] = new Array(rawValues.length);
      for (let j = 0; j < rawValues.length; j++) {
        normalized[j] = norm > 0 ? rawValues[j] / norm : rawValues[j];
      }
      vectors.push(normalized);
    }

    res.json({ embeddings: vectors });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Server-side embedding error:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * Server-side NLI Single Judgment Endpoint
 */
app.post('/api/nli/judge', async (req: Request, res: Response): Promise<void> => {
  const { premise, hypothesis } = req.body as { premise?: unknown; hypothesis?: unknown };
  if (typeof premise !== 'string' || typeof hypothesis !== 'string') {
    res.status(400).json({ error: 'premise and hypothesis must both be strings' });
    return;
  }
  // judgePair never throws; failures come back as neutral = 1 with `error` set.
  res.json(await judgePair(ai, premise, hypothesis));
});

/**
 * Server-side NLI Batch Judgment Endpoint (bounded concurrency + per-call timeout)
 */
app.post('/api/nli/judge-batch', async (req: Request, res: Response): Promise<void> => {
  const { pairs, concurrency, timeoutMs } = req.body as {
    pairs?: unknown;
    concurrency?: unknown;
    timeoutMs?: unknown;
  };
  if (!Array.isArray(pairs)) {
    res.status(400).json({ error: 'pairs must be an array of {premise, hypothesis}' });
    return;
  }
  const results = await judgePairs(ai, pairs, {
    concurrency: typeof concurrency === 'number' ? concurrency : undefined,
    timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
  });
  res.json({ results });
});

/**
 * Key-term extraction for web search queries (Gemini, temperature 0, JSON schema)
 */
app.post('/api/search/terms', async (req: Request, res: Response): Promise<void> => {
  const { prompt } = req.body as { prompt?: unknown };
  if (typeof prompt !== 'string') {
    res.status(400).json({ error: 'prompt must be a string' });
    return;
  }
  // extractSearchTerms never throws; failures come back with `error` set and no terms.
  res.json(await extractSearchTerms(ai, prompt));
});

/**
 * Web retrieval via Gemini Google Search grounding (sources from grounding metadata only)
 */
app.post('/api/search/web', async (req: Request, res: Response): Promise<void> => {
  const { query } = req.body as { query?: unknown };
  if (typeof query !== 'string') {
    res.status(400).json({ error: 'query must be a string' });
    return;
  }
  // searchWebGrounded never throws; failures come back with `error` set and no results.
  res.json(await searchWebGrounded(ai, query));
});

/**
 * Initialize development Vite server or static production file serving
 */
async function startServer(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    // Express 5 (path-to-regexp v8) requires a named wildcard for the SPA catch-all
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} (mode: ${isProduction ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
