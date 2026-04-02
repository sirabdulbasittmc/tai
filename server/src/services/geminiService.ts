import { getGenAI } from './genaiClient';
import { env } from '../config/env';
import { MODEL_GEMINI, MODEL_GEMINI_FLASH } from '../config/models';

// Conversation history type for multi-turn support
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export async function streamGemini(
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void,
  useFlash: boolean = false,
  maxOutputTokens?: number,
  disableThinking: boolean = false,
  conversationHistory?: ChatTurn[]
): Promise<void> {
  if (!env.geminiApiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const modelId = useFlash ? MODEL_GEMINI_FLASH : MODEL_GEMINI;
  const ai = getGenAI();

  // Build multi-turn contents array
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  if (conversationHistory && conversationHistory.length > 0) {
    for (const turn of conversationHistory) {
      contents.push({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: turn.content }],
      });
    }
  }
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  const stream = await ai.models.generateContentStream({
    model: modelId,
    contents,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: maxOutputTokens || (useFlash ? 4096 : 6144),
      ...(disableThinking ? {
        thinkingConfig: {
          thinkingBudget: (maxOutputTokens || 0) > 4096 ? 0 : 512,
        },
      } : {}),
    },
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) onChunk(text);
  }
}
