import { DataConnector } from '../connectors/DataConnector';
import { chunkDocuments } from './chunker';
import { embedText, embedBatch, getEmbeddingModel } from './embedder';
import { vectorStore } from './vectorStore';
import { SearchResult } from '../types';

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
 * Index documents from all provided connectors.
 * Fetches → chunks → embeds → stores vectors.
 * Only re-embeds chunks whose content has changed (hash-based dedup).
 */
export async function indexDocuments(connectors: DataConnector[], forceRebuild = false): Promise<void> {
  if (isIndexing) {
    console.log('[Retriever] Indexing already in progress, skipping...');
    return;
  }

  isIndexing = true;

  try {
    // 1. Fetch documents from all connectors
    const allDocuments = [];
    for (const connector of connectors) {
      if (!connector.isReady()) {
        console.log(`[Retriever] Connector "${connector.name}" not ready, skipping`);
        continue;
      }
      const docs = await connector.fetchDocuments();
      allDocuments.push(...docs);
    }

    if (allDocuments.length === 0) {
      console.log('[Retriever] No documents fetched from any connector');
      return;
    }

    // Extract data timestamp from first document
    const firstDoc = allDocuments[0];
    if (firstDoc.metadata.updatedAt) {
      dataLastUpdated = firstDoc.metadata.updatedAt;
    }

    // 2. Chunk documents
    const chunks = chunkDocuments(allDocuments);

    // 3. Purge stale chunks (from deleted/renamed documents)
    const currentHashes = new Set(chunks.map(c => c.metadata.contentHash));
    vectorStore.purgeStale(currentHashes);

    // 4. Determine which chunks need embedding
    if (forceRebuild) {
      vectorStore.clear();
    }

    const newChunks = chunks.filter(c => !vectorStore.hasChunk(c.metadata.contentHash));

    if (newChunks.length === 0) {
      console.log('[Retriever] All chunks up-to-date, no re-embedding needed');
      lastIndexTime = new Date();
      return;
    }

    // If more than half the chunks changed, rebuild entirely for consistency
    if (newChunks.length > chunks.length * 0.5) {
      console.log(`[Retriever] ${newChunks.length}/${chunks.length} chunks changed — full rebuild`);
      vectorStore.clear();
      const vectors = await embedBatch(chunks.map(c => c.content));
      const result = vectorStore.upsert(chunks, vectors);
      console.log(`[Retriever] Full rebuild: ${result.added} vectors added`);
    } else {
      // Incremental: only embed new/changed chunks
      console.log(`[Retriever] ${newChunks.length} new chunks to embed (${chunks.length - newChunks.length} cached)`);
      const vectors = await embedBatch(newChunks.map(c => c.content));
      const result = vectorStore.upsert(newChunks, vectors);
      console.log(`[Retriever] Incremental update: ${result.added} added, ${result.skipped} skipped`);
    }

    // 4. Persist to disk
    vectorStore.save();
    lastIndexTime = new Date();

    console.log(`[Retriever] Indexing complete: ${vectorStore.size} vectors total`);
  } catch (err: any) {
    console.error('[Retriever] Indexing failed:', err.message);
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
    console.log('[Retriever] Vector store empty — returning no results');
    return [];
  }

  const queryVector = await embedText(query);
  const results = vectorStore.search(queryVector, topK, minScore);

  console.log(`[Retriever] Query: "${query.slice(0, 60)}..." → ${results.length} results (top score: ${results[0]?.score.toFixed(3) || 'N/A'})`);
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
    console.log(`[Retriever] Context trimming: included ${includedCount}/${results.length} chunks (${context.length} chars)`);
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
