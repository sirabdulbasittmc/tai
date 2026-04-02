import { Request, Response, NextFunction } from 'express';
import createLogger from '../utils/logger';

const log = createLogger('http');

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const user = (req as any).user;

    // Skip health check spam in logs
    if (req.path.includes('/health')) return;

    log.info(`${req.method} ${req.path} ${res.statusCode}`, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
      userId: user?.id,
      clientNumber: user?.clientNumber,
      userAgent: req.headers['user-agent']?.slice(0, 100),
    });

    // Warn on slow requests (>10s)
    if (duration > 10000 && !req.path.includes('/stream')) {
      log.warn('Slow request detected', { path: req.path, durationMs: duration });
    }
  });

  next();
}
