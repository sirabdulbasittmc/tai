import crypto from 'crypto';
import prisma from '../db/prisma';
import createLogger from '../utils/logger';

const log = createLogger('config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

// Cached encryption key — loaded once, reused for all encrypt/decrypt operations
let cachedKey: Buffer | null = null;

/**
 * Reads ENCRYPTION_KEY from GCP Secret Manager in production,
 * falls back to environment variable in development.
 * Caches the key after first load for performance.
 */
async function getEncryptionKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;

  if (process.env.NODE_ENV === 'production' && process.env.GCP_PROJECT_ID) {
    try {
      const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
      const client = new SecretManagerServiceClient();
      const projectId = process.env.GCP_PROJECT_ID || 'tmcai-491811';
      const [version] = await client.accessSecretVersion({
        name: `projects/${projectId}/secrets/tmcai-encryption-key/versions/latest`,
      });
      const secret = version.payload?.data?.toString();
      if (!secret || secret.length < 32) {
        throw new Error('ENCRYPTION_KEY from Secret Manager is invalid (must be 32+ chars)');
      }
      cachedKey = Buffer.from(secret.slice(0, 32), 'utf-8');
      log.info('Encryption key loaded from GCP Secret Manager');
      return cachedKey;
    } catch (err: any) {
      log.error('Secret Manager failed, falling back to env var', { error: err.message });
    }
  }

  // Dev or fallback: read from environment variable
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) throw new Error('ENCRYPTION_KEY must be set (at least 32 characters)');
  cachedKey = Buffer.from(key.slice(0, 32), 'utf-8');
  return cachedKey;
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf-8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

export async function decrypt(encryptedValue: string): Promise<string> {
  const key = await getEncryptionKey();
  const parts = encryptedValue.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted value format');
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(parts[2], 'base64', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

export async function getConfig(clientNumber: string, key: string): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({ where: { clientNumber_key: { clientNumber, key } } });
  if (!row) return null;
  if (row.isSensitive) {
    try { return await decrypt(row.value); } catch { return null; }
  }
  return row.value;
}

export async function setConfig(clientNumber: string, key: string, value: string, sensitive = false, description?: string): Promise<void> {
  const storedValue = sensitive ? await encrypt(value) : value;
  await prisma.systemConfig.upsert({
    where: { clientNumber_key: { clientNumber, key } },
    update: { value: storedValue, isSensitive: sensitive, description },
    create: { clientNumber, key, value: storedValue, isSensitive: sensitive, description },
  });
}

export async function getAllConfig(clientNumber: string): Promise<Record<string, string>> {
  const rows = await prisma.systemConfig.findMany({ where: { clientNumber } });
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = row.isSensitive ? '********' : row.value;
  }
  return config;
}

export async function deleteConfig(clientNumber: string, key: string): Promise<void> {
  await prisma.systemConfig.delete({ where: { clientNumber_key: { clientNumber, key } } }).catch(() => {});
}

export async function getConfigOrEnv(clientNumber: string, key: string, envKey: string): Promise<string> {
  const dbValue = await getConfig(clientNumber, key);
  if (dbValue) return dbValue;
  return process.env[envKey] || '';
}
