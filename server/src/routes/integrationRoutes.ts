import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getAuthUrl, handleCallback, disconnectIntegration, getIntegrationStatus, testIntegration, updatePermissions } from '../services/integrationService';
import { getInbox, getUnreadCount } from '../services/gmailService';
import { getTodayEvents, getUpcomingEvents } from '../services/calendarService';

const router = Router();

// ─── OAuth Flow ───────────────────────────────────────────────

// Start OAuth — admin initiates for a user, or user initiates for self
router.get('/connect/:userId', requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string);
  const requestingUser = req.user!;

  // Only admin/SA can connect other users, regular users can only connect themselves
  if (targetUserId !== requestingUser.id && requestingUser.userType !== 'SA' && requestingUser.userType !== 'AD') {
    res.status(403).json({ error: 'Only admins can connect other users' });
    return;
  }

  const url = getAuthUrl(targetUserId);
  res.json({ url });
});

// OAuth callback — Google redirects here after consent
router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const userId = parseInt(req.query.state as string);

  if (!code || !userId) {
    res.status(400).send('Missing code or user ID');
    return;
  }

  const result = await handleCallback(code, userId);

  if (result.success) {
    // Redirect back to app with success
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5174';
    res.redirect(`${clientUrl}/admin?integration=success&email=${encodeURIComponent(result.email || '')}&userId=${userId}`);
  } else {
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5174';
    res.redirect(`${clientUrl}/admin?integration=error&error=${encodeURIComponent(result.error || 'Unknown error')}&userId=${userId}`);
  }
});

// ─── Integration Management ───────────────────────────────────

// Get status for a user
router.get('/status/:userId', requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string);
  const status = await getIntegrationStatus(targetUserId);
  res.json(status);
});

// Get status for current user (self)
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  const status = await getIntegrationStatus(req.user!.id);
  res.json(status);
});

// Test integration — verify tokens work, show errors
router.post('/test/:userId', requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string);
  const result = await testIntegration(targetUserId);
  res.json(result);
});

// Disconnect
router.delete('/disconnect/:userId', requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string);
  const requestingUser = req.user!;

  if (targetUserId !== requestingUser.id && requestingUser.userType !== 'SA' && requestingUser.userType !== 'AD') {
    res.status(403).json({ error: 'Only admins can disconnect other users' });
    return;
  }

  await disconnectIntegration(targetUserId);
  res.json({ success: true });
});

// ─── Permissions ──────────────────────────────────────────────

// Update permissions (user can update own, admin can update any)
router.put('/permissions/:userId', requireAuth, async (req: Request, res: Response) => {
  const targetUserId = parseInt(req.params.userId as string);
  const requestingUser = req.user!;

  if (targetUserId !== requestingUser.id && requestingUser.userType !== 'SA' && requestingUser.userType !== 'AD') {
    res.status(403).json({ error: 'Only admins can update other users permissions' });
    return;
  }

  const { permissions } = req.body; // e.g., "email_read,email_write,calendar_read"
  if (!permissions || typeof permissions !== 'string') {
    res.status(400).json({ error: 'permissions string required' });
    return;
  }

  // Validate permission values
  const valid = new Set(['email_read', 'email_write', 'calendar_read', 'calendar_write', 'calendar_delete']);
  const perms = permissions.split(',').map((p: string) => p.trim()).filter((p: string) => valid.has(p));

  await updatePermissions(targetUserId, perms.join(','));
  res.json({ success: true, permissions: perms.join(',') });
});

// ─── Quick Data Endpoints (for AI and UI) ─────────────────────

// Get inbox summary for current user
router.get('/emails', requireAuth, async (req: Request, res: Response) => {
  const maxResults = parseInt(req.query.max as string) || 10;
  const query = req.query.q as string;
  const result = await getInbox(req.user!.id, maxResults, query);
  res.json(result);
});

// Get unread count
router.get('/emails/unread', requireAuth, async (req: Request, res: Response) => {
  const result = await getUnreadCount(req.user!.id);
  res.json(result);
});

// Get today's calendar
router.get('/calendar/today', requireAuth, async (req: Request, res: Response) => {
  const result = await getTodayEvents(req.user!.id);
  res.json(result);
});

// Get upcoming events
router.get('/calendar/upcoming', requireAuth, async (req: Request, res: Response) => {
  const days = parseInt(req.query.days as string) || 7;
  const result = await getUpcomingEvents(req.user!.id, days);
  res.json(result);
});

export default router;
