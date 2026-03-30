import prisma from '../db/prisma';

/**
 * LicenseService — manages seat-based licensing per tenant.
 *
 * Each tenant has a ClientLicense with seat counts per role type.
 * The system enforces:
 * - Seat limits: can't create more users than licensed seats
 * - Subscription expiry: blocks access when tenant.expiry has passed
 * - License calculation: computes billing from seat counts × prices
 */

// ─── Seat Validation ───────────────────────────────────────────

export interface SeatStatus {
  roleType: string;
  licensed: number;
  used: number;
  available: number;
}

export async function getSeatUsage(clientNumber: string): Promise<SeatStatus[]> {
  const license = await prisma.clientLicense.findUnique({
    where: { clientNumber },
  });

  if (!license) return [];

  // Count active users per role type
  const [adminCount, standardCount, basicCount] = await Promise.all([
    prisma.user.count({ where: { clientNumber, isActive: true, userType: 'AD' } }),
    prisma.user.count({ where: { clientNumber, isActive: true, userType: 'ST' } }),
    prisma.user.count({ where: { clientNumber, isActive: true, userType: 'BS' } }),
  ]);

  return [
    { roleType: 'AD', licensed: license.adminSeats, used: adminCount, available: license.adminSeats - adminCount },
    { roleType: 'ST', licensed: license.standardSeats, used: standardCount, available: license.standardSeats - standardCount },
    { roleType: 'BS', licensed: license.basicSeats, used: basicCount, available: license.basicSeats - basicCount },
  ];
}

export async function validateSeatAvailability(clientNumber: string, userType: string): Promise<{ allowed: boolean; error?: string }> {
  // SuperAdmin seats are not counted (platform-level)
  if (userType === 'SA') return { allowed: true };

  const license = await prisma.clientLicense.findUnique({ where: { clientNumber } });
  if (!license) return { allowed: false, error: 'No license found for this tenant' };
  if (!license.isActive) return { allowed: false, error: 'License is inactive' };

  const seatField = userType === 'AD' ? 'adminSeats' :
                    userType === 'ST' ? 'standardSeats' :
                    userType === 'BS' ? 'basicSeats' : null;

  if (!seatField) return { allowed: true }; // Unknown role, allow

  const maxSeats = license[seatField];
  const currentCount = await prisma.user.count({
    where: { clientNumber, isActive: true, userType },
  });

  if (currentCount >= maxSeats) {
    return {
      allowed: false,
      error: `${userType} seat limit reached (${currentCount}/${maxSeats}). Upgrade your license to add more users.`,
    };
  }

  return { allowed: true };
}

// ─── Subscription Expiry ───────────────────────────────────────

export async function checkSubscription(clientNumber: string): Promise<{ valid: boolean; error?: string; daysRemaining?: number }> {
  const tenant = await prisma.tenant.findUnique({ where: { clientNumber } });
  if (!tenant) return { valid: false, error: 'Tenant not found' };
  if (!tenant.isActive) return { valid: false, error: 'Tenant is deactivated' };

  if (tenant.expiry) {
    const now = new Date();
    if (tenant.expiry < now) {
      return { valid: false, error: 'Subscription expired. Contact your administrator to renew.' };
    }
    const daysRemaining = Math.ceil((tenant.expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return { valid: true, daysRemaining };
  }

  // No expiry set = unlimited (trial or internal)
  return { valid: true };
}

// ─── License CRUD ──────────────────────────────────────────────

export async function getClientLicense(clientNumber: string) {
  const license = await prisma.clientLicense.findUnique({ where: { clientNumber } });
  const seats = await getSeatUsage(clientNumber);
  const subscription = await checkSubscription(clientNumber);
  return { license, seats, subscription };
}

export async function upsertClientLicense(clientNumber: string, data: {
  adminSeats: number;
  standardSeats: number;
  basicSeats: number;
  discount?: number;
  term?: string;
  startDate: Date;
  endDate: Date;
}) {
  // Get prices
  const prices = await prisma.license.findMany({ where: { isActive: true } });
  const priceMap: Record<string, number> = {};
  for (const p of prices) {
    priceMap[p.roleType] = Number(p.pricePerSeat);
  }

  const licenseAmount =
    (data.adminSeats * (priceMap['admin'] || 0)) +
    (data.standardSeats * (priceMap['standard'] || 0)) +
    (data.basicSeats * (priceMap['basic'] || 0));

  const discountPct = data.discount || 0;
  const discAmount = licenseAmount * (discountPct / 100);
  const netAmount = licenseAmount - discAmount;

  // Calculate term amount
  const term = data.term || 'M';
  const months = Math.max(1, Math.ceil((data.endDate.getTime() - data.startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)));
  const termDivisor = term === 'Y' ? Math.ceil(months / 12) : term === 'Q' ? Math.ceil(months / 3) : months;
  const termAmount = netAmount / Math.max(1, termDivisor);

  // Update tenant expiry
  await prisma.tenant.update({
    where: { clientNumber },
    data: { expiry: data.endDate },
  });

  return prisma.clientLicense.upsert({
    where: { clientNumber },
    update: {
      adminSeats: data.adminSeats,
      standardSeats: data.standardSeats,
      basicSeats: data.basicSeats,
      licenseAmount,
      discount: discountPct,
      discAmount,
      netAmount,
      termAmount,
      term,
      startDate: data.startDate,
      endDate: data.endDate,
    },
    create: {
      clientNumber,
      adminSeats: data.adminSeats,
      standardSeats: data.standardSeats,
      basicSeats: data.basicSeats,
      licenseAmount,
      discount: discountPct,
      discAmount,
      netAmount,
      termAmount,
      term,
      startDate: data.startDate,
      endDate: data.endDate,
    },
  });
}

// ─── Global License Prices ─────────────────────────────────────

export async function getLicensePrices() {
  return prisma.license.findMany({ where: { isActive: true }, orderBy: { roleType: 'asc' } });
}

export async function setLicensePrice(roleType: string, pricePerSeat: number, currency = 'USD', description?: string) {
  return prisma.license.upsert({
    where: { roleType },
    update: { pricePerSeat, currency, description },
    create: { roleType, pricePerSeat, currency, description },
  });
}
