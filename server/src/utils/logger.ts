/**
 * Structured logger — replaces raw console.log/error with consistent,
 * JSON-formatted output in production and readable output in dev.
 *
 * Usage:
 *   import createLogger from '../utils/logger';
 *   const log = createLogger('serviceName');
 *   log.info('message', { key: 'value', requestId });
 */

import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  service: string;
  message: string;
  timestamp: string;
  requestId?: string;
  [key: string]: unknown;
}

// AsyncLocalStorage carries requestId through the entire request lifecycle
// without passing it explicitly through every function call
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

/** Generate a short unique request ID */
export function generateRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

const isProd = process.env.NODE_ENV === 'production';

function formatEntry(entry: LogEntry): string {
  if (isProd) {
    return JSON.stringify(entry);
  }
  const { level, service, message, timestamp, requestId, ...extra } = entry;
  const reqStr = requestId ? ` [${requestId}]` : '';
  const extraStr = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
  return `${timestamp} [${level.toUpperCase()}] [${service}]${reqStr} ${message}${extraStr}`;
}

function createLogger(service: string) {
  const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    const ctx = requestContext.getStore();
    const entry: LogEntry = {
      level,
      service,
      message,
      timestamp: new Date().toISOString(),
      ...(ctx?.requestId && { requestId: ctx.requestId }),
      ...meta,
    };

    const formatted = formatEntry(entry);

    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  };

  return {
    info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
    error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
    debug: (message: string, meta?: Record<string, unknown>) => {
      if (!isProd) log('debug', message, meta);
    },
  };
}

export default createLogger;
