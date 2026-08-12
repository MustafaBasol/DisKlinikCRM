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
// active. Deliberately no in-process cache (unlike clinic auth's 15s
// getAuthUser cache): Platform Admin traffic is a handful of privileged
// operators, not hundreds of concurrent clinics, so the extra per-request
// query is cheap and removes any window where a just-revoked token would
// still be honored.
//
// F3-SEC-002-R1: revocation itself is enforced via an exact `credentialVersion`
// claim, not by comparing the token's `iat` against `passwordChangedAt`. JWT
// `iat` has one-second resolution, so an `iat < checkpoint` (or `<=`)
// comparison cannot reliably order a token issued and a password reset that
// land in the same wall-clock second — the confirmed R1 defect. Instead,
// `credentialVersion` carries the admin's `passwordChangedAt.getTime()`
// value *exactly*, as recorded at token issuance (see generatePlatformToken
// below); the middleware requires it to exactly equal the *current*
// persisted value read fresh from the DB on this request. There is no
// resolution loss and no ordering ambiguity — the claim either equals the
// current checkpoint (this token was issued at-or-after it) or it does not.
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

    // F3-SEC-002-R1: exact credential-version check, replacing the
    // second-resolution-limited `iat` comparison. A row with no recorded
    // credential change (`passwordChangedAt === null`) has never been
    // reset — every pre-migration/never-reset row keeps accepting whatever
    // token it was issued, per the documented legacy-compatibility policy,
    // with no claim requirement at all. Once a reset has happened, the
    // claim must match the current checkpoint exactly: absent, non-numeric,
    // or any other value than the current `passwordChangedAt.getTime()` is
    // rejected.
    if (admin.passwordChangedAt) {
      const currentCredentialVersion = admin.passwordChangedAt.getTime();
      if (
        typeof decoded.credentialVersion !== 'number' ||
        decoded.credentialVersion !== currentCredentialVersion
      ) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }
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

// F3-SEC-002-R1: `passwordChangedAt` (as read from the DB at issuance time,
// e.g. the login route's own admin lookup) becomes the token's exact
// credential-version checkpoint. A row that has never had a credential
// reset (`passwordChangedAt` null/omitted) gets the stable legacy
// representation `null` — authenticatePlatformAdmin never checks this claim
// against a null DB checkpoint, so its exact value is immaterial for those
// rows, but `null` (rather than e.g. omitting the claim) keeps the shape
// deterministic for logging/inspection.
export const generatePlatformToken = (admin: {
  id: string;
  email: string;
  sessionId?: string;
  sessionType?: 'platform' | 'platform_admin';
  passwordChangedAt?: Date | null;
}) => {
  const sessionId = admin.sessionId ?? createSessionId();
  const type = admin.sessionType ?? 'platform_admin';
  const credentialVersion = admin.passwordChangedAt ? admin.passwordChangedAt.getTime() : null;

  return jwt.sign(
    { type, sub: admin.id, id: admin.id, email: admin.email, jti: sessionId, credentialVersion },
    PLATFORM_JWT_SECRET,
    { expiresIn: '8h' },
  );
};
