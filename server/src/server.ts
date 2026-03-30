import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { validateEnv, env } from './config/env';
import { startAutoRefresh } from './services/indexCacheService';
import { initScheduler } from './services/schedulerService';
import { cleanupExpiredContextMemories } from './services/memoryService';

validateEnv();

app.listen(env.port, async () => {
  console.log(`TMCAI Server listening on port ${env.port}`);
  startAutoRefresh(env.indexRefreshIntervalMs);
  await initScheduler().catch(err => console.error('Scheduler init failed:', err.message));
  // Cleanup expired context memories every hour
  cleanupExpiredContextMemories().catch(() => {});
  setInterval(() => cleanupExpiredContextMemories().catch(() => {}), 60 * 60 * 1000);
});
