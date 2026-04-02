import { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth, requireAdmin } from '../middleware/auth';
import prisma from '../db/prisma';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.id?.toString() || ipKeyGenerator(req),
  message: { error: 'Too many requests. Please try again in 1 minute.' },
});
router.use(adminLimiter);

// List users in current tenant (includes integration status)
router.get('/users', async (req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    where: { clientNumber: req.user!.clientNumber },
    select: {
      id: true, empcode: true, name: true, email: true,
      userType: true, department: true, isActive: true,
      lastLoginAt: true, createdAt: true,
      city: true, contactNumber: true, jobDescription: true,
      integrationProvider: true, integrationEmail: true,
      integrationScopes: true, integrationStatus: true,
    },
    orderBy: { name: 'asc' },
  });
  res.json({ users });
});

// Update user details (admin can edit any user in their tenant)
router.patch('/users/:id', async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id as string);
  const { name, department, userType, city, contactNumber, jobDescription } = req.body;

  // Verify user belongs to same tenant
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { clientNumber: true } });
  if (!target || target.clientNumber !== req.user!.clientNumber) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(name && { name }),
      ...(department !== undefined && { department: department || null }),
      ...(userType && { userType }),
      ...(city !== undefined && { city: city || null }),
      ...(contactNumber !== undefined && { contactNumber: contactNumber || null }),
      ...(jobDescription !== undefined && { jobDescription: jobDescription || null }),
    },
    select: { id: true, name: true, department: true, userType: true, city: true },
  });

  res.json({ user: updated });
});

export default router;
