import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Shared server-side Gemini client
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const NLI_MODEL = 'gemini-3.8-flash';

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
 * Helper to judge single premise/hypothesis pair via Gemini
 */
async function judgeSinglePair(premise: string, hypothesis: string): Promise<{
  entailment: number;
  neutral: number;
  contradiction: number;
  error?: string;
}> {
  try {
    const prompt = `Premise:
"${premise}"

Hypothesis:
"${hypothesis}"`;

    const systemInstruction = `You are a strict Natural Language Inference (NLI) judge.
Evaluate whether the hypothesis is entailed by, neutral with respect to, or contradicted by the premise.
MANDATORY RULES:
1. Judge ONLY from the explicit text provided in the premise.
2. Treat the premise as the sole and complete universe of evidence.
3. NEVER assume, extrapolate, or use outside world knowledge not explicitly present in the premise.
4. Output probabilities for entailment, neutral, and contradiction, each between 0.0 and 1.0.`;

    const response = await ai.models.generateContent({
      model: NLI_MODEL,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            entailment: { type: Type.NUMBER, description: 'Probability of entailment (0 to 1)' },
            neutral: { type: Type.NUMBER, description: 'Probability of neutral (0 to 1)' },
            contradiction: { type: Type.NUMBER, description: 'Probability of contradiction (0 to 1)' },
          },
          required: ['entailment', 'neutral', 'contradiction'],
        },
      },
    });

    const text = response.text?.trim() || '{}';
    const parsed = JSON.parse(text) as { entailment?: number; neutral?: number; contradiction?: number };

    let e = typeof parsed.entailment === 'number' && !isNaN(parsed.entailment) ? Math.max(0, parsed.entailment) : 0;
    let n = typeof parsed.neutral === 'number' && !isNaN(parsed.neutral) ? Math.max(0, parsed.neutral) : 0;
    let c = typeof parsed.contradiction === 'number' && !isNaN(parsed.contradiction) ? Math.max(0, parsed.contradiction) : 0;

    const sum = e + n + c;
    if (sum > 0) {
      e = Math.round((e / sum) * 1000) / 1000;
      n = Math.round((n / sum) * 1000) / 1000;
      c = Math.round((1 - e - n) * 1000) / 1000;
      return { entailment: Math.max(0, e), neutral: Math.max(0, n), contradiction: Math.max(0, c) };
    }

    return { entailment: 0, neutral: 1, contradiction: 0, error: 'Invalid probability distribution' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('NLI judgment failed:', msg);
    return { entailment: 0, neutral: 1, contradiction: 0, error: msg };
  }
}

/**
 * Server-side NLI Single Judgment Endpoint
 */
app.post('/api/nli/judge', async (req: Request, res: Response): Promise<void> => {
  try {
    const { premise, hypothesis } = req.body as { premise?: unknown; hypothesis?: unknown };
    if (typeof premise !== 'string' || typeof hypothesis !== 'string') {
      res.status(400).json({ error: 'premise and hypothesis must both be strings' });
      return;
    }

    const result = await judgeSinglePair(premise, hypothesis);
    res.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ entailment: 0, neutral: 1, contradiction: 0, error: msg });
  }
});

/**
 * Server-side NLI Batch Judgment Endpoint with Concurrency Limit & Timeout
 */
app.post('/api/nli/judge-batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const { pairs } = req.body as { pairs?: { premise: string; hypothesis: string }[] };
    if (!Array.isArray(pairs)) {
      res.status(400).json({ error: 'pairs must be an array of {premise, hypothesis}' });
      return;
    }

    const results: { entailment: number; neutral: number; contradiction: number; error?: string }[] = new Array(pairs.length);
    const CONCURRENCY = 4;
    const PER_CALL_TIMEOUT_MS = 10000;

    let index = 0;
    const executeWorker = async () => {
      while (index < pairs.length) {
        const currentIndex = index++;
        const pair = pairs[currentIndex];

        if (!pair || typeof pair.premise !== 'string' || typeof pair.hypothesis !== 'string') {
          results[currentIndex] = { entailment: 0, neutral: 1, contradiction: 0, error: 'Invalid pair payload' };
          continue;
        }

        // Apply timeout
        const timeoutPromise = new Promise<{
          entailment: number;
          neutral: number;
          contradiction: number;
          error?: string;
        }>((resolve) => {
          setTimeout(() => {
            resolve({ entailment: 0, neutral: 1, contradiction: 0, error: 'Evaluation timed out' });
          }, PER_CALL_TIMEOUT_MS);
        });

        const judgment = await Promise.race([
          judgeSinglePair(pair.premise, pair.hypothesis),
          timeoutPromise,
        ]);

        results[currentIndex] = judgment;
      }
    };

    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(CONCURRENCY, pairs.length); w++) {
      workers.push(executeWorker());
    }
    await Promise.all(workers);

    res.json({ results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
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
    app.get('*', (_req: Request, res: Response) => {
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
