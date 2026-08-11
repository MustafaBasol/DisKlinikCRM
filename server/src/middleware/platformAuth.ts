import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getSecret } from '../utils/secrets.js';
import { PLATFORM_SESSION_COOKIE, createSessionId, getCookie } from '../utils/sessionCookies.js';
import { isBearerFallbackEnabled } from '../utils/authFallback.js';
import prisma from '../db.js';

const PLATFORM_JWT_SECRET = getSecret('PLATFORM_JWT_SECRET', 'platform-admin-secret-change-this');

export interface PlatformAdminRequest extends Request {
  platformAdmin?: {
    id: string;
    email: string;
    sessionId?: string;
  };
  authSource?: 'cookie' | 'bearer';
}

// F3-SEC-002: unlike clinic-user auth (middleware/auth.ts), a valid
// signature/expiry alone used to be sufficient here — a previously issued
// Platform Admin JWT stayed usable after a credential reset until its
// natural 8h expiry. This now performs the same persistent, per-request
// revocation check as clinic auth: the admin must still exist and be
// active, and the token's `iat` must not predate the admin's last recorded
// credential change (`passwordChangedAt`, set by the emergency recovery
// CLI — see scripts/platform-admin-recover-password.ts). Deliberately no
// in-process cache (unlike clinic auth's 15s getAuthUser cache): Platform
// Admin traffic is a handful of privileged operators, not hundreds of
// concurrent clinics, so the extra per-request query is cheap and removes
// any window where a just-revoked token would still be honored.
//
// All rejection branches below return the SAME generic message so a caller
// cannot distinguish "no such admin" / "inactive" / "credentials rotated
// since this token was issued" from each other or from an ordinary invalid
// signature (KVKK/security: never confirm or deny account existence/state
// to an unauthenticated caller). A DB/connectivity failure is treated the
// same way (fails closed, not open) — the outer try/catch already does this
// for jwt.verify() and now also covers this lookup.
export const authenticatePlatformAdmin = async (
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

    if (typeof decoded.iat !== 'number') {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    const adminId = decoded.sub || decoded.id;
    const admin = await prisma.platformAdmin.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, isActive: true, passwordChangedAt: true },
    });

    if (!admin || !admin.isActive) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    if (
      admin.passwordChangedAt &&
      decoded.iat < Math.floor(admin.passwordChangedAt.getTime() / 1000)
    ) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    if (authSource === 'bearer') {
      console.warn('[platform-auth] Bearer token fallback used for platform auth');
    }

    req.platformAdmin = {
      id: admin.id,
      email: admin.email,
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
