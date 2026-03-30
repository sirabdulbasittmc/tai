import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getLogs, getLogSummary, caterLog, resolveLog, generateSuggestionsForLogs } from '../services/systemLogService';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

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

// Generate AI suggestions for open logs
router.post('/suggestions', async (_req: Request, res: Response) => {
  const suggestions = await generateSuggestionsForLogs();
  res.json({ suggestions });
});

export default router;
