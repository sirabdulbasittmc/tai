import { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getLogs, getLogSummary, caterLog, ignoreLog, resolveLog, generateSuggestionsForLogs } from '../services/systemLogService';
import { setConfig } from '../services/configService';
import { clearAIConfigCache } from '../services/aiConfigService';

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

// Get log summary (dashboard)
router.get('/summary', async (_req: Request, res: Response) => {
  const summary = await getLogSummary();
  res.json(summary);
});

// Get logs with filters
router.get('/', async (req: Request, res: Response) => {
  const logs = await getLogs({
    status: req.query.status as string,
    level: req.query.level as string,
    category: req.query.category as string,
    limit: parseInt(req.query.limit as string) || 50,
  });
  res.json({ logs });
});

// Mark as catered
router.patch('/:id/cater', async (req: Request, res: Response) => {
  await caterLog(parseInt(req.params.id as string), req.user!.id, req.body.note);
  res.json({ success: true });
});

// Mark as resolved
router.patch('/:id/resolve', async (req: Request, res: Response) => {
  await resolveLog(parseInt(req.params.id as string), req.user!.id, req.body.note);
  res.json({ success: true });
});

// Mark as ignored
router.patch('/:id/ignore', async (req: Request, res: Response) => {
  await ignoreLog(parseInt(req.params.id as string), req.user!.id, req.body.note);
  res.json({ success: true });
});

// Fix: apply config change + mark as catered
router.post('/:id/fix', async (req: Request, res: Response) => {
  try {
    const { fixes } = req.body; // [{key: 'context_limit_full', value: '80000'}]
    const clientNumber = req.user!.clientNumber;

    if (fixes && Array.isArray(fixes)) {
      for (const fix of fixes) {
        if (fix.key && fix.value) {
          await setConfig(clientNumber, fix.key, fix.value);
        }
      }
      clearAIConfigCache();
    }

    await caterLog(parseInt(req.params.id as string), req.user!.id, `Fixed: ${fixes?.map((f: any) => `${f.key}=${f.value}`).join(', ') || 'Applied'}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk fix all open logs
router.post('/fix-all', async (req: Request, res: Response) => {
  try {
    const { fixes, logIds } = req.body;
    const clientNumber = req.user!.clientNumber;

    if (fixes && Array.isArray(fixes)) {
      for (const fix of fixes) {
        if (fix.key && fix.value) {
          await setConfig(clientNumber, fix.key, fix.value);
        }
      }
      clearAIConfigCache();
    }

    if (logIds && Array.isArray(logIds)) {
      for (const id of logIds) {
        await caterLog(id, req.user!.id, `Bulk fix: ${fixes?.map((f: any) => `${f.key}=${f.value}`).join(', ') || 'Applied'}`);
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk ignore all open logs
router.post('/ignore-all', async (req: Request, res: Response) => {
  try {
    const { logIds } = req.body;
    if (logIds && Array.isArray(logIds)) {
      for (const id of logIds) {
        await ignoreLog(id, req.user!.id, 'Bulk ignored');
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Generate AI suggestions for open logs
router.post('/suggestions', async (_req: Request, res: Response) => {
  const suggestions = await generateSuggestionsForLogs();
  res.json({ suggestions });
});

// GET /api/v1/logs/trends — log trend analysis (last N days)
router.get('/trends', async (req: Request, res: Response) => {
  const { getLogTrends } = await import('../services/systemLogService');
  const days = parseInt(req.query.days as string) || 7;
  const trends = await getLogTrends(days);
  res.json(trends);
});

// POST /api/v1/logs/auto-fix — run auto-fix rules for known patterns
router.post('/auto-fix', async (req: Request, res: Response) => {
  const { runAutoFix } = await import('../services/systemLogService');
  const cn = req.user!.clientNumber as string;
  const result = await runAutoFix(cn);
  res.json(result);
});

// POST /api/v1/logs/escalate — run severity escalation for high-recurrence logs
router.post('/escalate', async (req: Request, res: Response) => {
  const { escalateHighRecurrence } = await import('../services/systemLogService');
  const escalated = await escalateHighRecurrence();
  res.json({ escalated });
});

// POST /api/v1/logs/cleanup — remove old resolved/ignored logs
router.post('/cleanup', async (req: Request, res: Response) => {
  const { cleanupOldLogs } = await import('../services/systemLogService');
  const days = parseInt(req.body.retentionDays) || 90;
  const deleted = await cleanupOldLogs(days);
  res.json({ deleted });
});

export default router;
