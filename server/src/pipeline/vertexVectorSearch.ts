// ═════════════════════════════════════════════════════════════════════════════
// vertexVectorSearch.ts — Vertex AI Vector Search (Matching Engine) client
//
// Phase 2.7: Queries the deployed Vertex AI Vector Search index endpoint
// for nearest-neighbor chunk retrieval, replacing in-memory cosine similarity
// when enabled via feature flag ff_vector_search_enabled.
// ═════════════════════════════════════════════════════════════════════════════

import { v1 } from '@google-cloud/aiplatform';
import createLogger from '../utils/logger';

const log = createLogger('vertexVectorSearch');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PROJECT_ID  = process.env.GCP_PROJECT_ID || 'tmcai-491811';
const LOCATION    = process.env.GCP_LOCATION   || 'us-central1';
const ENDPOINT_ID = process.env.VECTOR_SEARCH_ENDPOINT_ID || '4700748659300499456';
const INDEX_ID    = process.env.VECTOR_SEARCH_INDEX_ID    || '6446016660208877568';

// The deployed index ID is assigned when the index is deployed to the endpoint.
// TODO: Verify this value from the GCP console under Index Endpoints > Deployed Indexes.
// It is often the index ID itself or a custom name set during deployment.
const DEPLOYED_INDEX_ID = process.env.VECTOR_SEARCH_DEPLOYED_INDEX_ID || `tmcai_index_${INDEX_ID}`;

const INDEX_ENDPOINT_PATH =
  `projects/${PROJECT_ID}/locations/${LOCATION}/indexEndpoints/${ENDPOINT_ID}`;

const VECTOR_SEARCH_TIMEOUT_MS = 3000;

// ─── CLIENT (lazy singleton) ────────────────────────────────────────────────

let matchClient: v1.MatchServiceClient | null = null;

function getMatchClient(): v1.MatchServiceClient {
  if (!matchClient) {
    matchClient = new v1.MatchServiceClient({
      apiEndpoint: `${LOCATION}-aiplatform.googleapis.com`,
    });
  }
  return matchClient;
}

// ─── QUERY VECTOR SEARCH ────────────────────────────────────────────────────

export interface VectorSearchResult {
  chunkId: string;
  score: number;
}

/**
 * Query the Vertex AI Vector Search endpoint for nearest neighbors.
 *
 * @param queryEmbedding - The embedding vector for the user query
 * @param topK - Number of nearest neighbors to return
 * @param filters - Optional domain filter applied via token restriction
 * @returns Array of { chunkId, score } sorted by relevance (highest score first)
 */
export async function queryVectorSearch(
  queryEmbedding: number[],
  topK: number,
  filters?: { domain?: string },
): Promise<VectorSearchResult[]> {
  const client = getMatchClient();

  // Build restriction filters for domain-level filtering
  const restricts: Array<{ namespace: string; allowList: string[] }> = [];
  if (filters?.domain) {
    restricts.push({
      namespace: 'domain',
      allowList: [filters.domain],
    });
  }

  const request = {
    indexEndpoint: INDEX_ENDPOINT_PATH,
    deployedIndexId: DEPLOYED_INDEX_ID,
    queries: [
      {
        datapoint: {
          featureVector: queryEmbedding,
          restricts: restricts.length > 0 ? restricts : undefined,
        },
        neighborCount: topK,
      },
    ],
  };

  log.info('Vector search request', {
    endpoint: ENDPOINT_ID,
    deployedIndex: DEPLOYED_INDEX_ID,
    topK,
    domain: filters?.domain || 'all',
    embeddingDim: queryEmbedding.length,
  });

  // Apply timeout via AbortController
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VECTOR_SEARCH_TIMEOUT_MS);

  try {
    const [response] = await client.findNeighbors(request, {
      timeout: VECTOR_SEARCH_TIMEOUT_MS,
    });

    clearTimeout(timeout);

    const neighbors = response.nearestNeighbors?.[0]?.neighbors || [];

    const results: VectorSearchResult[] = neighbors
      .filter((n) => n.datapoint?.datapointId)
      .map((n) => ({
        chunkId: n.datapoint!.datapointId!,
        // Vertex AI returns distance (lower = closer); convert to similarity score
        // For cosine distance: similarity = 1 - distance
        score: 1 - (n.distance ?? 0),
      }))
      .sort((a, b) => b.score - a.score);

    log.info('Vector search results', {
      count: results.length,
      topScore: results[0]?.score ?? 0,
    });

    return results;
  } catch (err: any) {
    clearTimeout(timeout);

    if (err.name === 'AbortError' || err.code === 'DEADLINE_EXCEEDED') {
      log.warn('Vector search timed out', { timeoutMs: VECTOR_SEARCH_TIMEOUT_MS });
    } else {
      log.error('Vector search failed', { error: err.message, code: err.code });
    }

    return [];
  }
}

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────

/**
 * Verify the Vector Search endpoint is reachable and has a deployed index.
 */
export async function isVectorSearchReady(): Promise<{ ready: boolean; deployedIndexes?: number; error?: string }> {
  try {
    const { IndexEndpointServiceClient } = await import('@google-cloud/aiplatform');
    const endpointClient = new IndexEndpointServiceClient({
      apiEndpoint: `${LOCATION}-aiplatform.googleapis.com`,
    });
    const [endpoint] = await endpointClient.getIndexEndpoint({
      name: INDEX_ENDPOINT_PATH,
    });
    const count = endpoint?.deployedIndexes?.length ?? 0;
    return { ready: count > 0, deployedIndexes: count };
  } catch (e: any) {
    return { ready: false, error: e.message };
  }
}
