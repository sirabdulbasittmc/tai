import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Unhandled error:', err);
  const status = err.status || err.statusCode || 500;

  if (process.env.NODE_ENV === 'production' && status === 500) {
    res.status(500).json({ error: 'An unexpected error occurred. Please try again later.' });
  } else {
    res.status(status).json({ error: err.message || 'Internal server error' });
  }
}
