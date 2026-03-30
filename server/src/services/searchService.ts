import { Section } from '../types';
import { truncate } from '../utils/truncate';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
}

/**
 * Smart section detection using TF-IDF-like scoring.
 * Words that appear in many sections are naturally downweighted.
 * No hardcoded stop words needed.
 */
function findBestSectionMatch(queryTokens: string[], sections: Section[]): Section[] | null {
  if (queryTokens.length === 0 || sections.length === 0) return null;

  // Calculate document frequency: how many section headers contain each token
  const docFreq: Record<string, number> = {};
  for (const token of queryTokens) {
    let count = 0;
    for (const section of sections) {
      // Check exact, stem, and partial matches
      if (matchesHeader(token, section.headerLower)) count++;
    }
    docFreq[token] = count;
  }

  const scored = sections.map(section => {
    let score = 0;
    let hits = 0;

    for (const token of queryTokens) {
      const matchStrength = getMatchStrength(token, section.headerLower);
      if (matchStrength > 0) {
        // IDF: tokens appearing in fewer headers are more valuable
        const idf = Math.log((sections.length + 1) / (docFreq[token] + 1)) + 1;
        // Length bonus: longer tokens are more likely to be meaningful
        const lengthBonus = Math.min(token.length / 5, 2);
        score += matchStrength * idf * lengthBonus;
        hits += matchStrength;
      }
    }

    return { section, score, hits };
  });

  const best = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);

  if (best.length === 0) return null;

  // Only treat as section-level match if there's meaningful header relevance
  // Require at least one substantive token (4+ chars) to have matched
  const hasSubstantiveMatch = queryTokens.some(t => t.length >= 4 && getMatchStrength(t, best[0].section.headerLower) > 0);
  if (best[0].hits >= 0.7 && hasSubstantiveMatch) {
    const topScore = best[0].score;
    const matched = best.filter(s => s.score >= topScore * 0.7);
    console.log(`[Search] Section match: "${matched.map(m => m.section.header).join(', ')}" (score: ${topScore.toFixed(2)})`);
    return matched.map(m => m.section);
  }

  return null;
}

/**
 * Returns match strength (0 to 1) of a token against a header string.
 * Handles exact match, stemming, and partial overlap — no hardcoded dictionaries.
 */
function getMatchStrength(token: string, headerLower: string): number {
  // Exact match
  if (headerLower.includes(token)) return 1.0;

  // Stem match: remove common suffixes and check
  const stems = getStemVariants(token);
  for (const stem of stems) {
    if (headerLower.includes(stem)) return 0.9;
  }

  // Reverse: check if any header word starts with the token or vice versa
  if (token.length >= 3) {
    const headerWords = headerLower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
    for (const hw of headerWords) {
      if (hw.startsWith(token) || token.startsWith(hw)) return 0.8;
    }
  }

  return 0;
}

function matchesHeader(token: string, headerLower: string): boolean {
  return getMatchStrength(token, headerLower) > 0;
}

/**
 * Simple suffix-stripping stemmer — no external libraries needed.
 * Returns variant forms of a word by removing common English suffixes.
 */
function getStemVariants(word: string): string[] {
  const variants: string[] = [];
  if (word.length <= 3) return variants;

  // Try removing common suffixes
  const suffixes = ['s', 'es', 'ed', 'ing', 'tion', 'sion', 'ment', 'ness', 'ity', 'ies', 'er', 'or', 'ly', 'al', 'ous', 'ive', 'able', 'ible'];
  for (const suffix of suffixes) {
    if (word.endsWith(suffix) && word.length > suffix.length + 2) {
      variants.push(word.slice(0, -suffix.length));
    }
  }

  return variants;
}

export function searchIndex(query: string, sections: Section[]): string {
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) {
    return 'Available data sections:\n' +
      sections.map(s => s.header).join('\n');
  }

  // Try section-level matching first
  const sectionMatch = findBestSectionMatch(queryTokens, sections);

  if (sectionMatch) {
    const fullContent = sectionMatch.map(s => s.body).join('\n\n');
    return truncate(fullContent);
  }

  // Fall back to content-level search across all sections
  // Use same TF-IDF approach but on section body content
  const bodyDocFreq: Record<string, number> = {};
  for (const token of queryTokens) {
    bodyDocFreq[token] = sections.filter(s => s.bodyLower.includes(token)).length;
  }

  const scored = sections.map(section => {
    let score = 0;
    for (const token of queryTokens) {
      if (section.bodyLower.includes(token)) {
        const idf = Math.log((sections.length + 1) / (bodyDocFreq[token] + 1)) + 1;
        const tf = Math.min(section.bodyLower.split(token).length - 1, 10);
        score += tf * idf;
      }
      // Boost header matches
      if (section.headerLower.includes(token)) {
        score += 3;
      }
    }
    return { section, score };
  });

  const matched = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matched.length === 0) {
    return 'No specific content found for your query.\n\nAvailable sections:\n' +
      sections.map(s => s.header).join('\n');
  }

  // Row-level filtering within matched sections
  const contextParts: string[] = [];

  for (const { section } of matched) {
    const lines = section.body.split('\n');
    let sectionHeader = '';
    let columnHeader = '';
    const matchingRows: string[] = [];

    for (const line of lines) {
      if (line.startsWith('## ')) {
        sectionHeader = line;
        continue;
      }

      if (line.includes(' | ') &&
          !queryTokens.some(t => line.toLowerCase().includes(t)) &&
          !columnHeader) {
        columnHeader = line;
        continue;
      }

      if (line.match(/^[-| ]+$/) || line.startsWith('- **Type') || line.startsWith('- **ID')) {
        continue;
      }

      if (queryTokens.some(t => line.toLowerCase().includes(t))) {
        if (matchingRows.length < 30) {
          matchingRows.push(line);
        }
      }
    }

    if (matchingRows.length > 0 || sectionHeader) {
      if (sectionHeader) contextParts.push(sectionHeader);
      if (columnHeader) contextParts.push(columnHeader);
      if (matchingRows.length > 0) contextParts.push(matchingRows.join('\n'));
    }
  }

  return truncate(contextParts.join('\n\n'));
}
