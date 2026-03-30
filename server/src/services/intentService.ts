import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';

export interface Intent {
  type: 'quick_answer' | 'detailed_analysis' | 'dashboard' | 'export' | 'list' | 'comparison' | 'action' | 'conversational';
  format: 'text' | 'table' | 'widget' | 'excel' | 'csv' | 'pdf' | 'chart' | 'hierarchy';
  detail: 'brief' | 'moderate' | 'comprehensive';
  tone: 'formal' | 'casual' | 'executive';
  scope: string;
  followUp: boolean;
}

const CLASSIFY_PROMPT = `You are an intent classifier for a business AI assistant. Return a JSON object.

{
  "type": "quick_answer" | "detailed_analysis" | "dashboard" | "export" | "list" | "comparison" | "action" | "conversational",
  "format": "text" | "table" | "widget" | "chart" | "hierarchy" | "excel" | "csv" | "pdf",
  "detail": "brief" | "moderate" | "comprehensive",
  "tone": "formal" | "casual" | "executive",
  "scope": "short description of data needed",
  "followUp": true/false
}

TYPE RULES:
- "dashboard": ONLY when user explicitly says "dashboard", "interactive overview", "portfolio view", or "status report"
- "quick_answer": factual questions — "how many?", "who is?", "what's the total?", "highest deal?"
- "detailed_analysis": "tell me about", "analyze", "explain", "insights", "follow up on", "details on [person/entity]"
- "list": "list all", "show all", "give me list of", "names of"
- "comparison": "compare", "vs", "difference between"
- "conversational": ONLY for greetings, thanks, personal chat, weather, news, jokes. NEVER for business data questions. If the query mentions deals, projects, revenue, employees, clients, risks, or any business term — it is NOT conversational.
- "export": explicitly asks for file download
- "action": create, update, schedule, send

FORMAT RULES — THIS IS CRITICAL:
- "widget": ONLY for broad overview dashboards of MULTIPLE items (all projects, all sales, org chart, all risks). The user wants an interactive visual with filters and charts.
- "text": For EVERYTHING ELSE — analysis, insights, follow-ups, questions about specific entities, recommendations, explanations. This is the DEFAULT.
- "table": For simple lists/rankings without interactivity
- "chart": For single visual comparison
- "hierarchy": For org charts/tree structures specifically

WHEN TO USE "widget" vs "text" — EXAMPLES:
WIDGET: "show project dashboard" ✓ (broad overview, multiple projects)
WIDGET: "sales revenue dashboard" ✓ (broad overview, all sales)
WIDGET: "show org chart" ✓ (visual hierarchy)
WIDGET: "risk dashboard" ✓ (broad overview, all risks)
TEXT: "follow up on Imran Rehmani's deals" ✗ (specific person, needs analysis)
TEXT: "tell me about PGC project" ✗ (specific entity, needs analysis)
TEXT: "highest deal in 2024" ✗ (specific factual answer)
TEXT: "what are the risks in project 809?" ✗ (specific project analysis)
TEXT: "how is the Shan Foods project going?" ✗ (specific project status)
TEXT: "analyze revenue trend" ✗ (analytical insight, not a dashboard)
TEXT: "which projects need attention?" ✗ (insight/recommendation, not overview)
TEXT: "who reports to the CEO?" ✗ (specific factual answer)

KEY PRINCIPLE: If the query is about a SPECIFIC entity (person, project, client, deal) → format is "text".
Only use "widget" for BROAD overviews of ALL items in a category.

Return ONLY the JSON object.`;

export async function classifyIntent(query: string, userFormatHints?: string): Promise<Intent> {
  const defaultIntent: Intent = {
    type: 'detailed_analysis',
    format: 'text',
    detail: 'moderate',
    tone: 'formal',
    scope: query,
    followUp: false,
  };

  if (!env.geminiApiKey) return defaultIntent;

  try {
    const genAI = new GoogleGenerativeAI(env.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { maxOutputTokens: 256 },
    });

    // Race against 3s timeout — if intent takes too long, use default
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
    const today = new Date().toISOString().split('T')[0]; // e.g., 2026-03-30
    const hints = userFormatHints ? `\nUSER PREFERENCES (learned from past interactions):\n${userFormatHints}\n` : '';
    const classify = model.generateContent(`Today's date: ${today}\nQuery: "${query}"\n${hints}\n${CLASSIFY_PROMPT}`);
    const result = await Promise.race([classify, timeout]);

    if (!result) {
      console.log('[Intent] Timed out after 4s, using default');
      return defaultIntent;
    }

    const text = result.response.text().trim();

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return defaultIntent;

    const parsed = JSON.parse(jsonMatch[0]);
    return { ...defaultIntent, ...parsed };
  } catch (err: any) {
    console.error('[Intent] Classification failed:', err.message);
    return defaultIntent;
  }
}

/**
 * Generates a response directive based on the classified intent.
 * This is prepended to the system prompt to guide the LLM's response style.
 */
export function buildIntentDirective(intent: Intent): string {
  const directives: string[] = [];

  // Response type
  switch (intent.type) {
    case 'quick_answer':
      directives.push('The user wants a SHORT, DIRECT answer. Give the answer in 1-3 sentences maximum. No headers, no bullet lists, no charts, no widgets. Just answer the question directly like a human would in conversation.');
      break;
    case 'list':
      directives.push('The user wants a CLEAN LIST or TABLE. Present the data in a well-formatted markdown table. Do NOT generate ```widget or HTML — use markdown tables only. Do NOT add analysis or lengthy introductions. Just the data, neatly formatted.');
      break;
    case 'export':
      directives.push(`The user wants to DOWNLOAD data as ${intent.format.toUpperCase()}. Create a \`\`\`widget with a complete HTML table of the requested data AND a download button. Include this JavaScript for the download button:\n<button onclick="downloadCSV()">Download ${intent.format.toUpperCase()}</button>\n<script>\nfunction downloadCSV(){const rows=document.querySelectorAll('table tr');let csv=[];rows.forEach(r=>{const cols=r.querySelectorAll('td,th');const row=[];cols.forEach(c=>row.push('"'+c.textContent.replace(/"/g,'""')+'"'));csv.push(row.join(','))});const blob=new Blob([csv.join('\\n')],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='${intent.scope.replace(/[^a-z0-9]/gi, '_')}.csv';a.click()}\n</script>\nInclude ALL rows of the requested data in the table. The table must be fully populated with real data.`);
      break;
    case 'dashboard':
      directives.push(
        'The user wants an INTERACTIVE DASHBOARD.\n' +
        'YOUR ENTIRE RESPONSE MUST BE: one sentence of insight (max 20 words) followed IMMEDIATELY by ```widget.\n' +
        'ABSOLUTELY NO paragraphs, NO bullet lists, NO headers, NO "What needs attention" sections before the widget.\n' +
        'ALL analysis goes INSIDE the widget as stat cards, badges, and visual elements.\n' +
        'Widget must include: stat cards → filter bar → data table (max 10 rows) → charts.\n' +
        'All filters must update ALL components (table + charts).\n' +
        'Embed ALL data directly in the HTML — use a JS array of objects, then render table rows and charts from it.'
      );
      break;
    case 'comparison':
      directives.push(
        'The user wants a COMPARISON. You MUST include:\n' +
        '1. A brief summary paragraph highlighting the key differences\n' +
        '2. A markdown table with the detailed breakdown by year\n' +
        '3. Analysis of the key differences and growth trends\n' +
        '4. Suggested targets based on the trend\n' +
        'Do NOT generate ```widget or HTML. Use only markdown text and tables. Do NOT mix currencies — separate PKR and USD.'
      );
      break;
    case 'conversational':
      directives.push('The user is being conversational. Respond naturally and briefly like a helpful colleague. If they say hi, greet them back warmly. If they ask what you can do, give a brief overview of your capabilities.');
      break;
    case 'action':
      directives.push('The user wants an ACTION performed. If the action is within your capabilities (generating reports, analyzing data), do it. If not (sending emails, updating systems), explain what you can do instead and suggest alternatives.');
      break;
    case 'detailed_analysis':
    default:
      directives.push('The user wants DETAILED ANALYSIS. Provide a comprehensive executive-quality response with structured sections, key insights, and strategic implications. Do NOT generate ```widget or HTML — use only markdown text, tables, and bullet points. Keep response under 1500 words.');
      break;
  }

  // Format-specific directives
  if (intent.format === 'hierarchy') {
    directives.push('Present the data as a VISUAL HIERARCHY using a ```widget with nested collapsible tree structure. Use the org-tree CSS classes.');
  }
  if (intent.format === 'chart') {
    directives.push('Include a ```chart visualization showing the key data points graphically.');
  }

  // Detail level
  switch (intent.detail) {
    case 'brief':
      directives.push('Keep response SHORT — maximum 5-6 lines. No lengthy introductions or strategic takeaways.');
      break;
    case 'comprehensive':
      directives.push('Be THOROUGH — include all relevant data points, cover all entities/items, and provide strategic implications.');
      break;
  }

  // Tone
  switch (intent.tone) {
    case 'casual':
      directives.push('Use a FRIENDLY, conversational tone. No formal headers or corporate language.');
      break;
    case 'executive':
      directives.push('Use EXECUTIVE tone — crisp, authoritative, focused on business impact and decisions.');
      break;
  }

  // Follow-up
  if (intent.followUp) {
    directives.push('This appears to be a FOLLOW-UP question. Reference the previous context and build on it rather than starting fresh.');
  }

  return '── RESPONSE DIRECTIVE ──\n' + directives.join('\n') + '\n── END DIRECTIVE ──\n\n';
}
