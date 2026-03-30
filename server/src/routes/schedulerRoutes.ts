import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  getUserTasks,
  runTaskNow,
} from '../services/schedulerService';

const router = Router();
router.use(requireAuth);

// List my scheduled tasks
router.get('/', async (req: Request, res: Response) => {
  const tasks = await getUserTasks(req.user!.id);
  res.json({ tasks });
});

// Create a new scheduled task
router.post('/', async (req: Request, res: Response) => {
  const { title, prompt, cronExpression, provider, notifyEmail, notifySelf } = req.body;

  if (!title || !prompt || !cronExpression) {
    res.status(400).json({ error: 'title, prompt, and cronExpression are required' });
    return;
  }

  try {
    const task = await createScheduledTask({
      clientNumber: req.user!.clientNumber,
      userId: req.user!.id,
      title,
      prompt,
      cronExpression,
      provider,
      notifyEmail,
      notifySelf,
    });
    res.status(201).json({ success: true, task });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Update a scheduled task
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    await updateScheduledTask(parseInt(req.params.id as string), req.user!.id, req.body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a scheduled task
router.delete('/:id', async (req: Request, res: Response) => {
  await deleteScheduledTask(parseInt(req.params.id as string), req.user!.id);
  res.json({ success: true });
});

// Run a task immediately
router.post('/:id/run', async (req: Request, res: Response) => {
  try {
    await runTaskNow(parseInt(req.params.id as string), req.user!.id);
    res.json({ success: true, message: 'Task executed. Check your email for results.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
