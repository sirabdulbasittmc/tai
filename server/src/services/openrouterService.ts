import OpenAI from 'openai';
import { env } from '../config/env';
import { FREE_MODELS } from '../config/models';

function getClient() {
  return new OpenAI({
    apiKey: env.openrouterApiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://tmcltd.ai',
      'X-Title': 'TMC Drive Intelligence',
    },
  });
}

// Error codes that mean "try the next model"
const RETRYABLE_CODES = [402, 404, 429, 503];

function isRetryableError(err: any): boolean {
  const status = err?.status || err?.response?.status;
  if (status && RETRYABLE_CODES.includes(status)) return true;
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('no endpoints') || msg.includes('insufficient credits') || msg.includes('rate limit');
}

export async function streamOpenRouter(
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void
): Promise<void> {
  if (!env.openrouterApiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }

  const client = getClient();
  const fullMessage = systemPrompt + '\n\nUser question: ' + userMessage;
  const errors: string[] = [];

  for (const model of FREE_MODELS) {
    try {
      console.log(`[OpenRouter] Trying: ${model}`);

      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: fullMessage }],
        max_tokens: env.maxTokens,
        stream: true,
      });

      let receivedContent = false;
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          if (!receivedContent) {
            console.log(`[OpenRouter] Streaming from: ${model}`);
            receivedContent = true;
          }
          onChunk(content);
        }
      }

      if (receivedContent) return; // Success

      // No content received — try next model
      console.log(`[OpenRouter] No content from ${model}, trying next...`);

    } catch (err: any) {
      const msg = err?.message || String(err);
      errors.push(`${model}: ${msg}`);
      console.log(`[OpenRouter] ${model} failed: ${msg}`);

      if (isRetryableError(err)) continue; // Try next model

      // Non-retryable error — stop
      throw err;
    }
  }

  throw new Error(`All free models exhausted. Errors:\n${errors.join('\n')}`);
}
