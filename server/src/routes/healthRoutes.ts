import { Router } from 'express';
import { getStatus } from '../services/indexCacheService';
import { getDriveStatus } from '../services/driveService';
import { env } from '../config/env';
import { isPIIEnabled } from '../pipeline/piiService';
import prisma from '../db/prisma';

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

router.get('/', (_req, res) => {
  const index = getStatus();
  const drive = getDriveStatus();
  res.json({
    status: 'ok',
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

export default router;
