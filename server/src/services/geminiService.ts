import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { MODEL_GEMINI, MODEL_GEMINI_FLASH } from '../config/models';

export async function streamGemini(
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void,
  useFlash: boolean = false,
  maxOutputTokens?: number,
  disableThinking: boolean = false
): Promise<void> {
  if (!env.geminiApiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const modelId = useFlash ? MODEL_GEMINI_FLASH : MODEL_GEMINI;

  // For widget generation, use REST API with thinkingConfig to disable thinking
  // SDK v0.24 doesn't support thinkingConfig, so we call the API directly
  if (disableThinking) {
    // Use REST API with controlled thinking budget
    // Widget/HTML: thinkingBudget=0 (all tokens for output)
    // Text responses: thinkingBudget=512 (some thinking improves quality)
    const isLargeOutput = (maxOutputTokens || 0) > 4096;
    const budget = isLargeOutput ? 0 : 512;
    await streamGeminiREST(modelId, systemPrompt, userMessage, onChunk, maxOutputTokens || 4096, budget);
    return;
  }

  const genAI = new GoogleGenerativeAI(env.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: maxOutputTokens || (useFlash ? 4096 : 6144),
    },
  });

  const result = await model.generateContentStream(userMessage);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) onChunk(text);
  }
}

/**
 * Direct REST API call to Gemini with thinkingConfig support.
 * Disables thinking to maximize visible output tokens for widget HTML generation.
 */
async function streamGeminiREST(
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void,
  maxOutputTokens: number,
  thinkingBudget: number = 0
): Promise<void> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${env.geminiApiKey}`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      maxOutputTokens,
      thinkingConfig: { thinkingBudget },
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini REST error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const parsed = JSON.parse(json);
        // parts may contain thinking (thought:true) + visible text — get visible text only
        const parts = parsed?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.text && !part.thought) onChunk(part.text);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  // Process remaining buffer
  if (buffer.startsWith('data: ')) {
    try {
      const parsed = JSON.parse(buffer.slice(6).trim());
      const parts = parsed?.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.text && !part.thought) onChunk(part.text);
      }
    } catch {}
  }
}
