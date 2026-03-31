import { BigQuery } from '@google-cloud/bigquery';
import { Section } from '../types';

/**
 * BigQueryConnector — queries business data directly from BigQuery tables.
 *
 * Replaces the markdown file approach:
 * - No truncation (SQL returns exact data needed)
 * - Real-time (no 1-hour Apps Script delay)
 * - Accurate counts (COUNT(*) is always right)
 * - Filterable (WHERE clauses instead of full-text search)
 *
 * Configuration:
 * - GCP_PROJECT_ID: Google Cloud project
 * - BQ_DATASET: BigQuery dataset name (e.g., 'tmcai_data')
 * - GOOGLE_APPLICATION_CREDENTIALS: path to service account key (or use default credentials)
 */

const DEFAULT_PROJECT = process.env.GCP_PROJECT_ID || 'tmcai-491811';
const DEFAULT_DATASET = process.env.BQ_DATASET || 'tmcai_data';

let bqClient: BigQuery | null = null;

function getClient(): BigQuery {
  if (!bqClient) {
    bqClient = new BigQuery({ projectId: DEFAULT_PROJECT });
  }
  return bqClient;
}

// ─── Table Registry ───────────────────────────────────────────
// Maps business concepts to BigQuery tables + key columns
// This is the BigQuery equivalent of the Routing Manifest

interface TableConfig {
  table: string;
  keyColumn: string;
  label: string;       // "projects", "employees", "deals"
  intentKeywords: string[];  // for query routing
  defaultColumns?: string[]; // columns to fetch by default
  defaultSort?: string;      // default ORDER BY
}

const TABLE_REGISTRY: TableConfig[] = [
  {
    table: 'projects',
    keyColumn: 'project_code',
    label: 'projects',
    intentKeywords: ['project', 'status', 'delivery', 'milestone', 'risk', 'progress'],
    defaultColumns: ['project_code', 'project_name', 'client_name', 'plan_start_date', 'plan_end_date', 'overall_progress', 'plan_deviation', 'open_risks'],
    defaultSort: 'overall_progress DESC',
  },
  {
    table: 'employees',
    keyColumn: 'employee_id',
    label: 'employees',
    intentKeywords: ['employee', 'staff', 'headcount', 'hr', 'people', 'team', 'department', 'org'],
    defaultColumns: ['employee_id', 'full_name', 'title', 'grade', 'department', 'team', 'location', 'reporting_manager', 'employment_type'],
    defaultSort: 'grade ASC, full_name ASC',
  },
  {
    table: 'deals',
    keyColumn: 'deal_id',
    label: 'deals',
    intentKeywords: ['deal', 'sales', 'revenue', 'client', 'account', 'closed'],
    defaultColumns: ['description', 'account', 'date_closed', 'deal_owner', 'milestone', 'tech', 'revenue', 'currency'],
    defaultSort: 'revenue DESC',
  },
  {
    table: 'pipeline',
    keyColumn: 'opp_id',
    label: 'opportunities',
    intentKeywords: ['pipeline', 'opportunity', 'prospect', 'funnel', 'crm'],
    defaultColumns: ['opp_id', 'opportunity_name', 'account', 'practice', 'stage', 'value_pkr', 'value_usd', 'probability', 'owner', 'expected_close'],
    defaultSort: 'value_pkr DESC',
  },
  {
    table: 'competency_matrix',
    keyColumn: 'employee_id',
    label: 'competency records',
    intentKeywords: ['competency', 'skill', 'training', 'assessment'],
    defaultSort: 'employee_id ASC',
  },
  {
    table: 'customer_360',
    keyColumn: 'account_name',
    label: 'accounts',
    intentKeywords: ['customer', 'account', 'client 360', 'key account'],
    defaultSort: 'account_name ASC',
  },
];

// ─── Query BigQuery ───────────────────────────────────────────

export async function queryTable(
  tableName: string,
  options?: {
    columns?: string[];
    where?: string;
    orderBy?: string;
    limit?: number;
    dataset?: string;
  }
): Promise<any[]> {
  const bq = getClient();
  const dataset = options?.dataset || DEFAULT_DATASET;
  const cols = options?.columns?.join(', ') || '*';
  const where = options?.where ? `WHERE ${options.where}` : '';
  const order = options?.orderBy ? `ORDER BY ${options.orderBy}` : '';
  const limit = options?.limit ? `LIMIT ${options.limit}` : '';

  const sql = `SELECT ${cols} FROM \`${DEFAULT_PROJECT}.${dataset}.${tableName}\` ${where} ${order} ${limit}`;

  try {
    console.log(`[BigQuery] ${sql.slice(0, 120)}...`);
    const [rows] = await bq.query({ query: sql });
    return rows;
  } catch (err: any) {
    console.error(`[BigQuery] Query failed: ${err.message}`);
    throw err;
  }
}

// ─── Get table counts (for Data Summary) ──────────────────────

export async function getTableCounts(dataset?: string): Promise<Record<string, number>> {
  const bq = getClient();
  const ds = dataset || DEFAULT_DATASET;
  const counts: Record<string, number> = {};

  for (const config of TABLE_REGISTRY) {
    try {
      const sql = `SELECT COUNT(DISTINCT ${config.keyColumn}) as cnt FROM \`${DEFAULT_PROJECT}.${ds}.${config.table}\``;
      const [rows] = await bq.query({ query: sql });
      counts[config.table] = Number(rows[0]?.cnt || 0);
    } catch {
      counts[config.table] = 0;
    }
  }

  return counts;
}

// ─── Build Data Summary from BigQuery ─────────────────────────

// Cache the summary for 5 minutes — avoids BQ call on every chat request
let bqSummaryCache: { text: string; fetchedAt: number } | null = null;
const BQ_SUMMARY_TTL = 5 * 60 * 1000;

export async function getDataSummaryFromBQ(dataset?: string): Promise<string> {
  if (bqSummaryCache && Date.now() - bqSummaryCache.fetchedAt < BQ_SUMMARY_TTL) {
    return bqSummaryCache.text;
  }

  // Try live tables first (tmcai_data), then fall back to chunks dataset (tmcai_index)
  let counts = await getTableCounts(dataset);
  const hasData = Object.values(counts).some(c => c > 0);

  if (!hasData) {
    // Fallback: count distinct domains in the chunks table
    try {
      const bq = getClient();
      const chunkDataset = process.env.BQ_DATASET || 'tmcai_index';
      const chunkTable = process.env.BQ_TABLE || 'chunks';
      const [rows] = await bq.query({
        query: `SELECT domain, SUM(row_count) as total_rows FROM \`${DEFAULT_PROJECT}.${chunkDataset}.${chunkTable}\` GROUP BY domain ORDER BY total_rows DESC`,
      });
      const lines: string[] = [];
      for (const row of rows as any[]) {
        if (row.domain && row.total_rows > 0) {
          lines.push(`${row.domain}: ${row.total_rows} rows`);
        }
      }
      if (lines.length > 0) {
        const text = '── DATA SUMMARY (from BigQuery chunks) ──\n' +
          lines.join('\n') +
          '\nThese are row counts from the indexed data. Use these for all count questions.\n── END SUMMARY ──\n\n';
        bqSummaryCache = { text, fetchedAt: Date.now() };
        return text;
      }
    } catch (e: any) {
      console.error('[BigQuery] Chunk count fallback failed:', e.message);
    }
    return '';
  }

  const lines: string[] = [];
  for (const config of TABLE_REGISTRY) {
    const count = counts[config.table] || 0;
    if (count > 0) {
      lines.push(`${config.table}: ${count} ${config.label}`);
    }
  }

  const text = '── DATA SUMMARY (from BigQuery — real-time) ──\n' +
    lines.join('\n') +
    '\nThese are EXACT counts from the live database. Use these for all count questions.\n── END SUMMARY ──\n\n';
  bqSummaryCache = { text, fetchedAt: Date.now() };
  return text;
}

// ─── Find matching table for a query ──────────────────────────

export function findMatchingTable(scope: string): TableConfig | null {
  const scopeLower = scope.toLowerCase();
  let bestMatch: TableConfig | null = null;
  let bestScore = 0;

  for (const config of TABLE_REGISTRY) {
    let score = 0;
    for (const keyword of config.intentKeywords) {
      if (scopeLower.includes(keyword)) {
        score += keyword.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = config;
    }
  }

  return bestScore >= 3 ? bestMatch : null;
}

// ─── Query for AI context (replaces section retriever) ────────

export async function queryForContext(
  scope: string,
  maxRows = 500,
  dataset?: string
): Promise<string> {
  const config = findMatchingTable(scope);
  if (!config) return '';

  try {
    const rows = await queryTable(config.table, {
      columns: config.defaultColumns,
      orderBy: config.defaultSort,
      limit: maxRows,
      dataset,
    });

    if (rows.length === 0) return '';

    // Convert to pipe-delimited text (same format AI expects)
    const headers = config.defaultColumns || Object.keys(rows[0]);
    let text = `[section: ${config.table} | source: BigQuery | rows: ${rows.length}]\n`;
    text += headers.join(' | ') + '\n';
    text += headers.map(() => '---').join(' | ') + '\n';

    for (const row of rows) {
      const vals = headers.map(h => {
        const v = row[h];
        if (v === null || v === undefined) return '-';
        if (v instanceof Date) return v.toLocaleDateString();
        return String(v);
      });
      text += vals.join(' | ') + '\n';
    }

    return text;
  } catch (err: any) {
    console.error(`[BigQuery] Context query failed: ${err.message}`);
    return '';
  }
}

// ─── Aggregate queries (for breakdowns without truncation) ────

export async function queryAggregate(
  tableName: string,
  groupBy: string,
  countColumn = '*',
  dataset?: string
): Promise<{ group: string; count: number }[]> {
  const bq = getClient();
  const ds = dataset || DEFAULT_DATASET;

  const sql = `SELECT ${groupBy} as grp, COUNT(${countColumn}) as cnt FROM \`${DEFAULT_PROJECT}.${ds}.${tableName}\` GROUP BY ${groupBy} ORDER BY cnt DESC`;

  try {
    const [rows] = await bq.query({ query: sql });
    return rows.map((r: any) => ({ group: String(r.grp || 'Unknown'), count: Number(r.cnt || 0) }));
  } catch (err: any) {
    console.error(`[BigQuery] Aggregate failed: ${err.message}`);
    return [];
  }
}

// ─── Check if BigQuery is configured and accessible ───────────

export async function isBigQueryReady(): Promise<{ ready: boolean; error?: string }> {
  try {
    const bq = getClient();
    const ds = DEFAULT_DATASET;
    const [tables] = await bq.dataset(ds).getTables();
    return { ready: true };
  } catch (err: any) {
    return { ready: false, error: err.message };
  }
}

// ─── Export registry for external use ─────────────────────────

export function getTableRegistry(): TableConfig[] {
  return TABLE_REGISTRY;
}
