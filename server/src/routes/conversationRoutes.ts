import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getConversations, getConversation, createConversation, archiveConversation, updateConversationTitle } from '../services/chatHistoryService';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const limit = parseInt(String(req.query.limit)) || 50;
  const offset = parseInt(String(req.query.offset)) || 0;
  const conversations = await getConversations(req.user!.clientNumber, req.user!.id, limit, offset);
  res.json({ conversations });
});

router.get('/:id', async (req: Request, res: Response) => {
  const conversation = await getConversation(parseInt(req.params.id as string), req.user!.clientNumber, req.user!.id);
  if (!conversation) { res.status(404).json({ error: 'Conversation not found' }); return; }
  res.json({ conversation });
});

router.post('/', async (req: Request, res: Response) => {
  const { provider } = req.body;
  const conversation = await createConversation(req.user!.clientNumber, req.user!.id, provider);
  res.status(201).json({ conversation });
});

router.patch('/:id', async (req: Request, res: Response) => {
  const { title } = req.body;
  if (!title) { res.status(400).json({ error: 'title is required' }); return; }
  await updateConversationTitle(parseInt(req.params.id as string), req.user!.clientNumber, req.user!.id, title);
  res.json({ success: true });
});

router.delete('/:id', async (req: Request, res: Response) => {
  await archiveConversation(parseInt(req.params.id as string), req.user!.clientNumber, req.user!.id);
  res.json({ success: true });
});

export default router;
