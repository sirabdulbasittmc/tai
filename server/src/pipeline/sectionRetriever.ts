import { Section } from '../types';
import { embedText } from './embedder';
import { env } from '../config/env';
import { logTruncation } from '../services/systemLogService';

/**
 * Section-level retriever — for dashboard/list/summary queries that need
 * COMPLETE data, not partial chunks.
 *
 * Instead of retrieving chunks (which split tables and lose rows),
 * this retrieves FULL sections by matching the intent scope against
 * section headers using embedding similarity.
 *
 * No hardcoded section names — purely semantic matching.
 *
 * Used when: intent.type is 'dashboard', 'list', or 'export'
 * Normal RAG used when: intent.type is 'quick_answer', 'detailed_analysis', etc.
 */

// Cache section header embeddings — only recompute when sections change
let cachedHeaderEmbeddings: { header: string; vector: number[] }[] = [];
let cachedSectionCount = 0;

// Cache scope embeddings — same scope text = same vector (avoids redundant API calls)
const scopeEmbedCache = new Map<string, { vector: number[]; ts: number }>();
const SCOPE_CACHE_TTL = 300_000; // 5 min
async function embedScope(scope: string): Promise<number[]> {
  const key = scope.toLowerCase().trim();
  const cached = scopeEmbedCache.get(key);
  if (cached && Date.now() - cached.ts < SCOPE_CACHE_TTL) return cached.vector;
  const vector = await embedText(scope);
  scopeEmbedCache.set(key, { vector, ts: Date.now() });
  // Keep cache small
  if (scopeEmbedCache.size > 100) {
    const oldest = scopeEmbedCache.keys().next().value;
    if (oldest) scopeEmbedCache.delete(oldest);
  }
  return vector;
}

/**
 * Embed all section headers (cached — only recomputes when section count changes).
 */
async function getHeaderEmbeddings(sections: Section[]): Promise<{ header: string; vector: number[] }[]> {
  if (cachedHeaderEmbeddings.length > 0 && cachedSectionCount === sections.length) {
    return cachedHeaderEmbeddings;
  }

  const headers = sections.map(s => s.header.replace(/^#+\s*/, '').trim());
  const vectors: number[][] = [];

  // Embed headers one by one (they're short, fast)
  for (const h of headers) {
    const v = await embedText(h);
    vectors.push(v);
  }

  cachedHeaderEmbeddings = headers.map((h, i) => ({ header: h, vector: vectors[i] }));
  cachedSectionCount = sections.length;
  console.log(`[SectionRetriever] Cached ${headers.length} header embeddings`);
  return cachedHeaderEmbeddings;
}

/**
 * Retrieve full sections that best match the query scope.
 * Returns complete section bodies (not chunks) — preserves all table rows.
 */
export async function retrieveFullSections(
  scope: string,
  sections: Section[],
  maxSections: number = 3,
  maxChars: number = env.maxContextChars
): Promise<string> {
  if (sections.length === 0 || !scope) return '';

  // Embed the scope/query (cached for 5 min)
  const scopeVector = await embedScope(scope);

  // Get cached header embeddings
  const headerEmbeddings = await getHeaderEmbeddings(sections);

  // Score each section by cosine similarity between scope and header
  const scored = sections.map((section, i) => ({
    section,
    score: cosineSimilarity(scopeVector, headerEmbeddings[i].vector),
  }));

  // Sort by score, take top N
  scored.sort((a, b) => b.score - a.score);
  const topSections = scored.slice(0, maxSections);

  console.log(`[SectionRetriever] Scope: "${scope}" → matched: ${topSections.map(s => `"${s.section.header.slice(0, 40)}" (${s.score.toFixed(3)})`).join(', ')}`);

  // Build context from full sections, respecting char limit
  let context = '';
  let includedCount = 0;

  for (const { section, score } of topSections) {
    let sectionText = section.body;
    const remaining = maxChars - context.length;
    if (remaining <= 200 && includedCount > 0) break; // No room left

    // Truncate section to fit within limit
    if (sectionText.length > remaining) {
      const fullSize = sectionText.length;
      const truncated = sectionText.slice(0, remaining);
      const lastNewline = truncated.lastIndexOf('\n');
      sectionText = lastNewline > 0 ? truncated.slice(0, lastNewline) + '\n[... truncated for speed]' : truncated;
      // Log truncation for admin visibility
      logTruncation(section.header.replace(/^#+\s*/, ''), fullSize, sectionText.length).catch(() => {});
    }

    const tag = `[section: ${section.header.replace(/^#+\s*/, '')} | relevance: ${score.toFixed(2)}]`;
    context += (context ? '\n\n' : '') + tag + '\n' + sectionText;
    includedCount++;
  }

  console.log(`[SectionRetriever] Returning ${includedCount} full sections, ${context.length} chars`);
  return context;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
