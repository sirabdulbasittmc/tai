import prisma from '../db/prisma';
import { getGenAI } from './genaiClient';
import { env } from '../config/env';
import createLogger from '../utils/logger';

const log = createLogger('memory');

/**
 * MemoryService — Single comprehensive row per user, 3 categories.
 *
 * Table: user_profile_memory (1 row per user)
 *   - ai_instructions: How AI should behave (name, tone, standing instructions)
 *   - user_personal: Personal facts (family, city, hobbies, background)
 *   - active_concerns: Current concerns (health, travel, stress) — resolved ones removed
 *
 * On every update, AI rewrites the ENTIRE text — no append, no fragments.
 */

interface ProfileMemory {
  aiInstructions: string;
  userPersonal: string;
  activeConcerns: string;
}

// ─── Read ──────────────────────────────────────────────────────

export async function getProfileMemory(userId: number): Promise<ProfileMemory> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    'SELECT ai_instructions, user_personal, active_concerns FROM user_profile_memory WHERE user_id = $1',
    userId
  );
  if (rows.length === 0) {
    return { aiInstructions: '', userPersonal: '', activeConcerns: '' };
  }
  return {
    aiInstructions: rows[0].ai_instructions || '',
    userPersonal: rows[0].user_personal || '',
    activeConcerns: rows[0].active_concerns || '',
  };
}

export async function getAIName(userId: number): Promise<string> {
  const mem = await getProfileMemory(userId);
  const match = mem.aiInstructions.match(/(?:name(?:\s+is)?|call\s+me)[:\s]+(\w+)/i);
  return match ? match[1] : '';
}

// ─── Build prompt blocks ───────────────────────────────────────

export async function buildMemoryPromptBlocks(userId: number): Promise<{
  userMemoryBlock: string;
  aiMemoryBlock: string;
  contextBlock: string;
  aiName: string;
}> {
  const mem = await getProfileMemory(userId);

  const aiMemoryBlock = mem.aiInstructions
    ? `── AI INSTRUCTIONS ──\n${mem.aiInstructions}\nFollow these silently. Your name and the user's name are DIFFERENT — never address the user by your name.\n── END AI INSTRUCTIONS ──\n\n`
    : '';

  const userMemoryBlock = mem.userPersonal
    ? `── ABOUT THIS USER ──\n${mem.userPersonal}\n── END USER INFO ──\n\n`
    : '';

  const contextBlock = mem.activeConcerns
    ? `── ACTIVE CONCERNS ──\n${mem.activeConcerns}\nAsk about unresolved concerns with genuine care.\n── END CONCERNS ──\n\n`
    : '';

  const nameMatch = mem.aiInstructions.match(/(?:name(?:\s+is)?|call\s+me)[:\s]+(\w+)/i);

  return {
    aiMemoryBlock,
    userMemoryBlock,
    contextBlock,
    aiName: nameMatch ? nameMatch[1] : '',
  };
}

// ─── Rewrite (AI-powered comprehensive update) ────────────────

const REWRITE_PROMPT = `You manage 3 memory categories for a personal AI assistant. Given the CURRENT memory and a NEW user message, rewrite each category ONLY if the message reveals something PERSONAL about the user.

CATEGORIES:
1. ai_instructions: How the AI should behave. Includes: AI name, preferred tone, response format, standing instructions. Write as directives.
2. user_personal: Facts about the USER as a person. Includes: their name, city, family, hobbies, interests, personal contacts, birthday, preferences. Write as a brief profile.
3. active_concerns: The USER's personal unresolved concerns. Includes: their health, family issues, travel, stress, emotional state, upcoming personal events. REMOVE resolved items.

CRITICAL RULES — WHAT TO SAVE vs IGNORE:

SAVE (personal facts about the user):
- "I live in Bahria Town" → user_personal
- "my daughter has fever" → active_concerns
- "call me Jeni" → ai_instructions
- "I'm feeling stressed" → active_concerns
- "I prefer dashboards" → ai_instructions

IGNORE (business data queries — these are NOT about the user):
- "show me Imran Rehmani's deals" → UNCHANGED (Imran is a business entity, not user's contact)
- "follow up on project 809" → UNCHANGED (this is a data query, not a personal concern)
- "list all employees" → UNCHANGED (data request)
- "show project dashboard" → UNCHANGED (data request)
- "tell me about PGC project" → UNCHANGED (data query)
- "highest deal in 2024" → UNCHANGED (data query)
- "who reports to CEO" → UNCHANGED (data query)

The user is a BUSINESS EXECUTIVE asking an AI about company data. Most messages are DATA QUERIES, not personal revelations. Only save things the user reveals about THEMSELVES or their PERSONAL life.

RULES:
- REWRITE the entire text for each category — do NOT append.
- If the message RESOLVES a concern ("she is well now"), REMOVE it from active_concerns.
- If nothing personal was revealed, return ALL categories as UNCHANGED.
- Keep each category concise — max 200 words each.
- Never lose existing information unless explicitly contradicted or resolved.

Return ONLY a JSON object:
{
  "ai_instructions": "full rewritten text or UNCHANGED",
  "user_personal": "full rewritten text or UNCHANGED",
  "active_concerns": "full rewritten text or UNCHANGED"
}
`;

export async function updateMemoryFromMessage(
  userId: number,
  clientNumber: string,
  userMessage: string
): Promise<void> {
  // Skip trivial messages and data queries — these are NOT personal revelations
  if (userMessage.length < 10) return;
  const trimmed = userMessage.trim();
  if (/^(show|list|give|provide|how many|what is the|where is|which|compare|who is|who are|what are|tell me about|export|download|search)\b/i.test(trimmed)) return;
  // Skip common business data patterns
  if (/\b(dashboard|project|employee|revenue|sales|deal|client|account|pipeline|okr|org chart|competenc|risk|schedule|status|report|breakdown|distribution|overview|summary)\b/i.test(trimmed) &&
      !/\b(I am|I'm|my |I feel|I prefer|I like|I want|I need|remember|worried|concerned|call me|name is)\b/i.test(trimmed)) return;

  try {
    const current = await getProfileMemory(userId);

    const ai = getGenAI();

    const prompt = REWRITE_PROMPT +
      `\nCURRENT MEMORY:\nai_instructions: ${current.aiInstructions || '(empty)'}\nuser_personal: ${current.userPersonal || '(empty)'}\nactive_concerns: ${current.activeConcerns || '(empty)'}` +
      `\n\nNEW USER MESSAGE: "${userMessage}"`;

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    const text = (result.text ?? '').trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const updated = JSON.parse(jsonMatch[0]);

    // Only update fields that changed — also handle LLM misspellings of "UNCHANGED"
    const isUnchanged = (val: any) => typeof val === 'string' && /^UNCH?A?N?GE?D$/i.test(val.trim());
    const ai_inst = isUnchanged(updated.ai_instructions) ? current.aiInstructions : updated.ai_instructions;
    const personal = isUnchanged(updated.user_personal) ? current.userPersonal : updated.user_personal;
    const concerns = isUnchanged(updated.active_concerns) ? current.activeConcerns : updated.active_concerns;

    await prisma.$executeRawUnsafe(
      `INSERT INTO user_profile_memory (user_id, client_number, ai_instructions, user_personal, active_concerns, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET ai_instructions = $3, user_personal = $4, active_concerns = $5, updated_at = NOW()`,
      userId, clientNumber, ai_inst || '', personal || '', concerns || ''
    );

    // Log what changed
    const changes = [];
    if (updated.ai_instructions !== 'UNCHANGED') changes.push('ai_instructions');
    if (updated.user_personal !== 'UNCHANGED') changes.push('user_personal');
    if (updated.active_concerns !== 'UNCHANGED') changes.push('active_concerns');
    if (changes.length > 0) log.info('Updated memory', { userId, fields: changes.join(', ') });
  } catch (err: any) {
    log.error('Rewrite failed', { error: err.message });
  }
}

// ─── Legacy compatibility exports ──────────────────────────────

export async function getUserMemories(userId: number): Promise<string[]> {
  const mem = await getProfileMemory(userId);
  const items: string[] = [];
  if (mem.userPersonal) items.push(mem.userPersonal);
  if (mem.activeConcerns) items.push(mem.activeConcerns);
  return items;
}

export async function cleanupExpiredContextMemories(): Promise<number> {
  // No longer needed — concerns are managed in single text field
  return 0;
}
