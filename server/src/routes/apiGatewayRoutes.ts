// Phase 9: External API Gateway routes
// Mounts at /api/v1/developer — requires session auth for key management
// /api/external/v1/* — requires X-API-Key header (apiKeyAuth middleware)
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiKeyAuth } from '../middleware/apiKeyAuth';
import {
  createApiKey, revokeApiKey, listApiKeys, generateOpenAPISpec,
} from '../services/apiGatewayService';
import { getBrandingConfig, updateBrandingConfig } from '../services/whiteLabelService';
import {
  listConnectors, installConnector, uninstallConnector,
  listInstalledConnectors, listAgentTemplates, getAgentTemplate,
} from '../services/marketplaceService';
import { env } from '../config/env';

// ── Developer portal (session auth) ───────────────────────────────────────────
export const developerRouter = Router();
developerRouter.use(requireAuth);

// GET /api/v1/developer/keys — list API keys
developerRouter.get('/keys', async (req, res, next) => {
  try {
    const keys = await listApiKeys(req.user!.clientNumber as string);
    res.json({ keys });
  } catch (err) { next(err); }
});

// POST /api/v1/developer/keys — create API key
developerRouter.post('/keys', async (req, res, next) => {
  try {
    const cn = req.user!.clientNumber as string;
    const { label, rateLimit, scopes } = req.body;
    const result = await createApiKey(cn, req.user!.id, label, rateLimit, scopes);
    // key is shown once — never stored in plaintext
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// DELETE /api/v1/developer/keys/:id — revoke API key
developerRouter.delete('/keys/:id', async (req, res, next) => {
  try {
    await revokeApiKey(req.user!.clientNumber as string, parseInt(req.params.id as string, 10));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/v1/developer/spec — OpenAPI spec
developerRouter.get('/spec', (_req, res) => {
  const spec = generateOpenAPISpec(env.baseUrl || 'https://tai.tmcltd.com');
  res.json(spec);
});

// GET /api/v1/developer/branding — get branding config
developerRouter.get('/branding', async (req, res, next) => {
  try {
    const config = await getBrandingConfig(req.user!.clientNumber as string);
    res.json(config);
  } catch (err) { next(err); }
});

// PATCH /api/v1/developer/branding — update branding config
developerRouter.patch('/branding', async (req, res, next) => {
  try {
    await updateBrandingConfig(req.user!.clientNumber as string, req.body);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Marketplace ────────────────────────────────────────────────────────────────

// GET /api/v1/developer/marketplace/connectors
developerRouter.get('/marketplace/connectors', async (req, res, next) => {
  try {
    const items = await listConnectors(req.query.category as string | undefined);
    res.json({ items });
  } catch (err) { next(err); }
});

// POST /api/v1/developer/marketplace/connectors/:id/install
developerRouter.post('/marketplace/connectors/:id/install', async (req, res, next) => {
  try {
    const cn = req.user!.clientNumber as string;
    await installConnector(cn, parseInt(req.params.id as string, 10), req.user!.id, req.body.config);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /api/v1/developer/marketplace/connectors/:id
developerRouter.delete('/marketplace/connectors/:id', async (req, res, next) => {
  try {
    await uninstallConnector(req.user!.clientNumber as string, parseInt(req.params.id as string, 10));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/v1/developer/marketplace/installed
developerRouter.get('/marketplace/installed', async (req, res, next) => {
  try {
    const items = await listInstalledConnectors(req.user!.clientNumber as string);
    res.json({ items });
  } catch (err) { next(err); }
});

// GET /api/v1/developer/marketplace/agent-templates
developerRouter.get('/marketplace/agent-templates', async (req, res, next) => {
  try {
    const items = await listAgentTemplates(req.query.category as string | undefined);
    res.json({ items });
  } catch (err) { next(err); }
});

// GET /api/v1/developer/marketplace/agent-templates/:slug
developerRouter.get('/marketplace/agent-templates/:slug', async (req, res, next) => {
  try {
    const item = await getAgentTemplate(req.params.slug as string);
    if (!item) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json(item);
  } catch (err) { next(err); }
});

// ── External API (API key auth) ────────────────────────────────────────────────
export const externalApiRouter = Router();
externalApiRouter.use(apiKeyAuth);

// GET /api/external/v1/health — unauthenticated health
externalApiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// POST /api/external/v1/query — main query endpoint for external consumers
externalApiRouter.post('/query', async (req, res, next) => {
  try {
    // Proxy to internal chat endpoint logic
    // Reuse existing chatController by forwarding as an internal request
    const { query, sources, conversationId } = req.body;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query is required', code: 'INVALID_REQUEST' });
      return;
    }

    // Delegate to chat route internally (simplified — returns JSON, not SSE)
    res.status(501).json({
      error: 'External query endpoint — integrate with chatController in production',
      code: 'NOT_IMPLEMENTED',
      hint: 'Wire externalApiRouter /query to chatController with streaming disabled',
    });
  } catch (err) { next(err); }
});
