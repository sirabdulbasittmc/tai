import { Response } from 'express';
import createLogger from '../../utils/logger';
import { env } from '../../config/env';
import { getDataSummaryFromBQ } from '../../connectors/BigQueryConnector';
import { getPKRperUSD } from '../../services/currencyService';
import { addMessage } from '../../services/chatHistoryService';
import { trackUsage } from '../../services/tokenUsageService';
import { sendChunkDirect, sendMeta } from './sseHelpers';

const log = createLogger('chat:widget');

// Dynamic dashboard schema — AI decides the structure based on query + data
const DYNAMIC_DASHBOARD_SCHEMA = `{
  "widget_type": "dashboard",
  "title": "descriptive title",
  "summary_cards": [
    { "label": "card label", "value": "formatted value e.g. PKR 234.1M or 47 or 85%", "unit": "PKR/USD/count/%" }
  ],
  "primary_table": {
    "title": "table title",
    "columns": ["Col1", "Col2", "Col3"],
    "rows": [["val1", "val2", "val3"]]
  },
  "secondary_table": null,
  "insights": ["key insight 1", "key insight 2"]
}`;

/**
 * Generate and send a structured widget (dashboard/table/chart) via SSE.
 * Returns true if widget was generated, false to fall through to normal flow.
 */
export async function handleWidget(
  widgetType: string,
  message: string,
  context: string,
  provider: string,
  res: Response,
  clientDisconnected: boolean,
  responseChunks: string[],
  startTime: number,
  userId: number | undefined,
  clientNumber: string | undefined,
  conversationId: number | undefined,
): Promise<boolean> {
  try {
    const onStatus = (text: string) => {
      if (!clientDisconnected) res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
    };
    onStatus('Building dashboard...');

    const widgetSummary = await getDataSummaryFromBQ().catch(() => '');
    const pkrPerUsd = await getPKRperUSD().catch(() => 278);
    const widgetPrompt = `You are a data analyst for TallyMarks Consulting (TMC).
The user asked: "${message}"

Create a ${widgetType} from the TMC data below. Decide what metrics, tables and insights make sense.
Return ONLY valid JSON matching this flexible schema:
${DYNAMIC_DASHBOARD_SCHEMA}

Rules:
- summary_cards: 3-6 cards max. Format values nicely: "PKR 234.1M", "$1.25M", "47", "85.3%"
- primary_table: always include, max 20 rows. Choose the most relevant columns (5-7 max).
- secondary_table: only if genuinely useful (e.g. breakdown by category). Null if not needed.
- insights: 2-3 bullets highlighting key findings, anomalies, or recommendations.
- Currency conversion: 1 USD = ${pkrPerUsd} PKR (live rate). Show both currencies where relevant.
- For summary totals, use EXACT counts from DATA SUMMARY below (not from context rows which are a subset).
- Progress values: format as percentage string "85.3%"
- Dates: keep original format from data

${widgetSummary}
CONTEXT:
${context.slice(0, 20000)}`;

    // Use REST API with responseMimeType to force valid JSON (not streaming)
    const widgetUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.geminiApiKey}`;
    const widgetResponse = await fetch(widgetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: widgetPrompt }] }],
        generationConfig: {
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!widgetResponse.ok) throw new Error(`Gemini API error: ${widgetResponse.status}`);
    const widgetResult = await widgetResponse.json();
    const jsonText = widgetResult?.candidates?.[0]?.content?.parts?.filter((p: any) => !p.thought).map((p: any) => p.text).join('') || '';
    if (!jsonText) throw new Error('Empty JSON response from Gemini');

    const widgetData = JSON.parse(jsonText.replace(/```json|```/g, '').trim());

    // Send widget as a special SSE message
    const briefText = `Here's your ${widgetType.replace(/_/g, ' ')}.`;
    sendChunkDirect(res, clientDisconnected, responseChunks, briefText);
    if (!clientDisconnected) {
      res.write(`data: ${JSON.stringify({ type: 'widget_data', widget: widgetData })}\n\n`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const estimatedTokens = Math.ceil(jsonText.length / 4);
    const contextTokens = Math.ceil(widgetPrompt.length / 4);
    const meta = { type: 'meta', elapsed, outputTokens: estimatedTokens, inputTokens: contextTokens, totalTokens: estimatedTokens + contextTokens, conversationId };
    sendMeta(res, clientDisconnected, meta);

    // Save to history
    if (userId && conversationId) {
      addMessage({ clientNumber: clientNumber!, conversationId, role: 'user', content: message }).catch(() => {});
      addMessage({ clientNumber: clientNumber!, conversationId, role: 'assistant', content: briefText + '\n```widget_json\n' + jsonText.slice(0, 500) + '\n```', provider }).catch(() => {});
    }
    if (userId && clientNumber) {
      trackUsage(clientNumber, userId, provider, contextTokens, estimatedTokens, message, 'dashboard', Math.round(parseFloat(elapsed) * 1000)).catch(() => {});
    }

    log.info('Widget generated', { widgetType, elapsed, outputTokens: estimatedTokens });
    return true;
  } catch (widgetErr: any) {
    log.error('Widget JSON extraction failed', { widgetType, error: widgetErr.message });
    return false; // Fall through to normal AI generation
  }
}
