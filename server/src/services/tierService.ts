import prisma from '../db/prisma';

export interface TierSettings {
  tierCode: string;
  tierName: string;
  responseStyle: 'brief' | 'moderate' | 'detailed' | 'comprehensive';
  maxResponseWords: number;
  maxOutputTokens: number;
  allowWidgets: boolean;
  allowCharts: boolean;
  allowTables: boolean;
  allowExport: boolean;
  exportFormats: string;
  allowedProviders: string;
  allowEmailRead: boolean;
  allowEmailWrite: boolean;
  allowCalendarRead: boolean;
  allowCalendarWrite: boolean;
  maxQueriesPerDay: number;
  maxScheduledTasks: number;
}

// Default tier for users without a configured tier
const DEFAULT_TIER: TierSettings = {
  tierCode: 'DEFAULT',
  tierName: 'Default',
  responseStyle: 'moderate',
  maxResponseWords: 500,
  maxOutputTokens: 2048,
  allowWidgets: true,
  allowCharts: true,
  allowTables: true,
  allowExport: true,
  exportFormats: 'csv,doc,pdf',
  allowedProviders: 'gemini-flash',
  allowEmailRead: true,
  allowEmailWrite: false,
  allowCalendarRead: true,
  allowCalendarWrite: false,
  maxQueriesPerDay: 100,
  maxScheduledTasks: 5,
};

// In-memory cache: clientNumber_tierCode → { settings, fetchedAt }
const tierCache = new Map<string, { settings: TierSettings; fetchedAt: number }>();
const TIER_CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Fetches tier settings for a user based on their userType and clientNumber.
 * Falls back to DEFAULT_TIER if no tier is configured.
 */
export async function getUserTier(clientNumber: string, userType: string): Promise<TierSettings> {
  const cacheKey = `${clientNumber}_${userType}`;
  const cached = tierCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < TIER_CACHE_TTL_MS) {
    return cached.settings;
  }

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      'SELECT * FROM user_tiers WHERE client_number = $1 AND tier_code = $2 AND is_active = true',
      clientNumber, userType
    );

    if (rows.length === 0) {
      tierCache.set(cacheKey, { settings: DEFAULT_TIER, fetchedAt: Date.now() });
      return DEFAULT_TIER;
    }

    const t = rows[0];
    const settings: TierSettings = {
      tierCode: t.tier_code,
      tierName: t.tier_name,
      responseStyle: t.response_style || 'moderate',
      maxResponseWords: Number(t.max_response_words) || 500,
      maxOutputTokens: Number(t.max_output_tokens) || 2048,
      allowWidgets: t.allow_widgets ?? true,
      allowCharts: t.allow_charts ?? true,
      allowTables: t.allow_tables ?? true,
      allowExport: t.allow_export ?? true,
      exportFormats: t.export_formats || 'csv',
      allowedProviders: t.allowed_providers || 'gemini-flash',
      allowEmailRead: t.allow_email_read ?? true,
      allowEmailWrite: t.allow_email_write ?? false,
      allowCalendarRead: t.allow_calendar_read ?? true,
      allowCalendarWrite: t.allow_calendar_write ?? false,
      maxQueriesPerDay: Number(t.max_queries_per_day) || 100,
      maxScheduledTasks: Number(t.max_scheduled_tasks) || 0,
    };

    tierCache.set(cacheKey, { settings, fetchedAt: Date.now() });
    return settings;
  } catch (err: any) {
    console.error('[TierService] Failed to fetch tier:', err.message);
    return DEFAULT_TIER;
  }
}

/** Clear tier cache (called when admin updates tiers) */
export function clearTierCache(): void {
  tierCache.clear();
}
