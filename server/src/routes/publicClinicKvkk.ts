/**
 * publicClinicKvkk.ts — Public Clinic KVKK/Privacy Notice endpoint
 *
 * GET /api/public/clinics/:clinicSlug/kvkk
 *   Returns published clinic legal profile + safe clinic display info.
 *   No authentication required.
 *   Returns 404 safe message if not found/not published.
 *   Never returns organization internal IDs, tokens, or secrets.
 */

import express, { Request, Response } from 'express';
import prisma from '../db.js';

const router = express.Router();

export const PUBLIC_PROFILE_SELECT = {
  dataControllerTitle: true,
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
  privacyNoticeVersion: true,
  effectiveDate: true,
  isPublished: true,
};

router.get('/clinics/:clinicSlug/kvkk', async (req: Request, res: Response) => {
  const slug = req.params.clinicSlug as string;

  try {
    const clinic = await prisma.clinic.findFirst({
      where: { slug, status: { not: 'cancelled' } },
      select: {
        id: true,
        name: true,
        legalName: true,
        phone: true,
        email: true,
        address: true,
        website: true,
        clinicLegalProfile: {
          select: PUBLIC_PROFILE_SELECT,
        },
      },
    });

    if (!clinic) {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    if (!clinic.clinicLegalProfile?.isPublished) {
      return res.status(404).json({ error: 'Privacy notice not available for this clinic' });
    }

    return res.json({
      clinic: {
        name: clinic.name,
        legalName: clinic.legalName,
      },
      legalProfile: clinic.clinicLegalProfile,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch clinic privacy notice' });
  }
});

export default router;
