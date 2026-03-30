import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import prisma from '../db/prisma';
import { clearTierCache } from '../services/tierService';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// List all tiers for the client
router.get('/', async (req: Request, res: Response) => {
  const tiers: any[] = await prisma.$queryRawUnsafe(
    'SELECT * FROM user_tiers WHERE client_number = $1 ORDER BY sort_order',
    req.user!.clientNumber
  );
  res.json({ tiers });
});

// Get a single tier
router.get('/:code', async (req: Request, res: Response) => {
  const tiers: any[] = await prisma.$queryRawUnsafe(
    'SELECT * FROM user_tiers WHERE client_number = $1 AND tier_code = $2',
    req.user!.clientNumber, req.params.code
  );
  res.json({ tier: tiers[0] || null });
});

// Create or update a tier
router.put('/:code', async (req: Request, res: Response) => {
  const { code } = req.params;
  const cn = req.user!.clientNumber;
  const b = req.body;

  await prisma.$executeRawUnsafe(`
    INSERT INTO user_tiers (client_number, tier_code, tier_name, description, price_per_seat, currency,
      response_style, max_response_words, allow_widgets, allow_charts, allow_tables, allow_export, export_formats,
      max_output_tokens, allowed_providers, allow_email_read, allow_email_write, allow_calendar_read, allow_calendar_write,
      max_queries_per_day, max_scheduled_tasks, sort_order, is_active)
    VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8::int, $9::boolean, $10::boolean, $11::boolean, $12::boolean, $13,
      $14::int, $15, $16::boolean, $17::boolean, $18::boolean, $19::boolean, $20::int, $21::int, $22::int, $23::boolean)
    ON CONFLICT (client_number, tier_code) DO UPDATE SET
      tier_name = $3, description = $4, price_per_seat = $5::numeric, currency = $6,
      response_style = $7, max_response_words = $8::int, allow_widgets = $9::boolean, allow_charts = $10::boolean,
      allow_tables = $11::boolean, allow_export = $12::boolean, export_formats = $13, max_output_tokens = $14::int,
      allowed_providers = $15, allow_email_read = $16::boolean, allow_email_write = $17::boolean,
      allow_calendar_read = $18::boolean, allow_calendar_write = $19::boolean, max_queries_per_day = $20::int,
      max_scheduled_tasks = $21::int, sort_order = $22::int, is_active = $23::boolean, updated_at = NOW()
  `,
    cn, code,
    b.tier_name || code, b.description || '',
    String(b.price_per_seat ?? 0), b.currency || 'USD',
    b.response_style || 'moderate', String(b.max_response_words ?? 500),
    String(b.allow_widgets ?? false), String(b.allow_charts ?? false),
    String(b.allow_tables ?? true), String(b.allow_export ?? false),
    b.export_formats || 'csv',
    String(b.max_output_tokens ?? 2048), b.allowed_providers || 'gemini-flash',
    String(b.allow_email_read ?? false), String(b.allow_email_write ?? false),
    String(b.allow_calendar_read ?? false), String(b.allow_calendar_write ?? false),
    String(b.max_queries_per_day ?? 100), String(b.max_scheduled_tasks ?? 0),
    String(b.sort_order ?? 0), String(b.is_active ?? true)
  );

  clearTierCache();
  res.json({ success: true });
});

// Delete a tier
router.delete('/:code', async (req: Request, res: Response) => {
  await prisma.$executeRawUnsafe(
    'DELETE FROM user_tiers WHERE client_number = $1 AND tier_code = $2',
    req.user!.clientNumber, req.params.code
  );
  clearTierCache();
  res.json({ success: true });
});

export default router;
