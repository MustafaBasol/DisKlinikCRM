import crypto from 'crypto';
import type { CookieOptions, Request, Response } from 'express';

export type SessionType = 'clinic' | 'platform';

export const CLINIC_SESSION_COOKIE = 'hcrm_session';
export const PLATFORM_SESSION_COOKIE = 'hcrm_platform_session';
export const CLINIC_CSRF_COOKIE = 'csrf_token';
export const PLATFORM_CSRF_COOKIE = 'platform_csrf_token';
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const CSRF_CLOCK_SKEW_MS = 5 * 60 * 1000;

type SameSite = 'lax' | 'strict' | 'none';

export function createSessionId(): string {
  return crypto.randomUUID();
}

function normalizeSameSite(value: string | undefined): SameSite {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'strict' || normalized === 'none') return normalized;
  return 'lax';
}

function getSameSite(): SameSite {
  return normalizeSameSite(process.env.SESSION_COOKIE_SAMESITE || process.env.COOKIE_SAMESITE);
}

function getCookieDomain(): string | undefined {
  return process.env.SESSION_COOKIE_DOMAIN?.trim() || process.env.COOKIE_DOMAIN?.trim() || undefined;
}

function getSecureFlag(sameSite: SameSite): boolean {
  if (String(process.env.SESSION_COOKIE_SECURE ?? process.env.COOKIE_SECURE ?? '').toLowerCase() === 'true') {
    return true;
  }
  return process.env.NODE_ENV === 'production' || sameSite === 'none';
}

function baseCookieOptions(httpOnly: boolean): CookieOptions {
  const sameSite = getSameSite();
  return {
    httpOnly,
    secure: getSecureFlag(sameSite),
    sameSite,
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
    ...(getCookieDomain() ? { domain: getCookieDomain() } : {}),
  };
}

function clearCookieOptions(httpOnly: boolean): CookieOptions {
  const { maxAge: _maxAge, ...options } = baseCookieOptions(httpOnly);
  return options;
}

export function getSessionCookieName(type: SessionType): string {
  return type === 'clinic' ? CLINIC_SESSION_COOKIE : PLATFORM_SESSION_COOKIE;
}

export function getCsrfCookieName(type: SessionType): string {
  return type === 'clinic' ? CLINIC_CSRF_COOKIE : PLATFORM_CSRF_COOKIE;
}

export function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.cookie;
  if (!raw) return {};

  return raw.split(';').reduce<Record<string, string>>((acc, part) => {
    const [name, ...valueParts] = part.trim().split('=');
    if (!name) return acc;
    const value = valueParts.join('=');
    try {
      acc[name] = decodeURIComponent(value);
    } catch {
      acc[name] = value;
    }
    return acc;
  }, {});
}

export function getCookie(req: Request, name: string): string | undefined {
  return parseCookies(req)[name];
}

export function setSessionCookie(res: Response, type: SessionType, token: string): void {
  res.cookie(getSessionCookieName(type), token, baseCookieOptions(true));
}

export function clearSessionCookie(res: Response, type: SessionType): void {
  res.clearCookie(getSessionCookieName(type), clearCookieOptions(true));
}

export function setCsrfCookie(res: Response, type: SessionType, token: string): void {
  res.cookie(getCsrfCookieName(type), token, baseCookieOptions(false));
}

export function clearCsrfCookie(res: Response, type: SessionType): void {
  res.clearCookie(getCsrfCookieName(type), clearCookieOptions(false));
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function getCsrfSecret(): string {
  return (
    process.env.CSRF_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    process.env.PLATFORM_JWT_SECRET?.trim() ||
    'csrf-development-secret-change-this-value'
  );
}

export function isCsrfSecretConfigured(): boolean {
  const secret = process.env.CSRF_SECRET?.trim();
  return Boolean(secret && secret.length >= 32);
}

export function getSessionCookieDeploymentWarnings(): string[] {
  const warnings: string[] = [];
  const domain = getCookieDomain();

  if (process.env.NODE_ENV === 'production' && !isCsrfSecretConfigured()) {
    warnings.push('CSRF_SECRET is missing or shorter than 32 characters. Set a strong CSRF_SECRET before production use.');
  }

  if (domain && /^https?:\/\//i.test(domain)) {
    warnings.push('SESSION_COOKIE_DOMAIN must be a bare domain, for example ".example.com", not a URL.');
  }

  return warnings;
}

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', getCsrfSecret()).update(payload).digest('base64url');
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createCsrfToken(type: SessionType, sessionId: string, issuedAt = Date.now()): string {
  const payload = base64url(JSON.stringify({ type, sessionId, iat: issuedAt }));
  return `${payload}.${signPayload(payload)}`;
}

export function verifyCsrfToken(token: string | undefined, type: SessionType, sessionId: string | undefined): boolean {
  if (!token || !sessionId) return false;

  const [payload, signature] = token.split('.');
  if (!payload || !signature || !timingSafeEqualString(signature, signPayload(payload))) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      type?: string;
      sessionId?: string;
      iat?: number;
    };

    if (decoded.type !== type || decoded.sessionId !== sessionId || typeof decoded.iat !== 'number') {
      return false;
    }

    const now = Date.now();
    if (decoded.iat > now + CSRF_CLOCK_SKEW_MS) return false;
    if (now - decoded.iat > SESSION_MAX_AGE_MS) return false;

    return true;
  } catch {
    return false;
  }
}

export function issueSessionCookies(
  res: Response,
  type: SessionType,
  sessionToken: string,
  sessionId: string,
): string {
  const csrfToken = createCsrfToken(type, sessionId);
  setSessionCookie(res, type, sessionToken);
  setCsrfCookie(res, type, csrfToken);
  return csrfToken;
}

export function clearAuthCookies(res: Response, type: SessionType): void {
  clearSessionCookie(res, type);
  clearCsrfCookie(res, type);
}
