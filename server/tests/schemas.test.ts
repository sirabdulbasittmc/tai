import { describe, it, expect } from 'vitest';
import { loginSchema, changePasswordSchema, createUserSchema, setupPasswordSchema, forgotPasswordSchema } from '../src/schemas/auth';
import { createTenantSchema, upsertLicenseSchema } from '../src/schemas/config';

describe('loginSchema', () => {
  it('accepts valid email + password', () => {
    const result = loginSchema.safeParse({ email: 'test@example.com', password: 'pass123' });
    expect(result.success).toBe(true);
  });

  it('accepts valid empcode + password', () => {
    const result = loginSchema.safeParse({ empcode: 'EMP-001', password: 'pass123' });
    expect(result.success).toBe(true);
  });

  it('rejects missing identifier', () => {
    const result = loginSchema.safeParse({ password: 'pass123' });
    expect(result.success).toBe(false);
  });

  it('rejects missing password', () => {
    const result = loginSchema.safeParse({ email: 'test@example.com' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'pass123' });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({ email: 'test@example.com', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('accepts valid passwords', () => {
    const result = changePasswordSchema.safeParse({ currentPassword: 'old123', newPassword: 'newPass1!' });
    expect(result.success).toBe(true);
  });

  it('rejects short new password', () => {
    const result = changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'ab' });
    expect(result.success).toBe(false);
  });
});

describe('createUserSchema', () => {
  it('accepts valid user data', () => {
    const result = createUserSchema.safeParse({
      empcode: 'EMP-001', name: 'Ahmed Khan', email: 'ahmed@test.com',
      password: 'Pass123!', userType: 'ST',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid userType', () => {
    const result = createUserSchema.safeParse({
      empcode: 'EMP-001', name: 'Ahmed', email: 'a@b.com',
      password: 'Pass123!', userType: 'INVALID',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing empcode', () => {
    const result = createUserSchema.safeParse({
      name: 'Ahmed', email: 'a@b.com', password: 'Pass123!', userType: 'ST',
    });
    expect(result.success).toBe(false);
  });
});

describe('setupPasswordSchema', () => {
  it('accepts valid token + password', () => {
    const result = setupPasswordSchema.safeParse({ token: 'abc123', password: 'NewPass1!' });
    expect(result.success).toBe(true);
  });

  it('rejects empty token', () => {
    const result = setupPasswordSchema.safeParse({ token: '', password: 'NewPass1!' });
    expect(result.success).toBe(false);
  });
});

describe('forgotPasswordSchema', () => {
  it('accepts valid email', () => {
    const result = forgotPasswordSchema.safeParse({ email: 'test@company.com' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = forgotPasswordSchema.safeParse({ email: 'not-email' });
    expect(result.success).toBe(false);
  });
});

describe('createTenantSchema', () => {
  it('accepts valid tenant data', () => {
    const result = createTenantSchema.safeParse({ name: 'ACME Corp' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = createTenantSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });
});

describe('upsertLicenseSchema', () => {
  it('accepts valid license data', () => {
    const result = upsertLicenseSchema.safeParse({
      adminSeats: 5, standardSeats: 50, basicSeats: 200,
      discount: 10, term: 'M', startDate: '2026-01-01', endDate: '2027-01-01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative seats', () => {
    const result = upsertLicenseSchema.safeParse({
      adminSeats: -1, standardSeats: 50, basicSeats: 200,
      term: 'M', startDate: '2026-01-01', endDate: '2027-01-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects discount > 100', () => {
    const result = upsertLicenseSchema.safeParse({
      adminSeats: 5, standardSeats: 50, basicSeats: 200,
      discount: 150, term: 'M', startDate: '2026-01-01', endDate: '2027-01-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid term', () => {
    const result = upsertLicenseSchema.safeParse({
      adminSeats: 5, standardSeats: 50, basicSeats: 200,
      term: 'X', startDate: '2026-01-01', endDate: '2027-01-01',
    });
    expect(result.success).toBe(false);
  });
});
