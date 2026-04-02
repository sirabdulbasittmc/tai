import { getGenAI } from '../services/genaiClient';
import { env } from '../config/env';
import { SearchResult } from '../types';

/**
 * Cross-encoder Re-ranker — uses Gemini Flash to score each chunk
 * against the actual query for true relevance, not just embedding similarity.
 *
 * Cosine similarity is a fast first pass but can't understand nuance.
 * The re-ranker reads both the query and each chunk, then judges:
 * "How well does this chunk actually answer this question?"
 *
 * Flow: Top-K from vector search → Re-rank with Flash → Top-N to LLM
 */

const RERANK_PROMPT = `You are a relevance scorer. Given a user query and a list of text chunks, score each chunk from 0 to 10 based on how relevant and useful it is for answering the query.

Scoring guide:
- 10: Directly answers the query with specific data
- 7-9: Contains highly relevant information
- 4-6: Partially relevant, has some useful context
- 1-3: Tangentially related
- 0: Irrelevant

Return ONLY a JSON array of scores in the same order as the chunks. Example: [8, 3, 9, 1, 6]
No explanation, just the array.

Query: `;

const MAX_RERANK_CHUNKS = 15;  // Don't send more than this to the re-ranker
const DEFAULT_TOP_N = 5;       // Keep top N after re-ranking

export async function rerankResults(
  query: string,
  results: SearchResult[],
  topN: number = DEFAULT_TOP_N
): Promise<SearchResult[]> {
  if (results.length <= topN || !env.geminiApiKey) {
    return results.slice(0, topN);
  }

  try {
    // Limit chunks sent to re-ranker
    const candidates = results.slice(0, MAX_RERANK_CHUNKS);

    // Build chunk summaries (truncate each to save tokens)
    const chunkSummaries = candidates.map((r, i) => {
      const preview = r.chunk.content.slice(0, 500);
      return `[Chunk ${i + 1}]: ${preview}`;
    }).join('\n\n');

    const ai = getGenAI();

    const prompt = RERANK_PROMPT + `"${query}"\n\nChunks:\n${chunkSummaries}`;
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    const response = (result.text ?? '').trim();

    // Parse scores
    const jsonMatch = response.match(/\[[\d\s,.]+\]/);
    if (!jsonMatch) {
      console.log('[Reranker] Could not parse scores, using cosine order');
      return results.slice(0, topN);
    }

    const scores: number[] = JSON.parse(jsonMatch[0]);

    // Combine re-rank scores with original cosine scores
    const reranked = candidates.map((r, i) => ({
      ...r,
      // Blend: 70% re-rank score (normalized to 0-1) + 30% original cosine score
      score: (scores[i] || 0) / 10 * 0.7 + r.score * 0.3,
    }));

    reranked.sort((a, b) => b.score - a.score);
    const topResults = reranked.slice(0, topN);

    console.log(`[Reranker] Re-ranked ${candidates.length} → top ${topN} (scores: ${topResults.map(r => r.score.toFixed(2)).join(', ')})`);
    return topResults;
  } catch (err: any) {
    console.error('[Reranker] Failed, using cosine order:', err.message);
    return results.slice(0, topN);
  }
}
