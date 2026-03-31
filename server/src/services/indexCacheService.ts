import { Section, IndexStatus } from '../types';
import { env } from '../config/env';
import { fetchIndexFileContent } from './driveService';
import { DriveConnector } from '../connectors/DriveConnector';
import { indexDocuments, getRetrieverStatus, getDataLastUpdated as getRAGDataUpdated } from '../pipeline/retriever';
import { vectorStore } from '../pipeline/vectorStore';
import { setPIIEnabled } from '../pipeline/piiService';

let cachedSections: Section[] = [];
let cachedRawContent: string = '';
let dataLastUpdated: string | null = null;
let lastRefreshTime: Date | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

// Data connectors — add new sources here
const driveConnector = new DriveConnector();

function extractDataTimestamp(content: string): string | null {
  const match = content.match(/_Last updated:\s*(.+?)_/);
  return match ? match[1].trim() : null;
}

function parseSections(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ') && current.length > 0) {
      const body = current.join('\n');
      const header = current[0] || '';
      sections.push({ header, headerLower: header.toLowerCase(), body, bodyLower: body.toLowerCase() });
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) {
    const body = current.join('\n');
    const header = current.find(l => l.startsWith('## ')) || current[0] || '';
    sections.push({ header, headerLower: header.toLowerCase(), body, bodyLower: body.toLowerCase() });
  }

  return sections;
}

export async function refreshIndex(): Promise<void> {
  const dataSource = process.env.DATA_SOURCE || 'drive';
  if (dataSource === 'bigquery') {
    console.log('✓ BigQuery mode active — skipping Drive index load');
    return;
  }
  try {
    console.log('Refreshing index...');

    // Legacy: still load raw content for backward compatibility
    const content = await fetchIndexFileContent();
    cachedRawContent = content;
    cachedSections = parseSections(content);
    dataLastUpdated = extractDataTimestamp(content);
    lastRefreshTime = new Date();

    // RAG pipeline: index via connectors → chunks → embeddings → vector store
    if (env.ragEnabled) {
      await indexDocuments([driveConnector]);
    }

    // PII setting
    setPIIEnabled(env.piiEnabled);

    const vectorInfo = env.ragEnabled ? ` | Vectors: ${vectorStore.size}` : '';
    console.log(`✓ Index loaded: ${cachedSections.length} sections, ${content.length} chars${vectorInfo}, data updated: ${dataLastUpdated || 'unknown'}`);
  } catch (error: any) {
    console.error('✗ Failed to refresh index:', error.message);
  }
}

export function startAutoRefresh(intervalMs: number): void {
  // Load persisted vectors from disk on startup
  if (env.ragEnabled) {
    vectorStore.load();
  }

  // Fetch immediately on startup
  refreshIndex();

  // Schedule periodic refresh
  refreshTimer = setInterval(() => refreshIndex(), intervalMs);
  console.log(`Index auto-refresh every ${intervalMs / 1000}s`);
}

export function stopAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export function getCachedSections(): Section[] {
  return cachedSections;
}

/**
 * Get accurate data counts from FULL (non-truncated) sections.
 * Used to inject into system prompt so AI reports correct totals even when data is truncated.
 */
export function getDataSummary(): string {
  if (cachedSections.length === 0) return '';

  // First, try to read the Data Summary section from the file itself (most accurate)
  const summarySection = cachedSections.find(s => s.headerLower.includes('data summary'));
  if (summarySection && summarySection.body.length > 20) {
    return '── DATA SUMMARY (from source) ──\n' + summarySection.body.replace(/^#+.*\n/, '').trim() +
      '\nIMPORTANT: These are EXACT counts from the source data. Use these for all "how many" / "total count" questions. NEVER count rows yourself.\n── END SUMMARY ──\n\n';
  }

  // Fallback: try to read "Records:" lines from section headers
  const recordLines: string[] = [];
  for (const section of cachedSections) {
    const recordMatch = section.body.match(/\*\*Records:\*\*\s*(.+)/);
    if (recordMatch) {
      const header = section.header.replace(/^#+\s*/, '').trim();
      recordLines.push(`${header}: ${recordMatch[1]}`);
    }
  }
  if (recordLines.length > 0) {
    return '── DATA SUMMARY (from source) ──\n' + recordLines.join('\n') +
      '\nIMPORTANT: These are EXACT counts from the source data. Use these for all "how many" / "total count" questions. NEVER count rows yourself.\n── END SUMMARY ──\n\n';
  }

  // Final fallback: compute from data (less accurate)

  const counts: string[] = [];

  for (const section of cachedSections) {
    const header = section.header.replace(/^#+\s*/, '').trim();
    if (!header) continue;

    const lines = section.body.split('\n');
    const headerLower = header.toLowerCase();

    // Find the pipe-delimited header row to understand column structure
    const headerRow = lines.find(l => l.includes('|') && !l.includes('---') && (l.includes('Name') || l.includes('ID') || l.includes('Code') || l.includes('Title')));
    const firstCol = headerRow ? headerRow.split('|')[0].trim().toLowerCase() : '';

    // Count DISTINCT primary records (not sub-rows)
    let bestCount = 0;

    if (headerLower.includes('project')) {
      // Projects: count lines starting with a project code (3-4 digit number followed by |)
      bestCount = lines.filter(l => /^\d{3,4}\s*\|/.test(l.trim())).length;
    } else if (headerLower.includes('employee') || headerLower.includes('hr')) {
      // Employees: count lines starting with employee ID pattern (E-XXX or any ID | Name |)
      bestCount = lines.filter(l => /^[A-Z]-?\d{1,4}\s*\|/.test(l.trim())).length;
    } else if (headerLower.includes('deal')) {
      // Sales Deals: count UNIQUE clients (Account column = 2nd pipe field)
      const clients = new Set<string>();
      let totalDeals = 0;
      for (const l of lines) {
        const trimmed = l.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('- **') || trimmed.startsWith('Sheet')) continue;
        const parts = trimmed.split('|').map(p => p.trim());
        if (parts.length < 5) continue;
        // Skip header row, separator row, and metadata
        const firstCol = parts[0];
        if (!firstCol || firstCol === 'Description' || /^-+$/.test(firstCol) || firstCol.startsWith('**')) continue;
        if (parts[1] && parts[1] !== 'Account' && parts[1].length > 1 && !/^-+$/.test(parts[1])) {
          clients.add(parts[1]); // Account/Client name
          totalDeals++;
        }
      }
      bestCount = clients.size;
      // Also store total deals for reference
      if (clients.size > 0) {
        counts.push(`${header}: ${clients.size} clients with ${totalDeals} deals`);
        continue; // skip the default push below
      }
    } else if (headerLower.includes('pipeline')) {
      // Pipeline: count lines starting with OPP-XXX or opportunity ID pattern
      bestCount = lines.filter(l => /^OPP-\d+\s*\|/i.test(l.trim())).length;
      if (bestCount === 0) {
        // Fallback: count pipe data rows
        const pipeRows = lines.filter(l => {
          const trimmed = l.trim();
          if (!trimmed || trimmed.includes('---') || trimmed.startsWith('-') || trimmed.startsWith('#')) return false;
          return (trimmed.match(/\|/g) || []).length >= 5;
        }).length;
        bestCount = Math.max(0, pipeRows - 1);
      }
    } else {
      // Generic: count pipe-delimited data rows (3+ pipes)
      const pipeRows = lines.filter(l => {
        const trimmed = l.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('_') || trimmed.includes('---')) return false;
        return (trimmed.match(/\|/g) || []).length >= 3;
      }).length;
      bestCount = Math.max(0, pipeRows - 1);
    }

    // Fallback: non-empty content lines
    const contentLines = lines.filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('_') && !l.startsWith('-') && l.trim().length > 10).length;

    if (bestCount > 0) {
      const label = headerLower.includes('project') ? 'projects'
        : headerLower.includes('employee') ? 'employees'
        : headerLower.includes('deal') ? 'deals'
        : headerLower.includes('pipeline') ? 'opportunities'
        : 'records';
      counts.push(`${header}: ${bestCount} ${label}`);
    } else if (contentLines > 5) {
      counts.push(`${header}: ~${contentLines} data lines`);
    }
  }

  if (counts.length === 0) return '';
  return '── DATA SUMMARY (accurate totals from full dataset) ──\n' +
    'Total sections: ' + cachedSections.length + '\n' +
    counts.join('\n') +
    '\nIMPORTANT: Use these totals for "how many" / "total count" questions. The data context below may be truncated, but these totals reflect the COMPLETE dataset. NEVER count rows in the data below — use these numbers instead.\n── END SUMMARY ──\n\n';
}

export function getRawContent(): string {
  return cachedRawContent;
}

export function getDataLastUpdated(): string | null {
  // Prefer RAG timestamp if available
  return getRAGDataUpdated() || dataLastUpdated;
}

export function getStatus(): IndexStatus {
  return {
    loaded: cachedSections.length > 0,
    sectionCount: cachedSections.length,
    charCount: cachedRawContent.length,
    lastRefresh: lastRefreshTime ? lastRefreshTime.toISOString() : null,
    dataLastUpdated: getDataLastUpdated(),
    vectorCount: env.ragEnabled ? vectorStore.size : undefined,
    embeddingModel: env.ragEnabled ? getRetrieverStatus().embeddingModel : undefined,
  };
}
