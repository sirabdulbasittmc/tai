import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getUserProfile, updateUserProfile } from '../services/userProfileService';

const router = Router();
router.use(requireAuth);

// Get my profile (includes JD as read-only)
router.get('/', async (req: Request, res: Response) => {
  const profile = await getUserProfile(req.user!.id);
  // Also fetch gender + preferredTitle from users table
  const prisma = (await import('../db/prisma')).default;
  const userExtra = await prisma.$queryRawUnsafe(
    `SELECT gender, preferred_title FROM users WHERE id = $1`, req.user!.id,
  ) as any[];
  res.json({ profile: { ...(profile || {}), gender: userExtra[0]?.gender || null, preferredTitle: userExtra[0]?.preferred_title || null } });
});

// Update my profile (JD is NOT editable here — synced from HR)
router.put('/', async (req: Request, res: Response) => {
  const { city, contactNumber, aboutMe, instructions, tonePreference: rawTone, gender, preferredTitle } = req.body;
  const tonePreference = rawTone || null; // empty string → null

  // Validate tone
  const validTones = ['friendly', 'formal', 'executive', 'casual', 'technical', null];
  if (tonePreference !== null && !validTones.includes(tonePreference)) {
    res.status(400).json({ error: `Invalid tone. Choose from: ${validTones.filter(Boolean).join(', ')}` });
    return;
  }

  // Note: jobDescription is intentionally excluded — only HR can update it
  // Save gender and preferred title directly (not in userProfileService — raw update)
  if (gender !== undefined || preferredTitle !== undefined) {
    const prisma = (await import('../db/prisma')).default;
    await prisma.$executeRawUnsafe(
      `UPDATE users SET gender = COALESCE($1, gender), preferred_title = COALESCE($2, preferred_title) WHERE id = $3`,
      gender || null, preferredTitle || null, req.user!.id,
    );
  }
  const profile = await updateUserProfile(req.user!.id, { city, contactNumber, aboutMe, instructions, tonePreference });
  res.json({ success: true, profile });
});

export default router;
