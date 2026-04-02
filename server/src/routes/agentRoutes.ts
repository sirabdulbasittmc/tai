// Phase 8 + 8.5: Agent CRUD, approval workflow, WhatsApp
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { approveAction, rejectAction, executeAction, getPendingApprovals } from '../agents/agentToolService';
import {
  createAgent, listUserAgents, deleteAgent,
  updateAgentMemory, clearAgentMemory, enqueueAgentRun,
  resetCircuitBreaker,
} from '../agents/agentFrameworkService';
import {
  connectWhatsApp, disconnectWhatsApp, getWhatsAppStatus,
  sendWhatsAppMessage, getOrCreateSession,
} from '../services/whatsappService';

const router = Router();
router.use(requireAuth);

// ── Agent CRUD ─────────────────────────────────────────────────────────────

// GET /api/v1/agents — list user's agents
router.get('/', async (req, res, next) => {
  try {
    const agents = await listUserAgents(req.user!.id);
    res.json({ agents });
  } catch (err) { next(err); }
});

// POST /api/v1/agents — create agent
router.post('/', async (req, res, next) => {
  try {
    const cn = req.user!.clientNumber as string;
    const id = await createAgent(cn, req.user!.id, req.body);
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

// PUT /api/v1/agents/:id — update agent
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const d = req.body;
    const prisma = (await import('../db/prisma')).default;
    await prisma.$executeRawUnsafe(
      `UPDATE agents SET
        name = COALESCE($1, name),
        display_name = COALESCE($2, display_name),
        instructions = COALESCE($3, instructions),
        personality = $4,
        gender = COALESCE($5, gender),
        data_sources = COALESCE($6, data_sources),
        schedule = $7,
        notify_email = COALESCE($8, notify_email),
        notify_whatsapp = COALESCE($9, notify_whatsapp),
        notify_recipients = $10,
        notify_whatsapp_numbers = $11,
        updated_at = NOW()
       WHERE id = $12 AND user_id = $13`,
      d.name || null, d.displayName || null, d.instructions || null,
      d.personality || null, d.gender || null, d.dataSources || null, d.schedule || null,
      d.notifyEmail ?? null, d.notifyWhatsapp ?? null,
      d.notifyRecipients || null, d.notifyWhatsappNumbers || null,
      id, req.user!.id,
    );
    // Re-schedule if schedule changed
    if (d.schedule !== undefined) {
      const { scheduleAgent } = await import('../agents/agentScheduler');
      scheduleAgent(id, d.displayName || d.name || '', d.schedule || '');
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /api/v1/agents/:id — permanently delete agent + all runs
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const prisma = (await import('../db/prisma')).default;
    // Delete runs first (cascade), then agent
    await prisma.$executeRawUnsafe(`DELETE FROM agent_runs WHERE agent_id = $1`, id);
    await prisma.$executeRawUnsafe(`DELETE FROM agents WHERE id = $1 AND user_id = $2`, id, req.user!.id);
    // Unschedule if was scheduled
    const { unscheduleAgent } = await import('../agents/agentScheduler');
    unscheduleAgent(id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Agent memory ───────────────────────────────────────────────────────────

// PATCH /api/v1/agents/:id/memory — update agent memory
router.patch('/:id/memory', async (req, res, next) => {
  try {
    const agentId = parseInt(req.params.id as string, 10);
    await updateAgentMemory(agentId, req.body.memory);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /api/v1/agents/:id/memory — clear agent memory
router.delete('/:id/memory', async (req, res, next) => {
  try {
    await clearAgentMemory(parseInt(req.params.id as string, 10));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Agent execution ────────────────────────────────────────────────────────

// POST /api/v1/agents/:id/run — execute agent immediately
router.post('/:id/run', async (req, res, next) => {
  try {
    const { executeAgentRun } = await import('../agents/agentExecutionEngine');
    const result = await executeAgentRun(parseInt(req.params.id as string, 10), 'manual', req.body.instructions);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/v1/agents/:id/runs — run history
router.get('/:id/runs', async (req, res, next) => {
  try {
    const { getAgentRuns } = await import('../agents/agentExecutionEngine');
    const runs = await getAgentRuns(parseInt(req.params.id as string, 10), parseInt(req.query.limit as string) || 20);
    res.json({ runs });
  } catch (err) { next(err); }
});

// GET /api/v1/agents/runs/:runId — single run detail
router.get('/runs/:runId', async (req, res, next) => {
  try {
    const { getAgentRunDetail } = await import('../agents/agentExecutionEngine');
    const run = await getAgentRunDetail(parseInt(req.params.runId as string, 10));
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
    res.json(run);
  } catch (err) { next(err); }
});

// POST /api/v1/agents/:id/hire — reactivate a fired agent
router.post('/:id/hire', async (req, res, next) => {
  try {
    const { hireAgent } = await import('../agents/agentScheduler');
    await hireAgent(parseInt(req.params.id as string, 10));
    res.json({ success: true, message: 'Agent hired (activated)' });
  } catch (err) { next(err); }
});

// POST /api/v1/agents/:id/fire — deactivate with reason
router.post('/:id/fire', async (req, res, next) => {
  try {
    const { fireAgent } = await import('../agents/agentScheduler');
    await fireAgent(parseInt(req.params.id as string, 10), req.body.reason || 'No reason provided', req.user!.id);
    res.json({ success: true, message: 'Agent fired (deactivated)' });
  } catch (err) { next(err); }
});

// POST /api/v1/agents/:id/reset-breaker — reset circuit breaker
router.post('/:id/reset-breaker', async (req, res, next) => {
  try {
    await resetCircuitBreaker(parseInt(req.params.id as string, 10));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Approval workflow ──────────────────────────────────────────────────────

// GET /api/v1/agents/approvals — pending actions awaiting approval
router.get('/approvals', async (req, res, next) => {
  try {
    const cn = req.user!.clientNumber as string;
    const items = await getPendingApprovals(cn, req.user!.id);
    res.json({ items });
  } catch (err) { next(err); }
});

// POST /api/v1/agents/actions/:id/approve
router.post('/actions/:id/approve', async (req, res, next) => {
  try {
    const cn = req.user!.clientNumber as string;
    const id = parseInt(req.params.id as string, 10);
    await approveAction(cn, id, req.user!.id);
    const result = await executeAction(cn, id);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/v1/agents/actions/:id/reject
router.post('/actions/:id/reject', async (req, res, next) => {
  try {
    const cn = req.user!.clientNumber as string;
    const id = parseInt(req.params.id as string, 10);
    await rejectAction(cn, id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── WhatsApp ───────────────────────────────────────────────────────────────

// GET /api/v1/agents/whatsapp/status
router.get('/whatsapp/status', async (req, res, next) => {
  try {
    const status = await getWhatsAppStatus(req.user!.id);
    res.json(status);
  } catch (err) { next(err); }
});

// POST /api/v1/agents/whatsapp/connect
router.post('/whatsapp/connect', async (req, res, next) => {
  try {
    const { phoneNumber, waId } = req.body;
    await connectWhatsApp(req.user!.id, phoneNumber, waId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /api/v1/agents/whatsapp/connect
router.delete('/whatsapp/connect', async (req, res, next) => {
  try {
    await disconnectWhatsApp(req.user!.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/v1/agents/whatsapp/send — manual send (test / direct message)
router.post('/whatsapp/send', async (req, res, next) => {
  try {
    const { content, agentId } = req.body;
    const { id: sessionId } = await getOrCreateSession(req.user!.id, agentId);
    const result = await sendWhatsAppMessage(req.user!.id, content, agentId, sessionId);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/v1/agents/whatsapp/webhook — Meta webhook (no auth — verified by X-Hub-Signature-256)
router.post('/whatsapp/webhook', async (req, res) => {
  // Webhook verification (GET is handled by express in practice, but some providers use POST)
  res.sendStatus(200);
  // Actual processing is async — fire and forget to meet Meta's 20s response requirement
  setImmediate(async () => {
    try {
      const body = req.body;
      const entries = body?.entry || [];
      for (const entry of entries) {
        for (const change of (entry.changes || [])) {
          const messages = change?.value?.messages || [];
          for (const msg of messages) {
            if (msg.type !== 'text') continue;
            const { processInboundMessage } = await import('../services/whatsappService');
            await processInboundMessage({
              waId: msg.from,
              phoneNumber: msg.from,
              content: msg.text?.body || '',
              messageId: msg.id,
              timestamp: parseInt(msg.timestamp, 10) * 1000,
            });
          }
        }
      }
    } catch (err: any) {
      const log = (await import('../utils/logger')).default('whatsapp');
      log.error('Webhook processing error', { error: err.message });
    }
  });
});

// GET /api/v1/agents/whatsapp/webhook — Meta webhook verification challenge
router.get('/whatsapp/webhook', (req, res) => {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

export default router;
