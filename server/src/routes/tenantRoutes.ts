import { Router, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import { createTenant, getTenant, listTenants, deactivateTenant } from '../services/tenantService';
import { getClientLicense, upsertClientLicense, getLicensePrices, setLicensePrice } from '../services/licenseService';
import prisma from '../db/prisma';

const router = Router();
router.use(requireAuth);
router.use(requireSuperAdmin);

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.id?.toString() || ipKeyGenerator(req),
  message: { error: 'Too many requests. Please try again in 1 minute.' },
});
router.use(adminLimiter);

// ─── Tenants ───────────────────────────────────────────────────

// List all tenants with license summary
router.get('/', async (_req: Request, res: Response) => {
  const tenants = await prisma.tenant.findMany({
    orderBy: { clientNumber: 'asc' },
    include: {
      clientLicense: { select: { adminSeats: true, standardSeats: true, basicSeats: true, netAmount: true, endDate: true, isActive: true } },
      _count: { select: { users: true } },
    },
  });

  const result = tenants.map(t => ({
    clientNumber: t.clientNumber,
    name: t.name,
    domain: t.domain,
    isActive: t.isActive,
    expiry: t.expiry,
    userCount: t._count.users,
    license: t.clientLicense,
  }));

  res.json({ tenants: result });
});

// Get single tenant detail
router.get('/:clientNumber', async (req: Request, res: Response) => {
  const tenant = await getTenant(req.params.clientNumber as string);
  if (!tenant) { res.status(404).json({ error: 'Tenant not found' }); return; }
  const licenseInfo = await getClientLicense(req.params.clientNumber as string);
  res.json({ tenant, ...licenseInfo });
});

// Create new tenant
router.post('/', async (req: Request, res: Response) => {
  const { name, clientNumber, domain } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }

  try {
    const tenant = await createTenant(name, clientNumber);
    if (domain) {
      await prisma.tenant.update({ where: { clientNumber: tenant.clientNumber }, data: { domain } });
    }
    res.status(201).json({ success: true, tenant });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Update tenant
router.patch('/:clientNumber', async (req: Request, res: Response) => {
  const { name, domain, isActive } = req.body;
  try {
    const tenant = await prisma.tenant.update({
      where: { clientNumber: req.params.clientNumber as string },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(domain !== undefined ? { domain } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });
    res.json({ success: true, tenant });
  } catch {
    res.status(404).json({ error: 'Tenant not found' });
  }
});

// Deactivate tenant
router.delete('/:clientNumber', async (req: Request, res: Response) => {
  await deactivateTenant(req.params.clientNumber as string);
  res.json({ success: true });
});

// ─── Client Licenses ───────────────────────────────────────────

// Get license for a tenant
router.get('/:clientNumber/license', async (req: Request, res: Response) => {
  const result = await getClientLicense(req.params.clientNumber as string);
  res.json(result);
});

// Set/update license for a tenant
router.put('/:clientNumber/license', async (req: Request, res: Response) => {
  const { adminSeats, standardSeats, basicSeats, discount, term, startDate, endDate } = req.body;

  if (adminSeats === undefined || standardSeats === undefined || basicSeats === undefined || !startDate || !endDate) {
    res.status(400).json({ error: 'adminSeats, standardSeats, basicSeats, startDate, and endDate are required' });
    return;
  }

  try {
    const license = await upsertClientLicense(req.params.clientNumber as string, {
      adminSeats: parseInt(adminSeats),
      standardSeats: parseInt(standardSeats),
      basicSeats: parseInt(basicSeats),
      discount: parseFloat(discount || '0'),
      term: term || 'M',
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    });
    res.json({ success: true, license });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── License Prices (Global) ──────────────────────────────────

router.get('/prices/all', async (_req: Request, res: Response) => {
  const prices = await getLicensePrices();
  res.json({ prices });
});

router.put('/prices/:roleType', async (req: Request, res: Response) => {
  const { pricePerSeat, currency, description } = req.body;
  if (pricePerSeat === undefined) { res.status(400).json({ error: 'pricePerSeat is required' }); return; }
  const price = await setLicensePrice(req.params.roleType as string, parseFloat(pricePerSeat), currency, description);
  res.json({ success: true, price });
});

export default router;
