import prisma from '../db/prisma';

/**
 * AI Configuration Service — reads AI-related config from system_config table.
 * Cached in memory for 5 minutes to avoid DB calls on every chat request.
 */

interface AIConfig {
  contextLimitFast: number;
  contextLimitFull: number;
  maxOutputTokensText: number;
  maxOutputTokensWidget: number;
  maxOutputTokensQuick: number;
  thinkingBudgetText: number;
  thinkingBudgetWidget: number;
  intentTimeoutMs: number;
  dedupCacheTtlMs: number;
  weatherCacheTtlMs: number;
  historyMaxCharsUser: number;
  historyMaxCharsAssistant: number;
}

const DEFAULTS: AIConfig = {
  contextLimitFast: 50000,
  contextLimitFull: 120000,
  maxOutputTokensText: 4096,
  maxOutputTokensWidget: 8192,
  maxOutputTokensQuick: 1024,
  thinkingBudgetText: 512,
  thinkingBudgetWidget: 0,
  intentTimeoutMs: 3000,
  dedupCacheTtlMs: 300000,
  weatherCacheTtlMs: 900000,
  historyMaxCharsUser: 300,
  historyMaxCharsAssistant: 1500,
};

let cached: AIConfig | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

export async function getAIConfig(clientNumber = 'TMC-0001'): Promise<AIConfig> {
  if (cached && Date.now() - cachedAt < CACHE_TTL) return cached;

  try {
    const rows = await prisma.systemConfig.findMany({
      where: { clientNumber, key: { in: Object.keys(KEY_MAP) } },
    });

    const config = { ...DEFAULTS };
    for (const row of rows) {
      const field = KEY_MAP[row.key];
      if (field) {
        (config as any)[field] = parseInt(row.value) || (DEFAULTS as any)[field];
      }
    }

    cached = config;
    cachedAt = Date.now();
    return config;
  } catch {
    return DEFAULTS;
  }
}

// Clear cache (call when config is updated via admin panel)
export function clearAIConfigCache(): void {
  cached = null;
  cachedAt = 0;
}

// Map DB keys to config field names
const KEY_MAP: Record<string, keyof AIConfig> = {
  context_limit_fast: 'contextLimitFast',
  context_limit_full: 'contextLimitFull',
  max_output_tokens_text: 'maxOutputTokensText',
  max_output_tokens_widget: 'maxOutputTokensWidget',
  max_output_tokens_quick: 'maxOutputTokensQuick',
  thinking_budget_text: 'thinkingBudgetText',
  thinking_budget_widget: 'thinkingBudgetWidget',
  intent_timeout_ms: 'intentTimeoutMs',
  dedup_cache_ttl_ms: 'dedupCacheTtlMs',
  weather_cache_ttl_ms: 'weatherCacheTtlMs',
  history_max_chars_user: 'historyMaxCharsUser',
  history_max_chars_assistant: 'historyMaxCharsAssistant',
};
