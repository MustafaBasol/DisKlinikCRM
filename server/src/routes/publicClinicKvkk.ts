/**
 * publicClinicKvkk.ts — Public Clinic KVKK/Privacy Notice endpoint
 *
 * GET /api/public/clinics/:clinicSlug/kvkk
 *   Returns published clinic legal profile + safe clinic display info.
 *   No authentication required.
 *   Returns 404 safe message if not found/not published.
 *   Never returns organization internal IDs, tokens, or secrets.
 *   Never returns a `website` that is not an absolute http(s) URL — see
 *   toPublicLegalProfile (F3-SEC-004 / R-076).
 */

import express, { Request, Response } from 'express';
import prisma from '../db.js';
import { sanitizeSafeHttpUrl } from '../utils/safeUrl.js';

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

/**
 * Last-mile scrub of the profile before it crosses the unauthenticated boundary.
 *
 * Write-time validation only protects rows written from now on; a `javascript:`
 * value persisted before F3-SEC-004 is still sitting in the database. Nulling it
 * here means the dangerous string never leaves the server on the public
 * endpoint at all, so it cannot reach an href in our page, a cached response, or
 * any third-party consumer of this API.
 *
 * Deliberately NOT applied to the authenticated GET (SAFE_SELECT in
 * clinicLegalProfile.ts): the clinic admin has to be able to see the bad value
 * in their settings form in order to correct it.
 *
 * This reads only — the stored row is never rewritten.
 *
 * Exported for the F3-SEC-004 regression tests.
 */
export function toPublicLegalProfile<T extends { website?: string | null }>(profile: T): T {
  return { ...profile, website: sanitizeSafeHttpUrl(profile.website) };
}

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
      legalProfile: toPublicLegalProfile(clinic.clinicLegalProfile),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch clinic privacy notice' });
  }
});

export default router;
