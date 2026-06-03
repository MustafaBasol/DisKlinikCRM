import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import { normalizeRole } from '../utils/roles.js';
import { getSecret } from '../utils/secrets.js';
import { CLINIC_SESSION_COOKIE, createSessionId, getCookie } from '../utils/sessionCookies.js';
import { isBearerFallbackEnabled } from '../utils/authFallback.js';

const JWT_SECRET = getSecret('JWT_SECRET', 'health-crm-secret-key-change-this');

// Simple in-memory cache: clinicId → { status, organizationId, expiresAt }
const clinicStatusCache = new Map<string, { status: string; organizationId: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 saniye

async function getClinicInfo(clinicId: string): Promise<{ status: string; organizationId: string } | null> {
  const cached = clinicStatusCache.get(clinicId);
  if (cached && cached.expiresAt > Date.now()) return { status: cached.status, organizationId: cached.organizationId };

  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { status: true, organizationId: true } });
  if (!clinic) return null;

  clinicStatusCache.set(clinicId, { status: clinic.status, organizationId: clinic.organizationId, expiresAt: Date.now() + CACHE_TTL_MS });
  return { status: clinic.status, organizationId: clinic.organizationId };
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    clinicId: string;             // defaultClinicId — sadece UI varsayılanı, yetkilendirme değil
    role: string;                 // Ham rol (logging ve eski uyumluluk için)
    normalizedRole: string;       // Kanonik rol (güvenlik kontrolleri için kullanın)
    organizationId: string;
    allowedClinicIds: string[];   // Gerçek klinik erişim listesi (UserClinic'ten)
    canAccessAllClinics: boolean; // OWNER/ORG_ADMIN için true
    sessionId?: string;
  };
  authSource?: 'cookie' | 'bearer';
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const cookieToken = getCookie(req, CLINIC_SESSION_COOKIE);
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;
  const bearerFallbackEnabled = isBearerFallbackEnabled('clinic');
  const token = cookieToken || (bearerFallbackEnabled ? bearerToken : undefined);

  if (!token) {
    return res.status(401).json({
      error: bearerToken && !bearerFallbackEnabled
        ? 'Unauthorized: Cookie session required'
        : 'Unauthorized: Missing token',
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const authSource = cookieToken ? 'cookie' : 'bearer';

    if (decoded.type && decoded.type !== 'clinic') {
      return res.status(403).json({ error: 'Forbidden: Invalid token type' });
    }

    if (authSource === 'cookie' && !decoded.jti) {
      return res.status(401).json({ error: 'Unauthorized: Invalid session' });
    }

    if (authSource === 'bearer') {
      console.warn('[auth] Bearer token fallback used for clinic auth');
    }

    // Klinik erişim kontrolü
    const dbUser = await prisma.user.findUnique({
      where: { id: decoded.sub || decoded.id },
      select: {
        id: true,
        clinicId: true,
        defaultClinicId: true,
        role: true,
        isActive: true,
        organizationId: true,
        canAccessAllClinics: true,
        userClinics: {
          where: { isActive: true },
          select: { clinicId: true },
        },
      },
    });

    if (!dbUser || !dbUser.isActive) {
      return res.status(401).json({ error: 'Unauthorized: User is inactive' });
    }

    const canAccessAllClinics = dbUser.canAccessAllClinics === true;
    const activeAssignedClinicIds = dbUser.userClinics.map(uc => uc.clinicId);
    const allowedClinicIds = canAccessAllClinics
      ? activeAssignedClinicIds
      : Array.from(new Set([dbUser.clinicId, ...activeAssignedClinicIds].filter(Boolean)));

    if (!canAccessAllClinics && allowedClinicIds.length === 0) {
      return res.status(403).json({ error: 'No active clinic access' });
    }

    const requestedDefaultClinicId = decoded.clinicId || dbUser.defaultClinicId || dbUser.clinicId;
    const clinicId = canAccessAllClinics || allowedClinicIds.includes(requestedDefaultClinicId)
      ? requestedDefaultClinicId
      : allowedClinicIds[0];

    const clinicInfo = await getClinicInfo(clinicId);
    if (!clinicInfo) {
      return res.status(403).json({ error: 'Clinic not found' });
    }
    if (clinicInfo.organizationId !== dbUser.organizationId) {
      return res.status(403).json({ error: 'Clinic does not belong to user organization' });
    }
    if (clinicInfo.status === 'suspended') {
      return res.status(403).json({ error: 'Clinic access suspended. Please contact support.' });
    }
    if (clinicInfo.status === 'cancelled') {
      return res.status(403).json({ error: 'Clinic subscription cancelled.' });
    }

    req.user = {
      id: dbUser.id,
      clinicId,
      role: dbUser.role,
      normalizedRole: normalizeRole(dbUser.role, canAccessAllClinics),
      organizationId: dbUser.organizationId,
      allowedClinicIds,
      canAccessAllClinics,
      sessionId: decoded.jti,
    };
    req.authSource = authSource;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

/**
 * authorize() — İki katmanlı rol kontrolü
 *
 * Katman 1: Kanonik rol kontrolü
 *   Kullanıcının rolü normalizeRole() ile kanonik forma dönüştürülür.
 *   authorize(['OWNER', 'ORG_ADMIN']) çağrısı, "admin" rolüne sahip
 *   kullanıcıyı kabul eder (ORG_ADMIN veya OWNER'a normalize olur).
 *   "admin" + canAccessAllClinics=true → OWNER
 *   "admin" + canAccessAllClinics=false → ORG_ADMIN
 *
 * Katman 2: Ham rol kontrolü (geriye dönük uyumluluk)
 *   authorize(['admin','doctor','receptionist']) gibi eski çağrılar
 *   ham rol string'ini de kontrol ederek mevcut davranışı korur.
 *
 * Güvenlik notu:
 *   Yalnızca kanonik roller kullanılan endpoint'lerde (org dashboard gibi),
 *   eski rolleri listeye EKLEMEYIN — bu kasıtlı bir kısıtlama mekanizmasıdır.
 */
export const authorize = (roles: string[]) => {
  const normalizedList = roles.map(r => r.toLowerCase());
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    // Kullanıcının kanonik rolünü hesapla
    const canonicalRole = normalizeRole(req.user.role, req.user.canAccessAllClinics).toLowerCase();
    // Ham rolü de kontrol et (geriye dönük uyumluluk)
    const rawRole = req.user.role.toLowerCase();

    if (!normalizedList.includes(canonicalRole) && !normalizedList.includes(rawRole)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
};

export const generateToken = (user: {
  id: string;
  clinicId: string;             // defaultClinicId — sadece UI varsayılanı
  organizationId: string;
  allowedClinicIds: string[];   // Boş dizi ASLA "hepsine erişim" anlamına GELMEZ
  canAccessAllClinics: boolean; // true ise allowedClinicIds göz ardı edilir
  role: string;
  sessionId?: string;
}) => {
  const sessionId = user.sessionId ?? createSessionId();

  return jwt.sign(
    {
      sub: user.id,
      id: user.id,
      type: 'clinic',
      jti: sessionId,
      clinicId: user.clinicId,
      organizationId: user.organizationId,
      allowedClinicIds: user.allowedClinicIds,
      canAccessAllClinics: user.canAccessAllClinics,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
};
