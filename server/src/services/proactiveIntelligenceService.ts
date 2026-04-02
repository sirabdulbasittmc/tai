// ═════════════════════════════════════════════════════════════════════════════
// proactiveIntelligenceService.ts — Phase 5: Proactive intelligence alerts
//
// Hourly anomaly scan + daily insights using the existing AI pipeline.
// Alerts stored in proactive_alerts, surfaced in admin UI + email.
// ═════════════════════════════════════════════════════════════════════════════

import prisma from '../db/prisma';
import { getGenAI } from './genaiClient';
import { isFeatureEnabled } from './featureFlagService';
import { retrieveContext } from '../pipeline/gcpRetrieval';
import createLogger from '../utils/logger';

const log = createLogger('proactiveIntel');

// ─── Create an alert ─────────────────────────────────────────────────────────

export async function createAlert(
  clientNumber: string,
  alertType: string,
  title: string,
  content: string,
  severity: 'info' | 'warning' | 'critical' = 'info',
  expiresInHours = 48,
): Promise<void> {
  // Avoid duplicate alerts of same type+title in last 24h
  const existing: any[] = await prisma.$queryRawUnsafe(
    `SELECT id FROM proactive_alerts
     WHERE client_number = $1 AND alert_type = $2 AND title = $3
       AND created_at > NOW() - INTERVAL '24 hours'`,
    clientNumber, alertType, title,
  );
  if (existing.length > 0) return; // Already alerted

  await prisma.$executeRawUnsafe(
    `INSERT INTO proactive_alerts (client_number, alert_type, title, content, severity, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${expiresInHours} hours')`,
    clientNumber, alertType, title, content, severity,
  );
  log.info('Alert created', { clientNumber, alertType, severity, title });
}

// ─── Get alerts for a tenant ──────────────────────────────────────────────────

export async function getAlerts(clientNumber: string, unreadOnly = false): Promise<Array<{
  id: number; alertType: string; title: string; content: string;
  severity: string; isRead: boolean; createdAt: Date;
}>> {
  const where = unreadOnly ? 'AND is_read = FALSE' : '';
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, alert_type, title, content, severity, is_read, created_at
     FROM proactive_alerts
     WHERE client_number = $1
       AND (expires_at IS NULL OR expires_at > NOW())
       ${where}
     ORDER BY created_at DESC
     LIMIT 50`,
    clientNumber,
  );
  return rows.map(r => ({
    id: r.id,
    alertType: r.alert_type,
    title: r.title,
    content: r.content,
    severity: r.severity,
    isRead: r.is_read,
    createdAt: r.created_at,
  }));
}

export async function markAlertRead(clientNumber: string, alertId: number): Promise<void> {
  await prisma.$executeRawUnsafe(
    'UPDATE proactive_alerts SET is_read = TRUE WHERE id = $1 AND client_number = $2',
    alertId, clientNumber,
  );
}

// ─── Anomaly scan (runs hourly) ───────────────────────────────────────────────

async function runAnomalyScan(clientNumber: string): Promise<void> {
  log.info('Running anomaly scan', { clientNumber });

  // Queries that detect common business anomalies
  const scans = [
    {
      query: 'Are there any projects that are critically overdue or at high risk right now?',
      alertType: 'risk',
      severity: 'critical' as const,
    },
    {
      query: 'Are there any deals or opportunities that have been stale for over 30 days with no activity?',
      alertType: 'opportunity',
      severity: 'warning' as const,
    },
  ];

  const ai = getGenAI();

  for (const scan of scans) {
    try {
      const gcpResult = await retrieveContext(scan.query);
      if (!gcpResult.context) continue;

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Based on this data, identify any ${scan.alertType} that needs immediate attention.
If there are no significant issues, respond with just "NO_ALERT".
If there is an issue, respond with:
TITLE: [short title, max 80 chars]
CONTENT: [2-3 sentences describing the issue]

Data: ${gcpResult.context.slice(0, 3000)}`,
        config: { maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
      });

      const text = (result.text ?? '').trim();
      if (text.includes('NO_ALERT') || !text) continue;

      const titleMatch = text.match(/TITLE:\s*(.+)/);
      const contentMatch = text.match(/CONTENT:\s*([\s\S]+)/);

      if (titleMatch && contentMatch) {
        await createAlert(
          clientNumber,
          scan.alertType,
          titleMatch[1].trim().slice(0, 255),
          contentMatch[1].trim(),
          scan.severity,
        );
      }
    } catch (e: any) {
      log.warn('Anomaly scan item failed', { clientNumber, alertType: scan.alertType, error: e.message });
    }
  }
}

// ─── Daily insights (runs at 8am) ────────────────────────────────────────────

async function runDailyInsights(clientNumber: string): Promise<void> {
  log.info('Running daily insights', { clientNumber });

  try {
    const gcpResult = await retrieveContext('Give me the most important business metrics and trends for today');
    if (!gcpResult.context) return;

    const ai = getGenAI();
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Generate a brief daily insight (2-3 sentences max) based on this business data.
Focus on the single most important thing worth knowing today.
Respond with:
TITLE: [short title]
CONTENT: [2-3 sentences]

Data: ${gcpResult.context.slice(0, 4000)}`,
      config: { maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
    });

    const text = (result.text ?? '').trim();
    const titleMatch = text.match(/TITLE:\s*(.+)/);
    const contentMatch = text.match(/CONTENT:\s*([\s\S]+)/);

    if (titleMatch && contentMatch) {
      await createAlert(
        clientNumber,
        'insight',
        `Daily Insight: ${titleMatch[1].trim().slice(0, 230)}`,
        contentMatch[1].trim(),
        'info',
        24, // expires in 24 hours
      );
    }
  } catch (e: any) {
    log.warn('Daily insights failed', { clientNumber, error: e.message });
  }
}

// ─── Main scheduler ───────────────────────────────────────────────────────────

export async function runProactiveIntelligence(): Promise<void> {
  const enabled = await isFeatureEnabled('GLOBAL', 'feature_proactive_alerts', false).catch(() => false);
  if (!enabled) return;

  // Get all active tenants
  const tenants: any[] = await prisma.$queryRawUnsafe(
    'SELECT client_number FROM tenants WHERE is_active = TRUE',
  );

  const now = new Date();
  const isHourly = true;
  const isDaily = now.getHours() === 8 && now.getMinutes() < 15; // Within 15 min of 8am

  for (const tenant of tenants) {
    if (isHourly) await runAnomalyScan(tenant.client_number).catch(() => {});
    if (isDaily)  await runDailyInsights(tenant.client_number).catch(() => {});
  }
}
