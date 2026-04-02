// ═════════════════════════════════════════════════════════════════════════════
// whiteLabelService.ts — Phase 9: White-label branding per tenant
//
// Supports:
// - Per-tenant CSS overrides (stored in system_config)
// - Custom domain (CNAME) association
// - Logo, app name, primary color
// - Branding removal flag
// ═════════════════════════════════════════════════════════════════════════════

import prisma from '../db/prisma';
import createLogger from '../utils/logger';

const log = createLogger('whiteLabel');

// 5-minute in-memory cache per tenant
const brandingCache = new Map<string, { data: BrandingConfig; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface BrandingConfig {
  appName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  customCss: string | null;
  customDomain: string | null;
  removeBranding: boolean;
  faviconUrl: string | null;
}

const DEFAULT_BRANDING: BrandingConfig = {
  appName: 'TMC AI',
  logoUrl: null,
  primaryColor: '#2563eb',
  accentColor: '#1e40af',
  customCss: null,
  customDomain: null,
  removeBranding: false,
  faviconUrl: null,
};

export async function getBrandingConfig(clientNumber: string): Promise<BrandingConfig> {
  const cached = brandingCache.get(clientNumber);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.data;

  const rows = await prisma.$queryRawUnsafe(
    `SELECT key, value FROM system_config
     WHERE client_number = $1 AND key LIKE 'branding_%'`,
    clientNumber,
  ) as any[];

  const kvMap: Record<string, string> = {};
  for (const row of rows) {
    kvMap[row.key] = row.value;
  }

  const config: BrandingConfig = {
    appName: kvMap['branding_app_name'] || DEFAULT_BRANDING.appName,
    logoUrl: kvMap['branding_logo_url'] || null,
    primaryColor: kvMap['branding_primary_color'] || DEFAULT_BRANDING.primaryColor,
    accentColor: kvMap['branding_accent_color'] || DEFAULT_BRANDING.accentColor,
    customCss: kvMap['branding_custom_css'] || null,
    customDomain: kvMap['branding_custom_domain'] || null,
    removeBranding: kvMap['branding_remove_powered_by'] === 'true',
    faviconUrl: kvMap['branding_favicon_url'] || null,
  };

  brandingCache.set(clientNumber, { data: config, cachedAt: Date.now() });
  return config;
}

export async function updateBrandingConfig(
  clientNumber: string,
  updates: Partial<BrandingConfig>,
): Promise<void> {
  const keyMap: Record<keyof BrandingConfig, string> = {
    appName: 'branding_app_name',
    logoUrl: 'branding_logo_url',
    primaryColor: 'branding_primary_color',
    accentColor: 'branding_accent_color',
    customCss: 'branding_custom_css',
    customDomain: 'branding_custom_domain',
    removeBranding: 'branding_remove_powered_by',
    faviconUrl: 'branding_favicon_url',
  };

  for (const [field, value] of Object.entries(updates)) {
    const key = keyMap[field as keyof BrandingConfig];
    if (!key) continue;
    const strValue = value === null ? '' : String(value);

    await prisma.$queryRawUnsafe(
      `INSERT INTO system_config (client_number, key, value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (client_number, key) DO UPDATE SET value = $3, updated_at = NOW()`,
      clientNumber, key, strValue,
    );
  }

  brandingCache.delete(clientNumber); // Invalidate cache
  log.info('Branding config updated', { clientNumber, fields: Object.keys(updates) });
}

export async function getTenantByDomain(domain: string): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT client_number FROM system_config
     WHERE key = 'branding_custom_domain' AND value = $1 LIMIT 1`,
    domain,
  ) as any[];
  return rows[0]?.client_number || null;
}

export function generateTenantCss(config: BrandingConfig): string {
  const lines: string[] = [
    ':root {',
    `  --color-primary: ${config.primaryColor};`,
    `  --color-accent: ${config.accentColor};`,
    '}',
  ];
  if (config.customCss) lines.push(config.customCss);
  return lines.join('\n');
}
