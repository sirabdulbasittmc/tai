import { Router } from 'express';
import { getStatus } from '../services/indexCacheService';
import { getDriveStatus } from '../services/driveService';
import { env } from '../config/env';
import { isPIIEnabled } from '../pipeline/piiService';
import prisma from '../db/prisma';
import { isGCPRetrievalReady } from '../pipeline/gcpRetrieval';
import { isVectorSearchReady } from '../pipeline/vertexVectorSearch';

const router = Router();

// Public app info — used by login page, welcome screen, etc.
router.get('/app-info', async (_req, res) => {
  const config = await prisma.systemConfig.findFirst({ where: { key: 'app_name' } }).catch(() => null);
  res.json({ appName: config?.value || 'TMC AI Intelligence' });
});

// Public logo — serve logo (system-wide)
router.get('/logo', async (_req, res) => {
  const cn = '';
  await serveLogo(cn, res);
});
router.get('/logo/:clientNumber', async (req, res) => {
  const cn = req.params.clientNumber as string;
  await serveLogo(cn, res);
});

async function serveLogo(cn: string, res: any) {
  let logo: string | null = null;

  if (cn) {
    const row = await prisma.systemConfig.findFirst({ where: { clientNumber: cn, key: 'client_logo' } }).catch(() => null);
    logo = row?.value || null;
  }

  if (!logo) {
    // Fallback: try first tenant's logo
    const row = await prisma.systemConfig.findFirst({ where: { key: 'client_logo' } }).catch(() => null);
    logo = row?.value || null;
  }

  if (!logo) {
    // No logo in DB — serve default static logo file
    const path = require('path');
    const fs = require('fs');
    const defaultLogo = path.resolve(__dirname, '../../../client/public/tmc-logo.png');
    if (fs.existsSync(defaultLogo)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(fs.readFileSync(defaultLogo));
    } else {
      res.status(404).json({ error: 'No logo found' });
    }
    return;
  }

  // Logo stored as data:image/png;base64,xxxx
  const match = logo.match(/^data:(.+);base64,(.+)$/);
  if (match) {
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } else {
    res.redirect('/tmc-logo.png');
  }
}

// ── Dependency health helpers ──────────────────────────────────────

async function checkDatabase(): Promise<{ status: 'up' | 'down'; latencyMs: number }> {
  const start = Date.now();
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return { status: 'up', latencyMs: Date.now() - start };
  } catch {
    return { status: 'down', latencyMs: Date.now() - start };
  }
}

async function checkBigQuery(): Promise<{ status: 'configured' | 'not_configured'; tables?: number }> {
  try {
    const result = await isGCPRetrievalReady();
    if (result.ready) return { status: 'configured', tables: result.tables };
  } catch { /* fall through */ }
  return { status: process.env.GCP_PROJECT_ID ? 'configured' : 'not_configured' };
}

function checkGemini(): { status: 'configured' | 'not_configured' } {
  return { status: process.env.GEMINI_API_KEY ? 'configured' : 'not_configured' };
}

function checkVertexAI(): { status: 'ready' | 'not_configured' } {
  return { status: process.env.USE_VERTEX_AI === 'true' ? 'ready' : 'not_configured' };
}

async function checkVectorSearch(): Promise<{ status: 'ready' | 'not_configured' | 'error'; deployedIndexes?: number; error?: string }> {
  if (!process.env.VECTOR_SEARCH_ENDPOINT_ID) return { status: 'not_configured' };
  try {
    const result = await isVectorSearchReady();
    if (result.ready) return { status: 'ready', deployedIndexes: result.deployedIndexes };
    return { status: 'error', error: result.error };
  } catch (e: any) {
    return { status: 'error', error: e.message };
  }
}

// ── Main health endpoint ──────────────────────────────────────────

router.get('/', async (_req, res) => {
  const [database, bigquery, gemini, vertexai, vectorSearch] = await Promise.all([
    checkDatabase(),
    checkBigQuery(),
    checkGemini(),
    checkVertexAI(),
    checkVectorSearch(),
  ]);

  const dbUp = database.status === 'up';
  const allDepsOk = bigquery.status === 'configured' && gemini.status === 'configured';

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (!dbUp) status = 'unhealthy';
  else if (!allDepsOk) status = 'degraded';
  else status = 'healthy';

  const index = getStatus();
  const drive = getDriveStatus();

  const httpStatus = status === 'unhealthy' ? 503 : 200;
  res.status(httpStatus).json({
    status,
    dependencies: { database, bigquery, gemini, vertexai, vectorSearch },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    index: {
      loaded: index.loaded,
      sectionCount: index.sectionCount,
      charCount: index.charCount,
      lastRefresh: index.lastRefresh,
      vectorCount: index.vectorCount,
      embeddingModel: index.embeddingModel,
    },
    rag: {
      enabled: env.ragEnabled,
      topK: env.ragTopK,
      minScore: env.ragMinScore,
    },
    pii: {
      enabled: isPIIEnabled(),
    },
    drive,
  });
});

// ── Kubernetes probes ─────────────────────────────────────────────

router.get('/ready', async (_req, res) => {
  const db = await checkDatabase();
  if (db.status === 'up') {
    res.status(200).json({ status: 'ready', database: db });
  } else {
    res.status(503).json({ status: 'not_ready', database: db });
  }
});

router.get('/live', (_req, res) => {
  res.status(200).json({ status: 'alive' });
});

export default router;
