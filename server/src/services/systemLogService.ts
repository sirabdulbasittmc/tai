import prisma from '../db/prisma';
import { streamGemini } from './geminiService';

/**
 * SystemLogService — records errors, warnings, truncation issues, and system events.
 *
 * Features:
 * - Auto-dedup: same error increments recurrence_count instead of creating new row
 * - AI suggestions: generates fix recommendations for admins
 * - Recurrence detection: flags if a resolved issue comes back
 * - Admin workflow: open → catered → monitors for recurrence
 */

export type LogLevel = 'error' | 'warning' | 'info';
export type LogCategory =
  | 'data_truncation'    // Data was cut due to context limits
  | 'api_error'          // External API failed (Gmail, Calendar, Weather, News, Gemini)
  | 'auth_error'         // OAuth/token issues
  | 'intent_error'       // Intent classification failed or timed out
  | 'memory_error'       // Memory extraction/update failed
  | 'email_error'        // Email send/read failed
  | 'calendar_error'     // Calendar read/write failed
  | 'scheduler_error'    // Scheduled task failed
  | 'data_quality'       // Data validation issue (missing fields, duplicates)
  | 'performance'        // Slow response (>20s)
  | 'system'             // General system issues
  | 'security';          // Auth failures, suspicious activity

interface LogEntry {
  clientNumber?: string;
  userId?: number;
  level: LogLevel;
  category: LogCategory;
  source: string;        // e.g., 'chatController', 'gmailService', 'schedulerService'
  message: string;       // Human-readable description
  details?: string;      // Stack trace, raw error, context
  suggestion?: string;   // Auto-generated or manual fix suggestion
}

// ─── Record a log entry (auto-dedup) ──────────────────────────

export async function log(entry: LogEntry): Promise<void> {
  try {
    // Check for existing similar log (same category + source + message pattern)
    const messageKey = entry.message.slice(0, 100); // First 100 chars as key
    const existing: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, status, recurrence_count FROM system_logs
      WHERE category = $1 AND source = $2 AND LEFT(message, 100) = $3
      AND status != 'resolved'
      ORDER BY last_seen_at DESC LIMIT 1
    `, entry.category, entry.source, messageKey);

    if (existing.length > 0) {
      // Same issue recurring — increment count
      await prisma.$executeRawUnsafe(`
        UPDATE system_logs SET
          recurrence_count = recurrence_count + 1,
          last_seen_at = NOW(),
          details = $1
        WHERE id = $2
      `, entry.details || '', existing[0].id);

      // If it was marked as "catered" but came back, flag it
      if (existing[0].status === 'catered') {
        await prisma.$executeRawUnsafe(`
          UPDATE system_logs SET status = 'recurring', last_seen_at = NOW() WHERE id = $1
        `, existing[0].id);
        console.log(`[SystemLog] RECURRING issue detected: ${entry.category}/${entry.source} — ${messageKey}`);
      }
      return;
    }

    // New issue — create log entry
    await prisma.$executeRawUnsafe(`
      INSERT INTO system_logs (client_number, user_id, level, category, source, message, details, suggestion, status, recurrence_count, first_seen_at, last_seen_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', 1, NOW(), NOW())
    `,
      entry.clientNumber || null,
      entry.userId || null,
      entry.level,
      entry.category,
      entry.source,
      entry.message,
      entry.details || null,
      entry.suggestion || null,
    );
  } catch (err: any) {
    // Don't let logging errors crash the app
    console.error('[SystemLog] Failed to record log:', err.message);
  }
}

// ─── Convenience methods ──────────────────────────────────────

export async function logError(category: LogCategory, source: string, message: string, details?: string): Promise<void> {
  await log({ level: 'error', category, source, message, details });
}

export async function logWarning(category: LogCategory, source: string, message: string, details?: string): Promise<void> {
  await log({ level: 'warning', category, source, message, details });
}

export async function logInfo(category: LogCategory, source: string, message: string, details?: string): Promise<void> {
  await log({ level: 'info', category, source, message, details });
}

// ─── Truncation logging ───────────────────────────────────────

export async function logTruncation(sectionName: string, fullSize: number, truncatedTo: number, userId?: number): Promise<void> {
  const pctLost = Math.round((1 - truncatedTo / fullSize) * 100);
  const neededLimit = Math.ceil(fullSize * 1.2); // 20% buffer above actual size
  await log({
    level: pctLost > 50 ? 'warning' : 'info',
    category: 'data_truncation',
    source: 'sectionRetriever',
    message: `Section "${sectionName}" truncated: ${fullSize.toLocaleString()} → ${truncatedTo.toLocaleString()} chars (${pctLost}% data lost)`,
    details: `Full section: ${fullSize.toLocaleString()} chars\nShown to AI: ${truncatedTo.toLocaleString()} chars\nData lost: ${(fullSize - truncatedTo).toLocaleString()} chars (${pctLost}%)`,
    suggestion: `ACTION: Go to Admin → Settings → AI Context & Tokens → set "context_limit_full" to at least ${neededLimit.toLocaleString()}. Current value is too low to fit the "${sectionName}" section (${fullSize.toLocaleString()} chars). This causes the AI to see incomplete data and report wrong counts or miss records.`,
    userId,
  });
}

// ─── Performance logging ──────────────────────────────────────

export async function logSlowResponse(prompt: string, elapsed: number, provider: string, userId?: number): Promise<void> {
  await log({
    level: elapsed > 30 ? 'error' : 'warning',
    category: 'performance',
    source: 'chatController',
    message: `Slow response: ${elapsed}s for "${prompt.slice(0, 50)}" via ${provider}`,
    details: `Prompt: ${prompt}\nProvider: ${provider}\nElapsed: ${elapsed}s`,
    suggestion: elapsed > 30
      ? `ACTION: This query took ${elapsed}s which is too slow. Steps to fix:\n1. Go to Admin → Settings → AI Context & Tokens → reduce "context_limit_full" (lower = faster but less data)\n2. Or switch default provider to "gemini-flash" which is 2-3x faster\n3. Or create an artifact template for this query type (Admin → check artifact templates) so it uses cached HTML instead of generating from scratch`
      : `MONITOR: Response took ${elapsed}s (target is <20s). If this keeps happening, consider reducing "max_output_tokens_text" in Admin → Settings → AI Context & Tokens, or reducing "context_limit_full" for faster processing.`,
    userId,
  });
}

// ─── Get logs for admin ───────────────────────────────────────

export async function getLogs(options?: {
  status?: string;
  level?: string;
  category?: string;
  limit?: number;
}): Promise<any[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (options?.status) { conditions.push(`status = $${paramIdx++}`); params.push(options.status); }
  if (options?.level) { conditions.push(`level = $${paramIdx++}`); params.push(options.level); }
  if (options?.category) { conditions.push(`category = $${paramIdx++}`); params.push(options.category); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = options?.limit || 50;

  return prisma.$queryRawUnsafe(`
    SELECT * FROM system_logs ${where}
    ORDER BY
      CASE status WHEN 'recurring' THEN 0 WHEN 'open' THEN 1 WHEN 'catered' THEN 2 WHEN 'resolved' THEN 3 END,
      last_seen_at DESC
    LIMIT ${limit}
  `, ...params);
}

// ─── Get log summary for dashboard ────────────────────────────

export async function getLogSummary(): Promise<{
  total: number;
  open: number;
  recurring: number;
  catered: number;
  byCategory: { category: string; count: number }[];
  byLevel: { level: string; count: number }[];
}> {
  const [total]: any[] = await prisma.$queryRawUnsafe("SELECT COUNT(*) as cnt FROM system_logs WHERE status != 'resolved'");
  const [open]: any[] = await prisma.$queryRawUnsafe("SELECT COUNT(*) as cnt FROM system_logs WHERE status = 'open'");
  const [recurring]: any[] = await prisma.$queryRawUnsafe("SELECT COUNT(*) as cnt FROM system_logs WHERE status = 'recurring'");
  const [catered]: any[] = await prisma.$queryRawUnsafe("SELECT COUNT(*) as cnt FROM system_logs WHERE status = 'catered'");
  const byCategory: any[] = await prisma.$queryRawUnsafe("SELECT category, COUNT(*) as count FROM system_logs WHERE status != 'resolved' GROUP BY category ORDER BY count DESC");
  const byLevel: any[] = await prisma.$queryRawUnsafe("SELECT level, COUNT(*) as count FROM system_logs WHERE status != 'resolved' GROUP BY level ORDER BY count DESC");

  return {
    total: Number(total.cnt),
    open: Number(open.cnt),
    recurring: Number(recurring.cnt),
    catered: Number(catered.cnt),
    byCategory,
    byLevel,
  };
}

// ─── Mark log as catered ──────────────────────────────────────

export async function caterLog(logId: number, userId: number, note?: string): Promise<void> {
  await prisma.$executeRawUnsafe(`
    UPDATE system_logs SET status = 'catered', resolved_by = $1, resolved_at = NOW(), resolution_note = $2 WHERE id = $3
  `, userId, note || 'Marked as catered', logId);
}

// ─── Mark log as resolved ─────────────────────────────────────

export async function resolveLog(logId: number, userId: number, note?: string): Promise<void> {
  await prisma.$executeRawUnsafe(`
    UPDATE system_logs SET status = 'resolved', resolved_by = $1, resolved_at = NOW(), resolution_note = $2 WHERE id = $3
  `, userId, note || 'Resolved', logId);
}

// ─── AI-generated suggestions for open logs ───────────────────

export async function generateSuggestionsForLogs(): Promise<{ logId: number; suggestion: string }[]> {
  const openLogs: any[] = await prisma.$queryRawUnsafe(`
    SELECT id, category, source, message, details, recurrence_count
    FROM system_logs WHERE status IN ('open', 'recurring') AND suggestion IS NULL
    ORDER BY recurrence_count DESC LIMIT 10
  `);

  if (openLogs.length === 0) return [];

  const logSummary = openLogs.map(l =>
    `Log #${l.id} [${l.category}] (${l.recurrence_count}x): ${l.message}`
  ).join('\n');

  let suggestions = '';
  try {
    await streamGemini(
      'You are a system administrator advisor. For each log entry below, provide a brief, actionable fix suggestion (1-2 sentences). Format: #ID: suggestion',
      `System logs needing attention:\n${logSummary}`,
      (chunk) => { suggestions += chunk; },
      true, 512, true
    );
  } catch { return []; }

  // Parse suggestions and update logs
  const results: { logId: number; suggestion: string }[] = [];
  for (const log of openLogs) {
    const match = suggestions.match(new RegExp(`#${log.id}:?\\s*(.+?)(?=#\\d|$)`, 's'));
    if (match) {
      const suggestion = match[1].trim();
      await prisma.$executeRawUnsafe('UPDATE system_logs SET suggestion = $1 WHERE id = $2', suggestion, log.id);
      results.push({ logId: log.id, suggestion });
    }
  }

  return results;
}
