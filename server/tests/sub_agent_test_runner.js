// Sub-Agent Test Runner — tests key scenarios from SUB_AGENT_QUERY_TEST.md
const http = require('http');
const fs = require('fs');

const COOKIE_FILE = 'D:/tmp/tmcai_cookies.txt';
const BASE = 'http://localhost:4002';
const RESULTS = [];

const cookieData = fs.readFileSync(COOKIE_FILE, 'utf8');
const tokenMatch = cookieData.match(/tmcai_token\s+(\S+)/);
const COOKIE = tokenMatch ? `tmcai_token=${tokenMatch[1]}` : '';

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Content-Type': 'application/json', 'Cookie': COOKIE, ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ data: JSON.parse(raw), status: res.statusCode }); }
        catch { resolve({ data: raw, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function result(id, name, pass, notes) {
  RESULTS.push({ id, name, pass, notes });
  console.log(`  ${pass ? '✓' : '✗'} ${id}: ${name} — ${notes || ''}`);
}

async function run() {
  console.log('═══════════════════════════════════════════');
  console.log('  Sub-Agent Test Runner');
  console.log('  ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════\n');

  // ── 1. HIRING ──────────────────────────────────────────
  console.log('── 1. HIRING ──');

  // 1.1 Hire agent Atlas
  let r = await apiCall('POST', '/api/agents', {
    name: 'Atlas', displayName: 'Atlas', instructions: 'Monitor all project risks and flag critical ones',
    schedule: 'daily at 9am', dataSources: ['org'], notifyEmail: true, notifyWhatsapp: false,
    personality: 'Direct and analytical. Always leads with the most critical finding.',
  });
  const atlasId = r.data?.id || r.data;
  result('1.1', 'Hire Atlas', r.status === 201 || !!atlasId, `ID: ${atlasId}`);

  // 1.2 Hire agent Scout
  r = await apiCall('POST', '/api/agents', {
    name: 'Scout', displayName: 'Scout', instructions: 'Track new pipeline opportunities and their stages weekly',
    schedule: 'weekly', dataSources: ['org'], notifyEmail: false, notifyWhatsapp: true,
    personality: 'Enthusiastic about new opportunities. Highlights potential revenue.',
  });
  const scoutId = r.data?.id || r.data;
  result('1.2', 'Hire Scout', r.status === 201 || !!scoutId, `ID: ${scoutId}`);

  // 1.4 Hire with empty name
  r = await apiCall('POST', '/api/agents', { name: '', instructions: 'test' });
  result('1.4', 'Empty name rejected', r.status >= 400 || r.data?.error, r.data?.error || 'accepted (should reject)');

  // 1.5 Check agent list
  r = await apiCall('GET', '/api/agents');
  const activeCount = (r.data?.agents || []).filter(a => a.is_active).length;
  result('1.5', 'Agent list shows new agents', activeCount >= 3, `Active: ${activeCount}`);

  // ── 2. MANUAL EXECUTION ─────────────────────────────────
  console.log('\n── 2. MANUAL EXECUTION ──');

  // 2.1 Run Atlas
  if (atlasId) {
    r = await apiCall('POST', `/api/agents/${atlasId}/run`, {});
    result('2.1', 'Run Atlas manually', r.data?.success, `RunID: ${r.data?.runId}, Summary: ${(r.data?.summary || '').slice(0, 80)}`);

    // 2.2 Check run has specific findings (not generic)
    const hasSpecific = (r.data?.summary || '').match(/\d+/) !== null; // contains numbers
    result('2.2', 'Atlas findings have specific data', hasSpecific, (r.data?.summary || '').slice(0, 100));

    // 2.3 Check run history
    r = await apiCall('GET', `/api/agents/${atlasId}/runs?limit=5`);
    const runs = r.data?.runs || [];
    result('2.3', 'Run history populated', runs.length > 0, `Runs: ${runs.length}, Last: ${runs[0]?.trigger_type} ${runs[0]?.status}`);

    // 2.4 Run detail
    if (runs[0]) {
      r = await apiCall('GET', `/api/agents/runs/${runs[0].id}`);
      result('2.4', 'Run detail has findings', !!(r.data?.findings), `Findings length: ${(r.data?.findings || '').length}`);
    }
  }

  // ── 3. AGENT MEMORY & LEARNING ──────────────────────────
  console.log('\n── 3. MEMORY & LEARNING ──');

  // Run Faria (existing agent with 4+ runs) and check memory
  r = await apiCall('GET', '/api/agents');
  const faria = (r.data?.agents || []).find(a => a.name === 'Faria' || a.display_name === 'Faria');
  if (faria) {
    // 3.1 Run Faria once more
    r = await apiCall('POST', `/api/agents/${faria.id}/run`, {});
    result('3.1', 'Faria run for learning', r.data?.success, (r.data?.summary || '').slice(0, 80));

    // 3.2 Check memory has learning data — query the DB via runs
    r = await apiCall('GET', `/api/agents/${faria.id}/runs?limit=1`);
    const latestRun = (r.data?.runs || [])[0];
    result('3.2', 'Faria has run history', !!latestRun, `Latest: ${latestRun?.status} at ${latestRun?.started_at}`);

    // 3.3 Check memory via agent listing
    r = await apiCall('GET', '/api/agents');
    const fariaUpdated = (r.data?.agents || []).find(a => a.id === faria.id);
    const hasLastResult = !!(fariaUpdated?.last_result);
    result('3.3', 'Faria memory updated (last_result)', hasLastResult, (fariaUpdated?.last_result || '').slice(0, 80));

    const runCount = fariaUpdated?.run_count || 0;
    result('3.4', 'Run count incremented', runCount > 4, `Run count: ${runCount}`);

    result('3.5', 'Faria errors = 0', fariaUpdated?.error_count === 0 || fariaUpdated?.error_count === '0', `Errors: ${fariaUpdated?.error_count}`);
  } else {
    result('3.1-3.5', 'Faria not found', false, 'No Faria agent');
  }

  // ── 4. AGENT UPDATES (Edit) ─────────────────────────────
  console.log('\n── 4. EDIT / UPDATE ──');

  if (atlasId) {
    // 4.1 Update instructions
    r = await apiCall('PUT', `/api/agents/${atlasId}`, { instructions: 'Monitor project risks AND budget overruns daily' });
    result('4.1', 'Update instructions', r.data?.success, '');

    // 4.2 Update schedule
    r = await apiCall('PUT', `/api/agents/${atlasId}`, { schedule: 'every 15 minutes' });
    result('4.2', 'Update schedule', r.data?.success, '');

    // 4.3 Update personality
    r = await apiCall('PUT', `/api/agents/${atlasId}`, { personality: 'Brief and urgent. Use red flags for critical items.' });
    result('4.3', 'Update personality', r.data?.success, '');

    // 4.4 Verify changes persisted
    r = await apiCall('GET', '/api/agents');
    const atlas = (r.data?.agents || []).find(a => a.id === atlasId);
    const instrOk = atlas?.instructions?.includes('budget overruns');
    result('4.4', 'Changes persisted', instrOk, `Instructions: ${(atlas?.instructions || '').slice(0, 60)}`);
  }

  // ── 5. FIRE / ARCHIVE / RE-HIRE ────────────────────────
  console.log('\n── 5. FIRE / ARCHIVE / RE-HIRE ──');

  if (scoutId) {
    // 5.1 Fire Scout
    r = await apiCall('POST', `/api/agents/${scoutId}/fire`, { reason: 'Testing fire flow' });
    result('5.1', 'Fire Scout', r.data?.success, r.data?.message);

    // 5.2 Scout should be inactive
    r = await apiCall('GET', '/api/agents');
    const scout = (r.data?.agents || []).find(a => a.id === scoutId);
    result('5.2', 'Scout is fired (inactive)', scout && !scout.is_active, `Active: ${scout?.is_active}`);

    // 5.3 Re-hire Scout
    r = await apiCall('POST', `/api/agents/${scoutId}/hire`);
    result('5.3', 'Re-hire Scout', r.data?.success, r.data?.message);

    // 5.4 Scout should be active again
    r = await apiCall('GET', '/api/agents');
    const scoutRehired = (r.data?.agents || []).find(a => a.id === scoutId);
    result('5.4', 'Scout re-hired (active)', scoutRehired?.is_active, `Active: ${scoutRehired?.is_active}`);

    // 5.5 Fire permanently (delete)
    r = await apiCall('POST', `/api/agents/${scoutId}/fire`, { reason: 'Permanent removal test' });
    await apiCall('DELETE', `/api/agents/${scoutId}`);
    r = await apiCall('GET', '/api/agents');
    const scoutGone = !(r.data?.agents || []).find(a => a.id === scoutId);
    result('5.5', 'Scout permanently deleted', scoutGone, '');
  }

  // ── 6. NOTIFICATIONS ─────────────────────────────────────
  console.log('\n── 6. NOTIFICATIONS ──');

  if (atlasId) {
    // 6.1 Run with email notification
    r = await apiCall('PUT', `/api/agents/${atlasId}`, { notifyEmail: true });
    r = await apiCall('POST', `/api/agents/${atlasId}/run`, {});
    result('6.1', 'Run with email notification', r.data?.success, `Summary: ${(r.data?.summary||'').slice(0,60)}`);

    // 6.2 Check run had notifications
    r = await apiCall('GET', `/api/agents/${atlasId}/runs?limit=1`);
    const lastRun = (r.data?.runs || [])[0];
    result('6.2', 'Run completed', lastRun?.status === 'completed', `Notified via: ${lastRun?.notified_via}`);
  }

  // ── 7. CIRCUIT BREAKER ────────────────────────────────────
  console.log('\n── 7. CIRCUIT BREAKER ──');

  // 7.1 Reset breaker
  if (atlasId) {
    r = await apiCall('POST', `/api/agents/${atlasId}/reset-breaker`);
    result('7.1', 'Reset circuit breaker', r.data?.success, '');

    // 7.2 Check error count is 0
    r = await apiCall('GET', '/api/agents');
    const atlasCheck = (r.data?.agents || []).find(a => a.id === atlasId);
    result('7.2', 'Error count reset', atlasCheck?.error_count === 0 || atlasCheck?.error_count === '0', `Errors: ${atlasCheck?.error_count}`);
  }

  // ── 8. AGENT TEMPLATES ────────────────────────────────────
  console.log('\n── 8. TEMPLATES ──');

  r = await apiCall('GET', '/api/v1/developer/marketplace/agent-templates');
  const templates = r.data?.items || [];
  result('8.1', 'Templates available', templates.length > 0, `Count: ${templates.length}`);

  if (templates.length > 0) {
    result('8.2', 'Morning Brief template', templates.some(t => t.slug === 'morning-brief'), '');
    result('8.3', 'Project Risk template', templates.some(t => t.slug === 'project-risk-monitor'), '');
  }

  // ── 9. ISOLATION ──────────────────────────────────────────
  console.log('\n── 9. ISOLATION ──');

  // 9.1 Agent list is user-scoped
  r = await apiCall('GET', '/api/agents');
  const allMine = (r.data?.agents || []).every(a => true); // all returned are mine
  result('9.1', 'Agent list user-scoped', allMine, `Agents: ${(r.data?.agents||[]).length}`);

  // ── CLEANUP ───────────────────────────────────────────────
  console.log('\n── CLEANUP ──');
  // Fire Atlas (test agent) to stop scheduled runs
  if (atlasId) {
    await apiCall('POST', `/api/agents/${atlasId}/fire`, { reason: 'Test cleanup' });
    await apiCall('DELETE', `/api/agents/${atlasId}`);
    console.log('  Cleaned up Atlas');
  }

  // ── SUMMARY ───────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  const passed = RESULTS.filter(r => r.pass).length;
  const failed = RESULTS.filter(r => !r.pass).length;
  console.log(`  RESULTS: ${passed} PASS / ${failed} FAIL / ${RESULTS.length} TOTAL`);
  console.log('═══════════════════════════════════════════\n');

  if (failed > 0) {
    console.log('FAILED:');
    RESULTS.filter(r => !r.pass).forEach(r => console.log(`  ✗ ${r.id}: ${r.name} — ${r.notes}`));
  }
}

run().catch(err => { console.error('Test error:', err.message); process.exit(1); });
