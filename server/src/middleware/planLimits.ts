import { Response, NextFunction } from 'express';
import prisma from '../db.js';
import { AuthRequest } from './auth.js';

type LimitEntry = { maxUsers: number; maxPatients: number; userCount: number; patientCount: number; expiresAt: number };

// Cache keyed by organizationId or clinicId
const limitsCache = new Map<string, LimitEntry>();
const CACHE_TTL_MS = 30_000;

async function getOrgLimits(organizationId: string): Promise<LimitEntry | null> {
  const cached = limitsCache.get(`org:${organizationId}`);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const [org, userCount, patientCount] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      include: { plan: { select: { maxUsers: true, maxPatients: true } } },
    }),
    prisma.user.count({ where: { organizationId } }),
    prisma.patient.count({ where: { organizationId, deletedAt: null, patientStatus: { not: 'archived' } } }),
  ]);

  if (!org?.plan) return null;

  const entry: LimitEntry = {
    maxUsers: org.plan.maxUsers,
    maxPatients: org.plan.maxPatients,
    userCount,
    patientCount,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  limitsCache.set(`org:${organizationId}`, entry);
  return entry;
}

async function getClinicLimits(clinicId: string): Promise<LimitEntry | null> {
  const cached = limitsCache.get(`clinic:${clinicId}`);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const [clinic, userCount, patientCount] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { maxUsers: true, maxPatients: true } }),
    prisma.userClinic.count({ where: { clinicId, isActive: true } }),
    prisma.patient.count({ where: { clinicId, deletedAt: null, patientStatus: { not: 'archived' } } }),
  ]);

  if (!clinic) return null;

  const entry: LimitEntry = {
    maxUsers: clinic.maxUsers,
    maxPatients: clinic.maxPatients,
    userCount,
    patientCount,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  limitsCache.set(`clinic:${clinicId}`, entry);
  return entry;
}

export const checkUserLimit = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const organizationId = req.user!.organizationId;
    const limits = organizationId
      ? (await getOrgLimits(organizationId)) ?? (await getClinicLimits(req.user!.clinicId))
      : await getClinicLimits(req.user!.clinicId);

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
    const organizationId = req.user!.organizationId;
    const limits = organizationId
      ? (await getOrgLimits(organizationId)) ?? (await getClinicLimits(req.user!.clinicId))
      : await getClinicLimits(req.user!.clinicId);

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
      const organizationId = req.user!.organizationId;

      let features: Record<string, boolean> = {};

      if (organizationId) {
        const org = await prisma.organization.findUnique({
          where: { id: organizationId },
          include: { plan: true },
        });
        features = (org?.plan?.features as Record<string, boolean>) ?? {};
      } else {
        const clinic = await prisma.clinic.findUnique({
          where: { id: req.user!.clinicId },
          include: { plan: true },
        });
        features = (clinic?.plan?.features as Record<string, boolean>) ?? {};
      }

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
