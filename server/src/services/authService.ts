import crypto from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '../db/prisma';
import { getUserTypeConfig } from '../config/userTypes';
import { getConfig } from './configService';
import { sendPasswordChangedEmail } from './inviteService';

const SALT_ROUNDS = 10;
const TOKEN_LENGTH = 64;

// Read security settings from system_config (with fallback defaults)
async function getSecurityConfig(clientNumber: string) {
  const get = async (key: string, fallback: string) => (await getConfig(clientNumber, key)) || fallback;
  return {
    maxAttempts: parseInt(await get('max_login_attempts', '5')),
    lockoutMinutes: parseInt(await get('lockout_minutes', '30')),
    sessionHours: parseInt(await get('session_hours', '72')),
    passwordMinLength: parseInt(await get('password_min_length', '8')),
    requireUppercase: (await get('password_require_uppercase', 'true')) === 'true',
    requireNumber: (await get('password_require_number', 'true')) === 'true',
    requireSpecial: (await get('password_require_special', 'true')) === 'true',
  };
}

export function validatePasswordComplexity(password: string, config: { passwordMinLength: number; requireUppercase: boolean; requireNumber: boolean; requireSpecial: boolean }): string | null {
  if (password.length < config.passwordMinLength) return `Password must be at least ${config.passwordMinLength} characters`;
  if (config.requireUppercase && !/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (config.requireNumber && !/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (config.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return 'Password must contain at least one special character';
  return null;
}

// ─── User Management ───────────────────────────────────────────

export async function createUser(data: {
  clientNumber: string;
  empcode: string;
  name: string;
  email: string;
  password: string;
  userType: string;
  department?: string;
}) {
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
  return prisma.user.create({
    data: {
      clientNumber: data.clientNumber,
      empcode: data.empcode,
      name: data.name,
      email: data.email,
      passwordHash,
      userType: data.userType,
      department: data.department,
    },
  });
}

// ─── Authentication ────────────────────────────────────────────

export interface AuthResult {
  success: boolean;
  token?: string;
  user?: TokenUser;
  error?: string;
  locked?: boolean;
}

export async function login(identifier: string, password: string, meta?: { userAgent?: string; ip?: string }): Promise<AuthResult> {
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { empcode: identifier }] },
  });

  if (!user || !user.isActive) return { success: false, error: 'Invalid credentials' };

  const sec = await getSecurityConfig(user.clientNumber);

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return { success: false, error: `Account locked. Try again in ${minutesLeft} minutes.`, locked: true };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const attempts = user.failedAttempts + 1;
    const lockData: any = { failedAttempts: attempts };
    if (attempts >= sec.maxAttempts) {
      lockData.lockedUntil = new Date(Date.now() + sec.lockoutMinutes * 60 * 1000);
    }
    await prisma.user.update({ where: { id: user.id }, data: lockData });
    if (attempts >= sec.maxAttempts) {
      return { success: false, error: `Account locked for ${sec.lockoutMinutes} minutes.`, locked: true };
    }
    return { success: false, error: `Invalid credentials. ${sec.maxAttempts - attempts} attempts remaining.` };
  }

  const token = crypto.randomBytes(TOKEN_LENGTH / 2).toString('hex');
  const expiresAt = new Date(Date.now() + sec.sessionHours * 60 * 60 * 1000);

  await prisma.session.create({
    data: { token, userId: user.id, expiresAt, userAgent: meta?.userAgent?.slice(0, 500), ipAddress: meta?.ip?.slice(0, 50) },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const config = getUserTypeConfig(user.userType);
  return {
    success: true,
    token,
    user: {
      id: user.id,
      clientNumber: user.clientNumber,
      empcode: user.empcode,
      name: user.name,
      email: user.email,
      department: user.department,
      userType: user.userType,
      ...config,
    },
  };
}

// ─── Session Validation ────────────────────────────────────────

export interface TokenUser {
  id: number;
  clientNumber: string;
  empcode: string;
  name: string;
  email: string;
  department: string | null;
  userType: string;
  label: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  allowedProviders: string[];
  internetAccess: string;
  maxScheduledTasks: number;
  canExport: boolean;
}

export async function validateToken(token: string): Promise<TokenUser | null> {
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session || session.isRevoked || session.expiresAt < new Date() || !session.user.isActive) return null;

  const user = session.user;
  const config = getUserTypeConfig(user.userType);

  return {
    id: user.id,
    clientNumber: user.clientNumber,
    empcode: user.empcode,
    name: user.name,
    email: user.email,
    department: user.department,
    userType: user.userType,
    ...config,
  };
}

export async function logout(token: string): Promise<void> {
  await prisma.session.update({ where: { token }, data: { isRevoked: true } }).catch(() => {});
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { success: false, error: 'User not found' };
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return { success: false, error: 'Current password is incorrect' };

  const sec = await getSecurityConfig(user.clientNumber);
  const complexityError = validatePasswordComplexity(newPassword, sec);
  if (complexityError) return { success: false, error: complexityError };

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  // Send confirmation email
  sendPasswordChangedEmail(userId).catch(() => {});

  return { success: true };
}

export async function resetPassword(clientNumber: string, empcode: string): Promise<{ success: boolean; tempPassword?: string; error?: string }> {
  const tempPassword = crypto.randomBytes(4).toString('hex');
  const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
  try {
    await prisma.user.update({
      where: { clientNumber_empcode: { clientNumber, empcode } },
      data: { passwordHash, failedAttempts: 0, lockedUntil: null },
    });
    return { success: true, tempPassword };
  } catch {
    return { success: false, error: 'User not found' };
  }
}
