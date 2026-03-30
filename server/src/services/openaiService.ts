import OpenAI from 'openai';
import { env } from '../config/env';
import { MODEL_OPENAI } from '../config/models';

export async function streamOpenAI(
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void
): Promise<void> {
  if (!env.openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const client = new OpenAI({ apiKey: env.openaiApiKey });

  const stream = await client.chat.completions.create({
    model: MODEL_OPENAI,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: env.maxTokens,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) onChunk(content);
  }
}
