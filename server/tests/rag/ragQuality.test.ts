import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../../src/services/intentService';
import { GOLDEN_QUERIES } from './goldenQueries';

const hasKey = !!process.env.GEMINI_API_KEY;

describe.skipIf(!hasKey)('RAG Quality - Intent Classification', () => {
  const results: { query: string; expected: string; actual: string; pass: boolean }[] = [];

  for (const gq of GOLDEN_QUERIES) {
    it(`classifies "${gq.query}" as ${gq.expectedIntent}`, async () => {
      const intent = await classifyIntent(gq.query);
      const pass = intent.type === gq.expectedIntent;
      results.push({
        query: gq.query,
        expected: gq.expectedIntent,
        actual: intent.type,
        pass,
      });
      // Individual test reports the result but does not fail —
      // accuracy is checked in the aggregate test below.
      expect(intent.type).toBeTruthy();
    }, 15_000); // 15s per query (API call)
  }

  it('achieves >= 70% overall accuracy', () => {
    // Only run once all individual tests have populated results
    if (results.length === 0) {
      // If no results yet (shouldn't happen), skip
      return;
    }

    const matched = results.filter((r) => r.pass).length;
    const total = results.length;
    const accuracy = matched / total;

    console.log('\n── Intent Classification Accuracy Report ──');
    console.log(`Total: ${total} | Passed: ${matched} | Accuracy: ${(accuracy * 100).toFixed(1)}%`);

    const failures = results.filter((r) => !r.pass);
    if (failures.length > 0) {
      console.log('\nMismatches:');
      for (const f of failures) {
        console.log(`  "${f.query}" → expected: ${f.expected}, got: ${f.actual}`);
      }
    }
    console.log('── End Report ──\n');

    expect(accuracy).toBeGreaterThanOrEqual(0.7);
  });
});
