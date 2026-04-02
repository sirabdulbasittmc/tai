import { Request, Response, NextFunction } from 'express';
import { requestContext, generateRequestId } from '../utils/logger';

/**
 * Middleware that generates a unique requestId for every incoming request
 * and stores it in AsyncLocalStorage so all downstream log calls include it.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  res.setHeader('X-Request-Id', requestId);

  requestContext.run({ requestId }, () => {
    next();
  });
}
