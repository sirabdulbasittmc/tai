// ═════════════════════════════════════════════════════════════════════════════
// agentExecutionEngine.ts — The brain of the agent framework
//
// Each agent is a personal AI subordinate that:
// 1. Retrieves data based on instructions
// 2. Analyzes findings using LLM (with its own memory)
// 3. Compares with previous findings (what changed?)
// 4. Produces a report (findings + summary)
// 5. Notifies the user (email, WhatsApp, in-app)
// 6. Updates its memory for next run
// ═════════════════════════════════════════════════════════════════════════════

import prisma from '../db/prisma';
import createLogger from '../utils/logger';

const log = createLogger('agentEngine');

interface AgentConfig {
  id: number;
  clientNumber: string;
  userId: number;
  name: string;
  displayName: string | null;
  instructions: string;
  personality: string | null;
  dataSources: string[];
  actions: string[];
  notifyEmail: boolean;
  notifyWhatsapp: boolean;
  notifyRecipients: string[] | null;
  notifyWhatsappNumbers: string[] | null;
  memoryContext: any;
  runCount: number;
  errorCount: number;
}

// ─── Execute a single agent run ───────────────────────────────────────────────

export async function executeAgentRun(
  agentId: number,
  triggerType: 'scheduled' | 'manual' | 'whatsapp' | 'event' = 'manual',
  additionalInstructions?: string,
): Promise<{ success: boolean; runId: number; summary?: string; error?: string }> {

  // Load agent config
  const agents = await prisma.$queryRawUnsafe(
    `SELECT id, client_number, user_id, name, display_name, instructions, personality,
            data_sources, actions, notify_email, notify_whatsapp, notify_recipients,
            notify_whatsapp_numbers, memory_context, run_count, error_count
     FROM agents WHERE id = $1 AND is_active = TRUE`, agentId,
  ) as any[];

  if (!agents.length) return { success: false, runId: 0, error: 'Agent not found or inactive' };
  const agent: AgentConfig = {
    id: agents[0].id,
    clientNumber: agents[0].client_number,
    userId: agents[0].user_id,
    name: agents[0].name,
    displayName: agents[0].display_name,
    instructions: agents[0].instructions,
    personality: agents[0].personality,
    dataSources: agents[0].data_sources || [],
    actions: agents[0].actions || [],
    notifyEmail: agents[0].notify_email,
    notifyWhatsapp: agents[0].notify_whatsapp,
    notifyRecipients: agents[0].notify_recipients,
    notifyWhatsappNumbers: agents[0].notify_whatsapp_numbers,
    memoryContext: agents[0].memory_context || {},
    runCount: agents[0].run_count,
    errorCount: agents[0].error_count,
  };

  // Create run record
  const runRows = await prisma.$queryRawUnsafe(
    `INSERT INTO agent_runs (agent_id, client_number, user_id, trigger_type, status, started_at)
     VALUES ($1, $2, $3, $4, 'running', NOW()) RETURNING id`,
    agent.id, agent.clientNumber, agent.userId, triggerType,
  ) as any[];
  const runId = runRows[0].id;

  log.info('Agent run started', { agentId, runId, name: agent.name, trigger: triggerType });

  // Safety timeout: if run takes longer than 2 min, mark as failed
  const runTimeout = setTimeout(async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE agent_runs SET status = 'failed', error = 'Run timed out (2 min limit)', completed_at = NOW() WHERE id = $1 AND status = 'running'`,
      runId,
    );
    log.error('Agent run timed out', { agentId, runId });
  }, 120_000);

  try {
    // ── Step 1: Retrieve data ──────────────────────────────────
    const { classifyIntent } = await import('../services/intentService');
    const { getAIConfig } = await import('../services/aiConfigService');
    const { retrieveData } = await import('../controllers/chat/dataRetrieval');

    const aiConfig = await getAIConfig(agent.clientNumber);
    const intent = await classifyIntent(agent.instructions);

    const { context } = await retrieveData(
      agent.instructions, intent, 'gemini-flash', aiConfig, Date.now(),
      () => {}, () => false, agent.userId, agent.dataSources as any[],
    );

    log.info('Agent data retrieved', { runId, contextLen: (context || '').length });

    // ── Step 2: Build agent prompt with memory ─────────────────
    const agentName = agent.displayName || agent.name;
    const previousFindings = agent.memoryContext.lastFindings || 'No previous findings.';
    const previousRunDate = agent.memoryContext.lastRunDate || 'Never';

    const prompt = [
      `You are "${agentName}", a personal AI agent working for your boss.`,
      agent.personality ? `Your style: ${agent.personality}` : '',
      '',
      '═══════════════════════════════════════════',
      'YOUR EXACT TASK (follow this PRECISELY):',
      '═══════════════════════════════════════════',
      agent.instructions,
      additionalInstructions ? `\nBoss just added: ${additionalInstructions}` : '',
      '',
      'CRITICAL: Your job is ONLY what is described above. Do not give generic overviews.',
      'If your task says "count active projects" — give the exact count with names.',
      'If your task says "find high risks" — list each risk by name, severity, and project.',
      'If your task says "track revenue" — show exact numbers with comparisons.',
      'Be SPECIFIC. Use real data. Name names. Give numbers.',
      '',
      '── YOUR MEMORY & LEARNING ──',
      `Last check: ${previousRunDate}`,
      previousFindings !== 'No previous findings.' ? `What you found then: ${previousFindings}` : 'This is your first run.',
      agent.memoryContext.userPreferences ? `Boss preferences: ${agent.memoryContext.userPreferences}` : '',
      '',
      // Self-learned knowledge from previous runs
      Object.keys(agent.memoryContext.baselines || {}).length > 0
        ? `Your learned baselines (what's "normal"): ${JSON.stringify(agent.memoryContext.baselines)}`
        : '',
      (agent.memoryContext.knownIssues || []).length > 0
        ? `Known persistent issues: ${agent.memoryContext.knownIssues.join('; ')}`
        : '',
      (agent.memoryContext.learnedInsights || []).length > 0
        ? `Patterns you've noticed: ${agent.memoryContext.learnedInsights.filter((i: any) => i.type === 'pattern').map((i: any) => i.text).join('; ')}`
        : '',
      `Total runs completed: ${agent.memoryContext.totalRuns || agent.runCount || 0}`,
      '',
      '── REPORT FORMAT ──',
      'SUMMARY: (1-2 sentences — the key finding for notification)',
      '',
      'FINDINGS:',
      '(Detailed answer to your task. Be specific — names, numbers, dates.)',
      '',
      'CHANGES SINCE LAST CHECK:',
      previousFindings !== 'No previous findings.'
        ? '(Compare current data with your previous findings. What changed? New items? Resolved items?)'
        : '(First run — no comparison needed. Just report current state.)',
      '',
      'RECOMMENDATIONS:',
      '(What should boss do about this? Action items.)',
      '',
      context ? `── DATA (use ONLY this data, do not make up numbers) ──\n${context}\n── END DATA ──` : '── DATA ──\nNo relevant data found for this task.',
    ].filter(Boolean).join('\n');

    // ── Step 3: Generate findings via LLM ──────────────────────
    const { getGenAI } = await import('../services/genaiClient');
    const ai = getGenAI();
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { maxOutputTokens: 2048 },
    });

    const fullFindings = (result.text ?? '').trim();
    const tokensUsed = Math.ceil(fullFindings.length / 4) + Math.ceil(prompt.length / 4);

    // Extract summary (first line after "SUMMARY:")
    const summaryMatch = fullFindings.match(/SUMMARY:\s*(.+?)(?:\n|FINDINGS:)/is);
    const summary = summaryMatch ? summaryMatch[1].trim() : fullFindings.slice(0, 200);

    log.info('Agent findings generated', { runId, findingsLen: fullFindings.length, summary: summary.slice(0, 80) });

    // ── Step 4: Update run record ──────────────────────────────
    await prisma.$executeRawUnsafe(
      `UPDATE agent_runs SET status = 'completed', completed_at = NOW(),
        findings = $1, findings_summary = $2, data_context = $3, tokens_used = $4
       WHERE id = $5`,
      fullFindings, summary.slice(0, 500), (context || '').slice(0, 5000), tokensUsed, runId,
    );

    // ── Step 5: Self-learning — agent reflects on what it found ──
    // The agent builds knowledge over time:
    // - Patterns: "projects 809 is always behind schedule"
    // - Baselines: "normal project count is 47, revenue ~15M"
    // - Anomalies: "employee count dropped from 661 to 655"
    // - Boss preferences: learned from WhatsApp instructions
    const prevMemory = agent.memoryContext;
    let learnedInsights = prevMemory.learnedInsights || [];
    let baselines = prevMemory.baselines || {};
    let knownIssues = prevMemory.knownIssues || [];

    // Ask LLM to extract learnings from this run
    try {
      const learnPrompt = [
        `You are an AI agent analyzing your own findings to learn for future runs.`,
        `Your task: ${agent.instructions}`,
        ``,
        `Previous baselines: ${JSON.stringify(baselines) || 'None yet'}`,
        `Previous known issues: ${knownIssues.join('; ') || 'None yet'}`,
        ``,
        `Current findings: ${summary}`,
        ``,
        `Extract learnings in this EXACT JSON format (no markdown, just JSON):`,
        `{`,
        `  "baselines": {"key": "value"} — normal/expected values you observed (e.g., {"active_projects": "47", "high_risk_count": "5"})`,
        `  "anomalies": [] — anything that changed or is unusual compared to baselines`,
        `  "patterns": [] — recurring themes you notice across runs (keep max 5)`,
        `  "known_issues": [] — persistent problems that haven't been resolved (keep max 5)`,
        `}`,
      ].join('\n');

      const learnResult = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: learnPrompt,
        config: { maxOutputTokens: 512 },
      });

      const learnText = (learnResult.text ?? '').trim().replace(/```json|```/g, '').trim();
      const jsonMatch = learnText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const learned = JSON.parse(jsonMatch[0]);
        // Merge baselines (new values overwrite old)
        if (learned.baselines) baselines = { ...baselines, ...learned.baselines };
        // Add new anomalies to insights
        if (learned.anomalies?.length) {
          learnedInsights = [...learnedInsights, ...learned.anomalies.map((a: string) => ({ type: 'anomaly', text: a, date: new Date().toISOString() }))].slice(-10);
        }
        // Update patterns
        if (learned.patterns?.length) {
          learnedInsights = [...learnedInsights.filter((i: any) => i.type !== 'pattern'), ...learned.patterns.map((p: string) => ({ type: 'pattern', text: p, date: new Date().toISOString() }))].slice(-10);
        }
        // Update known issues
        if (learned.known_issues?.length) knownIssues = learned.known_issues.slice(0, 5);
      }
    } catch (e: any) {
      log.error('Agent learning failed (non-fatal)', { runId, error: e.message });
    }

    // Build updated memory
    const updatedMemory = {
      ...prevMemory,
      lastFindings: summary,
      lastRunDate: new Date().toISOString(),
      lastRunId: runId,
      runHistory: [
        ...(prevMemory.runHistory || []).slice(-9),
        { runId, date: new Date().toISOString(), summary: summary.slice(0, 100) },
      ],
      // Learning data
      baselines,
      learnedInsights,
      knownIssues,
      totalRuns: (prevMemory.totalRuns || 0) + 1,
    };

    // Cap memory at 10KB
    const memoryStr = JSON.stringify(updatedMemory);
    const memoryToSave = memoryStr.length > 10240
      ? JSON.stringify({ ...updatedMemory, runHistory: updatedMemory.runHistory.slice(-3), learnedInsights: learnedInsights.slice(-5) })
      : memoryStr;

    await prisma.$executeRawUnsafe(
      `UPDATE agents SET memory_context = $1::jsonb, last_run_at = NOW(), last_result = $2,
        run_count = run_count + 1, error_count = 0, updated_at = NOW()
       WHERE id = $3`,
      memoryToSave, summary.slice(0, 500), agentId,
    );

    // ── Step 6: Send notifications ─────────────────────────────
    const notifiedVia: string[] = [];

    // Email notification
    if (agent.notifyEmail) {
      try {
        const userRows = await prisma.$queryRawUnsafe(`SELECT email FROM users WHERE id = $1`, agent.userId) as any[];
        const userEmail = userRows[0]?.email;
        if (userEmail) {
          const recipients = [userEmail, ...(agent.notifyRecipients || [])];
          await sendAgentEmailReport(agentName, agent.instructions, fullFindings, summary, recipients);
          notifiedVia.push('email');
        }
      } catch (e: any) { log.error('Agent email notification failed', { runId, error: e.message }); }
    }

    // WhatsApp notification — suppress if user is actively chatting (last message < 2 min ago)
    if (agent.notifyWhatsapp) {
      let suppressWA = false;
      if (triggerType === 'scheduled') {
        const recentChat = await prisma.$queryRawUnsafe(
          `SELECT 1 FROM whatsapp_sessions WHERE user_id = $1 AND client_number = $2 AND closed_at IS NULL
           AND last_message_at > NOW() - INTERVAL '2 minutes' LIMIT 1`,
          agent.userId, agent.clientNumber,
        ) as any[];
        if (recentChat.length) {
          suppressWA = true;
          log.info('Suppressing WhatsApp notification — user is actively chatting', { agentId, runId });
        }
      }
      if (!suppressWA) {
        try {
          const { sendWhatsAppMessage } = await import('../services/whatsapp/WhatsAppManager');
          const connections = await prisma.$queryRawUnsafe(
            `SELECT phone_number FROM whatsapp_connections WHERE user_id = $1 AND status = 'active'`, agent.userId,
          ) as any[];
          const numbersToNotify = [
            ...(connections.map((c: any) => c.phone_number)),
            ...(agent.notifyWhatsappNumbers || []),
          ];
          for (const number of numbersToNotify) {
            await sendWhatsAppMessage({
              clientNumber: agent.clientNumber,
              to: number,
              message: `*${agentName}* just completed a check:\n\n${summary}\n\nSay "${agentName} show details" for full report.`,
              agentId: agent.id,
            });
          }
          notifiedVia.push('whatsapp');
        } catch (e: any) { log.error('Agent WhatsApp notification failed', { runId, error: e.message }); }
      }
    }

    // Update notified_via
    if (notifiedVia.length) {
      await prisma.$executeRawUnsafe(
        `UPDATE agent_runs SET notified_via = $1::text[] WHERE id = $2`,
        `{${notifiedVia.join(',')}}`, runId,
      );
    }

    clearTimeout(runTimeout);
    log.info('Agent run completed', { agentId, runId, notifiedVia });
    return { success: true, runId, summary };

  } catch (error: any) {
    clearTimeout(runTimeout);
    log.error('Agent run failed', { agentId, runId, error: error.message });

    // Update run as failed
    await prisma.$executeRawUnsafe(
      `UPDATE agent_runs SET status = 'failed', completed_at = NOW(), error = $1 WHERE id = $2`,
      error.message, runId,
    );

    // Increment error count (circuit breaker opens at 3)
    await prisma.$executeRawUnsafe(
      `UPDATE agents SET error_count = error_count + 1, last_error = $1, updated_at = NOW() WHERE id = $2`,
      error.message, agentId,
    );

    return { success: false, runId, error: error.message };
  }
}

// ─── Get agent run history ────────────────────────────────────────────────────

export async function getAgentRuns(agentId: number, limit = 20): Promise<any[]> {
  return prisma.$queryRawUnsafe(
    `SELECT id, trigger_type, status, started_at, completed_at, findings_summary,
            tokens_used, cost_usd, error, notified_via
     FROM agent_runs WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`,
    agentId, limit,
  ) as Promise<any[]>;
}

export async function getAgentRunDetail(runId: number): Promise<any> {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM agent_runs WHERE id = $1`, runId,
  ) as any[];
  return rows[0] || null;
}

// ─── Email report for agent findings ──────────────────────────────────────────

function markdownToHtml(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')      // **bold** → <strong>
    .replace(/\*(.+?)\*/g, '<em>$1</em>')                   // *italic* → <em>
    .replace(/^#{3}\s+(.+)$/gm, '<h3 style="color:#333;font-size:14px;margin:16px 0 6px;">$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2 style="color:#1a1a2e;font-size:16px;margin:20px 0 8px;border-bottom:1px solid #e5e5e5;padding-bottom:6px;">$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1 style="color:#1a1a2e;font-size:18px;margin:20px 0 10px;">$1</h1>')
    .replace(/^[•\-\*]\s+(.+)$/gm, '<li style="margin:4px 0;color:#444;">$1</li>')
    .replace(/^(\d+)\.\s+(.+)$/gm, '<li style="margin:4px 0;color:#444;">$2</li>')
    .replace(/^(SUMMARY|FINDINGS|CHANGES SINCE LAST CHECK|RECOMMENDATIONS|CHANGES):?\s*$/gim,
      (m) => `<h2 style="color:#1a1a2e;font-size:15px;margin:24px 0 10px;border-bottom:1px solid #e5e5e5;padding-bottom:6px;">${m.replace(/:$/, '')}</h2>`)
    .split('\n')
    .map(line => {
      const t = line.trim();
      if (!t) return '<br/>';
      if (t.startsWith('<h') || t.startsWith('<li')) return t;
      return `<p style="margin:6px 0;line-height:1.7;color:#444;">${t}</p>`;
    })
    .join('\n');
}

async function sendAgentEmailReport(
  agentName: string,
  task: string,
  findings: string,
  summary: string,
  recipients: string[],
): Promise<void> {
  const { sendEmail } = await import('../services/emailService');

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const findingsHtml = markdownToHtml(findings);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;color:#333;">
  <div style="max-width:700px;margin:20px auto;background:#ffffff;border-radius:6px;overflow:hidden;border:1px solid #e0e0e0;">

    <!-- Header -->
    <div style="background:#1a1a2e;padding:20px 32px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><span style="color:#cc6b4a;font-size:20px;font-weight:700;">${agentName}</span></td>
        <td align="right"><span style="color:#888;font-size:12px;">${dateStr}<br/>${timeStr}</span></td>
      </tr></table>
    </div>

    <!-- Subject line -->
    <div style="padding:16px 32px;background:#f9f9f9;border-bottom:1px solid #eee;">
      <p style="margin:0;font-size:15px;font-weight:600;color:#1a1a2e;">${summary}</p>
      <p style="margin:6px 0 0;font-size:12px;color:#888;">Task: ${task.slice(0, 120)}</p>
    </div>

    <!-- Greeting -->
    <div style="padding:24px 32px 0;">
      <p style="margin:0;font-size:14px;color:#333;">Dear Sir/Madam,</p>
      <p style="margin:8px 0 16px;font-size:14px;color:#444;line-height:1.6;">
        Please find below my latest findings based on the assigned task. This report covers the current status,
        any changes observed since the previous review, and recommended actions.
      </p>
    </div>

    <!-- Findings -->
    <div style="padding:0 32px 24px;font-size:14px;line-height:1.7;">
      ${findingsHtml}
    </div>

    <!-- Signature -->
    <div style="padding:16px 32px;border-top:1px solid #eee;">
      <p style="margin:0;font-size:13px;color:#333;">Best regards,</p>
      <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#1a1a2e;">${agentName}</p>
      <p style="margin:2px 0 0;font-size:12px;color:#888;">AI Agent — TMC AI Intelligence Platform</p>
    </div>

    <!-- Footer -->
    <div style="padding:12px 32px;background:#f9f9f9;border-top:1px solid #eee;text-align:center;">
      <p style="margin:0;font-size:11px;color:#aaa;">
        This report was generated automatically by TMC AI. For interactive dashboards and detailed analysis,
        visit <a href="https://tai.tmcltd.com" style="color:#cc6b4a;text-decoration:none;">tai.tmcltd.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  const subject = `[${agentName}] ${summary.slice(0, 70)}`;
  for (const to of recipients) {
    await sendEmail(to, subject, html);
  }
}
