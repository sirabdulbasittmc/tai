import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { PIIEntity, PIIMask } from '../types';

/**
 * AI-powered PII detection and masking — no hardcoded patterns.
 * Uses Gemini Flash to detect entities, then masks before sending to AI.
 * Re-maps placeholders back to real values in the response.
 *
 * Flow:
 *   1. Context text → Gemini Flash NER → entity list
 *   2. Replace entities with placeholders → masked text
 *   3. Masked text → main AI → response with placeholders
 *   4. Replace placeholders → final response with real values
 */

const NER_PROMPT = `You are a PII (Personally Identifiable Information) entity extractor. Analyze the text below and extract ALL entities that could identify a person, organization, or contain sensitive business data.

Return ONLY a JSON array of objects, each with:
- "type": category (PERSON, ORG, EMPLOYEE_ID, PHONE, EMAIL, AMOUNT, ADDRESS, PROJECT_CODE, ACCOUNT_NUMBER, DATE_OF_BIRTH, NATIONAL_ID)
- "value": the exact text as it appears

Rules:
- Extract person names (full names, first names that clearly refer to a person in context)
- Extract organization/company names (client names, vendor names)
- Extract employee IDs, project codes, account numbers
- Extract monetary amounts with currency
- Extract emails, phone numbers, national IDs
- Do NOT extract generic terms, job titles, department names, or technology names (like "SAP", "Qlik")
- Do NOT extract dates unless they are dates of birth
- Do NOT extract percentages or general metrics
- If no PII found, return empty array []

Return ONLY the JSON array, no explanation.

TEXT:
`;

let piiEnabled = true;

export function setPIIEnabled(enabled: boolean): void {
  piiEnabled = enabled;
}

export function isPIIEnabled(): boolean {
  return piiEnabled;
}

/**
 * Detect and mask PII in text using AI-based NER.
 * Returns masked text + mapping for re-identification.
 */
export async function maskPII(text: string): Promise<PIIMask> {
  if (!piiEnabled || !env.geminiApiKey) {
    return { maskedText: text, entities: [], mapping: {} };
  }

  try {
    const entities = await detectEntities(text);

    if (entities.length === 0) {
      return { maskedText: text, entities: [], mapping: {} };
    }

    // Build placeholders and mapping
    const typeCounters: Record<string, number> = {};
    const mapping: Record<string, string> = {};
    const piiEntities: PIIEntity[] = [];

    // Sort entities by length descending to replace longest first (prevents partial replacements)
    entities.sort((a, b) => b.value.length - a.value.length);

    // Deduplicate by value
    const seen = new Set<string>();
    for (const entity of entities) {
      const normalizedValue = entity.value.trim();
      if (seen.has(normalizedValue.toLowerCase())) continue;
      seen.add(normalizedValue.toLowerCase());

      typeCounters[entity.type] = (typeCounters[entity.type] || 0) + 1;
      const placeholder = `[${entity.type}_${typeCounters[entity.type]}]`;

      mapping[placeholder] = normalizedValue;
      piiEntities.push({
        type: entity.type,
        value: normalizedValue,
        placeholder,
      });
    }

    // Replace all occurrences in text
    let maskedText = text;
    for (const entity of piiEntities) {
      // Escape special regex characters in the value
      const escaped = entity.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      maskedText = maskedText.replace(new RegExp(escaped, 'gi'), entity.placeholder);
    }

    console.log(`[PII] Masked ${piiEntities.length} entities (${Object.keys(typeCounters).map(t => `${t}:${typeCounters[t]}`).join(', ')})`);

    return { maskedText, entities: piiEntities, mapping };
  } catch (err: any) {
    console.error('[PII] Detection failed, returning unmasked:', err.message);
    return { maskedText: text, entities: [], mapping: {} };
  }
}

/**
 * Re-map placeholders in AI response back to real values.
 * Handles streaming by doing string replacement.
 */
export function unmaskPII(text: string, mapping: Record<string, string>): string {
  if (Object.keys(mapping).length === 0) return text;

  let result = text;
  for (const [placeholder, realValue] of Object.entries(mapping)) {
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), realValue);
  }
  return result;
}

/**
 * Create a streaming unmask wrapper that handles placeholders split across chunks.
 * Buffers partial placeholders (text ending with '[') and flushes when complete.
 */
export function createStreamUnmasker(mapping: Record<string, string>) {
  let buffer = '';

  return {
    /** Process a chunk and return the unmasked text ready to send */
    process(chunk: string): string {
      buffer += chunk;

      // Check if buffer ends with an incomplete placeholder (contains '[' without closing ']')
      const lastBracket = buffer.lastIndexOf('[');
      if (lastBracket >= 0 && !buffer.slice(lastBracket).includes(']')) {
        // Incomplete placeholder — flush everything before it, hold the rest
        const flushable = buffer.slice(0, lastBracket);
        buffer = buffer.slice(lastBracket);
        return unmaskPII(flushable, mapping);
      }

      // No incomplete placeholder — flush entire buffer
      const result = unmaskPII(buffer, mapping);
      buffer = '';
      return result;
    },

    /** Flush any remaining buffered text */
    flush(): string {
      if (buffer.length === 0) return '';
      const result = unmaskPII(buffer, mapping);
      buffer = '';
      return result;
    },
  };
}

/**
 * Detect PII entities using Gemini Flash NER.
 */
async function detectEntities(text: string): Promise<{ type: string; value: string }[]> {
  // Limit text size for NER call — only send first 30K chars
  const truncatedText = text.length > 30000 ? text.slice(0, 30000) : text;

  const genAI = new GoogleGenerativeAI(env.geminiApiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent(NER_PROMPT + truncatedText);
  const response = result.response.text().trim();

  // Extract JSON array from response
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const entities = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(entities)) return [];

    // Validate entity structure
    return entities.filter(
      (e: any) => typeof e.type === 'string' && typeof e.value === 'string' && e.value.trim().length > 0
    );
  } catch {
    console.error('[PII] Failed to parse NER response');
    return [];
  }
}
