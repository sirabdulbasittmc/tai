// ═════════════════════════════════════════════════════════════════════════════
// gcpRetrieval.ts — BigQuery + Vertex AI context retrieval (TUNED)
//
// v2: Added conversational skip, dynamic topK, quick domain match,
//     context cap, and fallback handling
// ═════════════════════════════════════════════════════════════════════════════

import { BigQuery } from '@google-cloud/bigquery';
import { VertexAI } from '@google-cloud/vertexai';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'tmcai-491811';
const LOCATION   = process.env.GCP_LOCATION   || 'us-central1';
const BQ_DATASET = process.env.BQ_DATASET     || 'tmcai_index';
const BQ_TABLE   = process.env.BQ_TABLE       || 'chunks';

// ─── CLIENTS ──────────────────────────────────────────────────────────────────
let bqClient: BigQuery | null = null;
let vertexClient: VertexAI | null = null;

function getBQ(): BigQuery {
  if (!bqClient) bqClient = new BigQuery({ projectId: PROJECT_ID });
  return bqClient;
}

function getVertex(): VertexAI {
  if (!vertexClient) vertexClient = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  return vertexClient;
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Filters {
  domain: string | null;
  account: string | null;
  geography: string | null;
  risk_flag: boolean | null;
  department: string | null;
}

interface ChunkRow {
  chunk_id: string;
  file_id: string;
  file_name: string;
  sheet_name: string;
  domain: string;
  account: string;
  geography: string;
  risk_flag: boolean;
  content: string;
  content_preview: string;
  row_count: number;
  last_updated: string;
  embedding?: number[];
  score?: number;
}

export interface RetrievalResult {
  context: string | null;
  sources: { file: string; sheet: string; domain: string }[];
  chunkCount: number;
  filters: Filters;
  elapsedMs: number;
}

// ─── FIX 1: CONVERSATIONAL SKIP ──────────────────────────────────────────────

const CONVERSATIONAL_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|bye|good|great)\b/i,
  /^how are you/i,
  /^what (is|are) you/i,
  /^who (are|is) you/i,
  /^(what can you|help me|what do you)/i,
  /what can you (do|help|tell)/i,
  /what do you (do|know|offer)/i,
  /how (do you work|can you help)/i,
  /^(remember|forget|clear|show my memory|do you know about me)/i,
  /^tell me a joke/i,
];

// External data queries — not TMC data, skip BQ, let AI answer from knowledge
const EXTERNAL_PATTERNS = [
  /exchange rate/i,
  /usd to/i, /pkr to/i, /eur to/i,
  /weather/i,
  /stock price/i,
  /^(latest |today'?s? )?news/i,
  /what time is it/i,
  /currency/i,
];

// Capability queries — user asking what AI can do
const CAPABILITY_QUERIES = [
  'what can you do', 'what can you do for me', 'what do you do',
  'how can you help', 'what are you capable', 'tell me what you can do',
  'what are your features', 'what do you offer', 'how do you work',
];

function isConversationalQuery(query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (CAPABILITY_QUERIES.some(p => trimmed.startsWith(p))) return true;
  return CONVERSATIONAL_PATTERNS.some(p => p.test(query.trim())) ||
         EXTERNAL_PATTERNS.some(p => p.test(query.trim()));
}

// ─── FIX 3: QUICK DOMAIN MATCH (skip Vertex AI for obvious queries) ──────────

function quickDomainMatch(query: string): string | null {
  const q = query.toLowerCase();
  if (q.includes('revenue') || q.includes('sales') ||
      q.includes('deal') || q.includes('invoice'))      return 'deals';
  if (q.includes('project') || q.includes('delivery') ||
      q.includes('milestone') || q.includes('schedule') ||
      q.includes('progress'))                            return 'projects';
  if (q.includes('employee') || q.includes('staff') ||
      q.includes('headcount') || q.includes('team') ||
      q.includes('department') || q.includes('grade'))   return 'employees';
  if (q.includes('pipeline') || q.includes('opportunit')) return 'pipeline';
  if (q.includes('client') || q.includes('account') ||
      q.includes('customer'))                            return 'accounts';
  if (q.includes('risk') || q.includes('blocked') ||
      q.includes('overdue'))                             return 'projects';
  if (q.includes('okr') || q.includes('objective') ||
      q.includes('target') || q.includes('kpi'))         return 'okr';
  if (q.includes('competenc') || q.includes('skill') ||
      q.includes('training'))                            return 'competency';
  if (q.includes('org chart') || q.includes('hierarchy') ||
      q.includes('reporting') || q.includes('structure')) return 'employees';
  return null;
}

// ─── FIX 2: DYNAMIC TOP-K ───────────────────────────────────────────────────

function getTopK(userQuery: string, filters: Filters): number {
  const q = userQuery.toLowerCase();

  // Dashboard/summary need more chunks
  if (q.includes('dashboard') || q.includes('summary') ||
      q.includes('overview') || q.includes('portfolio') ||
      q.includes('all projects') || q.includes('everything'))
    return 8;

  // Count queries need very few
  if (q.includes('how many') || q.includes('count') || q.includes('total number'))
    return 2;

  // Specific item lookup
  if (filters.account || q.includes('who is') || q.includes('what is the status'))
    return 3;

  // List queries
  if (q.includes('list') || q.includes('show all') || q.includes('give me all'))
    return 6;

  return 5;
}

// ─── FIX 4: CONTEXT CAP ─────────────────────────────────────────────────────

function capContext(context: string, maxTokens = 6000): string {
  const maxChars = maxTokens * 4;
  if (context.length <= maxChars) return context;
  console.log(`[GCP Retrieval] Context capped from ${context.length} to ${maxChars} chars`);
  // Cut at last newline to avoid breaking a row
  const truncated = context.substring(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n');
  return (lastNewline > 0 ? truncated.substring(0, lastNewline) : truncated) +
    '\n\n[Context truncated for performance]';
}

// ─── STEP 1: EXTRACT FILTERS ────────────────────────────────────────────────

async function extractFilters(userQuery: string): Promise<Filters> {
  // Try quick domain match first — no API call needed
  const quickDomain = quickDomainMatch(userQuery);
  if (quickDomain) {
    console.log('[GCP Retrieval] Quick domain match:', quickDomain);
    return { domain: quickDomain, account: null, geography: null, risk_flag: null, department: null };
  }

  // Fall through to Vertex AI for complex queries
  try {
    const model = getVertex().getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(`
Extract search filters from this query. Return JSON only, no explanation, no markdown.
Query: "${userQuery}"
Return exactly this structure:
{
  "domain": "projects or pipeline or employees or deals or accounts or okr or competency or doc or null",
  "account": "specific account/client name or null",
  "geography": "PK or UAE or KSA or QA or USA or null",
  "risk_flag": true or false or null,
  "department": "specific department name or null (e.g. delivery, sales, HR, finance, management)"
}
RULES:
- Only set domain if the query clearly relates to one of those categories.
- Only set account if a specific company name is mentioned.
- ONLY set risk_flag=true if the user EXPLICITLY asks for "critical risks" or "at risk". For general queries, set risk_flag=null.
- Set department if a specific department is mentioned.
- When in doubt, set fields to null (broader is better).
    `);

    const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const filters = JSON.parse(clean);
    console.log('[GCP Retrieval] Vertex AI filters:', JSON.stringify(filters));
    return filters;
  } catch (e: any) {
    console.error('[GCP Retrieval] Vertex AI filter extraction failed:', e.message);
    // Fallback: return quick match or empty
    return { domain: quickDomain, account: null, geography: null, risk_flag: null, department: null };
  }
}

// ─── STEP 2: BIGQUERY METADATA FILTER ────────────────────────────────────────

async function getChunksByMetadata(filters: Partial<Filters>): Promise<ChunkRow[]> {
  try {
    const conditions: string[] = [];
    const params: Record<string, any> = {};

    if (filters.domain) {
      conditions.push('domain = @domain');
      params.domain = filters.domain;
    }
    if (filters.account) {
      conditions.push('LOWER(account) LIKE LOWER(@account)');
      params.account = '%' + filters.account + '%';
    }
    if (filters.geography) {
      conditions.push('geography = @geography');
      params.geography = filters.geography;
    }
    if (filters.risk_flag === true) {
      conditions.push('risk_flag = TRUE');
    }
    if (filters.department) {
      conditions.push('LOWER(content) LIKE LOWER(@department)');
      params.department = '%' + filters.department + '%';
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT chunk_id, file_id, file_name, sheet_name, domain, account, geography,
             risk_flag, content, content_preview, row_count, last_updated
      FROM \`${PROJECT_ID}.${BQ_DATASET}.${BQ_TABLE}\`
      ${whereClause}
      ORDER BY last_updated DESC
      LIMIT 50
    `;

    const [rows] = await getBQ().query({
      query,
      params,
      types: filters.account ? { account: 'STRING' } : undefined,
    });
    console.log('[GCP Retrieval] BQ candidates:', rows.length);
    return rows as ChunkRow[];
  } catch (e: any) {
    console.error('[GCP Retrieval] BigQuery failed:', e.message);
    return [];
  }
}

// ─── STEP 3: EMBED QUERY ────────────────────────────────────────────────────

async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
    const result = await model.embedContent(text);
    return result.embedding?.values || null;
  } catch (e: any) {
    console.error('[GCP Retrieval] Embedding failed:', e.message);
    return null;
  }
}

// ─── STEP 4: COSINE SIMILARITY ──────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  const dot  = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}

function rankChunks(queryEmbedding: number[] | null, chunks: ChunkRow[], topK: number): ChunkRow[] {
  if (!queryEmbedding) return chunks.slice(0, topK);
  const scored = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding || []),
  }));
  return scored.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, topK);
}

// ─── STEP 5: BUILD CONTEXT ──────────────────────────────────────────────────

function buildContext(chunks: ChunkRow[]): string | null {
  if (chunks.length === 0) return null;
  return chunks.map((chunk, i) => {
    const source = chunk.file_name +
      (chunk.sheet_name && chunk.sheet_name !== '(doc)' ? ' → ' + chunk.sheet_name : '');
    return `[Source ${i + 1}: ${source}]\n${chunk.content}`;
  }).join('\n\n---\n\n');
}

// ─── MAIN: retrieveContext ──────────────────────────────────────────────────

export async function retrieveContext(userQuery: string): Promise<RetrievalResult> {
  console.log('[GCP Retrieval] Query:', userQuery);
  const startTime = Date.now();

  // FIX 1: Skip BQ for conversational queries
  if (isConversationalQuery(userQuery)) {
    console.log('[GCP Retrieval] Conversational — skipping BQ');
    return { context: null, sources: [], chunkCount: 0, filters: { domain: null, account: null, geography: null, risk_flag: null, department: null }, elapsedMs: 0 };
  }

  // Step 0: For count/quick queries, try data_summary chunk first (saves ~5K tokens)
  const isCountQuery = /\b(how many|count|total number|how much)\b/i.test(userQuery);
  if (isCountQuery) {
    try {
      const [summaryRows] = await getBQ().query({
        query: `SELECT chunk_id, file_id, file_name, sheet_name, domain, account, geography, risk_flag, content, content_preview, row_count, last_updated FROM \`${PROJECT_ID}.${BQ_DATASET}.${BQ_TABLE}\` WHERE chunk_id = 'data_summary' LIMIT 1`,
      });
      if (summaryRows.length > 0) {
        const elapsed = Date.now() - startTime;
        console.log(`[GCP Retrieval] Count query — using data_summary chunk (${elapsed}ms)`);
        const summaryChunk = summaryRows[0] as ChunkRow;
        return {
          context: `[Source: Data Summary — exact counts]\n${summaryChunk.content}`,
          sources: [{ file: 'Data Summary', sheet: '(summary)', domain: 'summary' }],
          chunkCount: 1,
          filters: { domain: null, account: null, geography: null, risk_flag: null, department: null },
          elapsedMs: elapsed,
        };
      }
    } catch (e: any) {
      console.log('[GCP Retrieval] data_summary not found, falling back to full retrieval');
    }
  }

  // Step 1: Extract filters (quick match first, then Vertex AI)
  const filters = await extractFilters(userQuery);

  // Step 2: BigQuery metadata filter
  let candidates = await getChunksByMetadata(filters);

  // Fallback: domain only
  if (candidates.length === 0 && filters.domain) {
    console.log('[GCP Retrieval] No results with full filters — trying domain only');
    candidates = await getChunksByMetadata({ domain: filters.domain });
  }

  // Fallback: recent chunks
  if (candidates.length === 0) {
    console.log('[GCP Retrieval] No domain match — fetching recent chunks');
    candidates = await getChunksByMetadata({});
  }

  // FIX 2: Dynamic topK
  const topK = Math.min(getTopK(userQuery, filters), candidates.length);

  // Step 3: Embed + rank
  const queryEmbedding = await embedQuery(userQuery);
  const topChunks = rankChunks(queryEmbedding, candidates, topK);

  // Step 4: Build context
  let context = buildContext(topChunks);

  // FIX 4: Cap context size
  if (context) context = capContext(context);

  const elapsed = Date.now() - startTime;
  console.log(`[GCP Retrieval] Done in ${elapsed}ms — ${topChunks.length} chunks, ~${Math.round((context || '').length / 4)} tokens`);

  return {
    context,
    sources: topChunks.map(c => ({ file: c.file_name, sheet: c.sheet_name, domain: c.domain })),
    chunkCount: topChunks.length,
    filters,
    elapsedMs: elapsed,
  };
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

export async function isGCPRetrievalReady(): Promise<{ ready: boolean; tables?: number; error?: string }> {
  try {
    const [rows] = await getBQ().query({
      query: `SELECT COUNT(*) as cnt FROM \`${PROJECT_ID}.${BQ_DATASET}.${BQ_TABLE}\``,
    });
    return { ready: true, tables: Number(rows[0]?.cnt || 0) };
  } catch (e: any) {
    return { ready: false, error: e.message };
  }
}
