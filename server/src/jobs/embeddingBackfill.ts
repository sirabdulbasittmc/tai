// ═════════════════════════════════════════════════════════════════════════════
// embeddingBackfill.ts — Phase 2.1: Backfill missing embeddings in BigQuery
//
// Reads all BQ chunks with null/empty embeddings, generates embeddings via
// the embedder pipeline, and writes them back to BQ.
//
// Usage:
//   - Call runEmbeddingBackfill() from a cron job (recommended: nightly 2 AM)
//   - Or invoke manually via an admin endpoint
// ═════════════════════════════════════════════════════════════════════════════

import { BigQuery } from '@google-cloud/bigquery';
import { embedBatch } from '../pipeline/embedder';
import createLogger from '../utils/logger';

const log = createLogger('embeddingBackfill');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'tmcai-491811';
const BQ_DATASET = process.env.BQ_DATASET     || 'tmcai_index';
const BQ_TABLE   = process.env.BQ_TABLE       || 'chunks';

const BATCH_SIZE = 50; // Match embedder batch size

const bq = new BigQuery({ projectId: PROJECT_ID });

interface BackfillResult {
  total: number;
  embedded: number;
  errors: number;
}

/**
 * Run the embedding backfill job.
 * Queries BQ for chunks missing embeddings, generates them in batches,
 * and writes the vectors back to BQ.
 */
export async function runEmbeddingBackfill(): Promise<BackfillResult> {
  const startTime = Date.now();
  log.info('Starting embedding backfill job');

  // Step 1: Query chunks with missing embeddings
  const query = `
    SELECT chunk_id, content
    FROM \`${PROJECT_ID}.${BQ_DATASET}.${BQ_TABLE}\`
    WHERE embedding IS NULL OR ARRAY_LENGTH(embedding) = 0
  `;

  let rows: Array<{ chunk_id: string; content: string }>;
  try {
    const [result] = await bq.query({ query });
    rows = result as Array<{ chunk_id: string; content: string }>;
  } catch (e: any) {
    log.error('Failed to query chunks for backfill', { error: e.message });
    return { total: 0, embedded: 0, errors: 1 };
  }

  const total = rows.length;
  if (total === 0) {
    log.info('No chunks need embedding backfill');
    return { total: 0, embedded: 0, errors: 0 };
  }

  log.info('Found chunks needing embeddings', { total });

  let embedded = 0;
  let errors = 0;

  // Step 2 & 3: Process in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map(r => r.content);

    try {
      const vectors = await embedBatch(texts);

      // Write each embedding back to BQ
      for (let j = 0; j < batch.length; j++) {
        const chunkId = batch[j].chunk_id;
        const embedding = vectors[j];

        if (!embedding || embedding.length === 0) {
          log.warn('Empty embedding returned', { chunkId });
          errors++;
          continue;
        }

        try {
          const updateQuery = `
            UPDATE \`${PROJECT_ID}.${BQ_DATASET}.${BQ_TABLE}\`
            SET embedding = @embedding
            WHERE chunk_id = @chunkId
          `;
          await bq.query({
            query: updateQuery,
            params: { embedding, chunkId },
            types: { embedding: ['FLOAT64'], chunkId: 'STRING' },
          });
          embedded++;
        } catch (updateErr: any) {
          log.error('Failed to update embedding', { chunkId, error: updateErr.message });
          errors++;
        }
      }

      log.info('Batch complete', {
        batchStart: i,
        batchEnd: Math.min(i + BATCH_SIZE, rows.length),
        embedded,
        errors,
        total,
      });
    } catch (batchErr: any) {
      log.error('Batch embedding failed', {
        batchStart: i,
        error: batchErr.message,
      });
      errors += batch.length;
    }
  }

  const elapsedMs = Date.now() - startTime;
  log.info('Embedding backfill complete', { total, embedded, errors, elapsedMs });

  return { total, embedded, errors };
}
