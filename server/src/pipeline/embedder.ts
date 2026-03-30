import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const BATCH_SIZE = 50;  // Gemini embedding API batch limit

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    const key = env.geminiEmbedKey;
    if (!key) throw new Error('GEMINI_API_KEY or GEMINI_API_KEY_EMBED required for embeddings');
    genAI = new GoogleGenerativeAI(key);
  }
  return genAI;
}

/**
 * Generate embedding vector for a single text.
 */
export async function embedText(text: string): Promise<number[]> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

/**
 * Generate embeddings for multiple texts in batches.
 * Returns vectors in the same order as input texts.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });
  const allVectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(text => model.embedContent(text))
    );
    for (const result of results) {
      allVectors.push(result.embedding.values);
    }

    if (i + BATCH_SIZE < texts.length) {
      console.log(`[Embedder] Embedded ${Math.min(i + BATCH_SIZE, texts.length)}/${texts.length} chunks...`);
    }
  }

  console.log(`[Embedder] Generated ${allVectors.length} embeddings (model: ${EMBEDDING_MODEL}, dims: ${allVectors[0]?.length || 0})`);
  return allVectors;
}

export function getEmbeddingModel(): string {
  return EMBEDDING_MODEL;
}
