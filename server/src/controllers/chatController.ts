import { Request, Response } from 'express';
import crypto from 'crypto';
import { ChatRequest } from '../types';
import { env } from '../config/env';
import { getCachedSections, getDataLastUpdated, getDataSummary } from '../services/indexCacheService';
import { getDataSummaryFromBQ } from '../connectors/BigQueryConnector';
import { searchIndex } from '../services/searchService';
import { buildSystemPrompt } from '../services/promptService';
import { streamClaude } from '../services/claudeService';
import { streamOpenAI } from '../services/openaiService';
import { streamOpenRouter } from '../services/openrouterService';
import { streamGemini } from '../services/geminiService';
import { streamGroq } from '../services/groqService';
import { classifyIntent, buildIntentDirective, Intent } from '../services/intentService';
import { maskPII, createStreamUnmasker, isPIIEnabled } from '../pipeline/piiService';
import { sanitizeRetrievedContent } from '../pipeline/contentSanitizer';
import { createConversation, addMessage, getRecentMessages } from '../services/chatHistoryService';
import { logQuery } from '../services/auditService';
import { getUserProfile } from '../services/userProfileService';
import { retrieveFullSections } from '../pipeline/sectionRetriever';
import { buildMemoryPromptBlocks, getProfileMemory, updateMemoryFromMessage } from '../services/memoryService';
import prisma from '../db/prisma';
import { getUserLearnings, learnFromMessage } from '../services/learningService';
import { isNewsQuery, parseNewsIntent, getNewsSummary } from '../services/newsService';
// Artifact system removed — AI generates widgets directly from data context
import { checkIntegrationReady, hasPermission } from '../services/integrationService';
import { getAIConfig } from '../services/aiConfigService';
import { getConfig } from '../services/configService';
import { logError, logWarning, logTruncation, logSlowResponse } from '../services/systemLogService';
import { retrieveContext as retrieveFromGCP } from '../pipeline/gcpRetrieval';
import { trackUsage } from '../services/tokenUsageService';
import { getInbox, getUnreadCount, sendUserEmail, searchEmails } from '../services/gmailService';
import { getTodayEvents, getUpcomingEvents, createEvent, findFreeTime } from '../services/calendarService';
import { getUserTier, TierSettings } from '../services/tierService';

// ── Request Deduplication Cache ────────────────────────────────
interface CachedResponse { chunks: string[]; meta: any; timestamp: number; }
const dedupCache = new Map<string, CachedResponse>();
let DEDUP_TTL_MS = 300_000; // Default 5 min — updated from system_config on first request

function getDedupKey(userId: number | undefined, message: string, provider: string): string {
  return crypto.createHash('md5').update(`${userId || 0}::${message}::${provider}`).digest('hex');
}
function getCachedResponse(key: string): CachedResponse | null {
  const cached = dedupCache.get(key);
  if (!cached || Date.now() - cached.timestamp > DEDUP_TTL_MS) { dedupCache.delete(key); return null; }
  return cached;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of dedupCache) {
    if (now - entry.timestamp > DEDUP_TTL_MS) dedupCache.delete(key);
  }
}, 60_000);

// ── PII Cache (same context = same entities) ──────────────────
const piiCache = new Map<string, { maskedText: string; mapping: Record<string, string>; entities: any[]; timestamp: number }>();
const PII_CACHE_TTL_MS = 120_000; // 2 minutes

async function maskPIICached(context: string) {
  const hash = crypto.createHash('md5').update(context).digest('hex');
  const cached = piiCache.get(hash);
  if (cached && Date.now() - cached.timestamp < PII_CACHE_TTL_MS) {
    console.log('[PII] Cache hit — skipping NER call');
    return cached;
  }
  const result = await maskPII(context);
  piiCache.set(hash, { ...result, timestamp: Date.now() });
  // Keep cache small
  if (piiCache.size > 50) {
    const oldest = piiCache.keys().next().value;
    if (oldest) piiCache.delete(oldest);
  }
  return result;
}

// ── Confidence Thresholds ──────────────────────────────────────
const LOW_CONFIDENCE_THRESHOLD = 0.4;

// ── Context limits — read from system_config, these are fallbacks ─────────
const FAST_CONTEXT_LIMITS: Record<string, number> = {
  gemini: 60000,
  'gemini-flash': 50000,
  groq: 25000,
  claude: 80000,
  openai: 60000,
  openrouter: 25000,
};
const FULL_CONTEXT_LIMITS: Record<string, number> = {
  gemini: 120000,
  'gemini-flash': 120000,
  groq: 30000,
  claude: 150000,
  openai: 120000,
  openrouter: 20000,
};

// Intent types that are simple enough to skip re-ranking
// (SKIP_RERANK_INTENTS removed — no longer using chunk-based RAG)

// Intent types that should use Flash even if user selected Pro (much faster for widgets)
const FORCE_FLASH_INTENTS = new Set(['quick_answer', 'list', 'dashboard', 'export', 'conversational']);

// ALL data queries use full section retrieval for consistency.
// Only 'conversational' skips data entirely (handled earlier).
// This ensures "how many projects?" and "project dashboard" always see the same data.

export async function streamChat(req: Request, res: Response) {
  const abortController = new AbortController();
  let clientDisconnected = false;

  req.on('close', () => {
    clientDisconnected = true;
    abortController.abort();
  });

  try {
    const { message, provider, conversationId: reqConversationId } = req.body as ChatRequest;
    const aiConfig = await getAIConfig(req.user?.clientNumber);
    DEDUP_TTL_MS = aiConfig.dedupCacheTtlMs;

    if (!message || !provider) {
      res.status(400).json({ error: 'message and provider are required' });
      return;
    }

    // ── Chat History (non-blocking) ──────────────────────────
    const userId = req.user?.id;
    const clientNumber = req.user?.clientNumber;
    let conversationId = reqConversationId;

    // Validate conversation ownership — prevent cross-user history leakage
    if (conversationId && userId) {
      const conv = await prisma.conversation.findFirst({ where: { id: conversationId, userId } });
      if (!conv) conversationId = undefined; // reject unauthorized conversation
    }

    // Don't create conversations for email/calendar utility queries — they clutter history
    const isUtilityQuery = /^(check my emails?|what'?s on my calendar|show my schedule|show my emails)/i.test(message.trim());

    if (userId && clientNumber && !conversationId && !isUtilityQuery) {
      const conv = await createConversation(clientNumber, userId, provider);
      conversationId = conv.id;
    }
    if (userId && clientNumber && conversationId && !isUtilityQuery) {
      addMessage({ clientNumber, conversationId, role: 'user', content: message }).catch(() => {});
    }

    // ── Dedup check ──────────────────────────────────────────
    const dedupKey = getDedupKey(userId, message, provider);
    const cached = getCachedResponse(dedupKey);
    if (cached) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      for (const chunk of cached.chunks) {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify(cached.meta)}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return;
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendStatus = (text: string) => {
      if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
    };

    const startTime = Date.now();
    let totalChars = 0;
    const responseChunks: string[] = [];

    const sendChunkDirect = (text: string) => {
      totalChars += text.length;
      responseChunks.push(text);
      if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'chunk', content: text })}\n\n`);
    };

    // ══════════════════════════════════════════════════════════
    // Step 1: Intent + history + profile in PARALLEL (~2s)
    // Query rewriting REMOVED — scope from intent is enough
    // ══════════════════════════════════════════════════════════
    sendStatus('Understanding your question...');
    // Build format hints from user's learned preferences (fast — from cache/DB)
    const formatLearnings = userId ? await getUserLearnings(userId) : [];
    const formatHints = formatLearnings.length > 0
      ? formatLearnings.filter((l: any) => l.category === 'response_format').map((l: any) => `User ${l.score > 0 ? 'prefers' : 'dislikes'} ${l.key} (score: ${l.score})`).join('. ')
      : '';

    const [intent, chatHistory, userProfile, memoryBlocks, userLearnings, tierSettings] = await Promise.all([
      classifyIntent(message, formatHints || undefined),
      conversationId ? getRecentMessages(conversationId, 4, userId) : Promise.resolve([]),
      userId ? getUserProfile(userId) : Promise.resolve(null),
      userId ? buildMemoryPromptBlocks(userId) : Promise.resolve({ userMemoryBlock: '', aiMemoryBlock: '', contextBlock: '', aiName: '' }),
      userId ? getUserLearnings(userId) : Promise.resolve([]),
      (clientNumber && req.user?.userType) ? getUserTier(clientNumber, req.user.userType) : Promise.resolve(null),
    ]);

    // ── Background memory extraction (non-blocking) ────────
    // After every response, AI silently checks if anything worth remembering.
    // No keyword matching — AI decides naturally.
    // This runs AFTER the response, not as an interceptor.
    if (clientDisconnected) return;

    // Destructure memory blocks (used in both conversational and data paths)
    const { userMemoryBlock, aiMemoryBlock, contextBlock, aiName } = memoryBlocks;

    // ── Apply tier-based format restrictions ─────────────────
    if (tierSettings) {
      // Downgrade widget/chart formats if tier doesn't allow them
      if (!tierSettings.allowWidgets && (intent.format === 'widget' || intent.format === 'hierarchy')) {
        intent.format = 'text';
        if (intent.type === 'dashboard') intent.type = 'detailed_analysis';
        if (intent.type === 'export' && !tierSettings.allowExport) intent.type = 'detailed_analysis';
      }
      if (!tierSettings.allowCharts && intent.format === 'chart') {
        intent.format = 'text';
      }
      if (!tierSettings.allowExport && intent.type === 'export') {
        intent.format = 'text';
        intent.type = 'detailed_analysis';
      }
      // Override detail level from tier response style
      intent.detail = tierSettings.responseStyle === 'brief' ? 'brief'
        : tierSettings.responseStyle === 'comprehensive' || tierSettings.responseStyle === 'detailed' ? 'comprehensive'
        : 'moderate';
    }

    const t1 = Date.now() - startTime;
    console.log(`[Pipeline] Step 1 (intent): ${t1}ms | type: ${intent.type}, scope: ${intent.scope}${tierSettings ? ` | tier: ${tierSettings.tierCode}` : ''}`);

    // ── Detect memory management requests ──────────────────
    const isMemoryRequest = /\b(forget|clear|reset|delete|erase|wipe|remove).*(memory|memories|know about me|what you know|learned|remember)/i.test(message)
      || /\b(show|see|review|edit|change|update).*(memory|memories|what you know|what you remember)/i.test(message);

    if (isMemoryRequest && userId) {
      const mem = await getProfileMemory(userId);

      const hasData = mem.aiInstructions || mem.userPersonal || mem.activeConcerns;

      if (!hasData) {
        const response = "I don't have any memories about you yet. We're starting completely fresh! Just chat with me and I'll learn over time.";
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: response })}\n\n`);
      } else {
        let response = "Here's everything I currently know about you:\n\n";
        if (mem.aiInstructions) response += `**🤖 How I Behave:**\n${mem.aiInstructions}\n\n`;
        if (mem.userPersonal) response += `**👤 About You:**\n${mem.userPersonal}\n\n`;
        if (mem.activeConcerns) response += `**⚠️ Active Concerns:**\n${mem.activeConcerns}\n\n`;
        response += "---\n\n";
        response += "Clearing this means I'll start from scratch and won't remember anything about you.\n\n";
        response += "**What would you like to do?**\n";
        response += "- **Edit** — Copy the text above, make changes, and send it back to me. I'll update my memory with your version.\n";
        response += "- **Clear everything** — Say \"clear all memory\" and I'll wipe everything (I'll confirm before deleting)\n";
        response += "- **Keep as is** — Just continue chatting, nothing changes";
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: response })}\n\n`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      res.write(`data: ${JSON.stringify({ type: 'meta', elapsed, outputTokens: 50, inputTokens: 10, totalTokens: 60, conversationId })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      if (clientNumber && conversationId) {
        addMessage({ clientNumber, conversationId, role: 'user', content: message }).catch(() => {});
      }
      res.end();
      return;
    }

    // ── Detect memory clear confirmation ─────────────────
    const isClearConfirm = /\b(clear all memory|yes clear|confirm clear|delete all memory|wipe all)\b/i.test(message);
    if (isClearConfirm && userId) {
      const { getProfileMemory: gpm } = await import('../services/memoryService');
      const mem = await gpm(userId);
      const nameMatch = mem.aiInstructions?.match(/Name:\s*\w+\./i);
      const keepName = nameMatch ? nameMatch[0] : '';

      await prisma.$executeRawUnsafe(
        'UPDATE user_profile_memory SET ai_instructions = $1, user_personal = $2, active_concerns = $3, updated_at = NOW() WHERE user_id = $4',
        keepName, '', '', userId
      );

      const response = `Done! I've cleared all my memories about you${keepName ? ` (kept my name: ${keepName.replace('Name: ', '').replace('.', '')})` : ''}. We're starting fresh — I'll learn about you again as we chat.`;
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: response })}\n\n`);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      res.write(`data: ${JSON.stringify({ type: 'meta', elapsed, outputTokens: 20, inputTokens: 10, totalTokens: 30, conversationId })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      if (clientNumber && conversationId) {
        addMessage({ clientNumber, conversationId, role: 'user', content: message }).catch(() => {});
        addMessage({ clientNumber, conversationId, role: 'assistant', content: response }).catch(() => {});
      }
      res.end();
      return;
    }

    // ── Detect memory edit (user sends updated text) ─────
    const isMemoryEdit = /\b(update memory|here is my updated|updated memory|new memory|replace memory)\b/i.test(message)
      || (message.includes('How I Behave:') || message.includes('About You:') || message.includes('Active Concerns:'));
    if (isMemoryEdit && userId && clientNumber) {
      // Parse the user's edited text into the 3 categories
      const aiMatch = message.match(/(?:How I Behave|AI Instructions)[:\s]*([^]*?)(?=(?:About You|User Personal|Active Concerns|$))/i);
      const personalMatch = message.match(/(?:About You|User Personal)[:\s]*([^]*?)(?=(?:Active Concerns|How I Behave|$))/i);
      const concernsMatch = message.match(/(?:Active Concerns)[:\s]*([^]*?)$/i);

      const prismaDb = (await import('../db/prisma')).default;
      const current = await getProfileMemory(userId);

      await prismaDb.$executeRawUnsafe(
        `INSERT INTO user_profile_memory (user_id, client_number, ai_instructions, user_personal, active_concerns, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) DO UPDATE SET ai_instructions = $3, user_personal = $4, active_concerns = $5, updated_at = NOW()`,
        userId, clientNumber,
        aiMatch?.[1]?.trim() || current.aiInstructions,
        personalMatch?.[1]?.trim() || current.userPersonal,
        concernsMatch?.[1]?.trim() || current.activeConcerns
      );

      const response = "Got it! I've updated my memory with your changes. Everything is saved.";
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: response })}\n\n`);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      res.write(`data: ${JSON.stringify({ type: 'meta', elapsed, outputTokens: 15, inputTokens: 10, totalTokens: 25, conversationId })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      if (conversationId) {
        addMessage({ clientNumber, conversationId, role: 'user', content: message }).catch(() => {});
        addMessage({ clientNumber, conversationId, role: 'assistant', content: response }).catch(() => {});
      }
      res.end();
      return;
    }

    // Detect conversational follow-ups — but NOT for data queries
    const hasDataKeywords = /\b(project|dashboard|sales|revenue|employee|org|risk|pipeline|client|deal|report|excel|list|show|compare|behind|ahead|overdue|status|portfolio|summary|analysis)\b/i.test(message);
    const isShortFollowUp = message.length < 20 && chatHistory.length > 0 && !hasDataKeywords;
    const prevWasConversational = chatHistory.length > 0 && chatHistory[0]?.content?.length < 300;
    // Force email/calendar queries to conversational path (where the integration handler lives)
    // Email/calendar detection — must NOT match business data queries like "behind schedule" or "project events"
    const isEmailCalendarQuery = /\b(emails?|inbox|mails?|unread|send email|reply|compose|draft|my calendar|my schedule|my meetings?|my events?|appointments?|free time|free slot|check my|what'?s on my)\b/i.test(message)
      && !hasDataKeywords; // Never treat data queries as email/calendar
    // Admin queries (logs, token usage, apply fixes) always go to conversational path
    const isAdminQuery = /\b(system log|logs?|token cost|token consumption|usage|billing|suggest fix|apply all fixes|apply.*fix)/i.test(message) && req.user?.isAdmin;
    // Personal/opinion queries should always go to conversational path (warm personality)
    const isPersonalQuery = /\b(think about me|know about me|how am i|who am i|my name|about me|my birthday|my hobby|my family|how do you feel|do you like me|your opinion|are you happy|are you sad|i am (sad|happy|tensed|stressed|worried|excited|angry|tired|bored|sick|lonely))\b/i.test(message);
    const isConversational = (intent.type === 'conversational' && !hasDataKeywords) || (isShortFollowUp && prevWasConversational) || isEmailCalendarQuery || isAdminQuery || isPersonalQuery;
    const isWidget = ['dashboard', 'list', 'export', 'comparison'].includes(intent.type) || intent.format === 'widget' || intent.format === 'hierarchy';

    // ── Widget Modification Detection ─────────────────────────
    // If user says "add filter", "sort by X", "change chart" and the previous response had a widget,
    // modify the existing widget instead of treating it as conversational
    const isModifyRequest = /\b(add|change|sort|filter|remove|hide|show|move|swap|switch|update|modify|make|convert)\b/i.test(message)
      && chatHistory.length > 0 && chatHistory[0]?.content?.includes('```widget');

    if (isModifyRequest && userId && clientNumber) {
      try {
        const prevWidget = chatHistory[0].content.match(/```widget\s*\n([\s\S]*?)```/);
        if (prevWidget) {
          sendStatus('Modifying your dashboard...');
          const modifyPrompt = `You are a frontend developer. The user has an existing HTML widget and wants to modify it.\n\nCURRENT WIDGET HTML:\n${prevWidget[1].slice(0, 6000)}\n\nUSER REQUEST: "${message}"\n\nReturn the COMPLETE modified HTML widget. Keep all existing functionality, just apply the requested change. Return ONLY the HTML/CSS/JS — no markdown, no explanation, no \`\`\` fences.`;

          let modifiedHtml = '';
          await streamGemini(modifyPrompt, message, (chunk) => { modifiedHtml += chunk; }, true, 6144, true);

          // Clean up — remove any markdown fences the AI might add
          modifiedHtml = modifiedHtml.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();

          if (modifiedHtml.length > 200) {
            const response = `Done! Here's your updated dashboard.\n\n\`\`\`widget\n${modifiedHtml}\n\`\`\``;
            sendChunkDirect(response);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const meta = { type: 'meta', elapsed, outputTokens: Math.ceil(modifiedHtml.length / 4), inputTokens: Math.ceil(prevWidget[1].length / 4), totalTokens: Math.ceil((modifiedHtml.length + prevWidget[1].length) / 4), conversationId };
            res.write(`data: ${JSON.stringify(meta)}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            if (conversationId) {
              addMessage({ clientNumber, conversationId, role: 'user', content: message }).catch(() => {});
              addMessage({ clientNumber, conversationId, role: 'assistant', content: response, provider }).catch(() => {});
            }
            res.end();
            return;
          }
        }
      } catch (modErr: any) {
        console.error('[Widget Modify] Error:', modErr.message);
        // Fall through to normal flow
      }
    }

    // Short-circuit for conversational queries — include profile so AI knows the user
    if (isConversational) {
      try {
        // For admin system queries, use a system admin prompt instead of personality prompt
        const isSystemQuery = isAdminQuery && (
          /\b(log|token|consumption|cost|usage|fix|apply)\b/i.test(message)
        );

        let convPrompt = isSystemQuery
          ? `Today's date is ${new Date().toISOString().split('T')[0]}.\n` +
            'You are a SYSTEM ADMINISTRATOR reporting tool. You have FULL access to system logs, token consumption data, and configuration settings.\n' +
            'When data is provided below, present it as a clear report. NEVER say "I don\'t have access" — the data IS provided to you.\n' +
            'Be direct, factual, and actionable. Format as a structured report with sections.\n'
          : `Today's date is ${new Date().toISOString().split('T')[0]}.\n` +
          'You are the user\'s personal AI — a multi-dimensional assistant who naturally adapts:\n' +
          '• FRIEND MODE (personal topics): Warm, curious, caring. Remember family details, ask about health, share in their joy and stress. Like a close friend who happens to be incredibly helpful.\n' +
          '• ASSISTANT MODE (tasks, scheduling, reminders): Organized, proactive, efficient. "I\'ll remind you about that." "Should I draft that email?" "Your meeting is in 30 min — want me to prep talking points?"\n' +
          '• ADVISOR MODE (business questions): Strategic, opinionated, data-driven. Lead with insights, not data dumps. Recommend actions. Flag risks.\n' +
          'Switch between these NATURALLY based on what the user says. Never announce a mode switch. Just shift your tone and approach seamlessly.\n' +
          'When in doubt, default to FRIEND — because a friend who gives great business advice is better than a tool that tries to be friendly.';
        const userName = req.user?.name;
        if (userName) convPrompt += `\nThe user's name is ${userName}.`;
        if (userProfile) {
          if (userProfile.jobDescription) convPrompt += `\nTheir role: ${userProfile.jobDescription}`;
          if (userProfile.city) convPrompt += `\nTheir city: ${userProfile.city}. Use this for weather, traffic, local time, and location-based questions.`;
          if (userProfile.aboutMe) convPrompt += `\nAbout them: ${userProfile.aboutMe}`;
          if (userProfile.tonePreference) convPrompt += `\nPreferred tone: ${userProfile.tonePreference}`;
          if (userProfile.instructions) convPrompt += `\nInstructions: ${userProfile.instructions}`;
        }
        convPrompt += '\nYou know this user personally. When asked about yourself or about them, use their name and your knowledge.';
        convPrompt += '\nCRITICAL PRIVACY RULE: NEVER invent or hallucinate personal facts about the user. ONLY reference information from the MEMORY blocks below or what the user told you in THIS conversation. If you don\'t know something about them, say "I don\'t know that yet — tell me!" Do NOT make up stories about "she", "he", family, health, or any personal details.';
        if (userMemoryBlock) convPrompt += '\n' + userMemoryBlock;
        if (aiMemoryBlock) convPrompt += '\n' + aiMemoryBlock;
        if (contextBlock) convPrompt += '\n' + contextBlock;
        convPrompt += '\nYou CAN answer general knowledge questions: weather, currency rates, news, time, jokes, fun facts.';
        convPrompt += '\nYou CAN read emails and calendar when the data is provided below. If email/calendar data appears below, summarize it naturally. NEVER say "I don\'t have access to your inbox" — if the data is provided, you DO have access.';
        convPrompt += '\nOnly refuse harmful/inappropriate topics.';
        convPrompt += '\nADAPTIVE TONE: Mirror the user\'s style naturally.';
        convPrompt += '\nEMOTIONAL INTELLIGENCE: If the user expresses stress, sadness, frustration, anxiety, or any emotion — respond with genuine empathy FIRST. Do NOT connect it to work unless they specifically mention work. Ask what\'s wrong. Be a caring human, not a corporate assistant. Examples:';
        convPrompt += '\n- "I am tensed" → "I\'m sorry to hear that. Want to share what\'s on your mind? I\'m here to listen."';
        convPrompt += '\n- "feeling down today" → "That\'s tough. Is everything okay? Sometimes just talking helps."';
        convPrompt += '\n- "stressed about deadline" → "Deadlines can be really stressful. Which one is bothering you? Maybe I can help."';
        convPrompt += '\nNEVER assume their stress is work-related unless they say so. Be a friend first, assistant second.';
        convPrompt += '\nLEARNING: If the user asks whether you know something about them and you DON\'T have that information, DO NOT just say "I don\'t have access." Instead, ask them to share it in a friendly way. Examples:';
        convPrompt += '\n- "do you know my address?" → "Not yet! Want to share it so I can remember for next time?"';
        convPrompt += '\n- "what\'s my birthday?" → "I don\'t know yet — when is it? I\'d love to remember!"';
        convPrompt += '\n- "do you know my hobbies?" → "I haven\'t learned that yet. What do you enjoy? I\'ll keep it in mind."';
        convPrompt += '\nWhen they DO share personal info, acknowledge it warmly. The memory system will save it automatically.';
        // Inject news if user asks about it
        if (isNewsQuery(message)) {
          const newsIntent = parseNewsIntent(message);
          const news = await getNewsSummary({ ...newsIntent, count: 5 });
          if (news) {
            convPrompt += '\n\nLATEST NEWS (from NewsAPI):\n' + news;
            convPrompt += '\nSummarize these naturally. Add brief commentary. Mention which might be relevant to the user based on their profile.';
          }
        }

        // ── Email confirm-and-send (user confirms a draft) ────
        const isConfirmSend = /\b(confirm|yes send|send it|go ahead|approve|looks good)\b/i.test(message)
          && chatHistory.length > 0 && chatHistory[0]?.content?.includes('[DRAFT READY]');
        if (isConfirmSend && userId) {
          const canWrite = await hasPermission(userId, 'email_write');
          if (canWrite) {
            // Extract draft details from previous AI message
            const prev = chatHistory[0].content;
            const toMatch = prev.match(/\*\*To:\*\*\s*(.+)/);
            const subMatch = prev.match(/\*\*Subject:\*\*\s*(.+)/);
            const bodyMatch = prev.match(/\*\*Body:\*\*\s*([\s\S]*?)(?=\n\n\[DRAFT READY\])/);
            if (toMatch && subMatch && bodyMatch) {
              sendStatus('Sending email...');
              const htmlBody = `<p>${bodyMatch[1].trim().replace(/\n/g, '<br/>')}</p>`;
              const sendResult = await sendUserEmail(userId, toMatch[1].trim(), subMatch[1].trim(), htmlBody);
              if (sendResult.success) {
                convPrompt += `\n\nEMAIL SENT SUCCESSFULLY to ${toMatch[1].trim()}. Tell the user the email has been sent. Be brief and confirmatory.`;
              } else {
                convPrompt += `\n\nFailed to send: ${sendResult.error}. Tell the user naturally.`;
              }
            }
          }
        }

        // ── Email/Calendar integration ────────────────────────
        const isEmailQuery = /\b(emails?|inbox|mails?|unread|send email|reply|compose|draft)\b/i.test(message);
        const isSendReply = /\b(reply|send|forward|respond|write back)\b/i.test(message) && chatHistory.length > 0;
        const isCalendarQuery = /\b(calendar|schedule|meetings?|events?|appointments?|free time|free slot|busy|today'?s? (meeting|event|schedule))\b/i.test(message);

        if ((isEmailQuery || isSendReply || isCalendarQuery) && userId) {
          const { ready, message: notReadyMsg } = await checkIntegrationReady(userId);
          if (!ready) {
            convPrompt += `\n\nIMPORTANT: The user is asking about email/calendar but has NOT connected their account. Respond with this message naturally:\n${notReadyMsg}`;
          } else {
            // ── Send/Reply email (draft → confirm → send) ────
            if (isSendReply) {
              const canWrite = await hasPermission(userId, 'email_write');
              if (!canWrite) {
                convPrompt += '\n\nThe user wants to reply but "Send/Reply Emails" is disabled. Tell them: "I can draft that, but sending is disabled. Enable it in **Settings → Email & Calendar → AI Permissions**."';
              } else {
                const emailFromMatch = message.match(/(?:reply|send|respond|write)\s+(?:to\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
                const targetName = emailFromMatch?.[1] || '';

                if (targetName) {
                  sendStatus(`Drafting reply to ${targetName}...`);
                  try {
                    const { emails: foundEmails } = await searchEmails(userId, `from:${targetName}`, 1);
                    if (foundEmails.length > 0) {
                      const targetEmail = foundEmails[0].from;
                      const targetAddress = targetEmail.match(/<(.+?)>/)?.[1] || targetEmail;
                      const subject = 'Re: ' + (foundEmails[0].subject || '');
                      const userIntent = message.replace(/^(reply|send|respond|write\s+back)\s+(to\s+)?[A-Z][a-z]+(\s+[A-Z][a-z]+)?\s*(that|saying|with|:)?\s*/i, '').trim();

                      let emailBody = '';
                      await streamGemini(
                        'You are an email writer. Write a SHORT, professional email body (2-3 sentences max). Include a greeting and sign-off. Return ONLY the email text.',
                        `Write email to ${targetName} saying: ${userIntent}`,
                        (chunk) => { emailBody += chunk; }, true, 256, true
                      );
                      emailBody = emailBody.trim();

                      // Show draft for confirmation — DON'T send yet
                      convPrompt += `\n\nDRAFT EMAIL (show this to user for review):\n**To:** ${targetAddress}\n**Subject:** ${subject}\n**Body:** ${emailBody}\n\n[DRAFT READY]\n\nPresent this draft to the user. Show the To, Subject, and Body clearly. Then ask: "Does this look good? Say **confirm** to send, or tell me what to change."`;
                    } else {
                      convPrompt += `\n\nCouldn't find an email from "${targetName}". Ask the user for the email address.`;
                    }
                  } catch (e: any) {
                    convPrompt += `\n\nEmail error: ${e.message}. Tell the user naturally.`;
                  }
                } else {
                  convPrompt += '\n\nThe user wants to reply but didn\'t specify who. Ask: "Who would you like me to reply to?"';
                }
              }
            }
            // ── Read email ──────────────────────────────────
            else if (isEmailQuery) {
              const canRead = await hasPermission(userId, 'email_read');
              const canWrite = await hasPermission(userId, 'email_write');

              if (canRead) {
                sendStatus('Checking your emails...');
                try {
                  const searchTerm = message.match(/(?:from|about|regarding|by)\s+["']?(\w[\w\s]*\w)["']?/i)?.[1];
                  const { emails, error: emailErr } = searchTerm
                    ? await searchEmails(userId, searchTerm, 5)
                    : await getInbox(userId, 8);

                  if (emailErr) {
                    convPrompt += `\n\nEmail error: ${emailErr}. Mention the error naturally and suggest reconnecting in Settings.`;
                  } else if (emails.length === 0) {
                    convPrompt += '\n\nNo emails found matching the query. Let the user know naturally.';
                  } else {
                    const canWrite = await hasPermission(userId, 'email_write');
                    const emailSummary = emails.map((e, i) => {
                      const fromAddr = e.from.match(/<(.+?)>/)?.[1] || e.from;
                      const fromName = e.from.replace(/<.*>/, '').trim();
                      return `${i + 1}. ${e.isUnread ? '[UNREAD] ' : ''}From: ${fromName} | Subject: ${e.subject} | ${e.date}\n   ${e.snippet}` +
                        (canWrite ? `\n   [reply:${fromAddr}:${e.subject}:Reply] [replyall:${fromAddr}:${e.subject}:Reply All]` : '');
                    }).join('\n');
                    convPrompt += `\n\nUSER'S EMAILS:\n${emailSummary}\n\nPresent each email naturally. IMPORTANT: Keep the [reply:...] and [replyall:...] tags EXACTLY as shown at the end of each email — they become clickable buttons in the UI. Do NOT modify or remove them.`;
                  }
                } catch (e: any) {
                  convPrompt += `\n\nCouldn't fetch emails: ${e.message}. Mention this naturally.`;
                }
              }
            }

            // Calendar queries
            if (isCalendarQuery) {
              const canRead = await hasPermission(userId, 'calendar_read');
              const canWrite = await hasPermission(userId, 'calendar_write');
              const isCreateRequest = /\b(schedule|create|book|set up|arrange).*(meeting|event|call|appointment)\b/i.test(message);
              const isFreeTimeRequest = /\b(free|available|open|slot)\b/i.test(message);

              if (isCreateRequest && !canWrite) {
                convPrompt += '\n\nThe user wants to create a calendar event but has NOT enabled "Create/Edit Events" permission. Politely tell them: "I can help plan that, but creating events is currently disabled. You can enable it in **Settings → Email & Calendar → AI Permissions**."\n';
              } else if (canRead) {
                sendStatus('Checking your calendar...');
                try {
                  if (isFreeTimeRequest) {
                    const targetDate = new Date(); // today by default
                    const { slots, error: freeErr } = await findFreeTime(userId, targetDate);
                    if (freeErr) {
                      convPrompt += `\n\nCalendar error: ${freeErr}. Mention naturally.`;
                    } else {
                      const slotText = slots.length > 0
                        ? slots.map(s => `${new Date(s.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} — ${new Date(s.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`).join('\n')
                        : 'No free slots found today';
                      convPrompt += `\n\nFREE TIME SLOTS TODAY:\n${slotText}\n\nPresent these naturally. Suggest the best slot.`;
                    }
                  } else {
                    const isUpcoming = /\b(week|upcoming|next|this week)\b/i.test(message);
                    const { events, error: calErr } = isUpcoming
                      ? await getUpcomingEvents(userId, 7)
                      : await getTodayEvents(userId);

                    if (calErr) {
                      convPrompt += `\n\nCalendar error: ${calErr}. Mention naturally.`;
                    } else if (events.length === 0) {
                      convPrompt += `\n\nNo ${isUpcoming ? 'upcoming' : "today's"} events found. Let the user know — "${isUpcoming ? 'Your week looks clear!' : 'Your calendar is free today!'}"`;
                    } else {
                      const canWrite = await hasPermission(userId, 'calendar_write');
                      const eventSummary = events.map((e, i) => {
                        const start = new Date(e.start);
                        const time = e.isAllDay ? 'All day' : start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                        const loc = (e.location || '').split(';')[0].replace(/https?:\/\/\S+/g, '').trim();
                        return `${i + 1}. ${time} — ${e.title}${loc ? ' @ ' + loc : ''}${e.attendees.length > 0 ? ' (with ' + e.attendees.slice(0, 3).join(', ') + ')' : ''}` +
                          (canWrite ? ` [event_modify:${e.id}:${e.title}:Modify]` : '');
                      }).join('\n');
                      convPrompt += `\n\n${isUpcoming ? 'UPCOMING' : "TODAY'S"} CALENDAR:\n${eventSummary}\n\nPresent each event naturally. IMPORTANT: Keep [event_modify:...] tags EXACTLY as shown — they become clickable buttons. Highlight important meetings and mention conflicts or tight gaps.`;
                    }
                  }
                } catch (e: any) {
                  convPrompt += `\n\nCouldn't fetch calendar: ${e.message}. Mention this naturally.`;
                }
              }
            }
          }
        }

        // ── Apply config fix (admin confirms or references a suggested setting change) ──
        // Detect fix confirmation — either from chat history context or direct "apply all fixes" command
        const prevHasFix = chatHistory.length > 0 && (chatHistory[0]?.content?.includes('context_limit') || chatHistory[0]?.content?.includes('max_output') || chatHistory[0]?.content?.includes('Would you like me to apply') || chatHistory[0]?.content?.includes('Fix All'));
        const hasDirectFixes = /apply all fixes:\s*(.+)/i.test(message); // from "Fix All" button
        const isApplyFix = (prevHasFix || hasDirectFixes) && (
          /\b(yes|confirm|apply|go ahead|update it|do it|fix it|change it|please do|ok do|sure|apply all)\b/i.test(message) ||
          /\b(context_limit|max_output_tokens|reducing|increase)\b/i.test(message)
        ) && req.user?.isAdmin;
        if (isApplyFix && req.user?.isAdmin && clientNumber) {
          try {
            const { setConfig } = require('../services/configService');
            const { clearAIConfigCache } = require('../services/aiConfigService');
            const { caterLog, getLogs } = require('../services/systemLogService');

            // Extract fixes from direct button command OR from previous AI message
            const directFixes = message.match(/apply all fixes:\s*(.+)/i)?.[1];
            const prevContent = chatHistory[0]?.content || '';

            const changes: string[] = [];

            // Parse direct fixes from button (format: key=value|key=value)
            if (directFixes) {
              for (const fix of directFixes.split('|')) {
                const [key, val] = fix.split('=');
                if (key && val) {
                  await setConfig(clientNumber, key.trim(), val.trim());
                  changes.push(`${key.trim()} → ${Number(val.trim()).toLocaleString()}`);
                }
              }
            }

            // Also parse from AI message if no direct fixes
            const valueMatch = !directFixes && prevContent.match(/context_limit_full.*?(\d{2,})/);
            const tokenMatch = !directFixes && prevContent.match(/max_output_tokens.*?(\d{3,})/);


            if (valueMatch) {
              const newVal = valueMatch[1];
              await setConfig(clientNumber, 'context_limit_full', newVal);
              changes.push(`context_limit_full → ${Number(newVal).toLocaleString()}`);
            }
            if (tokenMatch) {
              const newVal = tokenMatch[1];
              await setConfig(clientNumber, 'max_output_tokens_text', newVal);
              changes.push(`max_output_tokens_text → ${newVal}`);
            }

            if (changes.length > 0) {
              clearAIConfigCache();

              // Mark related logs as catered
              const openLogs: any[] = await getLogs({ status: 'open', limit: 20 });
              for (const log of openLogs) {
                if (log.category === 'data_truncation' || log.category === 'performance') {
                  await caterLog(log.id, userId, `Auto-fixed: ${changes.join(', ')}`);
                }
              }

              convPrompt += `\n\nCONFIG UPDATED SUCCESSFULLY:\n${changes.map(c => '- ' + c).join('\n')}\nRelated system logs have been marked as catered.\n\nTell the user: "Done! I've updated the settings: ${changes.join(', ')}. Related logs are now marked as resolved. The changes take effect on your next query."`;
            } else {
              convPrompt += '\n\nCould not determine what to change. Ask the user to specify.';
            }
          } catch (e: any) {
            convPrompt += `\n\nFailed to apply config change: ${e.message}`;
          }
        }

        // ── System logs query (admin only) ──────────────────
        const isLogQuery = /\b(system log|logs?|error log|issues?|warnings?|suggest fix)/i.test(message) && req.user?.isAdmin && !isApplyFix;
        if (isLogQuery && userId) {
          sendStatus('Fetching system logs...');
          try {
            const { getLogs, getLogSummary } = require('../services/systemLogService');
            const [logs, summary] = await Promise.all([getLogs({ limit: 15 }), getLogSummary()]);
            const logText = (logs as any[]).map((l: any, i: number) =>
              `${i+1}. [${l.level}] ${l.category} (Log #${l.id}) | ${l.message} | Status: ${l.status} | Seen: ${l.recurrence_count}x${l.suggestion ? '\n   Fix: ' + l.suggestion : ''}`
            ).join('\n');
            // Build fix actions list for auto-apply
            const fixableActions: string[] = [];
            for (const l of logs as any[]) {
              if (l.status === 'open' && l.suggestion && l.suggestion.includes('context_limit_full')) {
                const valMatch = l.suggestion.match(/at least ([\d,]+)/);
                if (valMatch) fixableActions.push(`context_limit_full=${valMatch[1].replace(/,/g, '')}`);
              }
            }
            const fixTag = fixableActions.length > 0 ? `\n\n[apply_fixes:${fixableActions.join('|')}:Fix All Issues]` : '';

            convPrompt += `\n\nSYSTEM LOGS (${summary.open} open, ${summary.recurring} recurring):\n${logText || 'No open issues — system is healthy!'}${fixTag}\n\nIMPORTANT: You DO have access to these logs from the database. Present them clearly with the fix suggestion for each. KEEP the [apply_fixes:...] tag EXACTLY as shown at the end — it becomes a clickable "Fix All" button. After showing all logs, add a brief note: "Click Fix All to apply all suggested changes automatically." NEVER say you don't have access to logs.`;
          } catch { convPrompt += '\n\nCould not fetch system logs.'; }
        }

        // ── Token consumption query (admin only) — generate widget report ──
        const isTokenQuery = /\b(token|consumption|cost|usage|billing|spend|mtd)\b/i.test(message) && req.user?.isAdmin;
        if (isTokenQuery && userId) {
          sendStatus('Fetching usage data...');
          try {
            const { getAllClientsUsage, getTopUsers, getProviderBreakdown, getTopQueries } = require('../services/tokenUsageService');
            const [clients, topUsers, providers, topQueries] = await Promise.all([
              getAllClientsUsage(30),
              getTopUsers(undefined, 30, 10),
              getProviderBreakdown(undefined, 30),
              getTopQueries(undefined, 30, 10),
            ]);

            const totalCost = (providers as any[]).reduce((s: number, p: any) => s + Number(p.cost_usd || 0), 0).toFixed(4);
            const totalTokens = (providers as any[]).reduce((s: number, p: any) => s + Number(p.total_tokens || 0), 0);
            const totalRequests = (providers as any[]).reduce((s: number, p: any) => s + Number(p.requests || 0), 0);

            // Build flat table data — one row per user with all details
            const allRows = (topUsers as any[]).map((u: any) => {
              // Find top queries for this user
              const userQueries = (topQueries as any[])
                .filter((q: any) => q.user_name === u.user_name)
                .slice(0, 5)
                .map((q: any, i: number) => `${i+1}. ${(q.query||'').slice(0,40)}: ${Number(q.total_tokens).toLocaleString()} tokens`)
                .join('<br>') || '-';

              return {
                client: u.client_number || '',
                user: u.user_name || '',
                email: u.email || '',
                provider: 'gemini-flash', // primary provider
                requests: Number(u.total_requests || 0),
                inputTokens: 0, // not available in aggregate — would need join
                outputTokens: 0,
                totalTokens: Number(u.total_tokens || 0),
                rate: '$0.075/1M in, $0.30/1M out',
                costUsd: Number(u.total_cost_usd || 0).toFixed(4),
                topQueries: userQueries,
              };
            });

            // Build flat table rows
            const tableRows = allRows.map(r =>
              '<tr data-client="' + r.client + '" data-user="' + r.user + '" data-provider="' + r.provider + '">' +
              '<td>' + r.client + '</td><td>' + r.user + '</td><td>' + r.email + '</td><td>' + r.provider + '</td>' +
              '<td>' + r.requests + '</td><td>' + r.totalTokens.toLocaleString() + '</td><td>' + r.rate + '</td>' +
              '<td>$' + r.costUsd + '</td><td style="font-size:11px;line-height:1.4">' + r.topQueries + '</td></tr>'
            ).join('');

            // Build CSV for download
            const csvLines = ['Client,User,Email,Provider,Requests,Total Tokens,Rate,Cost USD,Max Token Queries'];
            allRows.forEach(r => {
              const queries = r.topQueries.replace(/<br>/g, '; ').replace(/<[^>]+>/g, '');
              csvLines.push('"' + [r.client, r.user, r.email, r.provider, r.requests, r.totalTokens, r.rate, r.costUsd, queries].join('","') + '"');
            });
            const csvStr = csvLines.join('\\n');

            // Get unique values for filters
            const uniqueClients = [...new Set(allRows.map(r => r.client))];
            const uniqueUsers = [...new Set(allRows.map(r => r.user))];
            const uniqueProviders = [...new Set(allRows.map(r => r.provider))];

            const widgetHtml =
'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
'<h2 style="margin:0">Token Consumption Report</h2>' +
'<button onclick="downloadExcel()" style="padding:6px 16px;background:#cc6b4a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px">Download Excel</button>' +
'</div>' +
'<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;font-size:12px">' +
'<label>Client: <select id="fClient" onchange="applyFilter()"><option value="">All</option>' + uniqueClients.map(c => '<option>' + c + '</option>').join('') + '</select></label>' +
'<label>User: <select id="fUser" onchange="applyFilter()"><option value="">All</option>' + uniqueUsers.map(u => '<option>' + u + '</option>').join('') + '</select></label>' +
'<label>Provider: <select id="fProvider" onchange="applyFilter()"><option value="">All</option>' + uniqueProviders.map(p => '<option>' + p + '</option>').join('') + '</select></label>' +
'<label>Sort: <select id="fSort" onchange="applySort()"><option value="cost-desc">Cost (High→Low)</option><option value="cost-asc">Cost (Low→High)</option><option value="tokens-desc">Tokens (High→Low)</option><option value="requests-desc">Requests (High→Low)</option></select></label>' +
'</div>' +
'<table id="reportTable"><thead><tr><th>Client</th><th>User</th><th>Email</th><th>Provider</th><th>Requests</th><th>Total Tokens</th><th>Rate</th><th>Cost USD</th><th>Max Token Consumption</th></tr></thead>' +
'<tbody>' + (tableRows || '<tr><td colspan="9">No data</td></tr>') + '</tbody></table>' +
'<script>' +
'function applyFilter(){' +
'var c=document.getElementById("fClient").value,u=document.getElementById("fUser").value,p=document.getElementById("fProvider").value;' +
'document.querySelectorAll("#reportTable tbody tr").forEach(function(row){' +
'var show=(!c||row.dataset.client===c)&&(!u||row.dataset.user===u)&&(!p||row.dataset.provider===p);' +
'row.style.display=show?"":"none";});' +
'}' +
'function applySort(){' +
'var s=document.getElementById("fSort").value,tbody=document.querySelector("#reportTable tbody"),rows=Array.from(tbody.rows);' +
'rows.sort(function(a,b){var ci=s.includes("cost")?7:s.includes("tokens")?5:4;' +
'var av=parseFloat(a.cells[ci].textContent.replace(/[$,]/g,"")),bv=parseFloat(b.cells[ci].textContent.replace(/[$,]/g,""));' +
'return s.includes("asc")?av-bv:bv-av;});' +
'rows.forEach(function(r){tbody.appendChild(r);});' +
'}' +
'function downloadExcel(){' +
'var csv="' + csvStr + '";' +
'csv=csv.replace(/\\\\n/g,String.fromCharCode(10));' +
'var a=document.createElement("a");' +
'a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);' +
'a.download="token_consumption_report.csv";' +
'document.body.appendChild(a);a.click();document.body.removeChild(a);' +
'}' +
'</script>';

            const response = `Here's your token consumption report for the last 30 days.\n\n\`\`\`widget\n${widgetHtml}\n\`\`\`\n\n**Cost Reduction Suggestions:**\n- Current provider: **gemini-flash** ($0.075/1M input, $0.30/1M output) — this is already the cheapest Gemini option\n- Consider caching frequent queries (currently 5-min cache) — increase to 15-30 min for common dashboards\n- Use artifact templates for repeated dashboard queries — they skip AI generation entirely`;
            sendChunkDirect(response);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const meta = { type: 'meta', elapsed, outputTokens: Math.ceil(widgetHtml.length / 4), inputTokens: 0, totalTokens: Math.ceil(widgetHtml.length / 4), conversationId };
            res.write(`data: ${JSON.stringify(meta)}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
            return;
          } catch (e: any) {
            convPrompt += `\n\nToken usage fetch error: ${e.message}. Tell the user there was an issue fetching the data.`;
          }
        }

        if (chatHistory.length > 0) {
          convPrompt += '\n\nRecent conversation:\n' + chatHistory.reverse().map(m => {
            const maxLen = m.role === 'user' ? aiConfig.historyMaxCharsUser : aiConfig.historyMaxCharsAssistant;
            return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, maxLen)}`;
          }).join('\n');
        }
        await streamGemini(convPrompt, message, sendChunkDirect, true, 4096, true);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const meta = { type: 'meta', elapsed, outputTokens: Math.ceil(totalChars / 4), inputTokens: 50, totalTokens: Math.ceil(totalChars / 4) + 50, conversationId };
        res.write(`data: ${JSON.stringify(meta)}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        dedupCache.set(dedupKey, { chunks: responseChunks, meta, timestamp: Date.now() });
        // Extract memories from conversational messages too
        if (userId && clientNumber) {
          updateMemoryFromMessage(userId, clientNumber, message).catch(() => {});
        }
      } catch (error: any) {
        res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
      }
      res.end();
      return;
    }

    sendStatus('Searching data...');
    let context: string = '';
    let piiMapping: Record<string, string> = {};
    let topScore = 0;

    // ══════════════════════════════════════════════════════════
    // DATA RETRIEVAL — two paths based on data_source config:
    // 1. 'bigquery' → GCP BigQuery + Vertex AI (targeted chunks)
    // 2. 'drive'    → Google Drive markdown + local embeddings
    // Switch via Admin → Settings → Google Cloud Platform → data_source
    // ══════════════════════════════════════════════════════════
    const dataSource = process.env.DATA_SOURCE || 'drive';

    if (dataSource === 'bigquery') {
      // ── GCP PATH: BigQuery + Vertex AI retrieval ──────────
      sendStatus('Querying BigQuery...');
      try {
        const gcpResult = await retrieveFromGCP(message);
        context = gcpResult.context || '';
        topScore = gcpResult.chunkCount > 0 ? 0.9 : 0;
        const t2 = Date.now() - startTime;
        console.log(`[Pipeline] GCP retrieval: ${t2}ms | ${gcpResult.chunkCount} chunks, ${context.length} chars | filters: ${JSON.stringify(gcpResult.filters)}`);
      } catch (gcpErr: any) {
        console.error('[Pipeline] GCP retrieval failed, falling back to Drive:', gcpErr.message);
        context = '';
      }
    }

    if (dataSource === 'drive' || !context) {
      // ── DRIVE PATH: Local section retrieval (original) ────
      if (env.ragEnabled) {
        const sections = getCachedSections();
        const scope = intent.scope || message;
        const isBroad = ['dashboard', 'list', 'export', 'comparison'].includes(intent.type);
        const isDashboard = intent.type === 'dashboard';
        const maxSections = isBroad ? 2 : intent.type === 'quick_answer' ? 1 : 2;
        const maxChars = isBroad
          ? (FULL_CONTEXT_LIMITS[provider] || aiConfig.contextLimitFull)
          : (FAST_CONTEXT_LIMITS[provider] || aiConfig.contextLimitFast);

        sendStatus('Loading data...');
        context = await retrieveFullSections(scope, sections, maxSections, maxChars);
      if (clientDisconnected) return;
      topScore = context.length > 0 ? 0.9 : 0;

      const t2 = Date.now() - startTime;
      console.log(`[Pipeline] Step 2 (sections): ${t2}ms | ${maxSections} sections, ${context.length} chars for ${intent.type}`);

      // Fallback to TF-IDF if no sections matched
      if (!context) {
        console.log('[Chat] No sections matched, falling back to TF-IDF');
        context = searchIndex(message, sections);
      }

      // Sanitize
      context = sanitizeRetrievedContent(context);

      // ════════════════════════════════════════════════════════
      // PII masking — skip for dashboard/list/export (speed)
      // These show internal business data in widgets — masking
      // would break the widget and add 3-5s latency.
      // Keep for quick_answer/detailed_analysis (text responses).
      // ════════════════════════════════════════════════════════
      // PII masking disabled for internal company data — all users are authenticated employees
      // Enable only if data is being shared externally
      if (false && isPIIEnabled()) {
        sendStatus('Applying privacy filters...');
        const piiResult = await maskPIICached(context);
        if (clientDisconnected) return;
        context = piiResult.maskedText;
        piiMapping = piiResult.mapping;

        const t4 = Date.now() - startTime;
        console.log(`[Pipeline] Step 3 (PII): ${t4}ms | ${piiResult.entities.length} entities`);
      }
    } else {
      const sections = getCachedSections();
      context = searchIndex(message, sections);
      context = sanitizeRetrievedContent(context);
    }
    } // close dataSource === 'drive' block

    // ── Confidence / Abstention ──────────────────────────────
    let confidenceDirective = '';
    if (env.ragEnabled && topScore < LOW_CONFIDENCE_THRESHOLD && topScore > 0) {
      confidenceDirective =
        'IMPORTANT: The retrieved data has LOW relevance (confidence: ' + topScore.toFixed(2) + '). ' +
        'Do NOT guess. If data is insufficient, say so clearly.\n\n';
    }

    // ══════════════════════════════════════════════════════════
    // ── Build user profile directive ───────────────────────
    let profileDirective = '';
    if (userProfile) {
      const parts: string[] = [];
      if (userProfile.jobDescription) parts.push(`The user's JD: ${userProfile.jobDescription}.`);
      if (userProfile.aboutMe) parts.push(`About the user: ${userProfile.aboutMe}.`);
      if (userProfile.instructions) parts.push(`User's custom instructions: ${userProfile.instructions}`);
      if (parts.length > 0) {
        profileDirective = '── USER PROFILE ──\n' + parts.join('\n') +
          '\nUse this profile to prioritize relevant data and insights. ' +
          'Do NOT address the user by name or title. Do NOT reference their JD text.\n' +
          'ADAPTIVE TONE: Mirror the user\'s communication style. If they write formally, respond formally. ' +
          'If they write casually ("yo", "whats up", slang), respond casually. ' +
          'If they mix languages (Urdu/English), you can too. Match their energy and style naturally.\n\n';
      }
    }

    // ── Learned patterns from behavior ───────────────────
    let learningBlock = '';
    if (userLearnings.length > 0) {
      learningBlock = '── LEARNED PATTERNS ──\n' +
        userLearnings.join('\n') +
        '\nUse these silently.\n── END PATTERNS ──\n\n';
    }

    // ── Build conversation history for context ───────────
    let historyBlock = '';
    if (chatHistory.length > 0) {
      const turns = chatHistory.reverse().map(m => {
        const maxLen = m.role === 'user' ? aiConfig.historyMaxCharsUser : aiConfig.historyMaxCharsAssistant;
        return `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, maxLen)}`;
      }).join('\n');
      historyBlock = '── RECENT CONVERSATION ──\n' + turns +
        '\n── END CONVERSATION ──\nIMPORTANT: When user says "above", "those values", "that table", "show me in X format" — they are referring to YOUR LAST RESPONSE above. Use it as context.\n\n';
    }

    // Build prompt
    const intentDirective = buildIntentDirective(intent);
    // Data Summary: use BigQuery live counts when DATA_SOURCE=bigquery, else Drive index
    const dataSummary = dataSource === 'bigquery'
      ? await getDataSummaryFromBQ().catch(() => getDataSummary())
      : getDataSummary();

    // Response length control — tier settings take priority, then system_config fallback
    const isDashboardQuery = /dashboard|all projects|all risks|full list|overview|portfolio/i.test(message);
    const tierStyle = tierSettings?.responseStyle || 'moderate';
    const tierMaxWords = tierSettings?.maxResponseWords || 500;

    // Fallback to system_config only if no tier is configured
    const configLength = !tierSettings ? await getConfig(clientNumber || 'TMC-0001', 'response_length').catch(() => 'moderate') : tierStyle;
    const effectiveMaxWords = tierSettings ? tierMaxWords : Number(await getConfig(clientNumber || 'TMC-0001', 'max_response_words').catch(() => '500'));
    const userLength = userProfile?.tonePreference || configLength || 'moderate';

    const lengthRules: Record<string, string> = {
      brief: `Keep response under 150 words. 2-3 sentences max. No headers. Just answer directly.`,
      moderate: `Keep response under ${effectiveMaxWords} words. Use short paragraphs, bullets. Max 2-3 sections.`,
      detailed: `Provide detailed analysis up to ${effectiveMaxWords} words. Include relevant data points and recommendations.`,
      comprehensive: `Provide thorough analysis up to ${effectiveMaxWords} words. Include all relevant data points, sections, and recommendations.`,
    };

    // Tier format restrictions directive
    let tierFormatDirective = '';
    if (tierSettings) {
      const restrictions: string[] = [];
      if (!tierSettings.allowWidgets) restrictions.push('Do NOT generate ```widget or interactive HTML. Use only markdown text and tables.');
      if (!tierSettings.allowCharts) restrictions.push('Do NOT generate ```chart blocks. Describe data in text instead.');
      if (!tierSettings.allowTables) restrictions.push('Do NOT use markdown tables. Present data as bullet lists.');
      if (!tierSettings.allowExport) restrictions.push('Do NOT offer download/export options.');
      if (restrictions.length > 0) {
        tierFormatDirective = '── TIER FORMAT RESTRICTIONS ──\n' + restrictions.join('\n') + '\n── END ──\n\n';
      }
    }

    let brevityDirective = '';
    // Calculate output token budget so AI can self-adjust scope
    const outputBudget = (isDashboardQuery || isWidget) ? aiConfig.maxOutputTokensWidget : intent.type === 'quick_answer' ? aiConfig.maxOutputTokensQuick : aiConfig.maxOutputTokensText;

    if (isDashboardQuery && tierSettings?.allowWidgets !== false) {
      brevityDirective = `── RESPONSE LENGTH ──\nYour output token budget is ~${outputBudget} tokens. Plan accordingly:\n` +
        `- At ${outputBudget} tokens you can render ~10 table rows with stat cards and 2 charts.\n` +
        `- If the data has more rows than you can fit, show TOP 10 by default with a Show filter (Top 5/10/20/All).\n` +
        `- NEVER start rendering HTML you cannot finish. If data is too large, reduce scope BEFORE generating.\n` +
        `- If you cannot populate a stat card with a real number, DO NOT render it. Give a text answer instead.\n── END ──\n\n`;
    } else {
      brevityDirective = `── RESPONSE LENGTH ──\n${lengthRules[userLength as string] || lengthRules.moderate}\n── END ──\n\n`;
    }

    const systemPrompt = profileDirective + aiMemoryBlock + userMemoryBlock + contextBlock + learningBlock + historyBlock + confidenceDirective + brevityDirective + tierFormatDirective + dataSummary + intentDirective + buildSystemPrompt(context, getDataLastUpdated());
    const pipelineMs = Date.now() - startTime;
    console.log(`[Pipeline] Total pre-LLM: ${pipelineMs}ms | Context: ${context.length} chars | Provider: ${provider}`);

    // ══════════════════════════════════════════════════════════
    // OPTIMIZATION 5: Force Flash for dashboards/exports/lists
    // Gemini Pro is 3-5x slower for HTML-heavy widget generation
    // Flash generates equally good widgets much faster
    // ══════════════════════════════════════════════════════════
    const useFlash = (provider === 'gemini') && FORCE_FLASH_INTENTS.has(intent.type);
    if (useFlash) {
      console.log(`[Chat] Auto-routing to Flash for ${intent.type} (faster widget generation)`);
    }

    // Stream AI response with PII re-mapping
    const hasPII = Object.keys(piiMapping).length > 0;
    const unmasker = hasPII ? createStreamUnmasker(piiMapping) : null;

    const sendChunk = (text: string) => {
      if (clientDisconnected) return;
      if (unmasker) {
        const unmasked = unmasker.process(text);
        if (unmasked) { totalChars += unmasked.length; responseChunks.push(unmasked); res.write(`data: ${JSON.stringify({ type: 'chunk', content: unmasked })}\n\n`); }
      } else {
        sendChunkDirect(text);
      }
    };

    try {
      const matchedCount = context.split('## ').length - 1;
      sendStatus(`Found ${matchedCount} section${matchedCount !== 1 ? 's' : ''} · Generating response...`);

      let firstChunkReceived = false;
      const thinkingInterval = setInterval(() => {
        if (!firstChunkReceived && !clientDisconnected) sendStatus('Generating response...');
        else clearInterval(thinkingInterval);
      }, 4000);

      const wrappedSendChunk = (text: string) => {
        if (!firstChunkReceived) { firstChunkReceived = true; clearInterval(thinkingInterval); }
        sendChunk(text);
      };

      // LLM call — cap output tokens: all from system_config (Admin → Settings → AI Context & Tokens)
      const tierTokenCap = tierSettings?.maxOutputTokens || 0;
      const intentTokenCap = (isDashboardQuery || isWidget) ? aiConfig.maxOutputTokensWidget : intent.type === 'quick_answer' ? aiConfig.maxOutputTokensQuick : aiConfig.maxOutputTokensText;
      // Use tier cap for text responses (brief tiers get smaller output), but respect intent caps for widgets/dashboards
      const maxTokens = (tierTokenCap > 0 && !isWidget && !isDashboardQuery) ? Math.min(tierTokenCap, intentTokenCap) : intentTokenCap;
      // Use REST API with controlled thinking for ALL Gemini calls
      // Without this, Gemini 2.5 Flash spends 80%+ of output budget on invisible thinking
      const noThink = provider === 'gemini' || provider === 'gemini-flash';
      const timeoutMs = env.requestTimeoutMs;
      const llmCall = async () => {
        if (provider === 'gemini') {
          await streamGemini(systemPrompt, message, wrappedSendChunk, useFlash, maxTokens, noThink);
        } else if (provider === 'gemini-flash') {
          await streamGemini(systemPrompt, message, wrappedSendChunk, true, maxTokens, noThink);
        } else if (provider === 'groq') {
          await streamGroq(systemPrompt, message, wrappedSendChunk);
        } else if (provider === 'claude') {
          await streamClaude(systemPrompt, message, wrappedSendChunk);
        } else if (provider === 'openai') {
          await streamOpenAI(systemPrompt, message, wrappedSendChunk);
        } else {
          await streamOpenRouter(systemPrompt, message, wrappedSendChunk);
        }
      };

      await Promise.race([
        llmCall(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs / 1000}s`)), timeoutMs)),
        new Promise((_, reject) => { abortController.signal.addEventListener('abort', () => reject(new Error('Client disconnected'))); }),
      ]);

      // Flush PII buffer
      if (unmasker) {
        const remaining = unmasker.flush();
        if (remaining) { totalChars += remaining.length; responseChunks.push(remaining); if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'chunk', content: remaining })}\n\n`); }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const estimatedTokens = Math.ceil(totalChars / 4);
      const contextTokens = Math.ceil((systemPrompt.length + message.length) / 4);

      const meta = {
        type: 'meta', elapsed,
        outputTokens: estimatedTokens, inputTokens: contextTokens,
        totalTokens: estimatedTokens + contextTokens,
        dataLastUpdated: getDataLastUpdated(),
        conversationId: conversationId || undefined,
        pipelineMs,
      };

      if (!clientDisconnected) {
        res.write(`data: ${JSON.stringify(meta)}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      }

      dedupCache.set(dedupKey, { chunks: responseChunks, meta, timestamp: Date.now() });

      // Save history + audit + extract memories (all non-blocking)
      if (userId && conversationId) {
        addMessage({ clientNumber: clientNumber!, conversationId, role: 'assistant', content: responseChunks.join(''), provider, inputTokens: contextTokens, outputTokens: estimatedTokens, responseTimeMs: Math.round(parseFloat(elapsed) * 1000) }).catch(() => {});
      }
      logQuery({ clientNumber, userId, query: message, provider, chunksRetrieved: matchedCount, topScore, piiEntitiesCount: Object.keys(piiMapping).length, inputTokens: contextTokens, outputTokens: estimatedTokens, responseTimeMs: Math.round(parseFloat(elapsed) * 1000), intentType: intent.type }).catch(() => {});

      // Track token consumption (non-blocking)
      if (userId && clientNumber) {
        trackUsage(clientNumber, userId, provider, contextTokens, estimatedTokens, message, intent.type, Math.round(parseFloat(elapsed) * 1000)).catch(() => {});
      }

      // Log slow responses
      if (parseFloat(elapsed) > 20) {
        logSlowResponse(message, parseFloat(elapsed), provider, userId).catch(() => {});
      }

      // Background: extract memories + learn patterns (non-blocking)
      if (userId && clientNumber) {
        updateMemoryFromMessage(userId, clientNumber, message).catch(() => {});
        learnFromMessage(clientNumber, userId, message, intent.type).catch(() => {});
      }

      // Artifact system removed — AI generates widgets directly from data context

    } catch (error: any) {
      if (error.message === 'Client disconnected') {
        console.log('[Chat] Aborted — client disconnected');
      } else {
        console.error(`AI streaming error (${provider}):`, error.message);
        if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
        logQuery({ clientNumber, userId, query: message, provider, responseTimeMs: Date.now() - startTime, intentType: intent?.type, error: error.message }).catch(() => {});
        logError('api_error', 'chatController', `AI streaming error (${provider}): ${error.message}`, `Prompt: ${message.slice(0, 100)}`).catch(() => {});
      }
    }

    if (!clientDisconnected) res.end();
  } catch (outerError: any) {
    console.error('Chat endpoint error:', outerError.message);
    if (!res.headersSent) res.status(500).json({ error: outerError.message });
    else if (!clientDisconnected) res.end();
  }
}
