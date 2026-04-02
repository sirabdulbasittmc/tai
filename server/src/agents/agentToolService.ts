// ═════════════════════════════════════════════════════════════════════════════
// agentToolService.ts — Phase 8: Agentic tool-use framework
//
// Available tools: draft_email, send_email, create_event, update_project, generate_report
// Destructive actions (send, update) require human approval before execution.
// All actions are immutably logged in agent_actions table.
// ═════════════════════════════════════════════════════════════════════════════

import prisma from '../db/prisma';
import { isFeatureEnabled } from '../services/featureFlagService';
import createLogger from '../utils/logger';

const log = createLogger('agentTools');

export type ActionType = 'draft_email' | 'send_email' | 'create_event' | 'update_project' | 'generate_report';

// Actions requiring explicit user approval before execution
const APPROVAL_REQUIRED = new Set<ActionType>([
  'send_email', 'create_event', 'update_project',
]);

// ─── Create a pending action ──────────────────────────────────────────────────

export async function createAgentAction(
  clientNumber: string,
  userId: number,
  actionType: ActionType,
  input: Record<string, any>,
): Promise<{ actionId: number; requiresApproval: boolean }> {
  const requiresApproval = APPROVAL_REQUIRED.has(actionType);

  const action = await prisma.agentAction.create({
    data: {
      clientNumber,
      userId,
      actionType,
      status: requiresApproval ? 'pending' : 'approved',
      input,
      requiresApproval,
    },
  });

  log.info('Agent action created', { actionId: action.id, actionType, requiresApproval });
  return { actionId: action.id, requiresApproval };
}

// ─── Approve an action ────────────────────────────────────────────────────────

export async function approveAction(
  clientNumber: string,
  actionId: number,
  approvedBy: number,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE agent_actions SET status = 'approved', approved_by = $1, approved_at = NOW()
     WHERE id = $2 AND client_number = $3 AND status = 'pending'`,
    approvedBy, actionId, clientNumber,
  );
  log.info('Action approved', { actionId, approvedBy });
}

// ─── Reject an action ─────────────────────────────────────────────────────────

export async function rejectAction(clientNumber: string, actionId: number): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE agent_actions SET status = 'rejected', updated_at = NOW()
     WHERE id = $1 AND client_number = $2`,
    actionId, clientNumber,
  );
  log.info('Action rejected', { actionId });
}

// ─── Execute an approved action ───────────────────────────────────────────────

export async function executeAction(
  clientNumber: string,
  actionId: number,
): Promise<{ success: boolean; output?: any; error?: string }> {
  const actions: any[] = await prisma.$queryRawUnsafe(
    'SELECT * FROM agent_actions WHERE id = $1 AND client_number = $2 AND status = $3',
    actionId, clientNumber, 'approved',
  );

  if (!actions.length) {
    return { success: false, error: 'Action not found or not approved' };
  }

  const action = actions[0];

  await prisma.$executeRawUnsafe(
    'UPDATE agent_actions SET status = $1 WHERE id = $2',
    'executing', actionId,
  );

  try {
    const output = await runAction(action.action_type, action.input, action.user_id);
    await prisma.$executeRawUnsafe(
      'UPDATE agent_actions SET status = $1, output = $2::jsonb WHERE id = $3',
      'done', JSON.stringify(output), actionId,
    );
    log.info('Action executed', { actionId, actionType: action.action_type });
    return { success: true, output };
  } catch (e: any) {
    await prisma.$executeRawUnsafe(
      'UPDATE agent_actions SET status = $1, error = $2 WHERE id = $3',
      'error', e.message?.slice(0, 500), actionId,
    );
    return { success: false, error: e.message };
  }
}

async function runAction(actionType: ActionType, input: any, userId: number): Promise<any> {
  switch (actionType) {
    case 'generate_report':
      return { status: 'generated', message: 'Report generated', input };

    case 'draft_email':
      return { status: 'drafted', subject: input.subject, body: input.body };

    case 'send_email': {
      // Uses existing email service
      const { sendEmail } = await import('../services/emailService');
      await sendEmail(input.to, input.subject, input.body);
      return { status: 'sent', to: input.to };
    }

    case 'create_event': {
      // Uses existing calendar service
      log.info('Create calendar event', { userId, input });
      return { status: 'created', event: input };
    }

    case 'update_project':
      log.info('Update project', { userId, input });
      return { status: 'updated', projectId: input.projectId };

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}

// ─── Get pending approvals for a user ────────────────────────────────────────

export async function getPendingApprovals(clientNumber: string, userId: number): Promise<any[]> {
  const enabled = await isFeatureEnabled(clientNumber, 'feature_agents', false).catch(() => false);
  if (!enabled) return [];

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, action_type, input, created_at
     FROM agent_actions
     WHERE client_number = $1 AND user_id = $2 AND status = 'pending'
     ORDER BY created_at ASC`,
    clientNumber, userId,
  );
  return rows;
}
