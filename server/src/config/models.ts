export const MODEL_CLAUDE = 'claude-sonnet-4-20250514';
export const MODEL_OPENAI = 'gpt-4o';
export const MODEL_GEMINI = 'gemini-2.5-pro';
export const MODEL_GEMINI_FLASH = 'gemini-2.5-flash';
// gemini-2.0-flash-lite removed — using 2.5-flash with thinkingBudget:0 instead
export const MODEL_GROQ = 'meta-llama/llama-4-scout-17b-16e-instruct';

// OpenRouter free models — tried in order, auto-fallback
export const FREE_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'minimax/minimax-m2.5:free',
  'arcee-ai/trinity-large-preview:free',
  'stepfun/step-3.5-flash:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'liquid/lfm-2.5-1.2b-thinking:free',
  'liquid/lfm-2.5-1.2b-instruct:free',
];

export type Provider = 'gemini' | 'gemini-flash' | 'groq' | 'claude' | 'openai' | 'openrouter';

export const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: 'TMC Brain Deep',
  'gemini-flash': 'TMC Brain Fast',
  groq: 'Groq (Llama 4)',
  claude: 'Claude Sonnet 4',
  openai: 'GPT-4o',
  openrouter: 'OpenRouter (Free)',
};
