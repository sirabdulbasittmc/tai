// ═════════════════════════════════════════════════════════════════════════════
// WhatsAppManager — Orchestrator that routes to correct provider per tenant
//
// getProvider(clientNumber) → reads config → returns WebjsProvider or MetaProvider
// sendWhatsAppMessage() → checks limits → sends via provider → logs message
// ═════════════════════════════════════════════════════════════════════════════

import { IWhatsAppProvider } from './IWhatsAppProvider';
import { WebjsProvider } from './WebjsProvider';
import { MetaProvider } from './MetaProvider';
import prisma from '../../db/prisma';
import createLogger from '../../utils/logger';

const log = createLogger('whatsapp:manager');

// Cached provider instances per tenant
const providers = new Map<string, IWhatsAppProvider>();

// ─── Provider factory ─────────────────────────────────────────────────────────

export async function getProvider(clientNumber: string): Promise<IWhatsAppProvider> {
  if (providers.has(clientNumber)) return providers.get(clientNumber)!;

  const rows = await prisma.$queryRawUnsafe(
    `SELECT provider FROM whatsapp_config WHERE client_number = $1`, clientNumber,
  ) as any[];

  if (!rows.length) throw new Error(`No WhatsApp config for ${clientNumber}`);

  let provider: IWhatsAppProvider;
  switch (rows[0].provider) {
    case 'meta':
      provider = new MetaProvider();
      break;
    case 'webjs':
    default:
      provider = new WebjsProvider();
      break;
  }

  providers.set(clientNumber, provider);
  return provider;
}

/** Clear cached provider (call after config change so it re-creates with new settings) */
export function clearProviderCache(clientNumber: string): void {
  providers.delete(clientNumber);
}

// ─── Initialize all connected tenants on server startup ───────────────────────

export async function initializeAllTenants(): Promise<void> {
  const configs = await prisma.$queryRawUnsafe(
    `SELECT client_number FROM whatsapp_config WHERE status != 'disconnected'`,
  ) as any[];

  for (const config of configs) {
    try {
      providers.delete(config.client_number);
      const provider = await getProvider(config.client_number);
      await provider.initialize(config.client_number);
      log.info('Initialized', { clientNumber: config.client_number });
    } catch (error: any) {
      log.error('Init failed', { clientNumber: config.client_number, error: error.message });
    }
  }
}

// ─── Send message via correct provider ────────────────────────────────────────

export async function sendWhatsAppMessage(params: {
  clientNumber: string;
  to: string;
  message: string;
  messageType?: 'text' | 'template';
  templateName?: string;
  templateParams?: string[];
  agentId?: number;
  userId?: number;
  requiresApproval?: boolean;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // Check config + limits
  const configs = await prisma.$queryRawUnsafe(
    `SELECT status, connected_number, daily_limit, messages_today FROM whatsapp_config WHERE client_number = $1`,
    params.clientNumber,
  ) as any[];

  if (!configs.length) return { success: false, error: 'WhatsApp not configured' };
  const config = configs[0];

  if (config.status !== 'connected') return { success: false, error: `WhatsApp status: ${config.status}` };
  if (config.messages_today >= config.daily_limit) return { success: false, error: 'Daily message limit reached' };

  // If requires approval: queue as pending
  if (params.requiresApproval) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO whatsapp_messages (client_number, user_id, direction, from_number, to_number, content, status, requires_approval, agent_id, created_at)
       VALUES ($1, $2, 'outbound', $3, $4, $5, 'queued', TRUE, $6, NOW())`,
      params.clientNumber, params.userId || null, config.connected_number || '', params.to,
      params.message, params.agentId || null,
    );
    return { success: true, messageId: 'pending_approval' };
  }

  // Send immediately
  try {
    const provider = await getProvider(params.clientNumber);
    const result = await provider.sendMessage({
      clientNumber: params.clientNumber,
      to: params.to,
      message: params.message,
      messageType: params.messageType || 'text',
      templateName: params.templateName,
      templateParams: params.templateParams,
    });

    // Log message
    await prisma.$executeRawUnsafe(
      `INSERT INTO whatsapp_messages (client_number, user_id, direction, from_number, to_number, content, wa_message_id, status, agent_id, created_at)
       VALUES ($1, $2, 'outbound', $3, $4, $5, $6, $7, $8, NOW())`,
      params.clientNumber, params.userId || null, config.connected_number || '', params.to,
      params.message, result.messageId || null, result.success ? 'sent' : 'failed', params.agentId || null,
    );

    // Increment counter
    if (result.success) {
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_config SET messages_today = messages_today + 1, messages_this_month = messages_this_month + 1, last_message_at = NOW() WHERE client_number = $1`,
        params.clientNumber,
      );
    }

    return result;
  } catch (error: any) {
    log.error('Send failed', { clientNumber: params.clientNumber, to: params.to, error: error.message });
    return { success: false, error: error.message };
  }
}

// ─── Save/update config (handles encryption) ─────────────────────────────────

export async function saveWhatsAppConfig(
  clientNumber: string,
  data: {
    provider: string;
    companyNumber?: string;
    metaPhoneNumberId?: string;
    metaAccessToken?: string;
    metaBusinessId?: string;
    metaWebhookSecret?: string;
    dailyLimit?: number;
    monthlyLimit?: number;
    maxTokensData?: number;
  },
): Promise<void> {
  const { encrypt } = await import('../configService');

  const encAccessToken = data.metaAccessToken ? await encrypt(data.metaAccessToken) : null;
  const encWebhookSecret = data.metaWebhookSecret ? await encrypt(data.metaWebhookSecret) : null;

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM whatsapp_config WHERE client_number = $1`, clientNumber,
  ) as any[];

  if (exists.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE whatsapp_config SET
        provider = $1,
        connected_number = COALESCE($2, connected_number),
        meta_phone_number_id = COALESCE($3, meta_phone_number_id),
        meta_access_token = COALESCE($4, meta_access_token),
        meta_business_id = COALESCE($5, meta_business_id),
        meta_webhook_secret = COALESCE($6, meta_webhook_secret),
        daily_limit = COALESCE($7, daily_limit),
        monthly_limit = COALESCE($8, monthly_limit),
        max_tokens_data = COALESCE($9, max_tokens_data),
        updated_at = NOW()
       WHERE client_number = $10`,
      data.provider,
      data.companyNumber || null,
      data.metaPhoneNumberId || null,
      encAccessToken,
      data.metaBusinessId || null,
      encWebhookSecret,
      data.dailyLimit || null,
      data.monthlyLimit || null,
      data.maxTokensData || null,
      clientNumber,
    );
  } else {
    await prisma.$executeRawUnsafe(
      `INSERT INTO whatsapp_config (client_number, provider, connected_number, meta_phone_number_id, meta_access_token, meta_business_id, meta_webhook_secret, daily_limit, monthly_limit, max_tokens_data, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'disconnected', NOW(), NOW())`,
      clientNumber, data.provider,
      data.companyNumber || null,
      data.metaPhoneNumberId || null, encAccessToken,
      data.metaBusinessId || null, encWebhookSecret,
      data.dailyLimit || 100, data.monthlyLimit || 2000, data.maxTokensData || 400,
    );
  }

  clearProviderCache(clientNumber);
}

// ─── Approve a queued message → send immediately ──────────────────────────────

export async function approveQueuedMessage(messageId: number, approvedBy: number): Promise<{ success: boolean; error?: string }> {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT client_number, to_number, content FROM whatsapp_messages WHERE id = $1 AND status = 'queued' AND requires_approval = TRUE`, messageId,
  ) as any[];
  if (!rows.length) return { success: false, error: 'Message not found or already processed' };

  const msg = rows[0];
  const result = await sendWhatsAppMessage({
    clientNumber: msg.client_number, to: msg.to_number, message: msg.content,
  });

  await prisma.$executeRawUnsafe(
    `UPDATE whatsapp_messages SET status = $1, approved_by = $2, approved_at = NOW(), wa_message_id = $3, error_message = $4 WHERE id = $5`,
    result.success ? 'sent' : 'failed', approvedBy, result.messageId || null, result.error || null, messageId,
  );

  return result;
}

// ─── Reject a queued message ──────────────────────────────────────────────────

export async function rejectQueuedMessage(messageId: number, rejectedBy: number): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE whatsapp_messages SET status = 'rejected', approved_by = $1, approved_at = NOW() WHERE id = $2 AND status = 'queued'`,
    rejectedBy, messageId,
  );
}

// ─── Daily counter reset (call from cron at midnight) ─────────────────────────

export async function resetDailyCounters(): Promise<void> {
  await prisma.$executeRawUnsafe(`UPDATE whatsapp_config SET messages_today = 0`);
}

// ─── Monthly counter reset (call from cron on 1st of month) ───────────────────

export async function resetMonthlyCounters(): Promise<void> {
  await prisma.$executeRawUnsafe(`UPDATE whatsapp_config SET messages_this_month = 0`);
}
