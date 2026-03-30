import prisma from '../db/prisma';

/**
 * TokenUsageService — tracks cumulative token consumption per user per day per provider.
 *
 * Features:
 * - Upsert per day (one row per user/provider/day)
 * - Estimated cost calculation per provider
 * - Reports: per user, per client, all clients (SA view)
 * - Daily/weekly/monthly aggregation
 */

// ── Cost per 1M tokens (USD) — update as pricing changes ──────
// These should ideally come from system_config
const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gemini-flash':  { input: 0.075, output: 0.30 },   // Gemini 2.5 Flash
  'gemini':        { input: 1.25,  output: 5.00 },    // Gemini 2.5 Pro
  'claude':        { input: 3.00,  output: 15.00 },   // Claude Sonnet 4
  'openai':        { input: 2.50,  output: 10.00 },   // GPT-4o
  'groq':          { input: 0.05,  output: 0.10 },    // Llama via Groq
  'openrouter':    { input: 0.00,  output: 0.00 },    // Free tier
};

// ─── Record token usage (called after every AI response) ──────

export async function trackUsage(
  clientNumber: string,
  userId: number,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  query?: string,
  intentType?: string,
  responseTimeMs?: number
): Promise<void> {
  try {
    const totalTokens = inputTokens + outputTokens;
    const costs = COST_PER_MILLION[provider] || { input: 0, output: 0 };
    const estimatedCost = (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;

    // Update daily aggregate
    await prisma.$executeRawUnsafe(`
      INSERT INTO token_usage (client_number, user_id, date, provider, input_tokens, output_tokens, total_tokens, request_count, estimated_cost_usd)
      VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, 1, $7)
      ON CONFLICT (client_number, user_id, date, provider)
      DO UPDATE SET
        input_tokens = token_usage.input_tokens + $4,
        output_tokens = token_usage.output_tokens + $5,
        total_tokens = token_usage.total_tokens + $6,
        request_count = token_usage.request_count + 1,
        estimated_cost_usd = token_usage.estimated_cost_usd + $7,
        updated_at = NOW()
    `, clientNumber, userId, provider, inputTokens, outputTokens, totalTokens, estimatedCost);

    // Log individual query for top-consumer analysis
    if (query) {
      const reason = determineHighCostReason(inputTokens, outputTokens, intentType);
      await prisma.$executeRawUnsafe(`
        INSERT INTO token_query_log (client_number, user_id, provider, query, intent_type, input_tokens, output_tokens, total_tokens, estimated_cost_usd, response_time_ms, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, clientNumber, userId, provider, query.slice(0, 500), intentType || 'unknown',
        inputTokens, outputTokens, totalTokens, estimatedCost, responseTimeMs || 0, reason);
    }
  } catch (err: any) {
    console.error('[TokenUsage] Failed to track:', err.message);
  }
}

// Analyze WHY a query consumed high tokens
function determineHighCostReason(inputTokens: number, outputTokens: number, intentType?: string): string {
  const reasons: string[] = [];
  if (inputTokens > 10000) reasons.push('Large data context (' + Math.round(inputTokens/1000) + 'K input tokens)');
  if (outputTokens > 2000) reasons.push('Long AI response (' + Math.round(outputTokens/1000) + 'K output tokens)');
  if (intentType === 'dashboard') reasons.push('Dashboard/widget generation (HTML heavy)');
  if (intentType === 'detailed_analysis') reasons.push('Detailed analysis requested');
  if (intentType === 'comparison') reasons.push('Comparison query (multiple data points)');
  if (intentType === 'list') reasons.push('List/table generation');
  if (reasons.length === 0) reasons.push('Standard query');
  return reasons.join('; ');
}

// ─── Get top consuming queries ────────────────────────────────

export async function getTopQueries(clientNumber?: string, days = 30, limit = 10): Promise<any[]> {
  const filter = clientNumber ? 'AND client_number = $2' : '';
  const params: any[] = [days];
  if (clientNumber) params.push(clientNumber);

  return prisma.$queryRawUnsafe(`
    SELECT q.query, q.provider, q.intent_type, q.input_tokens, q.output_tokens, q.total_tokens,
           q.estimated_cost_usd, q.response_time_ms, q.reason, u.name as user_name, q.created_at
    FROM token_query_log q
    JOIN users u ON u.id = q.user_id
    WHERE q.created_at >= CURRENT_DATE - CAST($1 AS INT) ${filter}
    ORDER BY q.total_tokens DESC
    LIMIT ${limit}
  `, ...params);
}

// ─── Get user's own usage ─────────────────────────────────────

export async function getUserUsage(userId: number, days = 30): Promise<any[]> {
  return prisma.$queryRawUnsafe(`
    SELECT date, provider, input_tokens, output_tokens, total_tokens, request_count, estimated_cost_usd
    FROM token_usage WHERE user_id = $1 AND date >= CURRENT_DATE - CAST($2 AS INT)
    ORDER BY date DESC, provider
  `, userId, days);
}

// ─── Get client usage (AD view — all users in their client) ───

export async function getClientUsage(clientNumber: string, days = 30): Promise<any[]> {
  return prisma.$queryRawUnsafe(`
    SELECT u.name as user_name, t.user_id, t.date, t.provider,
           t.input_tokens, t.output_tokens, t.total_tokens, t.request_count, t.estimated_cost_usd
    FROM token_usage t
    JOIN users u ON u.id = t.user_id
    WHERE t.client_number = $1 AND t.date >= CURRENT_DATE - CAST($2 AS INT)
    ORDER BY t.date DESC, u.name, t.provider
  `, clientNumber, days);
}

// ─── Get all clients usage (SA view) ──────────────────────────

export async function getAllClientsUsage(days = 30): Promise<any[]> {
  return prisma.$queryRawUnsafe(`
    SELECT t.client_number, ten.name as client_name,
           SUM(t.input_tokens)::int as total_input,
           SUM(t.output_tokens)::int as total_output,
           SUM(t.total_tokens)::int as total_tokens,
           SUM(t.request_count)::int as total_requests,
           SUM(t.estimated_cost_usd)::numeric(10,4) as total_cost_usd
    FROM token_usage t
    JOIN tenants ten ON ten.client_number = t.client_number
    WHERE t.date >= CURRENT_DATE - CAST($1 AS INT)
    GROUP BY t.client_number, ten.name
    ORDER BY total_cost_usd DESC
  `, days);
}

// ─── Get daily summary (for charts) ──────────────────────────

export async function getDailySummary(clientNumber?: string, days = 30): Promise<any[]> {
  if (clientNumber) {
    return prisma.$queryRawUnsafe(`
      SELECT date,
             SUM(input_tokens)::int as input_tokens,
             SUM(output_tokens)::int as output_tokens,
             SUM(total_tokens)::int as total_tokens,
             SUM(request_count)::int as requests,
             SUM(estimated_cost_usd)::numeric(10,4) as cost_usd
      FROM token_usage WHERE client_number = $1 AND date >= CURRENT_DATE - CAST($2 AS INT)
      GROUP BY date ORDER BY date
    `, clientNumber, days);
  }

  return prisma.$queryRawUnsafe(`
    SELECT date,
           SUM(input_tokens)::int as input_tokens,
           SUM(output_tokens)::int as output_tokens,
           SUM(total_tokens)::int as total_tokens,
           SUM(request_count)::int as requests,
           SUM(estimated_cost_usd)::numeric(10,4) as cost_usd
    FROM token_usage WHERE date >= CURRENT_DATE - CAST($1 AS INT)
    GROUP BY date ORDER BY date
  `, days);
}

// ─── Get user ranking (top consumers) ─────────────────────────

export async function getTopUsers(clientNumber?: string, days = 30, limit = 10): Promise<any[]> {
  const clientFilter = clientNumber ? 'AND t.client_number = $2' : '';
  const params: any[] = [days];
  if (clientNumber) params.push(clientNumber);

  return prisma.$queryRawUnsafe(`
    SELECT u.name as user_name, u.email, t.client_number,
           SUM(t.total_tokens)::int as total_tokens,
           SUM(t.request_count)::int as total_requests,
           SUM(t.estimated_cost_usd)::numeric(10,4) as total_cost_usd
    FROM token_usage t
    JOIN users u ON u.id = t.user_id
    WHERE t.date >= CURRENT_DATE - CAST($1 AS INT) ${clientFilter}
    GROUP BY u.name, u.email, t.client_number
    ORDER BY total_cost_usd DESC
    LIMIT ${limit}
  `, ...params);
}

// ─── Provider-wise breakdown ──────────────────────────────────

export async function getProviderBreakdown(clientNumber?: string, days = 30): Promise<any[]> {
  const filter = clientNumber ? 'AND client_number = $2' : '';
  const params: any[] = [days];
  if (clientNumber) params.push(clientNumber);

  return prisma.$queryRawUnsafe(`
    SELECT provider,
           SUM(input_tokens)::int as input_tokens,
           SUM(output_tokens)::int as output_tokens,
           SUM(total_tokens)::int as total_tokens,
           SUM(request_count)::int as requests,
           SUM(estimated_cost_usd)::numeric(10,4) as cost_usd
    FROM token_usage WHERE date >= CURRENT_DATE - CAST($1 AS INT) ${filter}
    GROUP BY provider ORDER BY cost_usd DESC
  `, ...params);
}
