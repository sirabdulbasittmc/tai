// Phase 3.1: Personal GDrive routes
// All routes scoped to the authenticated user — admin cannot access personal data.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  setUserFolder, getUserFolderStatus, syncUserDrive, deletePersonalDriveData,
} from '../services/personalDriveService';

const router = Router();
router.use(requireAuth);

// GET /api/v1/personal-drive/status
router.get('/status', async (req, res) => {
  const userId = req.user!.id;
  const status = await getUserFolderStatus(userId);
  res.json(status);
});

// POST /api/v1/personal-drive/folder  { folderId }
router.post('/folder', async (req, res) => {
  const userId = req.user!.id;
  const { folderId } = req.body;
  if (!folderId || typeof folderId !== 'string') {
    return res.status(400).json({ error: 'folderId is required' });
  }
  const result = await setUserFolder(userId, folderId);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, folderName: result.folderName });
});

// POST /api/v1/personal-drive/sync
router.post('/sync', async (req, res) => {
  const userId = req.user!.id;
  const result = await syncUserDrive(userId);
  res.json(result);
});

// DELETE /api/v1/personal-drive
router.delete('/', async (req, res) => {
  const userId = req.user!.id;
  await deletePersonalDriveData(userId);
  res.json({ success: true });
});

export default router;
