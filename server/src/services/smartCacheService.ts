import crypto from 'crypto';
import { getNumericFlag } from './featureFlagService';

// ── Types ────────────────────────────────────────────────────────

export interface CacheKey {
  clientNumber: string;
  queryHash: string;           // MD5 of normalized query (lowercase, stripped punctuation)
  sourceSelector: string;      // sorted comma-join of selected sources (e.g., "bigquery,drive")
  personalDataVersion: string; // null until Phase 4; hash of personal data timestamp after
  provider: string;            // LLM provider
}

export interface CachedResult {
  chunks: string[];
  meta: any;
  cachedAt: number;
}

interface CacheEntry {
  result: CachedResult;
  ttlMs: number;
  clientNumber: string;  // stored for invalidation lookups
}

// ── Stats ────────────────────────────────────────────────────────

let hits = 0;
let misses = 0;

// ── In-memory cache ──────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Public API ───────────────────────────────────────────────────

/**
 * Build a deterministic cache key from structured parameters.
 * Normalizes the query (lowercase, strip punctuation) before hashing.
 */
export function buildCacheKey(params: CacheKey): string {
  const parts = [
    params.clientNumber,
    params.queryHash,
    params.sourceSelector,
    params.personalDataVersion || 'null',
    params.provider,
  ].join('::');
  return crypto.createHash('md5').update(parts).digest('hex');
}

/**
 * Normalize a raw user query into a stable hash.
 * Lowercases, strips punctuation, collapses whitespace, then MD5s.
 */
export function normalizeQueryHash(query: string): string {
  const normalized = query
    .toLowerCase()
    .replace(/[^\w\s]/g, '')   // strip punctuation
    .replace(/\s+/g, ' ')      // collapse whitespace
    .trim();
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Look up a cached LLM response.  Returns null on miss or TTL expiry.
 */
export function getCachedResult(key: string): CachedResult | null {
  const entry = cache.get(key);
  if (!entry) {
    misses++;
    return null;
  }

  // TTL check
  if (Date.now() - entry.result.cachedAt > entry.ttlMs) {
    cache.delete(key);
    misses++;
    return null;
  }

  hits++;
  return entry.result;
}

/**
 * Store an LLM response in the cache.
 * @param ttlMs  Override TTL; falls back to system_config `ff_smart_cache_ttl_ms` default.
 */
export function setCachedResult(key: string, result: CachedResult, ttlMs?: number): void {
  // Extract clientNumber from the result or default — we store it for invalidation
  // The caller should pass clientNumber through the CacheKey; we parse it from the key param
  // For invalidation we store the clientNumber separately in the entry.
  cache.set(key, {
    result,
    ttlMs: ttlMs ?? DEFAULT_TTL_MS,
    clientNumber: '',  // will be set by the wrapper below
  });
}

/**
 * Store with explicit client tracking (preferred over bare setCachedResult).
 */
export function setCachedResultForClient(
  key: string,
  clientNumber: string,
  result: CachedResult,
  ttlMs?: number,
): void {
  cache.set(key, {
    result,
    ttlMs: ttlMs ?? DEFAULT_TTL_MS,
    clientNumber,
  });
}

/**
 * Invalidate all cached responses for a given client (org data re-indexed).
 */
export function invalidateForClient(clientNumber: string): void {
  for (const [key, entry] of cache) {
    if (entry.clientNumber === clientNumber) {
      cache.delete(key);
    }
  }
}

/**
 * Invalidate cached responses for a specific user within a client.
 * Placeholder for Phase 4 personal data layer — currently behaves the same
 * as invalidateForClient since personal data version is not yet tracked.
 */
export function invalidateForUser(clientNumber: string, _userId: number): void {
  // Phase 4 will key personal responses separately; for now, clear all client entries
  invalidateForClient(clientNumber);
}

/**
 * Return cache statistics for the analytics dashboard.
 */
export function getCacheStats(): { size: number; hitRate: number; hits: number; misses: number } {
  const total = hits + misses;
  return {
    size: cache.size,
    hitRate: total > 0 ? hits / total : 0,
    hits,
    misses,
  };
}

/**
 * Read the configured TTL from system_config (async because it hits the DB).
 * Falls back to DEFAULT_TTL_MS if the flag is not set.
 */
export async function getConfiguredTTL(clientNumber: string): Promise<number> {
  const ttl = await getNumericFlag(clientNumber, 'ff_smart_cache_ttl_ms', DEFAULT_TTL_MS);
  return ttl > 0 ? ttl : DEFAULT_TTL_MS;
}

// ── Periodic cleanup ─────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.result.cachedAt > entry.ttlMs) {
      cache.delete(key);
    }
  }
}, 60_000);
