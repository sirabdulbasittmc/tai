/**
 * User type definitions — hardcoded permissions per type.
 * No roles table needed. userType field on users table: SA, AD, ST, BS.
 */

export interface UserTypeConfig {
  label: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  allowedProviders: string[];
  internetAccess: 'full' | 'limited' | 'none';
  maxScheduledTasks: number; // 0 = unlimited
  canExport: boolean;
}

export const USER_TYPES: Record<string, UserTypeConfig> = {
  SA: {
    label: 'SuperAdmin',
    isAdmin: true,
    isSuperAdmin: true,
    allowedProviders: ['all'],
    internetAccess: 'full',
    maxScheduledTasks: 0,
    canExport: true,
  },
  AD: {
    label: 'Admin',
    isAdmin: true,
    isSuperAdmin: false,
    allowedProviders: ['all'],
    internetAccess: 'full',
    maxScheduledTasks: 0,
    canExport: true,
  },
  ST: {
    label: 'Standard',
    isAdmin: false,
    isSuperAdmin: false,
    allowedProviders: ['all'],
    internetAccess: 'full',
    maxScheduledTasks: 0,
    canExport: true,
  },
  BS: {
    label: 'Basic',
    isAdmin: false,
    isSuperAdmin: false,
    allowedProviders: ['gemini-flash', 'groq'],
    internetAccess: 'limited',
    maxScheduledTasks: 3,
    canExport: false,
  },
};

export function getUserTypeConfig(userType: string): UserTypeConfig {
  return USER_TYPES[userType] || USER_TYPES.BS;
}

export function isValidUserType(userType: string): boolean {
  // Accept hardcoded types (SA, AD) + any alphanumeric tier code (e.g., ST, BS, EX, PR)
  // Tier codes are validated against user_tiers table at assignment time
  return userType in USER_TYPES || /^[A-Z0-9]{1,10}$/.test(userType);
}
