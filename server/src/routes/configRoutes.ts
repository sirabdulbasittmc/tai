import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware/auth';
import { setConfig, deleteConfig } from '../services/configService';
import { getTableInfo, getTenants, previewPurge, executePurge } from '../services/dataManagementService';
import prisma from '../db/prisma';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const SENSITIVE_KEYS = [
  'gemini_api_key', 'anthropic_api_key', 'openai_api_key',
  'groq_api_key', 'openrouter_api_key', 'google_client_secret',
  'smtp_pass', 'encryption_key',
];

// System-level keys — only SuperAdmin can read/write these
const SYSTEM_KEYS = [
  'app_name', 'session_hours', 'max_tokens', 'request_timeout_ms', 'max_context_chars',
  'rag_enabled', 'pii_enabled', 'rag_top_k', 'rag_min_score',
  'gemini_api_key', 'anthropic_api_key', 'openai_api_key', 'groq_api_key', 'openrouter_api_key',
];

const MASKED = '********';

// Resolve target client — SuperAdmin can pass ?client=XYZ-0001
function getTargetClient(req: Request): string {
  const override = req.query.client as string || req.body?.clientNumber;
  if (override && req.user!.isSuperAdmin) return override;
  return req.user!.clientNumber;
}

// Get all config (filtered by access level)
router.get('/', async (req: Request, res: Response) => {
  const targetClient = getTargetClient(req);
  const rows = await prisma.systemConfig.findMany({
    where: { clientNumber: targetClient },
    orderBy: { key: 'asc' },
  });

  // Admin sees only client-level keys, SuperAdmin sees all
  const filtered = req.user!.isSuperAdmin
    ? rows
    : rows.filter(r => !SYSTEM_KEYS.includes(r.key));

  const configs = filtered.map(r => ({
    key: r.key,
    value: r.isSensitive ? MASKED : r.value,
    isSensitive: r.isSensitive,
    description: r.description,
  }));

  res.json({ configs });
});

// Update config entries (bulk)
router.put('/', async (req: Request, res: Response) => {
  const { configs } = req.body;
  if (!configs || !Array.isArray(configs)) {
    res.status(400).json({ error: 'configs array is required' });
    return;
  }

  let updated = 0;
  for (const entry of configs) {
    if (!entry.key || entry.value === undefined) continue;
    if (entry.value === MASKED) continue;

    // Block non-SuperAdmin from writing system keys
    if (SYSTEM_KEYS.includes(entry.key) && !req.user!.isSuperAdmin) continue;

    const isSensitive = SENSITIVE_KEYS.includes(entry.key) || entry.isSensitive === true;
    await setConfig(getTargetClient(req), entry.key, entry.value, isSensitive, entry.description);
    updated++;
  }

  res.json({ success: true, updated });
});

// Set single config entry
router.put('/:key', async (req: Request, res: Response) => {
  const { value, description } = req.body;
  const key = req.params.key as string;
  if (value === undefined) { res.status(400).json({ error: 'value is required' }); return; }
  if (value === MASKED) { res.status(400).json({ error: 'Cannot save masked value' }); return; }

  if (SYSTEM_KEYS.includes(key) && !req.user!.isSuperAdmin) {
    res.status(403).json({ error: 'System config requires SuperAdmin access' });
    return;
  }

  const isSensitive = SENSITIVE_KEYS.includes(key) || req.body.isSensitive === true;
  await setConfig(getTargetClient(req), key, value, isSensitive, description);
  res.json({ success: true });
});

// Upload logo (base64 in request body)
router.post('/logo', async (req: Request, res: Response) => {
  const { logo } = req.body; // data:image/png;base64,xxxx
  if (!logo || !logo.startsWith('data:image/')) {
    res.status(400).json({ error: 'logo must be a base64 data URL (data:image/png;base64,...)' });
    return;
  }
  // Limit size: ~2MB base64 ≈ 2.7M chars
  if (logo.length > 3000000) {
    res.status(400).json({ error: 'Logo too large. Max 2MB.' });
    return;
  }
  const targetClient = getTargetClient(req);
  await setConfig(targetClient, 'client_logo', logo, false, 'Client logo (base64)');
  res.json({ success: true });
});

// Delete config entry
router.delete('/:key', async (req: Request, res: Response) => {
  const key = req.params.key as string;
  if (SYSTEM_KEYS.includes(key) && !req.user!.isSuperAdmin) {
    res.status(403).json({ error: 'System config requires SuperAdmin access' });
    return;
  }
  await deleteConfig(getTargetClient(req), key);
  res.json({ success: true });
});

// ─── Data Management (SuperAdmin only) ─────────────────────────

// List tenants for client selector
router.get('/data/tenants', requireSuperAdmin, async (_req: Request, res: Response) => {
  const tenants = await getTenants();
  res.json({ tenants });
});

// Get table info with row counts
router.get('/data/tables', requireSuperAdmin, async (req: Request, res: Response) => {
  const clientNumber = req.query.client as string || undefined;
  const tables = await getTableInfo(clientNumber || undefined);
  res.json({ tables, clientNumber: clientNumber || 'ALL' });
});

// Preview purge (counts only, no deletion)
router.post('/data/preview', requireSuperAdmin, async (req: Request, res: Response) => {
  const { tables, clientNumber } = req.body;
  if (!tables || !Array.isArray(tables) || tables.length === 0) {
    res.status(400).json({ error: 'tables array is required' });
    return;
  }
  const preview = await previewPurge(tables, clientNumber || undefined);
  res.json({ preview, clientNumber: clientNumber || 'ALL' });
});

// Execute purge
router.delete('/data/purge', requireSuperAdmin, async (req: Request, res: Response) => {
  const { tables, clientNumber } = req.body;
  if (!tables || !Array.isArray(tables) || tables.length === 0) {
    res.status(400).json({ error: 'tables array is required' });
    return;
  }
  const results = await executePurge(tables, clientNumber || undefined);
  res.json({ success: true, results });
});

export default router;
