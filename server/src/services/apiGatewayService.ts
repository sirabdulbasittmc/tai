// ═════════════════════════════════════════════════════════════════════════════
// apiGatewayService.ts — Phase 9: External API Gateway
//
// API key auth + per-key rate limiting extending /api/v1/
// Keys stored in api_keys table (hashed), scoped per tenant
// Rate limits: configurable per key, default 100 req/min
// ═════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import prisma from '../db/prisma';
import { isFeatureEnabled } from './featureFlagService';
import createLogger from '../utils/logger';

const log = createLogger('apiGateway');

// In-memory rate limit windows (production: move to Redis)
const rateLimitWindows = new Map<string, { count: number; windowStart: number }>();

// ─── Key management ───────────────────────────────────────────────────────────

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const raw = `tmcai_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12); // tmcai_XXXXXX — shown in UI for identification
  return { key: raw, hash, prefix };
}

export async function createApiKey(
  clientNumber: string,
  userId: number,
  label: string,
  rateLimit = 100,
  scopes: string[] = ['query'],
): Promise<{ id: number; key: string; prefix: string }> {
  const enabled = await isFeatureEnabled(clientNumber, 'feature_api_access', false);
  if (!enabled) throw new Error('API access not enabled for this tenant');

  const { key, hash, prefix } = generateApiKey();

  const record = await prisma.$queryRawUnsafe(
    `INSERT INTO api_keys (client_number, user_id, label, key_hash, key_prefix, rate_limit_rpm, scopes, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, TRUE, NOW())
     RETURNING id`,
    clientNumber, userId, label, hash, prefix, rateLimit, JSON.stringify(scopes),
  ) as any[];

  log.info('API key created', { clientNumber, userId, label, keyId: record[0]?.id });
  return { id: record[0]?.id, key, prefix };
}

export async function revokeApiKey(clientNumber: string, keyId: number): Promise<void> {
  await prisma.$queryRawUnsafe(
    `UPDATE api_keys SET is_active = FALSE WHERE id = $1 AND client_number = $2`,
    keyId, clientNumber,
  );
}

export async function listApiKeys(clientNumber: string): Promise<any[]> {
  return prisma.$queryRawUnsafe(
    `SELECT id, label, key_prefix, rate_limit_rpm, scopes, is_active, last_used_at, created_at
     FROM api_keys WHERE client_number = $1 ORDER BY created_at DESC`,
    clientNumber,
  ) as Promise<any[]>;
}

// ─── Key validation & rate limiting ──────────────────────────────────────────

export async function validateApiKey(rawKey: string): Promise<{
  valid: boolean;
  clientNumber?: string;
  userId?: number;
  scopes?: string[];
  keyId?: number;
  reason?: string;
}> {
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, client_number, user_id, scopes, rate_limit_rpm
     FROM api_keys WHERE key_hash = $1 AND is_active = TRUE`,
    hash,
  ) as any[];

  if (!rows.length) return { valid: false, reason: 'Invalid or revoked API key' };

  const row = rows[0];

  // Rate limit check
  const rateOk = checkRateLimit(String(row.id), row.rate_limit_rpm);
  if (!rateOk) return { valid: false, reason: 'Rate limit exceeded' };

  // Update last_used_at (fire-and-forget)
  prisma.$queryRawUnsafe(
    `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
    row.id,
  ).catch(() => {});

  // Log usage
  await prisma.$queryRawUnsafe(
    `INSERT INTO api_key_usage (key_id, client_number, created_at) VALUES ($1, $2, NOW())`,
    row.id, row.client_number,
  ).catch(() => {}); // Non-fatal if usage table missing

  return {
    valid: true,
    clientNumber: row.client_number,
    userId: row.user_id,
    scopes: row.scopes,
    keyId: row.id,
  };
}

function checkRateLimit(keyId: string, limitRpm: number): boolean {
  const now = Date.now();
  const window = rateLimitWindows.get(keyId);

  if (!window || now - window.windowStart > 60_000) {
    rateLimitWindows.set(keyId, { count: 1, windowStart: now });
    return true;
  }

  if (window.count >= limitRpm) return false;
  window.count++;
  return true;
}

// ─── OpenAPI spec generation ──────────────────────────────────────────────────

export function generateOpenAPISpec(baseUrl: string): object {
  return {
    openapi: '3.0.3',
    info: {
      title: 'TMC AI Enterprise API',
      version: '1.0.0',
      description: 'Programmatic access to TMC AI organizational intelligence queries, knowledge base, and agent management.',
      contact: { name: 'TMC Support', email: 'support@tmcltd.com' },
    },
    servers: [{ url: `${baseUrl}/api/v1`, description: 'Production' }],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: {
        QueryRequest: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Natural language question' },
            sources: {
              type: 'array',
              items: { type: 'string', enum: ['org', 'personal', 'uploads'] },
              description: 'Data sources to search',
            },
            conversationId: { type: 'string', description: 'Continue an existing conversation' },
          },
        },
        QueryResponse: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
            sources: { type: 'array', items: { type: 'object' } },
            conversationId: { type: 'string' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/chat': {
        post: {
          summary: 'Submit a query',
          description: 'Submit a natural language query and receive an AI-generated answer grounded in your organizational data.',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/QueryRequest' } } } },
          responses: {
            200: { description: 'Successful response', content: { 'application/json': { schema: { $ref: '#/components/schemas/QueryResponse' } } } },
            401: { description: 'Invalid or missing API key' },
            429: { description: 'Rate limit exceeded' },
          },
        },
      },
      '/knowledge': {
        get: {
          summary: 'List knowledge base items',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search query' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            200: { description: 'Knowledge items', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array' } } } } } },
          },
        },
      },
      '/agents': {
        get: {
          summary: 'List agents',
          responses: {
            200: { description: 'Agent list', content: { 'application/json': { schema: { type: 'object', properties: { agents: { type: 'array' } } } } } },
          },
        },
      },
      '/health': {
        get: {
          summary: 'Health check',
          security: [],
          responses: {
            200: { description: 'System health status' },
          },
        },
      },
    },
  };
}
