// ═════════════════════════════════════════════════════════════════════════════
// webhookRoutes.ts — Public webhook endpoints (no auth — verified by signature)
// Mounted BEFORE body parser in app.ts for raw body signature verification
// ═════════════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../db/prisma';
import createLogger from '../utils/logger';

const log = createLogger('webhook');
const router = Router();

// ─── Meta WhatsApp webhook verification (GET) ─────────────────────────────────
router.get('/webhooks/whatsapp/:clientNumber', async (req, res) => {
  const { clientNumber } = req.params;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const rows = await prisma.$queryRawUnsafe(
    `SELECT meta_webhook_secret, provider FROM whatsapp_config WHERE client_number = $1`, clientNumber,
  ) as any[];

  if (mode === 'subscribe' && rows.length && rows[0].provider === 'meta' && token === rows[0].meta_webhook_secret) {
    log.info('Webhook verified', { clientNumber });
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ─── Meta WhatsApp webhook receiver (POST) ────────────────────────────────────
router.post('/webhooks/whatsapp/:clientNumber', async (req, res) => {
  const { clientNumber } = req.params;

  // Verify X-Hub-Signature-256
  const rows = await prisma.$queryRawUnsafe(
    `SELECT meta_webhook_secret FROM whatsapp_config WHERE client_number = $1`, clientNumber,
  ) as any[];

  if (rows.length && rows[0].meta_webhook_secret) {
    const signature = req.headers['x-hub-signature-256'] as string;
    const rawBody = JSON.stringify(req.body);
    const expected = 'sha256=' + crypto.createHmac('sha256', rows[0].meta_webhook_secret).update(rawBody).digest('hex');
    if (signature !== expected) {
      log.warn('Invalid webhook signature', { clientNumber });
      res.sendStatus(403);
      return;
    }
  }

  // Acknowledge immediately (Meta requires < 5s)
  res.sendStatus(200);

  // Process asynchronously
  setImmediate(async () => {
    try {
      const body = req.body;
      if (body.object !== 'whatsapp_business_account') return;

      const { handleInboundMessage } = await import('../services/whatsapp/WhatsAppInbound');

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;

          // Status updates (sent → delivered → read)
          for (const status of value.statuses || []) {
            await prisma.$executeRawUnsafe(
              `UPDATE whatsapp_messages SET status = $1, updated_at = NOW() WHERE wa_message_id = $2`,
              status.status, status.id,
            );
          }

          // Incoming messages
          for (const message of value.messages || []) {
            await handleInboundMessage({
              clientNumber,
              fromNumber: '+' + message.from,
              messageBody: message.text?.body || message.caption || '',
              messageType: message.type === 'audio' ? 'voice' : message.type === 'image' ? 'image' : 'text',
              mediaUrl: message.image?.id || message.audio?.id || undefined,
            });
          }
        }
      }
    } catch (err: any) {
      log.error('Webhook processing error', { clientNumber, error: err.message });
    }
  });
});

export default router;
