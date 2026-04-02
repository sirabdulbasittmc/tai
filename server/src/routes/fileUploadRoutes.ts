// Phase 3.2: File upload routes
// Users upload files for private search. Admin cannot see content.

import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import {
  processUpload, listUserUploads, deleteUpload, checkUserQuota,
} from '../services/fileUploadService';

const router = Router();
router.use(requireAuth);

// In-memory multer: 50MB limit, allowed MIME types
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]);
    if (allowed.has(file.mimetype) ||
        /\.(pdf|txt|csv|docx|xlsx|xls)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// GET /api/v1/uploads — list user's uploaded files
router.get('/', async (req, res) => {
  const userId = req.user!.id;
  const files = await listUserUploads(userId);
  res.json({ files });
});

// GET /api/v1/uploads/quota — storage quota
router.get('/quota', async (req, res) => {
  const userId = req.user!.id;
  const quota = await checkUserQuota(userId);
  res.json(quota);
});

// POST /api/v1/uploads — upload a file
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const userId = req.user!.id;

  try {
    const result = await processUpload(
      userId,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/v1/uploads/:id — delete an uploaded file
router.delete('/:id', async (req, res) => {
  const userId = req.user!.id;
  const documentId = parseInt(req.params.id, 10);
  if (isNaN(documentId)) return res.status(400).json({ error: 'Invalid document ID' });

  try {
    await deleteUpload(userId, documentId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

export default router;
