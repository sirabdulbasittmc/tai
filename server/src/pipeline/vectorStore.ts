import fs from 'fs';
import path from 'path';
import { Chunk, VectorEntry, SearchResult } from '../types';

const STORE_PATH = path.resolve(__dirname, '../../data/vectors.json');

/**
 * Local file-backed vector store with in-memory cosine similarity search.
 * No external DB needed — persists to JSON, loads into memory.
 * Designed to be replaced by pgvector in Phase 2 without changing the API.
 */
class VectorStore {
  private entries: VectorEntry[] = [];
  private hashIndex: Set<string> = new Set();  // content hashes for dedup

  /** Number of stored vectors */
  get size(): number {
    return this.entries.length;
  }

  /** Load vectors from disk if available */
  load(): void {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
        if (Array.isArray(data)) {
          this.entries = data;
          this.hashIndex = new Set(data.map((e: VectorEntry) => e.chunk.metadata.contentHash));
          console.log(`[VectorStore] Loaded ${this.entries.length} vectors from disk`);
        }
      }
    } catch (err: any) {
      console.error('[VectorStore] Failed to load from disk:', err.message);
      this.entries = [];
      this.hashIndex = new Set();
    }
  }

  /** Persist vectors to disk */
  save(): void {
    try {
      const dir = path.dirname(STORE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(this.entries));
      console.log(`[VectorStore] Saved ${this.entries.length} vectors to disk`);
    } catch (err: any) {
      console.error('[VectorStore] Failed to save:', err.message);
    }
  }

  /** Check if a chunk (by content hash) already exists */
  hasChunk(contentHash: string): boolean {
    return this.hashIndex.has(contentHash);
  }

  /** Add vectors for new chunks. Skips chunks that haven't changed. */
  upsert(chunks: Chunk[], vectors: number[][]): { added: number; skipped: number } {
    let added = 0;
    let skipped = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (this.hashIndex.has(chunk.metadata.contentHash)) {
        skipped++;
        continue;
      }
      this.entries.push({
        chunkId: chunk.id,
        vector: vectors[i],
        chunk,
      });
      this.hashIndex.add(chunk.metadata.contentHash);
      added++;
    }

    return { added, skipped };
  }

  /** Clear all entries and rebuild from scratch */
  clear(): void {
    this.entries = [];
    this.hashIndex = new Set();
  }

  /**
   * Purge stale chunks — remove vectors whose content hashes
   * no longer appear in the current document set.
   * Prevents ghost results from deleted/renamed Drive files.
   */
  purgeStale(currentHashes: Set<string>): number {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => currentHashes.has(e.chunk.metadata.contentHash));
    this.hashIndex = new Set(this.entries.map(e => e.chunk.metadata.contentHash));
    const purged = before - this.entries.length;
    if (purged > 0) {
      console.log(`[VectorStore] Purged ${purged} stale vectors`);
    }
    return purged;
  }

  /**
   * Search for the top-K most similar chunks to the query vector.
   * Uses cosine similarity — no external libraries needed.
   */
  search(queryVector: number[], topK: number = 10, minScore: number = 0.3): SearchResult[] {
    if (this.entries.length === 0) return [];

    const scored = this.entries.map(entry => ({
      chunk: entry.chunk,
      score: cosineSimilarity(queryVector, entry.vector),
    }));

    return scored
      .filter(s => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** Get all chunks (useful for fallback to full context) */
  getAllChunks(): Chunk[] {
    return this.entries.map(e => e.chunk);
  }
}

/**
 * Cosine similarity between two vectors.
 * Returns value between -1 and 1, where 1 = identical direction.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

// Singleton instance
export const vectorStore = new VectorStore();
