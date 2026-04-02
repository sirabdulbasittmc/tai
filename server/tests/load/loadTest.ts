// ═════════════════════════════════════════════════════════════════════════════
// loadTest.ts — Phase 2.8: Load Testing Gate
//
// Manual load test script for TMCAI server endpoints.
// Run: npx ts-node tests/load/loadTest.ts
//
// Environment variables:
//   LOAD_TEST_URL   — Base URL (default: http://localhost:4002)
//   LOAD_TEST_TOKEN — Auth token cookie for authenticated endpoints
// ═════════════════════════════════════════════════════════════════════════════

import autocannon from 'autocannon';

const BASE_URL = process.env.LOAD_TEST_URL || 'http://localhost:4002';

async function runScenario(name: string, opts: autocannon.Options): Promise<autocannon.Result> {
  console.log(`\n=== ${name} ===`);
  const result = await autocannon(opts);
  console.log(`  Requests: ${result.requests.total}`);
  console.log(`  Throughput: ${result.throughput.average} bytes/sec`);
  console.log(`  Latency p50: ${result.latency.p50}ms`);
  console.log(`  Latency p95: ${result.latency.p95}ms`);
  console.log(`  Latency p99: ${result.latency.p99}ms`);
  console.log(`  Errors: ${result.errors}`);
  console.log(`  Non-2xx: ${result.non2xx}`);
  return result;
}

async function main() {
  console.log(`Load test target: ${BASE_URL}`);
  console.log(`Started at: ${new Date().toISOString()}`);

  // ── Scenario 1: Health check baseline ──────────────────────────────────
  const health = await runScenario('Health Check Baseline', {
    url: `${BASE_URL}/api/health`,
    connections: 10,
    duration: 10,
  });

  // ── Scenario 2: Chat endpoint sustained load ──────────────────────────
  const token = process.env.LOAD_TEST_TOKEN;
  if (token) {
    await runScenario('Chat Sustained (50 concurrent)', {
      url: `${BASE_URL}/api/chat/stream`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `tmcai_token=${token}`,
      },
      body: JSON.stringify({
        message: 'hi good morning',
        provider: 'gemini-flash',
      }),
      connections: 50,
      duration: 30,
    });

    // ── Scenario 3: Chat burst test ───────────────────────────────────────
    await runScenario('Chat Burst (100 concurrent, 10s)', {
      url: `${BASE_URL}/api/chat/stream`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `tmcai_token=${token}`,
      },
      body: JSON.stringify({
        message: 'show me project summary',
        provider: 'gemini-flash',
      }),
      connections: 100,
      duration: 10,
    });
  } else {
    console.log('\nSkipping chat load tests -- set LOAD_TEST_TOKEN env var');
  }

  console.log('\n=== Load Test Complete ===');
  console.log(`Finished at: ${new Date().toISOString()}`);
}

main().catch(console.error);
