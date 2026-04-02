import createLogger from '../../utils/logger';
import { env } from '../../config/env';
import { streamGemini, ChatTurn } from '../../services/geminiService';
import { shouldUseDomainLLM, streamDomainLLM } from '../../services/domainLLMService';
import { streamClaude } from '../../services/claudeService';
import { streamOpenAI } from '../../services/openaiService';
import { streamOpenRouter } from '../../services/openrouterService';
import { streamGroq } from '../../services/groqService';
import { Intent } from '../../services/intentService';
import { TierSettings } from '../../services/tierService';
import { createStreamUnmasker } from '../../pipeline/piiService';

const log = createLogger('chat:llm');

// Intent types that should use Flash even if user selected Pro (much faster for widgets)
const FORCE_FLASH_INTENTS = new Set(['quick_answer', 'list', 'dashboard', 'export', 'conversational']);

export interface LLMRouterParams {
  systemPrompt: string;
  message: string;
  provider: string;
  clientNumber?: string;    // Phase 7: needed for domain LLM traffic flag
  intent: Intent;
  tierSettings: TierSettings | null;
  aiConfig: { maxOutputTokensWidget: number; maxOutputTokensQuick: number; maxOutputTokensText: number };
  conversationTurns: ChatTurn[];
  piiMapping: Record<string, string>;
  isWidget: boolean;
  isDashboardQuery: boolean;
  clientDisconnected: boolean;
  abortSignal: AbortSignal;
  onChunk: (text: string) => void;
  onStatus: (text: string) => void;
}

/**
 * Route the LLM call to the correct provider with proper token limits and PII handling.
 * Returns { totalChars, responseChunks }.
 */
export async function routeToLLM(params: LLMRouterParams): Promise<{ totalChars: number; responseChunks: string[] }> {
  const {
    systemPrompt, message, provider, clientNumber, intent, tierSettings, aiConfig,
    conversationTurns, piiMapping, isWidget, isDashboardQuery,
    clientDisconnected, abortSignal, onChunk, onStatus,
  } = params;

  // ── Phase 7: Domain LLM traffic routing ──────────────────
  if (clientNumber) {
    const useDomainLLM = await shouldUseDomainLLM(clientNumber).catch(() => false);
    if (useDomainLLM) {
      log.info('Routing to domain LLM', { clientNumber });
      onStatus('Thinking with domain expertise...');
      try {
        await streamDomainLLM({ systemPrompt, message, onChunk, abortSignal });
        return { totalChars: 0, responseChunks: [] };
      } catch (e: any) {
        log.warn('Domain LLM failed, falling back to frontier', { error: e.message });
      }
    }
  }

  // ── Force Flash for dashboards/exports/lists ──────────
  const useFlash = (provider === 'gemini') && FORCE_FLASH_INTENTS.has(intent.type);
  if (useFlash) {
    log.info('Auto-routing to Flash', { intentType: intent.type });
  }

  // ── PII re-mapping ──────────────────────────────────────
  const hasPII = Object.keys(piiMapping).length > 0;
  const unmasker = hasPII ? createStreamUnmasker(piiMapping) : null;

  let totalChars = 0;
  const responseChunks: string[] = [];

  const sendChunk = (text: string) => {
    if (clientDisconnected) return;
    if (unmasker) {
      const unmasked = unmasker.process(text);
      if (unmasked) { totalChars += unmasked.length; responseChunks.push(unmasked); }
    } else {
      totalChars += text.length;
      responseChunks.push(text);
    }
    onChunk(text);
  };

  // ── Status heartbeat ────────────────────────────────────
  const matchedCount = (systemPrompt + message).split('## ').length - 1;
  onStatus(`Found ${matchedCount} section${matchedCount !== 1 ? 's' : ''} · Generating response...`);

  let firstChunkReceived = false;
  const thinkingInterval = setInterval(() => {
    if (!firstChunkReceived && !clientDisconnected) onStatus('Generating response...');
    else clearInterval(thinkingInterval);
  }, 4000);

  const wrappedSendChunk = (text: string) => {
    if (!firstChunkReceived) { firstChunkReceived = true; clearInterval(thinkingInterval); }
    sendChunk(text);
  };

  // ── Token limits ────────────────────────────────────────
  const tierTokenCap = tierSettings?.maxOutputTokens || 0;
  const intentTokenCap = (isDashboardQuery || isWidget) ? aiConfig.maxOutputTokensWidget : intent.type === 'quick_answer' ? aiConfig.maxOutputTokensQuick : aiConfig.maxOutputTokensText;
  const maxTokens = (tierTokenCap > 0 && !isWidget && !isDashboardQuery) ? Math.min(tierTokenCap, intentTokenCap) : intentTokenCap;
  const noThink = provider === 'gemini' || provider === 'gemini-flash';
  const history = conversationTurns.length > 0 ? conversationTurns : undefined;

  const llmCall = async () => {
    if (provider === 'gemini') {
      await streamGemini(systemPrompt, message, wrappedSendChunk, useFlash, maxTokens, noThink, history);
    } else if (provider === 'gemini-flash') {
      await streamGemini(systemPrompt, message, wrappedSendChunk, true, maxTokens, noThink, history);
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

  const timeoutMs = env.requestTimeoutMs;
  await Promise.race([
    llmCall(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs / 1000}s`)), timeoutMs)),
    new Promise((_, reject) => { abortSignal.addEventListener('abort', () => reject(new Error('Client disconnected'))); }),
  ]);

  // Flush PII buffer
  if (unmasker) {
    const remaining = unmasker.flush();
    if (remaining) { totalChars += remaining.length; responseChunks.push(remaining); onChunk(remaining); }
  }

  clearInterval(thinkingInterval);
  return { totalChars, responseChunks };
}
