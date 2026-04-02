import crypto from 'crypto';

// ── Request Deduplication Cache ────────────────────────────────
export interface CachedResponse {
  chunks: string[];
  meta: any;
  timestamp: number;
}

const dedupCache = new Map<string, CachedResponse>();
let DEDUP_TTL_MS = 300_000; // Default 5 min — updated from system_config on first request

export function setDedupTTL(ttlMs: number): void {
  DEDUP_TTL_MS = ttlMs;
}

export function getDedupKey(userId: number | undefined, message: string, provider: string): string {
  return crypto.createHash('md5').update(`${userId || 0}::${message}::${provider}`).digest('hex');
}

export function getCachedResponse(key: string): CachedResponse | null {
  const cached = dedupCache.get(key);
  if (!cached || Date.now() - cached.timestamp > DEDUP_TTL_MS) {
    dedupCache.delete(key);
    return null;
  }
  return cached;
}

export function setCachedResponse(key: string, response: CachedResponse): void {
  dedupCache.set(key, response);
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of dedupCache) {
    if (now - entry.timestamp > DEDUP_TTL_MS) dedupCache.delete(key);
  }
}, 60_000);
