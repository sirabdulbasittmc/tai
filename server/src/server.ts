import './instrumentation';
import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { validateEnv, env } from './config/env';
import { startAutoRefresh } from './services/indexCacheService';
import { initScheduler } from './services/schedulerService';
import { cleanupExpiredContextMemories } from './services/memoryService';
import { runPersonalDriveSyncJob } from './jobs/personalDriveSyncJob';
import { startIndexEventProcessor } from './services/indexEventService';
import { runProactiveIntelligence } from './services/proactiveIntelligenceService';

validateEnv();

app.listen(env.port, async () => {
  console.log(`TMCAI Server listening on port ${env.port}`);
  startAutoRefresh(env.indexRefreshIntervalMs);
  await initScheduler().catch(err => console.error('Scheduler init failed:', err.message));
  // Cleanup expired context memories every hour
  cleanupExpiredContextMemories().catch(() => {});
  setInterval(() => cleanupExpiredContextMemories().catch(() => {}), 60 * 60 * 1000);
  // Personal GDrive sync every 30 minutes (Phase 3.1)
  runPersonalDriveSyncJob().catch(() => {});
  setInterval(() => runPersonalDriveSyncJob().catch(() => {}), 30 * 60 * 1000);
  // Phase 5: Index event processor (polls every 10s)
  startIndexEventProcessor();
  // Phase 5: Proactive intelligence — hourly scan
  setInterval(() => runProactiveIntelligence().catch(() => {}), 60 * 60 * 1000);
  // Agent scheduler: initialize all scheduled agents
  import('./agents/agentScheduler').then(({ initializeAgentScheduler }) => {
    initializeAgentScheduler().then(() => console.log('[Agents] Scheduler initialized')).catch(() => {});
  }).catch(() => {});

  // WhatsApp: initialize all tenant connections (non-fatal on failure)
  if (process.env.ENABLE_WHATSAPP === 'true') {
    import('./services/whatsapp/WhatsAppManager').then(({ initializeAllTenants }) => {
      initializeAllTenants().then(() => console.log('[WhatsApp] All tenants initialized')).catch(() => {});
    }).catch(() => {});
  }
  // Smart log maintenance — hourly: escalate high-recurrence, auto-fix known patterns, cleanup old
  setInterval(async () => {
    try {
      const { escalateHighRecurrence, runAutoFix, cleanupOldLogs } = await import('./services/systemLogService');
      await escalateHighRecurrence();
      await runAutoFix('GLOBAL');
      await cleanupOldLogs(90);
    } catch {}
  }, 60 * 60 * 1000);
});
