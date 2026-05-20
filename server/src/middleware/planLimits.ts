import { Response, NextFunction } from 'express';
import prisma from '../db.js';
import { AuthRequest } from './auth.js';

// Cache: clinicId → { maxUsers, maxPatients, userCount, patientCount, expiresAt }
const limitsCache = new Map<string, { maxUsers: number; maxPatients: number; userCount: number; patientCount: number; expiresAt: number }>();
const CACHE_TTL_MS = 30_000; // 30 saniye

async function getClinicLimits(clinicId: string) {
  const cached = limitsCache.get(clinicId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const [clinic, userCount, patientCount] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { maxUsers: true, maxPatients: true } }),
    prisma.user.count({ where: { clinicId } }),
    prisma.patient.count({ where: { clinicId, deletedAt: null } }),
  ]);

  if (!clinic) return null;

  const entry = {
    maxUsers: clinic.maxUsers,
    maxPatients: clinic.maxPatients,
    userCount,
    patientCount,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  limitsCache.set(clinicId, entry);
  return entry;
}

export const checkUserLimit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limits = await getClinicLimits(req.user!.clinicId);
    if (!limits) return res.status(404).json({ error: 'Clinic not found' });

    if (limits.userCount >= limits.maxUsers) {
      return res.status(402).json({
        error: 'User limit reached for your plan',
        current: limits.userCount,
        max: limits.maxUsers,
      });
    }
    next();
  } catch {
    res.status(500).json({ error: 'Failed to check plan limits' });
  }
};

export const checkPatientLimit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const limits = await getClinicLimits(req.user!.clinicId);
    if (!limits) return res.status(404).json({ error: 'Clinic not found' });

    if (limits.patientCount >= limits.maxPatients) {
      return res.status(402).json({
        error: 'Patient limit reached for your plan',
        current: limits.patientCount,
        max: limits.maxPatients,
      });
    }
    next();
  } catch {
    res.status(500).json({ error: 'Failed to check plan limits' });
  }
};

export const requireFeature = (feature: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const clinic = await prisma.clinic.findUnique({
        where: { id: req.user!.clinicId },
        include: { plan: true },
      });

      if (!clinic) return res.status(404).json({ error: 'Clinic not found' });

      const features = (clinic.plan?.features as Record<string, boolean>) ?? {};
      if (features[feature] === false) {
        return res.status(402).json({
          error: `Feature '${feature}' is not available in your current plan`,
        });
      }
      next();
    } catch {
      res.status(500).json({ error: 'Failed to check plan features' });
    }
  };
};
