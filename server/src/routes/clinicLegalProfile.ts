/**
 * clinicLegalProfile.ts — Clinic Legal/KVKK Profile API
 *
 * Endpoints (protected — require authenticated clinic session):
 *   GET    /api/clinics/:clinicId/legal-profile         — Get profile (draft or published)
 *   PUT    /api/clinics/:clinicId/legal-profile         — Create or update (upsert)
 *   POST   /api/clinics/:clinicId/legal-profile/publish — Publish (validates required fields)
 *
 * Security:
 *   - All routes require OWNER | ORG_ADMIN | CLINIC_MANAGER.
 *   - Cross-organization access denied via resolveEffectiveClinicId.
 *   - CLINIC_MANAGER access further restricted to their allowed clinics.
 */

import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../db.js';
import { authorize, AuthRequest } from '../middleware/auth.js';
import { resolveEffectiveClinicId } from '../utils/clinicScope.js';

const router = express.Router();

const LEGAL_PROFILE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'];

const legalProfileSchema = z.object({
  dataControllerTitle: z.string().max(200).optional().nullable(),
  taxNumber: z.string().max(20).optional().nullable(),
  mersisNumber: z.string().max(30).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().max(200).optional().nullable().or(z.literal('')),
  privacyRequestEmail: z.string().email().max(200).optional().nullable().or(z.literal('')),
  kepEmail: z.string().max(200).optional().nullable(),
  website: z.string().max(300).optional().nullable(),
  dataProtectionContact: z.string().max(200).optional().nullable(),
  privacyNoticeText: z.string().max(50000).optional().nullable(),
  channelDisclosureText: z.string().max(10000).optional().nullable(),
  channelConsentText: z.string().max(10000).optional().nullable(),
  privacyNoticeVersion: z.string().max(20).optional().nullable(),
  effectiveDate: z.string().optional().nullable(),
});

// Safe fields to return (no internal secrets)
const SAFE_SELECT = {
  id: true,
  clinicId: true,
  dataControllerTitle: true,
  taxNumber: true,
  mersisNumber: true,
  address: true,
  city: true,
  country: true,
  phone: true,
  email: true,
  privacyRequestEmail: true,
  kepEmail: true,
  website: true,
  dataProtectionContact: true,
  privacyNoticeText: true,
  channelDisclosureText: true,
  channelConsentText: true,
  privacyNoticeVersion: true,
  effectiveDate: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
};

async function resolveClinic(req: AuthRequest, res: Response): Promise<string | false> {
  const clinicId = await resolveEffectiveClinicId(req.user!, req.params.clinicId as string);
  if (!clinicId) {
    res.status(403).json({ error: 'Access denied to requested clinic' });
    return false;
  }
  return clinicId;
}

// GET /api/clinics/:clinicId/legal-profile
router.get(
  '/clinics/:clinicId/legal-profile',
  authorize(LEGAL_PROFILE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const clinicId = await resolveClinic(req, res);
    if (!clinicId) return;

    try {
      const profile = await prisma.clinicLegalProfile.findUnique({
        where: { clinicId },
        select: SAFE_SELECT,
      });

      return res.json({ profile: profile ?? null });
    } catch {
      return res.status(500).json({ error: 'Failed to fetch legal profile' });
    }
  },
);

// PUT /api/clinics/:clinicId/legal-profile
router.put(
  '/clinics/:clinicId/legal-profile',
  authorize(LEGAL_PROFILE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const clinicId = await resolveClinic(req, res);
    if (!clinicId) return;

    const parsed = legalProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const data = parsed.data;
    const effectiveDate = data.effectiveDate ? new Date(data.effectiveDate) : null;

    try {
      const profile = await prisma.clinicLegalProfile.upsert({
        where: { clinicId },
        create: {
          clinicId,
          organizationId: req.user!.organizationId,
          ...data,
          effectiveDate,
          email: data.email || null,
          privacyRequestEmail: data.privacyRequestEmail || null,
          isPublished: false,
        },
        update: {
          ...data,
          effectiveDate,
          email: data.email || null,
          privacyRequestEmail: data.privacyRequestEmail || null,
          isPublished: false,
        },
        select: SAFE_SELECT,
      });

      return res.json({ profile });
    } catch {
      return res.status(500).json({ error: 'Failed to save legal profile' });
    }
  },
);

// POST /api/clinics/:clinicId/legal-profile/publish
router.post(
  '/clinics/:clinicId/legal-profile/publish',
  authorize(LEGAL_PROFILE_ROLES),
  async (req: AuthRequest, res: Response) => {
    const clinicId = await resolveClinic(req, res);
    if (!clinicId) return;

    try {
      const existing = await prisma.clinicLegalProfile.findUnique({
        where: { clinicId },
        select: {
          dataControllerTitle: true,
          address: true,
          privacyRequestEmail: true,
          email: true,
          privacyNoticeText: true,
          privacyNoticeVersion: true,
          effectiveDate: true,
        },
      });

      if (!existing) {
        return res.status(404).json({ error: 'No legal profile found. Save a draft first.' });
      }

      const fieldErrors: Record<string, string> = {};
      if (!existing.dataControllerTitle?.trim()) fieldErrors.dataControllerTitle = 'required';
      if (!existing.address?.trim()) fieldErrors.address = 'required';
      if (!existing.privacyNoticeText?.trim()) fieldErrors.privacyNoticeText = 'required';
      if (!existing.privacyNoticeVersion?.trim()) fieldErrors.privacyNoticeVersion = 'required';
      if (!existing.effectiveDate) fieldErrors.effectiveDate = 'required';
      if (!existing.privacyRequestEmail?.trim() && !existing.email?.trim()) {
        fieldErrors.privacyRequestEmail = 'privacyRequestEmail or email required';
      }

      if (Object.keys(fieldErrors).length > 0) {
        return res.status(422).json({ error: 'Required fields missing for publishing', fieldErrors });
      }

      const profile = await prisma.clinicLegalProfile.update({
        where: { clinicId },
        data: { isPublished: true },
        select: SAFE_SELECT,
      });

      return res.json({ profile });
    } catch {
      return res.status(500).json({ error: 'Failed to publish legal profile' });
    }
  },
);

export default router;
