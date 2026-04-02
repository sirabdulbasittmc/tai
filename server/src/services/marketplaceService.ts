// ═════════════════════════════════════════════════════════════════════════════
// marketplaceService.ts — Phase 9: Connector Marketplace
//
// Manages connector listings, tenant installations, and agent templates
// Revenue share: 70% creator, 30% platform (stored in marketplace_connectors)
// ═════════════════════════════════════════════════════════════════════════════

import prisma from '../db/prisma';
import { isFeatureEnabled } from './featureFlagService';
import createLogger from '../utils/logger';

const log = createLogger('marketplace');

// ─── Connectors ───────────────────────────────────────────────────────────────

export async function listConnectors(category?: string): Promise<any[]> {
  const rows = await prisma.$queryRawUnsafe(
    category
      ? `SELECT * FROM marketplace_connectors WHERE is_published = TRUE AND category = $1 ORDER BY downloads DESC`
      : `SELECT * FROM marketplace_connectors WHERE is_published = TRUE ORDER BY downloads DESC`,
    ...(category ? [category] : []),
  ) as any[];
  return rows;
}

export async function installConnector(
  clientNumber: string,
  connectorId: number,
  userId: number,
  config: Record<string, any> = {},
): Promise<void> {
  const enabled = await isFeatureEnabled(clientNumber, 'feature_marketplace', false);
  if (!enabled) throw new Error('Marketplace not enabled for this tenant');

  await prisma.$queryRawUnsafe(
    `INSERT INTO marketplace_installations (client_number, connector_id, installed_by, config)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (client_number, connector_id) DO UPDATE SET config = $4::jsonb`,
    clientNumber, connectorId, userId, JSON.stringify(config),
  );

  // Increment download counter (fire-and-forget)
  prisma.$queryRawUnsafe(
    `UPDATE marketplace_connectors SET downloads = downloads + 1 WHERE id = $1`,
    connectorId,
  ).catch(() => {});

  log.info('Connector installed', { clientNumber, connectorId });
}

export async function uninstallConnector(clientNumber: string, connectorId: number): Promise<void> {
  await prisma.$queryRawUnsafe(
    `DELETE FROM marketplace_installations WHERE client_number = $1 AND connector_id = $2`,
    clientNumber, connectorId,
  );
}

export async function listInstalledConnectors(clientNumber: string): Promise<any[]> {
  return prisma.$queryRawUnsafe(
    `SELECT mi.*, mc.name, mc.slug, mc.npm_package, mc.category
     FROM marketplace_installations mi
     JOIN marketplace_connectors mc ON mc.id = mi.connector_id
     WHERE mi.client_number = $1`,
    clientNumber,
  ) as Promise<any[]>;
}

// ─── Agent templates ──────────────────────────────────────────────────────────

export async function listAgentTemplates(category?: string): Promise<any[]> {
  const rows = await prisma.$queryRawUnsafe(
    category
      ? `SELECT * FROM agent_templates WHERE is_published = TRUE AND category = $1 ORDER BY name`
      : `SELECT * FROM agent_templates WHERE is_published = TRUE ORDER BY name`,
    ...(category ? [category] : []),
  ) as any[];
  return rows;
}

export async function getAgentTemplate(slug: string): Promise<any | null> {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM agent_templates WHERE slug = $1 AND is_published = TRUE LIMIT 1`,
    slug,
  ) as any[];
  return rows[0] || null;
}
