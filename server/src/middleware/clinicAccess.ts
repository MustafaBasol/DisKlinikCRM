/**
 * clinicAccess.ts — Klinik Erişim Middleware (Sprint 4)
 *
 * Kullanım:
 *   router.get('/patients', authenticate, requireClinicAccess, async (req: AuthRequest, res) => {
 *     const scope = req.clinicScope!;
 *     const patients = await prisma.patient.findMany({ where: scope });
 *   });
 *
 * ?clinicId=<uuid> veya ?clinicId=all kabul edilir.
 * Eksik veya geçersiz klinik = 403.
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { buildClinicScopeWhere, ClinicScopeWhere } from '../utils/clinicScope.js';

// AuthRequest'i genişlet — clinicScope ekleniyor
declare module '../middleware/auth.js' {
  interface AuthRequest {
    clinicScope?: ClinicScopeWhere;
  }
}

/**
 * Token doğrulamasından sonra çalışır (authenticate middleware sonrası).
 * req.clinicScope'u doldurur veya 403 döner.
 */
export const requireClinicAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ?clinicId query param veya header'dan seçili klinik
  const headerClinicId = req.headers['x-clinic-id'];
  const selectedClinicId =
    (req.query.clinicId as string | undefined) ||
    (Array.isArray(headerClinicId) ? headerClinicId[0] : headerClinicId);

  const scope = await buildClinicScopeWhere(req.user, selectedClinicId);
  if (scope === null) {
    return res.status(403).json({ error: 'Access denied to requested clinic' });
  }

  (req as any).clinicScope = scope;
  next();
};

/**
 * Belirli bir klinik ID'sine tam erişim gerektirir (list değil).
 * Route param'dan :clinicId veya body.clinicId okur.
 */
export const requireSpecificClinicAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const rawParam = req.params.clinicId;
  const clinicId =
    (Array.isArray(rawParam) ? rawParam[0] : rawParam) ||
    (req.body?.clinicId as string | undefined) ||
    (req.query.clinicId as string | undefined);

  if (!clinicId) {
    return res.status(400).json({ error: 'clinicId is required' });
  }

  const scope = await buildClinicScopeWhere(req.user, clinicId);
  if (scope === null) {
    return res.status(403).json({ error: 'Access denied to requested clinic' });
  }

  (req as any).clinicScope = scope;
  next();
};
