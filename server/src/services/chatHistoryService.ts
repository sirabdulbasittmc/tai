import prisma from '../db/prisma';

// ─── Conversations ─────────────────────────────────────────────

export async function createConversation(clientNumber: string, userId: number, provider?: string) {
  return prisma.conversation.create({
    data: { clientNumber, userId, provider },
  });
}

export async function getConversations(clientNumber: string, userId: number, limit = 50, offset = 0) {
  return prisma.conversation.findMany({
    where: { clientNumber, userId, isArchived: false },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    skip: offset,
    select: { id: true, title: true, provider: true, messageCount: true, createdAt: true, updatedAt: true },
  });
}

export async function getConversation(conversationId: number, clientNumber: string, userId: number) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, clientNumber, userId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function archiveConversation(conversationId: number, clientNumber: string, userId: number) {
  return prisma.conversation.updateMany({
    where: { id: conversationId, clientNumber, userId },
    data: { isArchived: true },
  });
}

export async function updateConversationTitle(conversationId: number, clientNumber: string, userId: number, title: string) {
  return prisma.conversation.updateMany({
    where: { id: conversationId, clientNumber, userId },
    data: { title },
  });
}

// ─── Messages ──────────────────────────────────────────────────

export async function addMessage(data: {
  clientNumber: string;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  responseTimeMs?: number;
}) {
  const message = await prisma.message.create({
    data: {
      clientNumber: data.clientNumber,
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      provider: data.provider,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      responseTimeMs: data.responseTimeMs,
    },
  });

  await prisma.conversation.update({
    where: { id: data.conversationId },
    data: { messageCount: { increment: 1 }, provider: data.provider || undefined, updatedAt: new Date() },
  });

  // Auto-title from first user message
  const conv = await prisma.conversation.findUnique({ where: { id: data.conversationId } });
  if (conv && !conv.title && data.role === 'user') {
    const title = data.content.length > 80 ? data.content.slice(0, 77) + '...' : data.content;
    await prisma.conversation.update({ where: { id: data.conversationId }, data: { title } });
  }

  return message;
}

export async function getRecentMessages(conversationId: number, limit = 4, userId?: number) {
  return prisma.message.findMany({
    where: {
      conversationId,
      ...(userId ? { conversation: { userId } } : {}), // validate ownership
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { role: true, content: true },
  });
}
