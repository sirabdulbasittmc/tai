import { Response } from 'express';
import { sanitizeOutput } from '../../pipeline/outputSanitizer';

/**
 * Send a status message via SSE (shown as loading indicator in UI).
 */
export function sendStatus(res: Response, clientDisconnected: boolean, text: string): void {
  if (!clientDisconnected) {
    res.write(`data: ${JSON.stringify({ type: 'status', content: text })}\n\n`);
  }
}

/**
 * Send a chunk of AI response via SSE, with output sanitization.
 * Returns the safe text length (0 if blocked).
 */
export function sendChunkDirect(
  res: Response,
  clientDisconnected: boolean,
  responseChunks: string[],
  text: string,
): number {
  const { text: safeText, blocked } = sanitizeOutput(text);
  if (blocked || !safeText) return 0;
  responseChunks.push(safeText);
  if (!clientDisconnected) {
    res.write(`data: ${JSON.stringify({ type: 'chunk', content: safeText })}\n\n`);
  }
  return safeText.length;
}

/**
 * Setup SSE headers on the response.
 */
export function setupSSEHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

/**
 * Send meta + done SSE messages.
 */
export function sendMeta(res: Response, clientDisconnected: boolean, meta: Record<string, any>): void {
  if (!clientDisconnected) {
    res.write(`data: ${JSON.stringify(meta)}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  }
}
