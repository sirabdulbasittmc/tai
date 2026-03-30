import prisma from '../db/prisma';

/**
 * DataManagementService — table-level data purge for SuperAdmin.
 * Supports per-client or all-client operations.
 * Handles FK dependencies and safe deletion order.
 */

// Table metadata — what can be purged
const TABLE_META: Record<string, { label: string; category: 'transactional' | 'configuration' | 'ai_memory' | 'monitoring'; model: string }> = {
  // Transactional
  audit_log:          { label: 'Audit Logs',             category: 'transactional', model: 'auditLog' },
  messages:           { label: 'Messages',               category: 'transactional', model: 'message' },
  conversations:      { label: 'Conversations',          category: 'transactional', model: 'conversation' },
  scheduled_tasks:    { label: 'Scheduled Tasks',        category: 'transactional', model: 'scheduledTask' },
  sessions:           { label: 'Sessions',               category: 'transactional', model: 'session' },
  chunks:             { label: 'Chunks (Embeddings)',     category: 'transactional', model: 'chunk' },
  documents:          { label: 'Documents',              category: 'transactional', model: 'document' },

  // AI Memory & Learning
  user_profile_memory: { label: 'User Memory',           category: 'ai_memory', model: '_raw' },
  user_learning:       { label: 'User Learning',         category: 'ai_memory', model: '_raw' },
  feedback:            { label: 'Feedback (Thumbs)',      category: 'ai_memory', model: '_raw' },
  general_artifacts:   { label: 'General Artifacts',      category: 'ai_memory', model: '_raw' },
  user_artifacts:      { label: 'User Artifacts',         category: 'ai_memory', model: '_raw' },

  // Monitoring & Usage
  system_logs:         { label: 'System Logs',            category: 'monitoring', model: '_raw' },
  token_usage:         { label: 'Token Usage (Daily)',     category: 'monitoring', model: '_raw' },
  token_query_log:     { label: 'Token Query Log',        category: 'monitoring', model: '_raw' },

  // Configuration
  system_config:       { label: 'System Config',          category: 'configuration', model: 'systemConfig' },
  client_licenses:     { label: 'Client Licenses',        category: 'configuration', model: 'clientLicense' },
};

// FK dependencies — if you delete parent, children must go first
const DEPENDENCY_MAP: Record<string, string[]> = {
  conversations: ['messages'],
  documents:     ['chunks'],
  users:         ['sessions', 'messages', 'conversations', 'audit_log', 'scheduled_tasks'],
};

// Safe deletion order (children before parents)
const DELETE_ORDER = [
  'token_query_log', 'token_usage', 'system_logs', 'feedback',
  'user_learning', 'user_profile_memory', 'user_artifacts', 'general_artifacts',
  'audit_log', 'messages', 'scheduled_tasks', 'sessions',
  'conversations', 'chunks', 'documents', 'client_licenses', 'system_config',
];

/**
 * Get table info with row counts for a client (or all clients).
 */
export async function getTableInfo(clientNumber?: string) {
  const where = clientNumber ? { clientNumber } : {};
  const results: { key: string; label: string; category: string; count: number }[] = [];

  for (const [key, meta] of Object.entries(TABLE_META)) {
    let count = 0;
    try {
      if (meta.model === '_raw') {
        // Raw SQL tables — use direct query
        const whereClause = clientNumber ? `WHERE client_number = '${clientNumber}'` : '';
        const rows: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM ${key} ${whereClause}`);
        count = Number(rows[0]?.cnt || 0);
      } else {
        count = await (prisma as any)[meta.model].count({ where }).catch(() =>
          (prisma as any)[meta.model].count().catch(() => 0)
        );
      }
    } catch {
      count = 0;
    }
    results.push({ key, label: meta.label, category: meta.category, count });
  }

  return results;
}

/**
 * Get list of all tenants (for client selector).
 */
export async function getTenants() {
  return prisma.tenant.findMany({
    orderBy: { clientNumber: 'asc' },
    select: { clientNumber: true, name: true, isActive: true },
  });
}

/**
 * Preview purge — returns counts that would be deleted without actually deleting.
 */
export async function previewPurge(tables: string[], clientNumber?: string) {
  const expanded = expandDependencies(tables);
  const ordered = sortByDeleteOrder(expanded);
  const where = clientNumber ? { clientNumber } : {};

  const preview: { table: string; label: string; count: number }[] = [];

  for (const key of ordered) {
    const meta = TABLE_META[key];
    if (!meta) continue;
    let count = 0;
    try {
      if (meta.model === '_raw') {
        const whereClause = clientNumber ? `WHERE client_number = '${clientNumber}'` : '';
        const rows: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM ${key} ${whereClause}`);
        count = Number(rows[0]?.cnt || 0);
      } else {
        count = await (prisma as any)[meta.model].count({ where }).catch(() =>
          (prisma as any)[meta.model].count().catch(() => 0)
        );
      }
    } catch { count = 0; }
    preview.push({ table: key, label: meta.label, count });
  }

  return preview;
}

/**
 * Execute purge — deletes data from selected tables for a client (or all).
 */
export async function executePurge(tables: string[], clientNumber?: string): Promise<{ table: string; deleted: number }[]> {
  const expanded = expandDependencies(tables);
  const ordered = sortByDeleteOrder(expanded);
  const where = clientNumber ? { clientNumber } : {};

  const results: { table: string; deleted: number }[] = [];

  // Execute in transaction for atomicity
  await prisma.$transaction(async (tx: any) => {
    for (const key of ordered) {
      const meta = TABLE_META[key];
      if (!meta) continue;
      let deleted = 0;
      try {
        if (meta.model === '_raw') {
          const whereClause = clientNumber ? `WHERE client_number = '${clientNumber}'` : '';
          const rows: any[] = await tx.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM ${key} ${whereClause}`);
          deleted = Number(rows[0]?.cnt || 0);
          await tx.$executeRawUnsafe(`DELETE FROM ${key} ${whereClause}`);
        } else {
          const result = await tx[meta.model].deleteMany({ where });
          deleted = result.count;
        }
      } catch {
        try {
          if (meta.model === '_raw') {
            await tx.$executeRawUnsafe(`DELETE FROM ${key}`);
          } else {
            const result = await tx[meta.model].deleteMany({});
            deleted = result.count;
          }
        } catch { deleted = 0; }
      }
      results.push({ table: key, deleted });
    }
  });

  console.log(`[DataMgmt] Purge complete: ${results.map(r => `${r.table}:${r.deleted}`).join(', ')} | client: ${clientNumber || 'ALL'}`);
  return results;
}

function expandDependencies(tables: string[]): string[] {
  const expanded = new Set(tables);
  for (const table of tables) {
    const deps = DEPENDENCY_MAP[table];
    if (deps) deps.forEach(d => expanded.add(d));
  }
  return Array.from(expanded);
}

function sortByDeleteOrder(tables: string[]): string[] {
  return tables.sort((a, b) => {
    const ai = DELETE_ORDER.indexOf(a);
    const bi = DELETE_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}
