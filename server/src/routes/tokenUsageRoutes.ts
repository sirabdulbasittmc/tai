import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getUserUsage, getClientUsage, getAllClientsUsage, getDailySummary, getTopUsers, getProviderBreakdown } from '../services/tokenUsageService';

const router = Router();
router.use(requireAuth);

// My usage (any user)
router.get('/my', async (req: Request, res: Response) => {
  const days = parseInt(req.query.days as string) || 30;
  const usage = await getUserUsage(req.user!.id, days);
  res.json({ usage });
});

// Client usage (AD — their client only)
router.get('/client', requireAdmin, async (req: Request, res: Response) => {
  const days = parseInt(req.query.days as string) || 30;
  const usage = await getClientUsage(req.user!.clientNumber, days);
  res.json({ usage });
});

// All clients usage (SA only)
router.get('/all', requireAdmin, async (req: Request, res: Response) => {
  if (req.user!.userType !== 'SA') { res.status(403).json({ error: 'SuperAdmin only' }); return; }
  const days = parseInt(req.query.days as string) || 30;
  const usage = await getAllClientsUsage(days);
  res.json({ usage });
});

// Daily summary chart data
router.get('/daily', requireAdmin, async (req: Request, res: Response) => {
  const days = parseInt(req.query.days as string) || 30;
  const clientNumber = req.user!.userType === 'SA' ? (req.query.client as string) : req.user!.clientNumber;
  const summary = await getDailySummary(clientNumber || undefined, days);
  res.json({ summary });
});

// Top users by consumption
router.get('/top-users', requireAdmin, async (req: Request, res: Response) => {
  const days = parseInt(req.query.days as string) || 30;
  const clientNumber = req.user!.userType === 'SA' ? (req.query.client as string) : req.user!.clientNumber;
  const users = await getTopUsers(clientNumber || undefined, days);
  res.json({ users });
});

// Provider breakdown
router.get('/providers', requireAdmin, async (req: Request, res: Response) => {
  const days = parseInt(req.query.days as string) || 30;
  const clientNumber = req.user!.userType === 'SA' ? (req.query.client as string) : req.user!.clientNumber;
  const breakdown = await getProviderBreakdown(clientNumber || undefined, days);
  res.json({ breakdown });
});

export default router;
