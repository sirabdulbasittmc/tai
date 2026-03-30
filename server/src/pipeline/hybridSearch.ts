import { SearchResult, Section } from '../types';
import { searchIndex } from '../services/searchService';
import { vectorStore } from './vectorStore';
import { embedText } from './embedder';

/**
 * Hybrid Search — combines vector (semantic) + BM25/TF-IDF (keyword) results
 * using Reciprocal Rank Fusion (RRF).
 *
 * Why: Pure vector search fails on exact strings like employee IDs ("EMP-1234"),
 * project codes ("P-1113"), and SAP transaction codes. These have no semantic
 * neighbourhood — they need exact keyword matching.
 *
 * Pure keyword search fails on meaning ("who handles cybersecurity clients?").
 *
 * Hybrid = best of both. RRF merges two ranked lists without needing to normalize scores.
 */

const RRF_K = 60;  // RRF constant — higher = more weight to lower-ranked results

export interface HybridResult extends SearchResult {
  vectorRank?: number;
  keywordRank?: number;
  rrfScore: number;
}

/**
 * Perform hybrid search: vector similarity + TF-IDF keyword, merged with RRF.
 */
export async function hybridSearch(
  query: string,
  sections: Section[],
  topK: number = 15,
  minScore: number = 0.3
): Promise<SearchResult[]> {
  // Run both searches in parallel
  const [vectorResults, keywordContext] = await Promise.all([
    vectorSearch(query, topK * 2, minScore),
    Promise.resolve(searchIndex(query, sections)),
  ]);

  // Convert keyword results to chunk-like results for merging
  const keywordChunkIds = extractMatchedSections(keywordContext, sections);

  // Build RRF scores
  const rrfScores = new Map<string, HybridResult>();

  // Score vector results
  vectorResults.forEach((result, rank) => {
    const id = result.chunk.id;
    const existing = rrfScores.get(id) || {
      ...result,
      vectorRank: undefined,
      keywordRank: undefined,
      rrfScore: 0,
    };
    existing.vectorRank = rank + 1;
    existing.rrfScore += 1.0 / (RRF_K + rank + 1);
    rrfScores.set(id, existing);
  });

  // Score keyword results — match by section header overlap
  keywordChunkIds.forEach((sectionHeader, rank) => {
    // Find vector entries whose chunks belong to this section
    const matchingEntries = vectorResults.filter(r =>
      r.chunk.metadata.section === sectionHeader ||
      r.chunk.metadata.headerPath?.includes(sectionHeader)
    );

    if (matchingEntries.length > 0) {
      // Boost existing vector results that also matched keyword search
      for (const entry of matchingEntries) {
        const id = entry.chunk.id;
        const existing = rrfScores.get(id);
        if (existing) {
          existing.keywordRank = rank + 1;
          existing.rrfScore += 1.0 / (RRF_K + rank + 1);
        }
      }
    } else {
      // Keyword found a section that vector search missed — include it
      // Find any chunk from this section in the full vector store
      const allChunks = vectorStore.getAllChunks();
      const sectionChunks = allChunks.filter(c =>
        c.metadata.section === sectionHeader ||
        c.metadata.headerPath?.includes(sectionHeader)
      );
      for (const chunk of sectionChunks.slice(0, 3)) {
        const id = chunk.id;
        if (!rrfScores.has(id)) {
          rrfScores.set(id, {
            chunk,
            score: 0.5,  // baseline
            keywordRank: rank + 1,
            rrfScore: 1.0 / (RRF_K + rank + 1),
          });
        }
      }
    }
  });

  // Sort by RRF score and return top-K
  const merged = Array.from(rrfScores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, topK);

  // Normalize scores to 0-1 range for downstream
  const maxRRF = merged[0]?.rrfScore || 1;
  for (const result of merged) {
    result.score = result.rrfScore / maxRRF;
  }

  const hybridCount = merged.filter(r => r.vectorRank && r.keywordRank).length;
  console.log(`[HybridSearch] Vector: ${vectorResults.length}, Keyword sections: ${keywordChunkIds.length}, Merged: ${merged.length} (${hybridCount} matched both)`);

  return merged;
}

async function vectorSearch(query: string, topK: number, minScore: number): Promise<SearchResult[]> {
  if (vectorStore.size === 0) return [];
  const queryVector = await embedText(query);
  return vectorStore.search(queryVector, topK, minScore);
}

/**
 * Extract matched section headers from keyword search results.
 * The TF-IDF search returns formatted text — we extract which sections matched.
 */
function extractMatchedSections(keywordContext: string, sections: Section[]): string[] {
  const matchedHeaders: string[] = [];
  for (const section of sections) {
    // Check if this section's header or content appears in the keyword results
    if (keywordContext.includes(section.header)) {
      const cleanHeader = section.header.replace(/^##\s*/, '').trim();
      if (cleanHeader) matchedHeaders.push(cleanHeader);
    }
  }
  return matchedHeaders;
}
