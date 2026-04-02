// ═════════════════════════════════════════════════════════════════════════════
// knowledgeBaseService.ts — Phase 5: Knowledge base builder
//
// Stores company knowledge: decisions, lessons learned, transcripts, procedures.
// Items are embedded and searchable via cosine similarity.
// ═════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import prisma from '../db/prisma';
import { embedText, embedBatch } from '../pipeline/embedder';
import createLogger from '../utils/logger';

const log = createLogger('knowledgeBase');

export type KnowledgeCategory = 'decision' | 'lesson_learned' | 'transcript' | 'procedure' | 'general';

// ─── Add a knowledge item ─────────────────────────────────────────────────────

export async function addKnowledgeItem(
  clientNumber: string,
  category: KnowledgeCategory,
  title: string,
  content: string,
  opts: {
    tags?: string[];
    source?: string;
    sourceId?: string;
    createdBy?: number;
  } = {},
): Promise<number> {
  const embedding = await embedText(`${title}\n\n${content}`).catch(() => []);
  const embeddingJson = JSON.stringify(embedding);

  const rows: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO knowledge_items
       (client_number, category, title, content, tags, source, source_id, embedding, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     RETURNING id`,
    clientNumber, category, title, content,
    opts.tags || [], opts.source || null, opts.sourceId || null,
    embeddingJson, opts.createdBy || null,
  );

  const id = rows[0].id;
  log.info('Knowledge item added', { clientNumber, category, id, title });
  return id;
}

// ─── Search knowledge base ────────────────────────────────────────────────────

export async function searchKnowledgeBase(
  clientNumber: string,
  query: string,
  opts: { category?: KnowledgeCategory; topK?: number } = {},
): Promise<Array<{ id: number; category: string; title: string; content: string; score: number }>> {
  const queryEmbedding = await embedText(query).catch(() => null);
  if (!queryEmbedding) return [];

  const categoryFilter = opts.category ? `AND category = '${opts.category}'` : '';
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, category, title, content, embedding FROM knowledge_items
     WHERE client_number = $1 ${categoryFilter}`,
    clientNumber,
  );

  if (rows.length === 0) return [];

  const topK = opts.topK ?? 5;
  const scored = rows.map(r => {
    const emb: number[] = Array.isArray(r.embedding) ? r.embedding : JSON.parse(r.embedding || '[]');
    return { id: r.id, category: r.category, title: r.title, content: r.content, score: cosineSim(queryEmbedding, emb) };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK).filter(r => r.score > 0.5);
}

function cosineSim(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

// ─── List knowledge items ─────────────────────────────────────────────────────

export async function listKnowledgeItems(
  clientNumber: string,
  category?: KnowledgeCategory,
  limit = 50,
): Promise<Array<{ id: number; category: string; title: string; tags: string[]; source?: string; createdAt: Date }>> {
  const categoryFilter = category ? `AND category = '${category}'` : '';
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, category, title, tags, source, created_at
     FROM knowledge_items
     WHERE client_number = $1 ${categoryFilter}
     ORDER BY created_at DESC
     LIMIT $2`,
    clientNumber, limit,
  );
  return rows.map(r => ({
    id: r.id, category: r.category, title: r.title,
    tags: r.tags || [], source: r.source || undefined, createdAt: r.created_at,
  }));
}

// ─── Update knowledge item ────────────────────────────────────────────────────

export async function updateKnowledgeItem(
  clientNumber: string,
  id: number,
  updates: { title?: string; content?: string; tags?: string[] },
): Promise<void> {
  const existing: any[] = await prisma.$queryRawUnsafe(
    'SELECT id, title, content FROM knowledge_items WHERE id = $1 AND client_number = $2',
    id, clientNumber,
  );
  if (!existing.length) throw new Error('Knowledge item not found');

  const title   = updates.title   ?? existing[0].title;
  const content = updates.content ?? existing[0].content;
  const embedding = await embedText(`${title}\n\n${content}`).catch(() => []);

  await prisma.$executeRawUnsafe(
    `UPDATE knowledge_items
     SET title = $1, content = $2, tags = $3, embedding = $4::jsonb, updated_at = NOW()
     WHERE id = $5 AND client_number = $6`,
    title, content, updates.tags ?? existing[0].tags, JSON.stringify(embedding), id, clientNumber,
  );
  log.info('Knowledge item updated', { clientNumber, id });
}

// ─── Delete knowledge item ────────────────────────────────────────────────────

export async function deleteKnowledgeItem(clientNumber: string, id: number): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DELETE FROM knowledge_items WHERE id = $1 AND client_number = $2',
    id, clientNumber,
  );
  log.info('Knowledge item deleted', { clientNumber, id });
}
