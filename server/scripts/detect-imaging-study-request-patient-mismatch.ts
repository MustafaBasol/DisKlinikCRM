/**
 * detect-imaging-study-request-patient-mismatch.ts — F2-CT-23 historical
 * data audit.
 *
 * READ-ONLY. Finds any existing `ImagingStudy` rows where `imagingRequestId`
 * is set but the study's own `patientId`/`clinicId` no longer matches the
 * referenced `ImagingRequest.patientId`/`clinicId` (or the relation is
 * otherwise unreachable) — the exact inconsistent state that
 * `PATCH /api/imaging/studies/:id/link` could previously produce (fixed by
 * this task in server/src/routes/imaging.ts). Rows already in this state
 * before the fix are NOT touched or migrated by that fix, since
 * `ImagingRequest.patientId` never changes and the fixed route only rejects
 * *new* inconsistent writes going forward — this script exists to surface
 * whether any pre-existing rows need a separate, explicitly-authorized
 * remediation decision (out of scope for this task per its own brief).
 *
 * Performs ONLY paginated SELECT-shaped Prisma reads, in bounded batches via
 * cursor + take on the row's unique `id` (ascending, deterministic — no
 * duplicate/omitted rows across pages even under concurrent inserts, since
 * new rows always sort after an already-issued cursor). No `update`,
 * `delete`, `create`, or `$executeRaw` call exists anywhere in this file —
 * verified by this file containing no such call. Only mismatched rows are
 * accumulated in memory; the full row set is never held at once, so memory
 * use stays bounded by batch size regardless of table size. Safe to run
 * against a production database; still recommended to run against a read
 * replica first if one is available, per standard operational caution for
 * any ad hoc production query.
 *
 * Per-row logs intentionally omit `patientId`/`imagingRequest.patientId`
 * values — `studyId` + `imagingRequestId` is enough for an operator to look
 * a row up under proper authorization without echoing patient-linked
 * identifiers into logs/log aggregators.
 *
 * Run:
 *   DATABASE_URL=postgresql://... npx tsx scripts/detect-imaging-study-request-patient-mismatch.ts
 *   DETECTOR_BATCH_SIZE=1000 DATABASE_URL=postgresql://... npx tsx scripts/detect-imaging-study-request-patient-mismatch.ts
 *
 * Exit code 0 when the scan completes (mismatches found or not — this is a
 * report, not a pass/fail check; the finding count is in stdout/the JSON
 * summary line). Exit code 1 on any DB/query error.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BATCH_SIZE = 500;

export interface MismatchReasons {
  patientMismatch: boolean;
  clinicMismatch: boolean;
  missingRequest: boolean;
}

export interface MismatchRecord {
  studyId: string;
  clinicId: string;
  imagingRequestId: string;
  requestClinicId: string | null;
  status: string;
  createdAt: string;
  reasons: MismatchReasons;
}

export interface ScanResult {
  scanned: number;
  pages: number;
  mismatches: MismatchRecord[];
}

type ImagingStudyPage = Array<{
  id: string;
  clinicId: string;
  patientId: string | null;
  imagingRequestId: string | null;
  status: string;
  createdAt: Date;
  imagingRequest: { id: string; clinicId: string; patientId: string } | null;
}>;

export interface ScannableImagingStudyClient {
  imagingStudy: {
    // Return type is intentionally `Promise<any>`, not `Promise<ImagingStudyPage>`:
    // the real PrismaClient's findMany is generic over its `select`/`include`
    // args, so its structural type can't unify with a fixed narrow return type
    // here. The `select` below is what actually pins the shape at the call
    // site; the cast right after the call recovers it for the rest of this
    // module.
    findMany(args: any): Promise<any>;
  };
}

/**
 * Bounded-pagination scan: repeatedly fetches up to `batchSize` rows ordered
 * by `id` ascending, resuming from the last-seen id each iteration (cursor +
 * skip:1, never OFFSET-scanning the already-visited rows). Terminates as
 * soon as a page returns fewer rows than requested (or zero) — a strictly
 * decreasing/bounded number of iterations, so this always halts.
 */
export async function scanForMismatches(
  prismaClient: ScannableImagingStudyClient,
  options: { batchSize?: number; clinicIds?: string[] } = {},
): Promise<ScanResult> {
  const batchSize =
    typeof options.batchSize === 'number' && Number.isFinite(options.batchSize) && options.batchSize > 0
      ? Math.floor(options.batchSize)
      : DEFAULT_BATCH_SIZE;

  // clinicIds is test-only scoping (isolates a suite's own fixtures on a
  // shared disposable DB) — omitted in production use (main() below), where
  // the scan is intentionally unscoped across every clinic.
  const where: Record<string, unknown> = { imagingRequestId: { not: null } };
  if (options.clinicIds) where.clinicId = { in: options.clinicIds };

  let cursor: string | undefined;
  let scanned = 0;
  let pages = 0;
  const mismatches: MismatchRecord[] = [];

  for (;;) {
    const page = (await prismaClient.imagingStudy.findMany({
      where,
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        imagingRequestId: true,
        status: true,
        createdAt: true,
        imagingRequest: { select: { id: true, clinicId: true, patientId: true } },
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })) as ImagingStudyPage;

    if (page.length === 0) break;

    pages += 1;
    scanned += page.length;

    for (const s of page) {
      const missingRequest = !s.imagingRequest; // structurally impossible per the FK constraint — reported defensively
      const patientMismatch = !missingRequest && s.patientId !== s.imagingRequest!.patientId;
      const clinicMismatch = !missingRequest && s.clinicId !== s.imagingRequest!.clinicId;

      if (missingRequest || patientMismatch || clinicMismatch) {
        mismatches.push({
          studyId: s.id,
          clinicId: s.clinicId,
          imagingRequestId: s.imagingRequestId as string,
          requestClinicId: s.imagingRequest?.clinicId ?? null,
          status: s.status,
          createdAt: s.createdAt.toISOString(),
          reasons: { patientMismatch, clinicMismatch, missingRequest },
        });
      }
    }

    cursor = page[page.length - 1].id;
    if (page.length < batchSize) break;
  }

  return { scanned, pages, mismatches };
}

function reasonLabel(reasons: MismatchReasons): string {
  return [
    reasons.patientMismatch && 'patient',
    reasons.clinicMismatch && 'clinic',
    reasons.missingRequest && 'missing-request',
  ]
    .filter(Boolean)
    .join('+');
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set — refusing to run without an explicit target database.');
  }

  let batchSize = DEFAULT_BATCH_SIZE;
  if (process.env.DETECTOR_BATCH_SIZE !== undefined) {
    const parsed = Number(process.env.DETECTOR_BATCH_SIZE);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`DETECTOR_BATCH_SIZE must be a positive number, got: ${process.env.DETECTOR_BATCH_SIZE}`);
    }
    batchSize = Math.floor(parsed);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });
  try {
    const { scanned, pages, mismatches } = await scanForMismatches(prisma, { batchSize });

    console.log(
      `[detect-imaging-study-request-patient-mismatch] scanned ${scanned} ImagingStudy row(s) with a ` +
      `non-null imagingRequestId across ${pages} page(s) of up to ${batchSize} row(s) each.`,
    );

    if (mismatches.length === 0) {
      console.log('[detect-imaging-study-request-patient-mismatch] no mismatches found.');
      console.log(JSON.stringify({ scanned, mismatches: 0 }));
      return;
    }

    console.log(`[detect-imaging-study-request-patient-mismatch] FOUND ${mismatches.length} mismatched row(s):`);
    for (const m of mismatches) {
      console.log(
        `  studyId=${m.studyId} clinicId=${m.clinicId} imagingRequestId=${m.imagingRequestId} ` +
        `requestClinicId=${m.requestClinicId ?? 'MISSING'} mismatch=${reasonLabel(m.reasons)} ` +
        `status=${m.status} createdAt=${m.createdAt}`,
      );
    }
    console.log(JSON.stringify({
      scanned,
      mismatches: mismatches.length,
      studyIds: mismatches.map((m) => m.studyId),
    }));
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

const isMainModule = !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => {
    console.error('[detect-imaging-study-request-patient-mismatch] Fatal:', err);
    process.exitCode = 1;
  });
}
