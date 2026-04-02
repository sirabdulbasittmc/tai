// ═════════════════════════════════════════════════════════════════════════════
// dataResidencyService.ts — Phase 3.4: Multi-region data residency
//
// Per-tenant data_region in system_config controls which GCP regional resources
// (BigQuery dataset, Vector Search index, GCS bucket) are used for that tenant.
//
// Regions: pk (asia-south1) | ae (me-west1) | sa (me-central1) | qa (me-central2) | global (us-central1)
//
// The app server and PostgreSQL stay centralized (metadata only).
// Only data-plane resources (BQ, Vector Search, GCS) are region-specific.
// ═════════════════════════════════════════════════════════════════════════════

import { getFlagValue } from './featureFlagService';
import createLogger from '../utils/logger';

const log = createLogger('dataResidency');

// ─── Region registry ──────────────────────────────────────────────────────────

export type DataRegion = 'pk' | 'ae' | 'sa' | 'qa' | 'global';

const REGION_CONFIG: Record<DataRegion, {
  gcpLocation: string;
  bqDataset: string;
  bqTable: string;
  label: string;
}> = {
  pk: {
    gcpLocation: 'asia-south1',
    bqDataset: process.env.BQ_DATASET_PK    || 'tmcai_index_pk',
    bqTable:   process.env.BQ_TABLE         || 'chunks',
    label: 'Pakistan (asia-south1)',
  },
  ae: {
    gcpLocation: 'me-west1',
    bqDataset: process.env.BQ_DATASET_AE    || 'tmcai_index_ae',
    bqTable:   process.env.BQ_TABLE         || 'chunks',
    label: 'UAE (me-west1)',
  },
  sa: {
    gcpLocation: 'me-central1',
    bqDataset: process.env.BQ_DATASET_SA    || 'tmcai_index_sa',
    bqTable:   process.env.BQ_TABLE         || 'chunks',
    label: 'Saudi Arabia (me-central1)',
  },
  qa: {
    gcpLocation: 'me-central2',
    bqDataset: process.env.BQ_DATASET_QA    || 'tmcai_index_qa',
    bqTable:   process.env.BQ_TABLE         || 'chunks',
    label: 'Qatar (me-central2)',
  },
  global: {
    gcpLocation: process.env.GCP_LOCATION   || 'us-central1',
    bqDataset: process.env.BQ_DATASET       || 'tmcai_index',
    bqTable:   process.env.BQ_TABLE         || 'chunks',
    label: 'Global (us-central1)',
  },
};

// ─── Tenant region lookup ─────────────────────────────────────────────────────

const regionCache = new Map<string, { region: DataRegion; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getTenantRegion(clientNumber: string): Promise<DataRegion> {
  const cached = regionCache.get(clientNumber);
  if (cached && cached.expiresAt > Date.now()) return cached.region;

  try {
    const raw = await getFlagValue(clientNumber, 'data_region', 'global');
    const region = (Object.keys(REGION_CONFIG).includes(raw) ? raw : 'global') as DataRegion;
    regionCache.set(clientNumber, { region, expiresAt: Date.now() + CACHE_TTL_MS });
    return region;
  } catch (e: any) {
    log.warn('Region lookup failed, using global', { clientNumber, error: e.message });
    return 'global';
  }
}

export function invalidateTenantRegionCache(clientNumber: string): void {
  regionCache.delete(clientNumber);
}

// ─── BQ config for a tenant ───────────────────────────────────────────────────

export async function getTenantBQConfig(clientNumber: string): Promise<{
  location: string;
  dataset: string;
  table: string;
  region: DataRegion;
}> {
  const region = await getTenantRegion(clientNumber);
  const config = REGION_CONFIG[region];
  return {
    location: config.gcpLocation,
    dataset:  config.bqDataset,
    table:    config.bqTable,
    region,
  };
}

// ─── Admin: list available regions ───────────────────────────────────────────

export function getAvailableRegions(): Array<{ id: DataRegion; label: string }> {
  return Object.entries(REGION_CONFIG).map(([id, cfg]) => ({
    id: id as DataRegion,
    label: cfg.label,
  }));
}
