import prisma from '../db/prisma';
import { maskPII } from '../pipeline/piiService';

export async function logQuery(data: {
  clientNumber?: string;
  userId?: number;
  query: string;
  provider: string;
  chunksRetrieved?: number;
  topScore?: number;
  piiEntitiesCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  responseTimeMs: number;
  intentType?: string;
  error?: string;
}): Promise<void> {
  if (!data.clientNumber) return; // Can't log without tenant context

  try {
    const masked = await maskPII(data.query);
    const maskedQuery = masked.entities.length > 0 ? masked.maskedText : data.query;

    await prisma.auditLog.create({
      data: {
        clientNumber: data.clientNumber,
        userId: data.userId || null,
        maskedQuery,
        provider: data.provider,
        chunksRetrieved: data.chunksRetrieved || 0,
        topScore: data.topScore || null,
        piiEntitiesCount: data.piiEntitiesCount || 0,
        inputTokens: data.inputTokens || null,
        outputTokens: data.outputTokens || null,
        responseTimeMs: data.responseTimeMs,
        intentType: data.intentType || null,
        error: data.error || null,
      },
    });
  } catch (err: any) {
    console.error('[Audit] Failed to log query:', err.message);
  }
}

export async function getRecentAuditLogs(clientNumber: string, limit = 100) {
  return prisma.auditLog.findMany({
    where: { clientNumber },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { name: true, empcode: true } } },
  });
}
