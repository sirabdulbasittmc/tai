import crypto from 'crypto';
import { Document, Chunk } from '../types';

const DEFAULT_CHUNK_SIZE = 1500;   // target chars per chunk
const CHUNK_OVERLAP = 200;         // overlap between consecutive chunks

/**
 * Smart semantic chunker — splits documents by structural boundaries
 * (headers, paragraphs, table rows) rather than fixed character counts.
 * No hardcoded keywords — purely structural parsing.
 */
export function chunkDocuments(documents: Document[], chunkSize = DEFAULT_CHUNK_SIZE): Chunk[] {
  const allChunks: Chunk[] = [];

  for (const doc of documents) {
    const chunks = chunkDocument(doc, chunkSize);
    allChunks.push(...chunks);
  }

  console.log(`[Chunker] ${documents.length} documents → ${allChunks.length} chunks`);
  return allChunks;
}

function chunkDocument(doc: Document, maxSize: number): Chunk[] {
  const blocks = splitIntoSemanticBlocks(doc.content);
  const chunks: Chunk[] = [];
  let currentContent: string[] = [];
  let currentSize = 0;
  let chunkIndex = 0;
  const headerPath = extractHeaderPath(doc.content);

  for (const block of blocks) {
    const blockSize = block.length;

    // If a single block exceeds max size, split it further
    if (blockSize > maxSize) {
      // Flush current buffer first
      if (currentContent.length > 0) {
        chunks.push(buildChunk(doc, currentContent.join('\n'), chunkIndex++, headerPath));
        // Keep overlap
        const overlapText = getOverlapText(currentContent.join('\n'), CHUNK_OVERLAP);
        currentContent = overlapText ? [overlapText] : [];
        currentSize = overlapText ? overlapText.length : 0;
      }
      // Split large block into sub-chunks
      const subChunks = splitLargeBlock(block, maxSize);
      for (const sub of subChunks) {
        chunks.push(buildChunk(doc, sub, chunkIndex++, headerPath));
      }
      currentContent = [];
      currentSize = 0;
      continue;
    }

    // If adding this block exceeds limit, flush
    if (currentSize + blockSize > maxSize && currentContent.length > 0) {
      chunks.push(buildChunk(doc, currentContent.join('\n'), chunkIndex++, headerPath));
      // Keep overlap from end of previous chunk
      const overlapText = getOverlapText(currentContent.join('\n'), CHUNK_OVERLAP);
      currentContent = overlapText ? [overlapText] : [];
      currentSize = overlapText ? overlapText.length : 0;
    }

    currentContent.push(block);
    currentSize += blockSize;
  }

  // Flush remaining
  if (currentContent.length > 0) {
    chunks.push(buildChunk(doc, currentContent.join('\n'), chunkIndex++, headerPath));
  }

  return chunks;
}

/**
 * Split content into semantic blocks — respects markdown structure:
 * - Headers (##, ###)
 * - Table rows (lines with |)
 * - Paragraphs (separated by blank lines)
 * - List items
 */
function splitIntoSemanticBlocks(content: string): string[] {
  const lines = content.split('\n');
  const blocks: string[] = [];
  let currentBlock: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Header starts a new block
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      currentBlock.push(line);
      continue;
    }

    // Table separator or header row
    if (trimmed.match(/^\|.*\|$/) || trimmed.match(/^[-| ]+$/)) {
      if (!inTable && currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      inTable = true;
      currentBlock.push(line);
      continue;
    }

    // End of table
    if (inTable && !trimmed.match(/^\|/) && trimmed !== '') {
      blocks.push(currentBlock.join('\n'));
      currentBlock = [];
      inTable = false;
    }

    // Blank line = paragraph boundary (but not inside tables)
    if (trimmed === '' && !inTable) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      continue;
    }

    currentBlock.push(line);
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }

  return blocks.filter(b => b.trim().length > 0);
}

/**
 * Split a large block (e.g., huge table) into smaller pieces.
 * Splits by lines, keeping logical groups together.
 */
function splitLargeBlock(block: string, maxSize: number): string[] {
  const lines = block.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let currentSize = 0;

  // Keep table header with each sub-chunk if it's a table
  let tableHeader = '';
  if (lines.length > 1 && lines[0].includes('|') && lines[1]?.match(/^[-| ]+$/)) {
    tableHeader = lines[0] + '\n' + lines[1];
  }

  for (const line of lines) {
    if (currentSize + line.length > maxSize && current.length > 0) {
      chunks.push(current.join('\n'));
      current = tableHeader ? [tableHeader] : [];
      currentSize = tableHeader ? tableHeader.length : 0;
    }
    current.push(line);
    currentSize += line.length + 1;
  }

  if (current.length > 0) {
    chunks.push(current.join('\n'));
  }

  return chunks;
}

function extractHeaderPath(content: string): string[] {
  const headers: string[] = [];
  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) {
      headers.push(line.replace(/^#+\s*/, '').trim());
    }
  }
  return headers;
}

function getOverlapText(text: string, overlapSize: number): string {
  if (text.length <= overlapSize) return text;
  // Try to break at a newline for clean overlap
  const tail = text.slice(-overlapSize);
  const newlineIdx = tail.indexOf('\n');
  return newlineIdx > 0 ? tail.slice(newlineIdx + 1) : tail;
}

function buildChunk(doc: Document, content: string, index: number, headerPath: string[]): Chunk {
  const contentHash = crypto.createHash('md5').update(content).digest('hex');
  return {
    id: `${doc.id}_chunk_${index}`,
    documentId: doc.id,
    content,
    metadata: {
      ...doc.metadata,
      chunkIndex: index,
      headerPath,
      contentHash,
    },
  };
}
