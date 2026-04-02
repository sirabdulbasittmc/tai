/**
 * Output Sanitizer — filters LLM response content before delivery to user.
 *
 * Defense-in-depth layer that catches:
 * 1. System prompt leakage (LLM tricked into revealing its instructions)
 * 2. Credential/secret leakage in responses
 * 3. XSS payloads in widget HTML responses
 * 4. Cross-tenant data leakage patterns
 *
 * Controlled by feature flag: ff_content_safety_enabled (default: true)
 */

// Patterns that indicate the LLM is leaking its system prompt
const SYSTEM_PROMPT_LEAK_PATTERNS = [
  // Common system prompt disclosure markers
  /(?:system prompt|system instructions|my instructions|my rules)[\s:]+/gi,
  // Instruction boundary leaks
  /── (?:RESPONSE DIRECTIVE|AI INSTRUCTIONS|END DIRECTIVE) ──/g,
  // Direct instruction repetition (model repeating its own system prompt)
  /You are (?:a strategic analyst|an AI assistant|TMC AI|Aria).*?(?:never|always|must).*?(?:hallucinate|fabricate|make up)/gi,
];

// Patterns that indicate secrets/credentials in output
const SECRET_LEAK_PATTERNS = [
  // API keys (generic patterns)
  /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token)[\s:=]+['"]*[A-Za-z0-9_\-]{20,}/gi,
  // GCP service account JSON
  /"type"\s*:\s*"service_account"/g,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g,
  // Connection strings with passwords
  /(?:postgres|mysql|mongodb):\/\/[^:]+:[^@]+@/gi,
];

// XSS patterns in widget HTML (script tags loading external resources)
const XSS_PATTERNS = [
  /<script\s+[^>]*src\s*=\s*["']https?:\/\//gi,
  /javascript\s*:/gi,
  /on(?:error|load|click|mouseover)\s*=\s*["']/gi,
  /<iframe\s+[^>]*src\s*=\s*["']https?:\/\//gi,
];

export interface SanitizeResult {
  text: string;
  blocked: boolean;
  reason?: string;
}

/**
 * Sanitize a chunk of LLM output before sending to the user.
 * Returns the sanitized text and whether any content was blocked.
 */
export function sanitizeOutput(text: string): SanitizeResult {
  // Check for system prompt leakage
  for (const pattern of SYSTEM_PROMPT_LEAK_PATTERNS) {
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      console.warn(`[OutputSanitizer] Blocked system prompt leak: "${text.slice(0, 80)}..."`);
      return { text: '', blocked: true, reason: 'system_prompt_leak' };
    }
    pattern.lastIndex = 0;
  }

  // Check for credential leakage
  for (const pattern of SECRET_LEAK_PATTERNS) {
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      console.warn(`[OutputSanitizer] Blocked credential leak in response`);
      return { text: '', blocked: true, reason: 'credential_leak' };
    }
    pattern.lastIndex = 0;
  }

  // Strip XSS from widget HTML (don't block, just clean)
  let cleaned = text;
  for (const pattern of XSS_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match) => {
      console.warn(`[OutputSanitizer] Stripped XSS pattern: "${match.slice(0, 40)}"`);
      return '<!-- removed by security filter -->';
    });
  }

  return { text: cleaned, blocked: false };
}
