import Groq from 'groq-sdk';
import { env } from '../config/env';
import { MODEL_GROQ } from '../config/models';

export async function streamGroq(
  systemPrompt: string,
  userMessage: string,
  onChunk: (text: string) => void
): Promise<void> {
  if (!env.groqApiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const client = new Groq({ apiKey: env.groqApiKey });

  const stream = await client.chat.completions.create({
    model: MODEL_GROQ,
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
