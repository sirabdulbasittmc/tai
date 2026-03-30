import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { Intent } from '../services/intentService';

/**
 * Query Rewriter — expands short/ambiguous queries before embedding.
 *
 * Uses intent classification (not character count) to decide when to rewrite:
 * - SKIP: conversational, action, export (these don't need enrichment)
 * - REWRITE: quick_answer, detailed_analysis, dashboard, list, comparison
 *   (but only when the query lacks enough semantic signal)
 *
 * "FFC status?" embeds poorly → rewrite to detailed search query.
 * "Explain everything about our cybersecurity portfolio" is already rich → skip.
 */

const REWRITE_PROMPT = `You are a query expansion engine for a business intelligence system. The system has data about: clients, projects (with status, risks, progress), sales deals (PKR/USD), employees (names, titles, departments, reporting hierarchy), and solutions (SAP, SuccessFactors, Qlik, BTP, Cloud, Cybersecurity).

Given a short user query, expand it into a clear, detailed search query that will retrieve better results. Keep it as a single sentence.

Rules:
- Expand abbreviations if you can guess them from business context
- Add likely related terms (e.g., "status" -> include "progress, risks, schedule")
- Keep the original intent — don't change what's being asked
- If the query is already clear and detailed, return it unchanged
- Return ONLY the rewritten query, nothing else

Examples:
- "FFC status?" -> "What is the current project status, progress percentage, risks, and schedule for FFC client engagements?"
- "top clients" -> "Which clients have the highest revenue, most active contracts, and largest deal values?"
- "org chart" -> "Show the organizational hierarchy with reporting structure, employee names, titles, grades, and departments"
- "critical risks" -> "Which projects have critical or high severity open risks, and what are the risk details and affected projects?"

Query: `;

// Intent types that benefit from query rewriting
const REWRITE_INTENTS = new Set([
  'quick_answer',
  'detailed_analysis',
  'dashboard',
  'list',
  'comparison',
]);

// Queries that are already semantically rich don't need rewriting
const RICH_QUERY_THRESHOLD = 8; // word count — queries with 8+ meaningful words are usually detailed enough

export async function rewriteQuery(query: string, intent?: Intent): Promise<string> {
  // Skip rewriting for intent types that don't need it
  if (intent && !REWRITE_INTENTS.has(intent.type)) {
    return query;
  }

  // Skip if query is already semantically rich
  const wordCount = query.split(/\s+/).filter(w => w.length > 2).length;
  if (wordCount >= RICH_QUERY_THRESHOLD) {
    return query;
  }

  if (!env.geminiApiKey) return query;

  try {
    const genAI = new GoogleGenerativeAI(env.geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent(REWRITE_PROMPT + `"${query}"`);
    const rewritten = result.response.text().trim().replace(/^["']|["']$/g, '');

    if (rewritten && rewritten.length > query.length) {
      console.log(`[QueryRewriter] "${query}" → "${rewritten.slice(0, 80)}..."`);
      return rewritten;
    }

    return query;
  } catch (err: any) {
    console.error('[QueryRewriter] Failed, using original query:', err.message);
    return query;
  }
}
