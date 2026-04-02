import prisma from '../db/prisma';
import createLogger from '../utils/logger';

const log = createLogger('slaMonitor');

// SLA targets (from SLA.md)
const SLA_TARGETS = {
  uptimePercent: 99.9,
  conversational_p95_ms: 3000,
  quickAnswer_p95_ms: 8000,
  dataQuery_p95_ms: 15000,
  errorRateThreshold: 0.05, // 5%
};

interface SLAReport {
  period: string;
  uptimePercent: number;
  totalChecks: number;
  failedChecks: number;
  responseTimeP50Ms: number;
  responseTimeP95Ms: number;
  responseTimeP99Ms: number;
  errorRate: number;
  totalQueries: number;
  breaches: string[];
}

/**
 * Compute SLA metrics for the last N hours from audit_log data.
 */
export async function getSLAReport(hours = 24): Promise<SLAReport> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const period = `Last ${hours} hours`;
  const breaches: string[] = [];

  try {
    // Response time percentiles from audit_log
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE error IS NOT NULL) as errors,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) as p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) as p99
      FROM audit_log
      WHERE created_at >= $1
    `, since);

    const stats = rows[0] || { total: 0, errors: 0, p50: 0, p95: 0, p99: 0 };
    const total = Number(stats.total) || 0;
    const errors = Number(stats.errors) || 0;
    const p50 = Math.round(Number(stats.p50) || 0);
    const p95 = Math.round(Number(stats.p95) || 0);
    const p99 = Math.round(Number(stats.p99) || 0);
    const errorRate = total > 0 ? errors / total : 0;

    // Check SLA breaches
    if (p95 > SLA_TARGETS.dataQuery_p95_ms) {
      breaches.push(`p95 response time ${p95}ms exceeds ${SLA_TARGETS.dataQuery_p95_ms}ms target`);
    }
    if (errorRate > SLA_TARGETS.errorRateThreshold) {
      breaches.push(`Error rate ${(errorRate * 100).toFixed(1)}% exceeds ${SLA_TARGETS.errorRateThreshold * 100}% threshold`);
    }

    // Uptime: estimated from health check success rate
    // In production, slaMonitorService pings /api/health/ready every 60s
    // For now, estimate from error rate (no downtime = no errors)
    const uptimePercent = total > 0 ? ((1 - errorRate) * 100) : 100;
    if (uptimePercent < SLA_TARGETS.uptimePercent) {
      breaches.push(`Uptime ${uptimePercent.toFixed(2)}% below ${SLA_TARGETS.uptimePercent}% SLA target`);
    }

    if (breaches.length > 0) {
      log.warn('SLA breaches detected', { breaches, period });
    }

    return {
      period,
      uptimePercent: Number(uptimePercent.toFixed(3)),
      totalChecks: total,
      failedChecks: errors,
      responseTimeP50Ms: p50,
      responseTimeP95Ms: p95,
      responseTimeP99Ms: p99,
      errorRate: Number((errorRate * 100).toFixed(2)),
      totalQueries: total,
      breaches,
    };
  } catch (err: any) {
    log.error('Failed to compute SLA report', { error: err.message });
    return {
      period,
      uptimePercent: 0,
      totalChecks: 0,
      failedChecks: 0,
      responseTimeP50Ms: 0,
      responseTimeP95Ms: 0,
      responseTimeP99Ms: 0,
      errorRate: 0,
      totalQueries: 0,
      breaches: [`Failed to compute: ${err.message}`],
    };
  }
}

/**
 * Get response time breakdown by intent type.
 */
export async function getResponseTimeByType(hours = 24): Promise<Record<string, { p50: number; p95: number; count: number }>> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(intent_type, 'unknown') as intent_type,
        COUNT(*) as count,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) as p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95
      FROM audit_log
      WHERE created_at >= $1
      GROUP BY intent_type
      ORDER BY count DESC
    `, since);

    const result: Record<string, { p50: number; p95: number; count: number }> = {};
    for (const row of rows) {
      result[row.intent_type] = {
        p50: Math.round(Number(row.p50) || 0),
        p95: Math.round(Number(row.p95) || 0),
        count: Number(row.count) || 0,
      };
    }
    return result;
  } catch {
    return {};
  }
}
