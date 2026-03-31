import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getUserProfile, updateUserProfile } from '../services/userProfileService';

const router = Router();
router.use(requireAuth);

// Get my profile (includes JD as read-only)
router.get('/', async (req: Request, res: Response) => {
  const profile = await getUserProfile(req.user!.id);
  res.json({ profile: profile || { jobDescription: null, city: null, contactNumber: null, aboutMe: null, instructions: null, tonePreference: null } });
});

// Update my profile (JD is NOT editable here — synced from HR)
router.put('/', async (req: Request, res: Response) => {
  const { city, contactNumber, aboutMe, instructions, tonePreference: rawTone } = req.body;
  const tonePreference = rawTone || null; // empty string → null

  // Validate tone
  const validTones = ['friendly', 'formal', 'executive', 'casual', 'technical', null];
  if (tonePreference !== null && !validTones.includes(tonePreference)) {
    res.status(400).json({ error: `Invalid tone. Choose from: ${validTones.filter(Boolean).join(', ')}` });
    return;
  }

  // Note: jobDescription is intentionally excluded — only HR can update it
  const profile = await updateUserProfile(req.user!.id, { city, contactNumber, aboutMe, instructions, tonePreference });
  res.json({ success: true, profile });
});

export default router;
