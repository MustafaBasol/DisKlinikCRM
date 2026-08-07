/**
 * detect-imaging-study-request-patient-mismatch.ts — F2-CT-23 historical
 * data audit.
 *
 * READ-ONLY. Finds any existing `ImagingStudy` rows where `imagingRequestId`
 * is set but the study's own `patientId` no longer matches the referenced
 * `ImagingRequest.patientId` — the exact inconsistent state that
 * `PATCH /api/imaging/studies/:id/link` could previously produce (fixed by
 * this task in server/src/routes/imaging.ts). Rows already in this state
 * before the fix are NOT touched or migrated by that fix, since
 * `ImagingRequest.patientId` never changes and the fixed route only rejects
 * *new* inconsistent writes going forward — this script exists to surface
 * whether any pre-existing rows need a separate, explicitly-authorized
 * remediation decision (out of scope for this task per its own brief).
 *
 * Performs ONLY a single SELECT-shaped Prisma read. No `update`, `delete`,
 * `create`, or `$executeRaw` call exists anywhere in this file — verified by
 * this file containing no such call. Safe to run against a production
 * database; still recommended to run against a read replica first if one is
 * available, per standard operational caution for any ad hoc production
 * query.
 *
 * Run:
 *   DATABASE_URL=postgresql://... npx tsx scripts/detect-imaging-study-request-patient-mismatch.ts
 *
 * Exit code 0 whether or not mismatches are found (this is a report, not a
 * pass/fail check) — the finding count is in stdout/the JSON summary line.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set — refusing to run without an explicit target database.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

async function main() {
  const studies = await prisma.imagingStudy.findMany({
    where: { imagingRequestId: { not: null } },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      imagingRequestId: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      imagingRequest: { select: { id: true, clinicId: true, patientId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const mismatches = studies.filter((s) => {
    if (!s.imagingRequest) return true; // imagingRequestId set but the FK target is unreachable under this read — report defensively, should be structurally impossible per the FK constraint
    return s.patientId !== s.imagingRequest.patientId || s.clinicId !== s.imagingRequest.clinicId;
  });

  console.log(`[detect-imaging-study-request-patient-mismatch] scanned ${studies.length} ImagingStudy row(s) with a non-null imagingRequestId.`);

  if (mismatches.length === 0) {
    console.log('[detect-imaging-study-request-patient-mismatch] no mismatches found.');
    console.log(JSON.stringify({ scanned: studies.length, mismatches: 0 }));
    return;
  }

  console.log(`[detect-imaging-study-request-patient-mismatch] FOUND ${mismatches.length} mismatched row(s):`);
  for (const m of mismatches) {
    console.log(
      `  studyId=${m.id} clinicId=${m.clinicId} studyPatientId=${m.patientId ?? 'null'} ` +
      `imagingRequestId=${m.imagingRequestId} requestPatientId=${m.imagingRequest?.patientId ?? 'MISSING'} ` +
      `requestClinicId=${m.imagingRequest?.clinicId ?? 'MISSING'} status=${m.status} createdAt=${m.createdAt.toISOString()}`,
    );
  }
  console.log(JSON.stringify({
    scanned: studies.length,
    mismatches: mismatches.length,
    studyIds: mismatches.map((m) => m.id),
  }));
}

main()
  .catch((err) => {
    console.error('[detect-imaging-study-request-patient-mismatch] Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
