/**
 * requestId.ts — echoes the per-request correlation id back to the client.
 *
 * pino-http (httpLogger, mounted ahead of this in index.ts) assigns req.id
 * before this middleware runs. Previously that id only ever reached the
 * server's own structured logs — a client or support agent handling a failed
 * request had no way to hand back an id that a log line could be found by.
 * Exposing it as X-Request-Id closes that gap. Safe to expose: pino-http's
 * default id generator here is a per-process monotonic counter (not derived
 * from any client-supplied header), so nothing user-controlled is reflected.
 */
import type { Request, Response, NextFunction } from 'express';

export function attachRequestIdHeader(req: Request, res: Response, next: NextFunction): void {
  if (req.id !== undefined) {
    res.setHeader('X-Request-Id', String(req.id));
  }
  next();
}
