import { VertexAI } from '@google-cloud/vertexai';

/**
 * VertexAIService — uses Google Cloud Vertex AI for LLM inference.
 *
 * Benefits over direct Gemini API:
 * - Enterprise SLA and support
 * - Better rate limits (TPM, RPM)
 * - Model versioning and management
 * - Fine-tuning capability
 * - VPC-SC and private endpoints
 * - Integrated monitoring via Cloud Logging
 *
 * Configuration:
 * - GCP_PROJECT_ID: Google Cloud project
 * - GCP_LOCATION: Region (default: us-central1)
 * - VERTEX_MODEL: Model ID (default: gemini-2.5-flash)
 */

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'tmcai-491811';
const LOCATION = process.env.GCP_LOCATION || 'us-central1';

let vertexClient: VertexAI | null = null;

function getClient(): VertexAI {
  if (!vertexClient) {
    vertexClient = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  }
  return vertexClient;
}

// ─── Streaming Generation (replaces streamGemini) ─────────────

export async function streamVertexAI(
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void,
  modelId = 'gemini-2.5-flash',
  maxOutputTokens = 4096,
  thinkingBudget?: number
): Promise<void> {
  const vertex = getClient();

  const model = vertex.getGenerativeModel({
    model: modelId,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens,
      temperature: 0.7,
      topP: 0.95,
    },
  });

  const request = {
    contents: [{ role: 'user' as const, parts: [{ text: userMessage }] }],
  };

  try {
    const streamResult = await model.generateContentStream(request);

    for await (const chunk of streamResult.stream) {
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) onChunk(text);
    }
  } catch (err: any) {
    console.error(`[VertexAI] Stream error: ${err.message}`);
    throw err;
  }
}

// ─── Non-streaming Generation ─────────────────────────────────

export async function generateVertexAI(
  systemPrompt: string,
  userMessage: string,
  modelId = 'gemini-2.5-flash',
  maxOutputTokens = 1024
): Promise<string> {
  const vertex = getClient();

  const model = vertex.getGenerativeModel({
    model: modelId,
    systemInstruction: systemPrompt,
    generationConfig: { maxOutputTokens },
  });

  const result = await model.generateContent({
    contents: [{ role: 'user' as const, parts: [{ text: userMessage }] }],
  });

  return result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── Embeddings via Vertex AI ─────────────────────────────────

export async function embedTextVertex(
  text: string,
  modelId = 'text-embedding-005'
): Promise<number[]> {
  const vertex = getClient();

  // Vertex AI embeddings use a different API path
  // For now, fall back to the Gemini embedding API
  // Vertex AI native embeddings will be available via aiplatform SDK
  const { embedText } = require('../pipeline/embedder');
  return embedText(text);
}

// ─── Check if Vertex AI is configured ─────────────────────────

export async function isVertexAIReady(): Promise<{ ready: boolean; model?: string; error?: string }> {
  try {
    const vertex = getClient();
    const model = vertex.getGenerativeModel({ model: 'gemini-2.5-flash' });
    // Quick test — generate 1 token
    const result = await model.generateContent({
      contents: [{ role: 'user' as const, parts: [{ text: 'hi' }] }],
    });
    return { ready: true, model: 'gemini-2.5-flash' };
  } catch (err: any) {
    return { ready: false, error: err.message };
  }
}

// ─── Unified streaming function (drop-in replacement for streamGemini) ──

export async function streamWithVertexAI(
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void,
  useFlash = false,
  maxOutputTokens?: number,
  disableThinking = false
): Promise<void> {
  const modelId = useFlash ? 'gemini-2.5-flash' : 'gemini-2.5-pro';
  const tokens = maxOutputTokens || (useFlash ? 4096 : 6144);

  // For Vertex AI, thinkingBudget is controlled differently
  // The SDK handles it internally — we just set maxOutputTokens
  await streamVertexAI(systemPrompt, userMessage, onChunk, modelId, tokens);
}
