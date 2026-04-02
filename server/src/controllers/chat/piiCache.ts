import crypto from 'crypto';
import createLogger from '../../utils/logger';
import { maskPII } from '../../pipeline/piiService';

const log = createLogger('chat:pii');

// ── PII Cache (same context = same entities) ──────────────────
const piiCache = new Map<string, { maskedText: string; mapping: Record<string, string>; entities: any[]; timestamp: number }>();
const PII_CACHE_TTL_MS = 120_000; // 2 minutes

export async function maskPIICached(context: string): Promise<{ maskedText: string; mapping: Record<string, string>; entities: any[] }> {
  const hash = crypto.createHash('md5').update(context).digest('hex');
  const cached = piiCache.get(hash);
  if (cached && Date.now() - cached.timestamp < PII_CACHE_TTL_MS) {
    log.info('PII cache hit — skipping NER call');
    return cached;
  }
  const result = await maskPII(context);
  piiCache.set(hash, { ...result, timestamp: Date.now() });
  // Keep cache small
  if (piiCache.size > 50) {
    const oldest = piiCache.keys().next().value;
    if (oldest) piiCache.delete(oldest);
  }
  return result;
}
