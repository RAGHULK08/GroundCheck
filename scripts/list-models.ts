import { GoogleGenAI } from '@google/genai';

/**
 * List the Gemini models this API key can use, so GEMINI_CHAT_MODEL / GEMINI_EMBED_MODEL
 * can be pointed at one with more free quota. Usage: npm run models
 * Free-tier limits per model: https://ai.google.dev/gemini-api/docs/rate-limits
 */
const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey || apiKey === 'your-gemini-api-key-here') {
  console.error('Set GEMINI_API_KEY in .env first.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const chat: string[] = [];
const embed: string[] = [];
const pager = await ai.models.list({ config: { pageSize: 100 } });
for await (const model of pager) {
  const name = (model.name ?? '').replace(/^models\//, '');
  const actions = model.supportedActions ?? [];
  if (actions.includes('generateContent')) chat.push(name);
  if (actions.includes('embedContent')) embed.push(name);
}
console.log(`Chat models (GEMINI_CHAT_MODEL), currently "${process.env.GEMINI_CHAT_MODEL || 'default'}":`);
for (const n of chat.sort()) console.log(`  ${n}`);
console.log(`\nEmbedding models (GEMINI_EMBED_MODEL), currently "${process.env.GEMINI_EMBED_MODEL || 'default'}":`);
for (const n of embed.sort()) console.log(`  ${n}`);
