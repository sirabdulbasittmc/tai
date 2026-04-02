// ═════════════════════════════════════════════════════════════════════════════
// domainLLMService.ts — Phase 7: Fine-tuned Domain LLM routing
//
// Traffic is shifted progressively to the domain LLM via feature flag:
//   ff_domain_llm_traffic_pct = 0   → all traffic on frontier models (safe default)
//   ff_domain_llm_traffic_pct = 10  → 10% shadow mode (compare outputs)
//   ff_domain_llm_traffic_pct = 50  → A/B test
//   ff_domain_llm_traffic_pct = 90  → domain LLM primary, frontier as fallback
//
// Model staging:
//   Stage A (initial): Llama 3.1 8B on 2x NVIDIA L4  (~$1,024/mo)
//   Stage B (scale):   Llama 3.1 70B on 2x A100 80GB (~$9,360/mo) — when 10+ enterprise clients
//
// Go/no-go: 8B must outperform GPT-4o on 60%+ of domain queries before traffic shift.
// ═════════════════════════════════════════════════════════════════════════════

import { getNumericFlag, getFlagValue } from './featureFlagService';
import createLogger from '../utils/logger';

const log = createLogger('domainLLM');

// ─── Check if domain LLM should handle this request ──────────────────────────

export async function shouldUseDomainLLM(clientNumber: string): Promise<boolean> {
  const trafficPct = await getNumericFlag(clientNumber, 'ff_domain_llm_traffic_pct', 0);
  if (trafficPct <= 0) return false;
  if (trafficPct >= 100) return true;
  return Math.random() * 100 < trafficPct;
}

// ─── Route to domain LLM ─────────────────────────────────────────────────────

interface DomainLLMOptions {
  systemPrompt: string;
  message: string;
  onChunk: (text: string) => void;
  abortSignal?: AbortSignal;
}

export async function streamDomainLLM(opts: DomainLLMOptions): Promise<void> {
  const endpoint = process.env.DOMAIN_LLM_ENDPOINT;
  if (!endpoint) {
    throw new Error('DOMAIN_LLM_ENDPOINT not configured');
  }

  const model = process.env.DOMAIN_LLM_MODEL || 'llama-3.1-8b-instruct';

  log.info('Routing to domain LLM', { model });

  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DOMAIN_LLM_API_KEY || ''}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user',   content: opts.message },
      ],
      stream: true,
      max_tokens: 2048,
      temperature: 0.7,
    }),
    signal: opts.abortSignal,
  });

  if (!response.ok) {
    throw new Error(`Domain LLM HTTP ${response.status}: ${await response.text().catch(() => '')}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        const chunk = json.choices?.[0]?.delta?.content;
        if (chunk) opts.onChunk(chunk);
      } catch {
        // skip malformed SSE line
      }
    }
  }
}

// ─── Benchmark: compare domain LLM vs frontier ───────────────────────────────

export async function isBenchmarkMet(): Promise<{ met: boolean; domainScore: number; frontierScore: number }> {
  // Read benchmark results from system_config (set by the evaluation job)
  // Go/no-go: domain LLM must win on 60%+ of test queries
  const domainScore = parseFloat(process.env.DOMAIN_LLM_BENCHMARK_SCORE || '0');
  const frontierScore = parseFloat(process.env.FRONTIER_BENCHMARK_SCORE || '1');
  const met = domainScore >= 0.6 * frontierScore;
  return { met, domainScore, frontierScore };
}
