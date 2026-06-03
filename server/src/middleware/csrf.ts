import type { NextFunction, Request, Response } from 'express';
import {
  getCsrfCookieName,
  getCookie,
  type SessionType,
  verifyCsrfToken,
} from '../utils/sessionCookies.js';
import type { AuthRequest } from './auth.js';
import type { PlatformAdminRequest } from './platformAuth.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const CSRF_EXCLUDED_PATH_PREFIXES = [
  '/api/public',
  '/api/register',
  '/api/auth/login',
  '/api/auth/csrf',
  '/api/platform/auth/login',
  '/api/platform/auth/csrf',
];

function isCsrfExcludedPath(req: Request): boolean {
  const path = req.originalUrl.split('?')[0] || req.path;
  return CSRF_EXCLUDED_PATH_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

function getAllowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function requestOrigin(req: Request): string | null {
  const origin = req.get('Origin');
  if (origin) return origin;

  const referer = req.get('Referer');
  if (!referer) return null;

  try {
    const parsed = new URL(referer);
    return parsed.origin;
  } catch {
    return null;
  }
}

function isAllowedUnsafeOrigin(req: Request): boolean {
  const origin = requestOrigin(req);
  if (!origin) return true;

  const allowed = getAllowedOrigins();
  if (allowed.length === 0) return process.env.NODE_ENV !== 'production';

  return allowed.includes(origin);
}

function getSessionId(req: Request, type: SessionType): string | undefined {
  if (type === 'clinic') return (req as AuthRequest).user?.sessionId;
  return (req as PlatformAdminRequest).platformAdmin?.sessionId;
}

export function csrfProtection(type: SessionType) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();
    if (isCsrfExcludedPath(req)) return next();

    const authSource = (req as Request & { authSource?: string }).authSource;
    if (authSource !== 'cookie') return next();

    if (!isAllowedUnsafeOrigin(req)) {
      return res.status(403).json({ error: 'Forbidden: Invalid request origin' });
    }

    const token = req.get('X-CSRF-Token');
    const cookieToken = getCookie(req, getCsrfCookieName(type));
    const sessionId = getSessionId(req, type);

    if (!token || !cookieToken || token !== cookieToken || !verifyCsrfToken(token, type, sessionId)) {
      return res.status(403).json({ error: 'Forbidden: Invalid CSRF token' });
    }

    next();
  };
}
