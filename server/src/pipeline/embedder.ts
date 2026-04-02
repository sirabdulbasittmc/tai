import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import createLogger from '../utils/logger';

const log = createLogger('embedder');

import { MODEL_EMBEDDING } from '../config/models';
const EMBEDDING_MODEL = MODEL_EMBEDDING;
const BATCH_SIZE = 50;  // Gemini embedding API batch limit

// Embedder uses its own client because it may have a separate API key
let embedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!embedClient) {
    const key = env.geminiEmbedKey;
    if (!key) throw new Error('GEMINI_API_KEY or GEMINI_API_KEY_EMBED required for embeddings');
    embedClient = new GoogleGenAI({ apiKey: key });
  }
  return embedClient;
}

/**
 * Generate embedding vector for a single text.
 */
export async function embedText(text: string): Promise<number[]> {
  const client = getClient();
  const result = await client.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });
  return result.embeddings?.[0]?.values || [];
}

/**
 * Generate embeddings for multiple texts in batches.
 * Returns vectors in the same order as input texts.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const client = getClient();
  const allVectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(text => client.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
      }))
    );
    for (const result of results) {
      allVectors.push(result.embeddings?.[0]?.values || []);
    }

    if (i + BATCH_SIZE < texts.length) {
      log.info('Embedding progress', { done: Math.min(i + BATCH_SIZE, texts.length), total: texts.length });
    }
  }

  log.info('Generated embeddings', { count: allVectors.length, model: EMBEDDING_MODEL, dims: allVectors[0]?.length || 0 });
  return allVectors;
}

export function getEmbeddingModel(): string {
  return EMBEDDING_MODEL;
}
