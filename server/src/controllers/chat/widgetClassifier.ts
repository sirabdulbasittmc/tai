import createLogger from '../../utils/logger';
import { env } from '../../config/env';
import { WidgetClassification } from './types';

const log = createLogger('chat:widget');

/**
 * LLM-based widget classifier.
 * Uses Gemini Flash to classify any query phrasing -> widget type.
 * ~100 tokens per call, ~50ms, essentially free at scale.
 */
export async function classifyWidgetIntent(userQuery: string): Promise<WidgetClassification> {
  const fallback: WidgetClassification = { widget_type: null, skip_data: false, domain: null };
  if (!env.geminiApiKey) return fallback;

  try {
    // Use REST API with thinkingBudget:0 — SDK wastes all tokens on thinking
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.geminiApiKey}`;
    const prompt = `Classify this query for TMC AI. Return ONLY a JSON object.
Query: "${userQuery}"
Return: {"widget_type":"dashboard|table|chart|null","skip_data":true/false,"domain":"deals|projects|pipeline|employees|accounts|okr|competency|null"}

widget_type — 4 values only:
- "dashboard": user wants a VISUAL OVERVIEW with stat cards + table (dashboard, overview, summary of many items, portfolio, all X)
- "table": user wants a LIST or DIRECTORY (list all X, show all X, employee directory, all deals)
- "chart": user wants a VISUAL COMPARISON (compare X vs Y over time, trend, breakdown by category)
- null: everything else — specific question, count, lookup, analysis, conversational

STRICT RULES:
- "dashboard" = broad overview with numbers at top + details below
- null = specific question about ONE entity, count query, "highest/lowest", "suggest target", follow-up
- skip_data=true = greetings, weather, jokes, currency rates, non-TMC topics

Examples:
"show me sales dashboard" → {"widget_type":"dashboard","skip_data":false,"domain":"deals"}
"project portfolio overview" → {"widget_type":"dashboard","skip_data":false,"domain":"projects"}
"show me all risks" → {"widget_type":"dashboard","skip_data":false,"domain":"projects"}
"competency dashboard" → {"widget_type":"dashboard","skip_data":false,"domain":"competency"}
"list all employees" → {"widget_type":"table","skip_data":false,"domain":"employees"}
"show me org chart" → {"widget_type":"dashboard","skip_data":false,"domain":"employees"}
"compare revenue by year" → {"widget_type":"chart","skip_data":false,"domain":"deals"}
"highest deal of 2024" → {"widget_type":null,"skip_data":false,"domain":"deals"}
"how many projects" → {"widget_type":null,"skip_data":false,"domain":"projects"}
"status of SECMC" → {"widget_type":null,"skip_data":false,"domain":"projects"}
"suggest sales target" → {"widget_type":null,"skip_data":false,"domain":"deals"}
"hi good morning" → {"widget_type":null,"skip_data":true,"domain":null}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 150, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      log.error('WidgetClassifier API error', { status: response.status });
      return fallback;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.filter((p: any) => !p.thought).map((p: any) => p.text).join('') || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn('WidgetClassifier: no JSON in response', { responsePreview: text.slice(0, 100) });
      return fallback;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    log.info('WidgetClassifier result', { query: userQuery.slice(0, 50), type: parsed.widget_type, domain: parsed.domain, skipData: parsed.skip_data });
    return { ...fallback, ...parsed };
  } catch (err: any) {
    if (err.name === 'AbortError') log.warn('WidgetClassifier timed out after 3s');
    else log.error('WidgetClassifier failed', { error: err.message });
    return fallback;
  }
}
