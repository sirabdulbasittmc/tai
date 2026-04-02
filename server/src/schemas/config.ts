import { z } from 'zod';

export const updateConfigSchema = z.object({
  value: z.string().min(0),
  sensitive: z.boolean().optional(),
  description: z.string().optional(),
});

export const createTenantSchema = z.object({
  name: z.string().min(1, 'Company name is required').max(200),
  domain: z.string().max(200).optional().nullable(),
});

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(200).optional().nullable(),
  isActive: z.boolean().optional(),
  expiry: z.string().optional(),
});

export const upsertLicenseSchema = z.object({
  adminSeats: z.number().int().min(0),
  standardSeats: z.number().int().min(0),
  basicSeats: z.number().int().min(0),
  discount: z.number().min(0).max(100).default(0),
  term: z.enum(['M', 'Q', 'Y']).default('M'),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});
