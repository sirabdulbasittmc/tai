import { env } from '../config/env';

export function truncate(text: string): string {
  const max = env.maxContextChars;
  if (text.length <= max) return text;
  console.log(`Content truncated from ${text.length} to ${max} chars.`);
  return text.substring(0, max) + '\n\n...[content truncated — ask more specific questions for full details]';
}
