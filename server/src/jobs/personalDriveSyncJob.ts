// Phase 3.1: Personal GDrive sync cron — runs every 30 minutes.
// Syncs every user who has a personal_drive_folder_id configured.

import prisma from '../db/prisma';
import { syncUserDrive } from '../services/personalDriveService';
import { isFeatureEnabled } from '../services/featureFlagService';
import createLogger from '../utils/logger';

const log = createLogger('personalDriveSync');

export async function runPersonalDriveSyncJob(): Promise<void> {
  const enabled = await isFeatureEnabled('GLOBAL', 'ff_personal_gdrive', false).catch(() => false);
  if (!enabled) return;

  const users: any[] = await prisma.$queryRawUnsafe(
    `SELECT id FROM users
     WHERE personal_drive_folder_id IS NOT NULL
       AND is_active = TRUE
       AND (personal_drive_last_sync IS NULL
            OR personal_drive_last_sync < NOW() - INTERVAL '30 minutes')`,
  );

  if (users.length === 0) return;

  log.info('Personal drive sync starting', { userCount: users.length });

  for (const user of users) {
    try {
      const result = await syncUserDrive(user.id);
      log.info('User sync done', { userId: user.id, ...result });
    } catch (e: any) {
      log.error('User sync failed', { userId: user.id, error: e.message });
    }
  }
}
