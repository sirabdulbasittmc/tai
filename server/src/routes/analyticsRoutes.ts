import { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth, requireAdmin } from '../middleware/auth';
import prisma from '../db/prisma';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.id?.toString() || ipKeyGenerator(req),
  message: { error: 'Too many requests. Please try again in 1 minute.' },
});
router.use(adminLimiter);

// ── GET /top-queries — Top 20 queries by frequency ────────────────────
router.get('/top-queries', async (req: Request, res: Response) => {
  try {
    const clientNumber = req.user!.clientNumber;

    const rows = await prisma.$queryRawUnsafe<
      { masked_query: string; count: bigint; avg_response_time_ms: number }[]
    >(
      `SELECT masked_query,
              COUNT(*)::bigint AS count,
              ROUND(AVG(response_time_ms)) AS avg_response_time_ms
         FROM audit_log
        WHERE client_number = $1
        GROUP BY masked_query
        ORDER BY count DESC
        LIMIT 20`,
      clientNumber,
    );

    res.json(
      rows.map((r) => ({
        maskedQuery: r.masked_query,
        count: Number(r.count),
        avgResponseTimeMs: Number(r.avg_response_time_ms),
      })),
    );
  } catch (err: any) {
    console.error('[Analytics] top-queries error:', err.message);
    res.status(500).json({ error: 'Failed to fetch top queries' });
  }
});

// ── GET /performance — p50/p95/p99 latency by provider ────────────────
router.get('/performance', async (req: Request, res: Response) => {
  try {
    const clientNumber = req.user!.clientNumber;
    const hours = Math.min(Number(req.query.hours) || 24, 720); // max 30 days

    const rows = await prisma.$queryRawUnsafe<
      { provider: string; p50: number; p95: number; p99: number; total: bigint }[]
    >(
      `SELECT provider,
              PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) AS p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) AS p99,
              COUNT(*)::bigint AS total
         FROM audit_log
        WHERE client_number = $1
          AND created_at >= NOW() - MAKE_INTERVAL(hours => $2)
        GROUP BY provider
        ORDER BY provider`,
      clientNumber,
      hours,
    );

    res.json(
      rows.map((r) => ({
        provider: r.provider,
        p50: Math.round(Number(r.p50)),
        p95: Math.round(Number(r.p95)),
        p99: Math.round(Number(r.p99)),
        total: Number(r.total),
      })),
    );
  } catch (err: any) {
    console.error('[Analytics] performance error:', err.message);
    res.status(500).json({ error: 'Failed to fetch performance metrics' });
  }
});

// ── GET /quality — Distribution of topScore ranges ────────────────────
router.get('/quality', async (req: Request, res: Response) => {
  try {
    const clientNumber = req.user!.clientNumber;

    const rows = await prisma.$queryRawUnsafe<
      { bucket: string; count: bigint }[]
    >(
      `SELECT
          CASE
            WHEN top_score > 0.8  THEN 'excellent'
            WHEN top_score >= 0.5 THEN 'good'
            WHEN top_score IS NOT NULL THEN 'poor'
            ELSE 'unknown'
          END AS bucket,
          COUNT(*)::bigint AS count
        FROM audit_log
       WHERE client_number = $1
       GROUP BY bucket
       ORDER BY bucket`,
      clientNumber,
    );

    const result: Record<string, number> = { excellent: 0, good: 0, poor: 0, unknown: 0 };
    for (const r of rows) {
      result[r.bucket] = Number(r.count);
    }

    res.json(result);
  } catch (err: any) {
    console.error('[Analytics] quality error:', err.message);
    res.status(500).json({ error: 'Failed to fetch quality distribution' });
  }
});

// ── GET /usage — DAU, queries/day, peak hours (last 7 days) ──────────
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const clientNumber = req.user!.clientNumber;

    // Daily active users & queries per day
    const daily = await prisma.$queryRawUnsafe<
      { day: string; active_users: bigint; queries: bigint }[]
    >(
      `SELECT DATE(created_at) AS day,
              COUNT(DISTINCT user_id)::bigint AS active_users,
              COUNT(*)::bigint AS queries
         FROM audit_log
        WHERE client_number = $1
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY day DESC`,
      clientNumber,
    );

    // Peak hours
    const peakHours = await prisma.$queryRawUnsafe<
      { hour: number; queries: bigint }[]
    >(
      `SELECT EXTRACT(HOUR FROM created_at)::int AS hour,
              COUNT(*)::bigint AS queries
         FROM audit_log
        WHERE client_number = $1
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY hour
        ORDER BY queries DESC
        LIMIT 5`,
      clientNumber,
    );

    res.json({
      daily: daily.map((d) => ({
        day: d.day,
        activeUsers: Number(d.active_users),
        queries: Number(d.queries),
      })),
      peakHours: peakHours.map((p) => ({
        hour: Number(p.hour),
        queries: Number(p.queries),
      })),
    });
  } catch (err: any) {
    console.error('[Analytics] usage error:', err.message);
    res.status(500).json({ error: 'Failed to fetch usage stats' });
  }
});

export default router;
