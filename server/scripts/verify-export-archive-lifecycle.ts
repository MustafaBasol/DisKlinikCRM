/**
 * verify-export-archive-lifecycle.ts — manual disposable-DB verification for
 * PR #160 (docs/compliance/53-kvkk-attachment-imaging-lifecycle.md).
 *
 * Exercises the real PatientPrivacyExportArchive lifecycle against a real
 * Postgres database (never mocked): reserve -> generating -> ready, the
 * one-in-flight-per-clinic guard, and marking a reservation failed. This is
 * NOT wired into `npm test` (no other test in this repo depends on a live
 * database), so it never breaks CI for contributors without Postgres — but
 * it is the authoritative proof that the migration's CREATE TABLE shape
 * (nullable storageKey/manifestJson/tokenHash/expiresAt, status default
 * 'ready') actually accepts the write pattern reserveGenerationSlot() uses.
 *
 * Second follow-up review round: this script now imports and calls the real,
 * exported `reserveGenerationSlot` from patientPrivacyExportPackage.ts
 * directly (not a reimplementation of its logic) and fires genuinely
 * concurrent calls via Promise.allSettled to prove the PostgreSQL advisory
 * transaction lock (pg_advisory_xact_lock, keyed by clinicId) actually
 * serializes the reservation race — a naive findFirst-then-create had a real
 * TOCTOU window under READ COMMITTED that the earlier version of this script
 * never exercised (it only proved a pre-existing row could be *found*, not
 * that two concurrent reservations couldn't both be *created*).
 *
 * Run against a disposable database only:
 *   DATABASE_URL=postgresql://user:pass@host:port/throwaway_db \
 *     npx tsx scripts/verify-export-archive-lifecycle.ts
 *
 * Requires `npx prisma migrate deploy` to have already been run against that
 * same DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  reserveGenerationSlot,
  ExportGenerationInProgressError,
} from '../src/services/privacy/patientPrivacyExportPackage.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point at a disposable database — refusing to run without one.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? err.stack : String(err)}`);
    failed++;
  }
}

async function main() {
  const suffix = Date.now();
  const org = await prisma.organization.create({
    data: { name: `Verify Org ${suffix}`, slug: `verify-org-${suffix}` },
  });
  const clinic = await prisma.clinic.create({
    data: { name: `Verify Clinic ${suffix}`, slug: `verify-clinic-${suffix}`, organizationId: org.id },
  });
  const user = await prisma.user.create({
    data: {
      clinicId: clinic.id,
      organizationId: org.id,
      firstName: 'Verify',
      lastName: 'User',
      email: `verify-${suffix}@example.test`,
      role: 'OWNER',
      passwordHash: 'x',
    },
  });
  const patient = await prisma.patient.create({
    data: {
      clinic: { connect: { id: clinic.id } },
      organization: { connect: { id: org.id } },
      firstName: 'Verify',
      lastName: 'Patient',
    },
  });

  console.log('\nDisposable-DB PatientPrivacyExportArchive lifecycle');

  let reservedId = '';
  await test('reserve: creates a "generating" row with all artifact columns empty', async () => {
    const row = await prisma.patientPrivacyExportArchive.create({
      data: {
        organizationId: org.id,
        clinicId: clinic.id,
        patientId: patient.id,
        requestedByUserId: user.id,
        status: 'generating',
        // storageKey / manifestJson / tokenHash / expiresAt intentionally
        // omitted — this is the exact write reserveGenerationSlot() performs,
        // and it must succeed against a migration whose CREATE TABLE marks
        // these columns nullable.
      },
    });
    reservedId = row.id;
    assert.equal(row.status, 'generating');
    assert.equal(row.storageKey, null);
    assert.equal(row.manifestJson, null);
    assert.equal(row.tokenHash, null);
    assert.equal(row.expiresAt, null);
  });

  await test('one-in-flight guard: a second "generating"/"queued" row is detectable via the clinicId/status index', async () => {
    const inFlight = await prisma.patientPrivacyExportArchive.findFirst({
      where: { clinicId: clinic.id, status: { in: ['queued', 'generating'] } },
    });
    assert.ok(inFlight, 'reserveGenerationSlot must be able to find the existing in-flight row');
    assert.equal(inFlight!.id, reservedId);
  });

  await test('complete: transitions "generating" -> "ready" and populates all artifact columns', async () => {
    const updated = await prisma.patientPrivacyExportArchive.update({
      where: { id: reservedId },
      data: {
        status: 'ready',
        storageKey: `exports/${clinic.id}/${reservedId}.zip`,
        manifestJson: { exportVersion: 1, includedFiles: [], missingFiles: [], skippedFiles: [] },
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    assert.equal(updated.status, 'ready');
    assert.ok(updated.storageKey);
    assert.ok(updated.manifestJson);
    assert.ok(updated.tokenHash);
    assert.ok(updated.expiresAt);
  });

  await test('atomic one-time claim: first updateMany claims, second updateMany claims nothing', async () => {
    const first = await prisma.patientPrivacyExportArchive.updateMany({
      where: { id: reservedId, downloadedAt: null },
      data: { downloadedAt: new Date() },
    });
    assert.equal(first.count, 1);
    const second = await prisma.patientPrivacyExportArchive.updateMany({
      where: { id: reservedId, downloadedAt: null },
      data: { downloadedAt: new Date() },
    });
    assert.equal(second.count, 0, 'a row already claimed must not be claimable again');
  });

  await test('failed generation: a "generating" row can be marked "failed" with no NOT NULL violation', async () => {
    const failedRow = await prisma.patientPrivacyExportArchive.create({
      data: {
        organizationId: org.id,
        clinicId: clinic.id,
        patientId: patient.id,
        requestedByUserId: user.id,
        status: 'generating',
      },
    });
    const updated = await prisma.patientPrivacyExportArchive.update({
      where: { id: failedRow.id },
      data: { status: 'failed' },
    });
    assert.equal(updated.status, 'failed');
    assert.equal(updated.storageKey, null);
  });

  await test('unique tokenHash constraint is enforced', async () => {
    await assert.rejects(
      prisma.patientPrivacyExportArchive.create({
        data: {
          organizationId: org.id,
          clinicId: clinic.id,
          patientId: patient.id,
          requestedByUserId: user.id,
          status: 'ready',
          tokenHash: 'a'.repeat(64), // same hash used above
        },
      }),
      'a duplicate tokenHash must be rejected by the unique index',
    );
  });

  console.log(
    '\nReal concurrent reservation test (production reserveGenerationSlot, pg_advisory_xact_lock — not a reimplementation)',
  );

  const clinicB = await prisma.clinic.create({
    data: { name: `Verify Clinic B ${suffix}`, slug: `verify-clinic-b-${suffix}`, organizationId: org.id },
  });

  await test(
    'same clinic, two simultaneous reservations: exactly one succeeds, one is rejected with ExportGenerationInProgressError',
    async () => {
      const results = await Promise.allSettled([
        reserveGenerationSlot(clinic.id, org.id, patient.id, user.id, new Date()),
        reserveGenerationSlot(clinic.id, org.id, patient.id, user.id, new Date()),
      ]);
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      assert.equal(fulfilled.length, 1, 'exactly one concurrent reservation must succeed');
      assert.equal(rejected.length, 1, 'exactly one concurrent reservation must be rejected');
      assert.ok(
        rejected[0].reason instanceof ExportGenerationInProgressError,
        'the losing reservation must be rejected with ExportGenerationInProgressError specifically, not a generic/DB-constraint error',
      );

      const activeRows = await prisma.patientPrivacyExportArchive.findMany({
        where: { clinicId: clinic.id, status: { in: ['queued', 'generating'] } },
      });
      assert.equal(
        activeRows.length,
        1,
        'the database must contain exactly one active generating row for this clinic after the race',
      );
    },
  );

  await test('a different clinic can reserve concurrently — it does not contend on clinic A\'s lock', async () => {
    const result = await reserveGenerationSlot(clinicB.id, org.id, patient.id, user.id, new Date());
    assert.ok(result, 'clinic B must be able to reserve while clinic A already has an active generating row');
  });

  await test('a stale generating row is transitioned to failed and no longer blocks a new reservation', async () => {
    const active = await prisma.patientPrivacyExportArchive.findFirstOrThrow({
      where: { clinicId: clinic.id, status: { in: ['queued', 'generating'] } },
    });
    // Age the row past EXPORT_GENERATION_STALE_MS (10 minutes) so the next
    // reserveGenerationSlot call must sweep it to 'failed' rather than
    // treating it as still in-flight.
    await prisma.patientPrivacyExportArchive.update({
      where: { id: active.id },
      data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) },
    });

    const newExportId = await reserveGenerationSlot(clinic.id, org.id, patient.id, user.id, new Date());
    assert.ok(newExportId, 'reservation must succeed once the previous in-flight row is stale');

    const staleRow = await prisma.patientPrivacyExportArchive.findUniqueOrThrow({ where: { id: active.id } });
    assert.equal(staleRow.status, 'failed', 'the stale row must be swept to status=failed by the reservation call itself');
  });

  await prisma.patientPrivacyExportArchive.deleteMany({ where: { clinicId: clinic.id } });
  await prisma.patientPrivacyExportArchive.deleteMany({ where: { clinicId: clinicB.id } });
  await prisma.patient.delete({ where: { id: patient.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.clinic.delete({ where: { id: clinic.id } });
  await prisma.clinic.delete({ where: { id: clinicB.id } });
  await prisma.organization.delete({ where: { id: org.id } });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
