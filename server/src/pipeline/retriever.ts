import { DataConnector } from '../connectors/DataConnector';
import { chunkDocuments } from './chunker';
import { embedText, embedBatch, getEmbeddingModel } from './embedder';
import { vectorStore } from './vectorStore';
import { Chunk, SearchResult } from '../types';
import createLogger from '../utils/logger';
import { isFeatureEnabled } from '../services/featureFlagService';

const log = createLogger('retriever');

let dataLastUpdated: string | null = null;
let lastIndexTime: Date | null = null;
let isIndexing = false;

/**
 * RAG Retriever — orchestrates the full pipeline:
 *   Connectors → Documents → Chunks → Embeddings → Vector Store → Search
 *
 * Source-agnostic: works with any DataConnector implementation.
 * Adding BigQuery or Vertex AI only requires a new connector, not changes here.
 */

/**
 * Remove duplicate chunks that share the same contentHash but come from
 * different sources (e.g., Drive and BigQuery).  Keeps the first occurrence.
 */
function deduplicateChunks(chunks: Chunk[]): Chunk[] {
  const seen = new Set<string>();
  const deduped: Chunk[] = [];
  let dupeCount = 0;

  for (const chunk of chunks) {
    const hash = chunk.metadata.contentHash;
    if (seen.has(hash)) {
      dupeCount++;
      continue;
    }
    seen.add(hash);
    deduped.push(chunk);
  }

  if (dupeCount > 0) {
    log.info('Cross-source dedup removed duplicate chunks', { removed: dupeCount, remaining: deduped.length });
  }

  return deduped;
}

/**
 * Index documents from all provided connectors.
 * Fetches → chunks → embeds → stores vectors.
 * Only re-embeds chunks whose content has changed (hash-based dedup).
 *
 * @param clientNumber  Tenant identifier — used for feature flag lookups.
 *                      When omitted, dedup-on-index is skipped.
 */
export async function indexDocuments(connectors: DataConnector[], forceRebuild = false, clientNumber?: string): Promise<void> {
  if (isIndexing) {
    log.info('Indexing already in progress, skipping');
    return;
  }

  isIndexing = true;

  try {
    // 1. Fetch documents from all connectors
    const allDocuments = [];
    for (const connector of connectors) {
      if (!connector.isReady()) {
        log.info('Connector not ready, skipping', { connector: connector.name });
        continue;
      }
      const docs = await connector.fetchDocuments();
      allDocuments.push(...docs);
    }

    if (allDocuments.length === 0) {
      log.info('No documents fetched from any connector');
      return;
    }

    // Extract data timestamp from first document
    const firstDoc = allDocuments[0];
    if (firstDoc.metadata.updatedAt) {
      dataLastUpdated = firstDoc.metadata.updatedAt;
    }

    // 2. Chunk documents
    let chunks = chunkDocuments(allDocuments);

    // 2.5  Cross-source dedup — if the same content arrives from both Drive
    //       and BQ (or any two connectors), keep only the first occurrence.
    //       Controlled by feature flag `ff_dedup_on_index`.
    if (clientNumber) {
      const dedupEnabled = await isFeatureEnabled(clientNumber, 'ff_dedup_on_index', true);
      if (dedupEnabled) {
        chunks = deduplicateChunks(chunks);
      }
    }

    // 3. Purge stale chunks (from deleted/renamed documents)
    const currentHashes = new Set(chunks.map(c => c.metadata.contentHash));
    vectorStore.purgeStale(currentHashes);

    // 4. Determine which chunks need embedding
    if (forceRebuild) {
      vectorStore.clear();
    }

    const newChunks = chunks.filter(c => !vectorStore.hasChunk(c.metadata.contentHash));

    if (newChunks.length === 0) {
      log.info('All chunks up-to-date, no re-embedding needed');
      lastIndexTime = new Date();
      return;
    }

    // If more than half the chunks changed, rebuild entirely for consistency
    if (newChunks.length > chunks.length * 0.5) {
      log.info('Chunks changed — full rebuild', { changed: newChunks.length, total: chunks.length });
      vectorStore.clear();
      const vectors = await embedBatch(chunks.map(c => c.content));
      const result = vectorStore.upsert(chunks, vectors);
      log.info('Full rebuild complete', { added: result.added });
    } else {
      // Incremental: only embed new/changed chunks
      log.info('Incremental embed', { newChunks: newChunks.length, cached: chunks.length - newChunks.length });
      const vectors = await embedBatch(newChunks.map(c => c.content));
      const result = vectorStore.upsert(newChunks, vectors);
      log.info('Incremental update complete', { added: result.added, skipped: result.skipped });
    }

    // 4. Persist to disk
    vectorStore.save();
    lastIndexTime = new Date();

    log.info('Indexing complete', { vectorsTotal: vectorStore.size });
  } catch (err: any) {
    log.error('Indexing failed', { error: err.message });
  } finally {
    isIndexing = false;
  }
}

/**
 * Retrieve the most relevant chunks for a query.
 * Embeds the query → cosine similarity search → returns top-K results.
 */
export async function retrieve(query: string, topK = 10, minScore = 0.3): Promise<SearchResult[]> {
  if (vectorStore.size === 0) {
    log.info('Vector store empty — returning no results');
    return [];
  }

  const queryVector = await embedText(query);
  const results = vectorStore.search(queryVector, topK, minScore);

  log.info('Query results', { query: query.slice(0, 60), results: results.length, topScore: results[0]?.score.toFixed(3) || 'N/A' });
  return results;
}

/**
 * Build context string from search results — score-based trimming.
 * Results are already sorted by relevance (highest first).
 * Highest-scoring chunks always make it in; lowest get dropped when near limit.
 */
export function buildContextFromResults(results: SearchResult[], maxChars = 50000): string {
  if (results.length === 0) return '';

  // Results already sorted by score descending — highest relevance first
  let context = '';
  let includedCount = 0;

  for (const result of results) {
    const section = result.chunk.content;
    if (context.length + section.length > maxChars) {
      // Don't hard-cut — skip this chunk and try smaller ones below it
      continue;
    }
    const source = result.chunk.metadata.section || result.chunk.metadata.title || '';
    const scoreTag = `[relevance: ${result.score.toFixed(2)}${source ? ` | source: ${source}` : ''}]`;
    context += (context ? '\n\n' : '') + scoreTag + '\n' + section;
    includedCount++;
  }

  if (includedCount < results.length) {
    log.info('Context trimming', { included: includedCount, total: results.length, chars: context.length });
  }

  return context;
}

/** Status getters */
export function getRetrieverStatus() {
  return {
    vectorCount: vectorStore.size,
    embeddingModel: getEmbeddingModel(),
    lastIndexTime: lastIndexTime?.toISOString() || null,
    isIndexing,
  };
}

export function getDataLastUpdated(): string | null {
  return dataLastUpdated;
}
