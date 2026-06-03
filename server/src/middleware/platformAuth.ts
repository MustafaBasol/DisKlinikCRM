import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getSecret } from '../utils/secrets.js';
import { PLATFORM_SESSION_COOKIE, createSessionId, getCookie } from '../utils/sessionCookies.js';
import { isBearerFallbackEnabled } from '../utils/authFallback.js';

const PLATFORM_JWT_SECRET = getSecret('PLATFORM_JWT_SECRET', 'platform-admin-secret-change-this');

export interface PlatformAdminRequest extends Request {
  platformAdmin?: {
    id: string;
    email: string;
    sessionId?: string;
  };
  authSource?: 'cookie' | 'bearer';
}

export const authenticatePlatformAdmin = (
  req: PlatformAdminRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  const cookieToken = getCookie(req, PLATFORM_SESSION_COOKIE);
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
  const bearerFallbackEnabled = isBearerFallbackEnabled('platform');
  const token = cookieToken || (bearerFallbackEnabled ? bearerToken : undefined);

  if (!token) {
    return res.status(401).json({
      error: bearerToken && !bearerFallbackEnabled
        ? 'Unauthorized: Cookie session required'
        : 'Unauthorized: Missing token',
    });
  }

  try {
    const decoded = jwt.verify(token, PLATFORM_JWT_SECRET) as any;
    const authSource = cookieToken ? 'cookie' : 'bearer';

    if (decoded.type !== 'platform' && decoded.type !== 'platform_admin') {
      return res.status(403).json({ error: 'Forbidden: Not a platform admin token' });
    }

    if (authSource === 'cookie' && !decoded.jti) {
      return res.status(401).json({ error: 'Unauthorized: Invalid session' });
    }

    if (authSource === 'bearer') {
      console.warn('[platform-auth] Bearer token fallback used for platform auth');
    }

    req.platformAdmin = {
      id: decoded.sub || decoded.id,
      email: decoded.email,
      sessionId: decoded.jti,
    };
    req.authSource = authSource;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const generatePlatformToken = (admin: {
  id: string;
  email: string;
  sessionId?: string;
  sessionType?: 'platform' | 'platform_admin';
}) => {
  const sessionId = admin.sessionId ?? createSessionId();
  const type = admin.sessionType ?? 'platform_admin';

  return jwt.sign(
    { type, sub: admin.id, id: admin.id, email: admin.email, jti: sessionId },
    PLATFORM_JWT_SECRET,
    { expiresIn: '8h' },
  );
};
