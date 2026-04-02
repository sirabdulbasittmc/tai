import { getConfig, getAllConfig } from './configService';

// In-memory cache with TTL
const cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

export async function isFeatureEnabled(clientNumber: string, flag: string, defaultValue = false): Promise<boolean> {
  const value = await getFlag(clientNumber, flag);
  if (value === null) return defaultValue;
  return value === 'true' || value === '1';
}

export async function getFlagValue(clientNumber: string, flag: string, defaultValue = ''): Promise<string> {
  const value = await getFlag(clientNumber, flag);
  return value ?? defaultValue;
}

export async function getNumericFlag(clientNumber: string, flag: string, defaultValue = 0): Promise<number> {
  const value = await getFlag(clientNumber, flag);
  if (value === null) return defaultValue;
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

async function getFlag(clientNumber: string, flag: string): Promise<string | null> {
  const cacheKey = `${clientNumber}:${flag}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await getConfig(clientNumber, flag);
  if (value !== null) {
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return value;
}

export function clearFlagCache(): void {
  cache.clear();
}

// List all feature flags for a tenant (for admin UI)
export async function listFlags(clientNumber: string): Promise<Record<string, string>> {
  const all = await getAllConfig(clientNumber);
  const flags: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('ff_') || key.startsWith('feature_')) {
      flags[key] = value;
    }
  }
  return flags;
}
