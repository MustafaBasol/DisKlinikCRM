import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import { normalizeRole } from '../utils/roles.js';

const JWT_SECRET = process.env.JWT_SECRET || 'health-crm-secret-key-change-this';

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
  };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    // Klinik erişim kontrolü
    const clinicInfo = await getClinicInfo(decoded.clinicId);
    if (!clinicInfo) {
      return res.status(403).json({ error: 'Clinic not found' });
    }
    if (clinicInfo.status === 'suspended') {
      return res.status(403).json({ error: 'Clinic access suspended. Please contact support.' });
    }
    if (clinicInfo.status === 'cancelled') {
      return res.status(403).json({ error: 'Clinic subscription cancelled.' });
    }

    const canAccessAllClinics = decoded.canAccessAllClinics ?? false;
    req.user = {
      id: decoded.id,
      clinicId: decoded.clinicId,
      role: decoded.role,
      normalizedRole: normalizeRole(decoded.role, canAccessAllClinics),
      organizationId: clinicInfo.organizationId,
      // Eski token uyumluluğu: allowedClinicIds yoksa veya boşsa, clinicId'yi fallback kullan.
      // Yeni tokenlar login sırasında UserClinic tablosundan doldurulur.
      allowedClinicIds: decoded.allowedClinicIds?.length > 0
        ? decoded.allowedClinicIds
        : [decoded.clinicId],
      canAccessAllClinics,
    };
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
}) => {
  return jwt.sign(
    {
      id: user.id,
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
