import { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { getClientLicense, upsertClientLicense, getLicensePrices, setLicensePrice } from '../services/licenseService';

const router = Router();
router.use(requireAuth);

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.id?.toString() || ipKeyGenerator(req),
  message: { error: 'Too many requests. Please try again in 1 minute.' },
});
router.use(adminLimiter);

// Get license status for current tenant
router.get('/status', async (req: Request, res: Response) => {
  const result = await getClientLicense(req.user!.clientNumber);
  res.json(result);
});

// Get global license prices (admin only)
router.get('/prices', requireAdmin, async (_req: Request, res: Response) => {
  const prices = await getLicensePrices();
  res.json({ prices });
});

// Update license for current tenant (SuperAdmin only)
router.put('/', requireAuth, async (req: Request, res: Response) => {
  if (!req.user!.isSuperAdmin) {
    res.status(403).json({ error: 'SuperAdmin access required' });
    return;
  }

  const { clientNumber, adminSeats, standardSeats, basicSeats, discount, term, startDate, endDate } = req.body;
  const targetClient = clientNumber || req.user!.clientNumber;

  if (adminSeats === undefined || standardSeats === undefined || basicSeats === undefined || !startDate || !endDate) {
    res.status(400).json({ error: 'adminSeats, standardSeats, basicSeats, startDate, and endDate are required' });
    return;
  }

  const license = await upsertClientLicense(targetClient, {
    adminSeats, standardSeats, basicSeats,
    discount, term,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
  });

  res.json({ success: true, license });
});

// Update global license prices (SuperAdmin only)
router.put('/prices', requireAuth, async (req: Request, res: Response) => {
  if (!req.user!.isSuperAdmin) {
    res.status(403).json({ error: 'SuperAdmin access required' });
    return;
  }

  const { roleType, pricePerSeat, currency, description } = req.body;
  if (!roleType || pricePerSeat === undefined) {
    res.status(400).json({ error: 'roleType and pricePerSeat are required' });
    return;
  }

  const price = await setLicensePrice(roleType, pricePerSeat, currency, description);
  res.json({ success: true, price });
});

export default router;
