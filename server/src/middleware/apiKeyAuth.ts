// apiKeyAuth.ts — validates X-API-Key header for external API access
import { Request, Response, NextFunction } from 'express';
import { validateApiKey } from '../services/apiGatewayService';
import createLogger from '../utils/logger';

const log = createLogger('apiKeyAuth');

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rawKey = req.headers['x-api-key'] as string | undefined;
  if (!rawKey) {
    res.status(401).json({ error: 'Missing X-API-Key header', code: 'MISSING_API_KEY' });
    return;
  }

  const result = await validateApiKey(rawKey);
  if (!result.valid) {
    log.warn('Invalid API key attempt', { ip: req.ip, reason: result.reason });
    res.status(401).json({ error: result.reason, code: 'INVALID_API_KEY' });
    return;
  }

  // Inject as if session user — downstream handlers check req.user
  (req as any).apiKey = {
    clientNumber: result.clientNumber,
    userId: result.userId,
    scopes: result.scopes,
    keyId: result.keyId,
  };

  // Populate req.user shape so existing middleware works
  if (!req.user) {
    (req as any).user = {
      id: result.userId,
      clientNumber: result.clientNumber,
    };
  }

  next();
}
