import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const CLIENT_NUMBER = 'TMC-0001';

async function main() {
  console.log('Seeding database...');

  // ─── Tenant ──────────────────────────────────────────────────
  await prisma.tenant.upsert({
    where: { clientNumber: CLIENT_NUMBER },
    update: {},
    create: { clientNumber: CLIENT_NUMBER, name: 'TallyMarks Consulting', expiry: new Date('2027-01-01') },
  });
  console.log('Tenant: TMC-0001');

  // ─── SuperAdmin User ─────────────────────────────────────────
  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'basit.ahmed@tmcltd.com' },
    update: { passwordHash, userType: 'SA' },
    create: {
      clientNumber: CLIENT_NUMBER,
      empcode: 'ADMIN',
      name: 'Basit Ahmed',
      email: 'basit.ahmed@tmcltd.com',
      passwordHash,
      userType: 'SA',
      department: 'IT',
    },
  });
  console.log('SuperAdmin: basit.ahmed@tmcltd.com / admin123 (SA)');

  // ─── System Config ───────────────────────────────────────────
  const configs = [
    { key: 'app_name', value: 'TMC AI Intelligence', isSensitive: false, description: 'Application name' },
    { key: 'rag_enabled', value: 'true', isSensitive: false, description: 'Enable RAG' },
    { key: 'pii_enabled', value: 'true', isSensitive: false, description: 'Enable PII masking' },
    { key: 'rag_top_k', value: '7', isSensitive: false, description: 'Chunks to retrieve' },
    { key: 'max_tokens', value: '8192', isSensitive: false, description: 'Max AI output tokens' },
    { key: 'session_hours', value: '72', isSensitive: false, description: 'Session duration' },
    { key: 'password_min_length', value: '8', isSensitive: false, description: 'Minimum password length' },
    { key: 'password_require_uppercase', value: 'true', isSensitive: false, description: 'Require uppercase letter' },
    { key: 'password_require_number', value: 'true', isSensitive: false, description: 'Require number' },
    { key: 'password_require_special', value: 'true', isSensitive: false, description: 'Require special character' },
    { key: 'max_login_attempts', value: '5', isSensitive: false, description: 'Max failed login attempts before lockout' },
    { key: 'lockout_minutes', value: '30', isSensitive: false, description: 'Lockout duration in minutes' },
  ];
  for (const c of configs) {
    await prisma.systemConfig.upsert({
      where: { clientNumber_key: { clientNumber: CLIENT_NUMBER, key: c.key } },
      update: {},
      create: { clientNumber: CLIENT_NUMBER, ...c },
    });
  }
  console.log(`Config: ${configs.length} entries`);

  // ─── License Prices ──────────────────────────────────────────
  const prices = [
    { roleType: 'AD', pricePerSeat: 49.00, currency: 'USD', description: 'Admin — full tenant management + all AI' },
    { roleType: 'ST', pricePerSeat: 29.00, currency: 'USD', description: 'Standard — company data + full internet AI' },
    { roleType: 'BS', pricePerSeat: 9.00, currency: 'USD', description: 'Basic — company data + limited internet' },
  ];
  for (const p of prices) {
    await prisma.license.upsert({ where: { roleType: p.roleType }, update: p, create: p });
  }
  console.log(`Prices: AD $49, ST $29, BS $9`);

  // ─── TMC License ─────────────────────────────────────────────
  const existingLicense = await prisma.clientLicense.findUnique({ where: { clientNumber: CLIENT_NUMBER } });
  if (!existingLicense) {
    await prisma.clientLicense.create({
      data: {
        clientNumber: CLIENT_NUMBER,
        adminSeats: 5, standardSeats: 50, basicSeats: 200,
        licenseAmount: 7495, discount: 0, discAmount: 0, netAmount: 7495, termAmount: 7495,
        term: 'M', startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'),
      },
    });
  }
  console.log('License: 5 AD, 50 ST, 200 BS');

  console.log('\nSeed complete!');
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
