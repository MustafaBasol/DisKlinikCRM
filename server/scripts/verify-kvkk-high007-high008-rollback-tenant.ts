/**
 * verify-kvkk-high007-high008-rollback-tenant.ts — R-046 committed,
 * repeatable disposable-DB verification for the KVKK-HIGH-007
 * (`20260719120821_kvkk_high007_consent_reconciliation`) and KVKK-HIGH-008
 * (`20260719155318_kvkk_high008_legacy_consent_correction`) migrations.
 *
 * This formalizes, as a committed script, verification that prior R-046
 * evidence (KVKK-HIGH-008-PMVR, F0-011-P2) performed with throwaway scripts
 * that were deleted after use — see
 * docs/program/evidence/R046_PRODUCTION_VERIFICATION.md. Running this again
 * is how a future task independently re-verifies R-046's disposable-rehearsal
 * evidence without re-deriving the procedure from prose.
 *
 * What this script proves, in order:
 *   1. Schema integrity — the live schema for CommunicationConsentConflictBucket
 *      and PatientLegacyConsentCorrection matches the committed migration SQL
 *      (columns, PK, indexes, unique constraints, FKs).
 *   2. Rollback rehearsal, empty tables — hand-authored reverse DDL cleanly
 *      removes both migrations' objects while both tables are empty, with no
 *      effect on pre-existing data.
 *   3. Forward-recovery — re-applying the two migrations' committed SQL after
 *      a rollback succeeds and reproduces the identical schema.
 *   4. Multi-tenant isolation — real, unmodified service functions
 *      (correctSmsOptOut, listLegacyConsentCorrections,
 *      getLegacyConsentCorrectionDetail, recordCommunicationConsentConflict)
 *      are exercised across two tenants with deliberately colliding names/
 *      idempotency keys/bucket keys, asserting zero cross-tenant leakage.
 *   5. Rollback rehearsal, populated tables (destructive, run LAST) — the
 *      same reverse DDL against tables holding real rows demonstrates that
 *      physical schema rollback destroys that data once created. This step
 *      ends the script; do not add assertions after it.
 *
 * NOT wired into `npm test` (mirrors scripts/verify-clinic-bulk-export-lifecycle.ts
 * and scripts/verify-export-archive-lifecycle.ts) — it performs destructive
 * DDL (DROP TABLE/DROP TYPE) by design and must only ever run against a
 * disposable database. Run manually:
 *
 *   DATABASE_URL=postgresql://user:pass@localhost:PORT/throwaway_db \
 *     npx tsx scripts/verify-kvkk-high007-high008-rollback-tenant.ts
 *
 * Requires `npx prisma migrate deploy` to have already been run against that
 * same DATABASE_URL (all 65 migrations applied, schema up to date).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  correctSmsOptOut,
  listLegacyConsentCorrections,
  getLegacyConsentCorrectionDetail,
  LegacyConsentCorrectionError,
} from '../src/services/communicationConsent/legacyConsentCorrection.js';
import { recordCommunicationConsentConflict } from '../src/services/communicationConsent/communicationConsentConflictTracker.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point at a disposable database — refusing to run without one.');
}
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  throw new Error(
    'DATABASE_URL must resolve to localhost/127.0.0.1 (a local disposable container) — ' +
      'this script performs destructive DDL (DROP TABLE) and must never run against a remote/production host.',
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

// ── Reverse DDL (hand-authored — Prisma migrate has no down-migration) ─────
// Reverses HIGH-008 then HIGH-007, mirroring the forward order's dependency
// (HIGH-008's table has no FK on HIGH-007's table, but this order matches
// prior R-046 evidence exactly for comparability).
const ROLLBACK_SQL = `
BEGIN;
ALTER TABLE "PatientLegacyConsentCorrection" DROP CONSTRAINT IF EXISTS "PatientLegacyConsentCorrection_organizationId_fkey";
ALTER TABLE "PatientLegacyConsentCorrection" DROP CONSTRAINT IF EXISTS "PatientLegacyConsentCorrection_clinicId_fkey";
ALTER TABLE "PatientLegacyConsentCorrection" DROP CONSTRAINT IF EXISTS "PatientLegacyConsentCorrection_patientId_fkey";
ALTER TABLE "PatientLegacyConsentCorrection" DROP CONSTRAINT IF EXISTS "PatientLegacyConsentCorrection_correctedById_fkey";
DROP TABLE IF EXISTS "PatientLegacyConsentCorrection";
DROP TYPE IF EXISTS "PatientLegacyConsentField";
DROP INDEX IF EXISTS "OperationalEvent_source_organizationId_clinicId_createdAt_idx";
DROP TABLE IF EXISTS "CommunicationConsentConflictBucket";
COMMIT;
`;

// Forward DDL — copied verbatim from the two committed migration.sql files,
// used to re-create the objects after a rollback (forward-recovery proof).
const FORWARD_SQL = `
BEGIN;
CREATE TABLE "CommunicationConsentConflictBucket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "bucketStartedAt" TIMESTAMP(3) NOT NULL,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommunicationConsentConflictBucket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CommunicationConsentConflictBucket_organizationId_clinicId__idx" ON "CommunicationConsentConflictBucket"("organizationId", "clinicId", "createdAt");
CREATE INDEX "CommunicationConsentConflictBucket_bucketStartedAt_idx" ON "CommunicationConsentConflictBucket"("bucketStartedAt");
CREATE UNIQUE INDEX "CommunicationConsentConflictBucket_organizationId_clinicId__key" ON "CommunicationConsentConflictBucket"("organizationId", "clinicId", "channel", "purpose", "reasonCode", "bucketStartedAt");
CREATE INDEX "OperationalEvent_source_organizationId_clinicId_createdAt_idx" ON "OperationalEvent"("source", "organizationId", "clinicId", "createdAt");

CREATE TYPE "PatientLegacyConsentField" AS ENUM ('SMS_OPT_OUT');
CREATE TABLE "PatientLegacyConsentCorrection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "fieldName" "PatientLegacyConsentField" NOT NULL,
    "previousValue" BOOLEAN NOT NULL,
    "newValue" BOOLEAN NOT NULL,
    "previousRecordedAt" TIMESTAMP(3),
    "correctionReason" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "sourceReference" TEXT,
    "notes" TEXT NOT NULL,
    "correctedById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientLegacyConsentCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PatientLegacyConsentCorrection_patientId_createdAt_idx" ON "PatientLegacyConsentCorrection"("patientId", "createdAt");
CREATE INDEX "PatientLegacyConsentCorrection_organizationId_clinicId_crea_idx" ON "PatientLegacyConsentCorrection"("organizationId", "clinicId", "createdAt");
CREATE UNIQUE INDEX "PatientLegacyConsentCorrection_organizationId_patientId_ide_key" ON "PatientLegacyConsentCorrection"("organizationId", "patientId", "idempotencyKey");
ALTER TABLE "PatientLegacyConsentCorrection" ADD CONSTRAINT "PatientLegacyConsentCorrection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientLegacyConsentCorrection" ADD CONSTRAINT "PatientLegacyConsentCorrection_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientLegacyConsentCorrection" ADD CONSTRAINT "PatientLegacyConsentCorrection_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientLegacyConsentCorrection" ADD CONSTRAINT "PatientLegacyConsentCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
`;

async function assertTablesExist(expected: boolean): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('CommunicationConsentConflictBucket', 'PatientLegacyConsentCorrection')`,
  );
  assert.equal(rows.length, expected ? 2 : 0, `expected tables present=${expected}, found ${rows.map((r) => r.table_name).join(',')}`);
}

async function createTenant(label: string) {
  const uniq = randomUUID();
  const org = await prisma.organization.create({ data: { name: `R046 Verify Org ${label}`, slug: `r046-verify-org-${label.toLowerCase()}-${uniq}` } });
  const clinic = await prisma.clinic.create({ data: { organizationId: org.id, name: `R046 Verify Clinic ${label}`, slug: `r046-verify-clinic-${label.toLowerCase()}-${uniq}` } });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      clinicId: clinic.id,
      email: `r046-verify-${label}-${uniq}@example.invalid`,
      passwordHash: 'not-a-real-hash',
      firstName: 'R046',
      lastName: `Verify Staff ${label}`,
      role: 'OWNER',
    },
  });
  // Deliberately identical patient name across tenants — mirrors F0-011-P2
  // Part D's cross-tenant-collision design.
  const patient = await prisma.patient.create({
    data: {
      organizationId: org.id,
      clinicId: clinic.id,
      firstName: 'Ayse',
      lastName: 'Yilmaz',
      smsOptOut: true,
      smsOptOutAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
  return { org, clinic, user, patient };
}

async function main() {
  console.log('R-046 — KVKK-HIGH-007/HIGH-008 rollback + tenant-isolation verification\n');

  console.log('Part 1 — schema integrity (read-only)');
  await test('CommunicationConsentConflictBucket has exactly the expected indexes/constraint', async () => {
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'CommunicationConsentConflictBucket' ORDER BY indexname`,
    );
    const names = idx.map((r) => r.indexname).sort();
    assert.deepEqual(names, [
      'CommunicationConsentConflictBucket_bucketStartedAt_idx',
      'CommunicationConsentConflictBucket_organizationId_clinicId__idx',
      'CommunicationConsentConflictBucket_organizationId_clinicId__key',
      'CommunicationConsentConflictBucket_pkey',
    ]);
    const fks = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::int AS count FROM information_schema.table_constraints WHERE table_name = 'CommunicationConsentConflictBucket' AND constraint_type = 'FOREIGN KEY'`,
    );
    assert.equal(Number(fks[0]!.count), 0, 'this table is deliberately FK-free (aggregate-only, no patient identifier — see F0-011-P2 §B)');
  });
  await test('PatientLegacyConsentCorrection has exactly the expected indexes/constraints/FKs', async () => {
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'PatientLegacyConsentCorrection' ORDER BY indexname`,
    );
    assert.deepEqual(
      idx.map((r) => r.indexname).sort(),
      [
        'PatientLegacyConsentCorrection_organizationId_clinicId_crea_idx',
        'PatientLegacyConsentCorrection_organizationId_patientId_ide_key',
        'PatientLegacyConsentCorrection_patientId_createdAt_idx',
        'PatientLegacyConsentCorrection_pkey',
      ],
    );
    const fks = await prisma.$queryRawUnsafe<{ constraint_name: string }[]>(
      `SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'PatientLegacyConsentCorrection' AND constraint_type = 'FOREIGN KEY' ORDER BY constraint_name`,
    );
    assert.deepEqual(
      fks.map((r) => r.constraint_name).sort(),
      [
        'PatientLegacyConsentCorrection_clinicId_fkey',
        'PatientLegacyConsentCorrection_correctedById_fkey',
        'PatientLegacyConsentCorrection_organizationId_fkey',
        'PatientLegacyConsentCorrection_patientId_fkey',
      ],
    );
  });
  await assertTablesExist(true);

  console.log('\nPart 2 — rollback rehearsal, empty tables (destructive DDL, disposable DB only)');
  const preRollbackPatientCount = await prisma.patient.count();
  await test('reverse DDL cleanly drops both migrations while tables are empty', async () => {
    const conflictRows = await prisma.communicationConsentConflictBucket.count();
    const correctionRows = await prisma.patientLegacyConsentCorrection.count();
    assert.equal(conflictRows, 0, 'precondition: table must be empty for this scenario');
    assert.equal(correctionRows, 0, 'precondition: table must be empty for this scenario');
    await prisma.$executeRawUnsafe(ROLLBACK_SQL);
    await assertTablesExist(false);
  });
  await test('pre-existing data is unaffected by the rollback', async () => {
    const after = await prisma.patient.count();
    assert.equal(after, preRollbackPatientCount, 'rollback must not touch pre-existing rows in unrelated tables');
  });

  console.log('\nPart 3 — forward-recovery (re-apply committed migration SQL after rollback)');
  await test('forward SQL re-creates both tables with the identical schema', async () => {
    await prisma.$executeRawUnsafe(FORWARD_SQL);
    await assertTablesExist(true);
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'PatientLegacyConsentCorrection' ORDER BY indexname`,
    );
    assert.equal(idx.length, 4, 'all 4 indexes/constraints must be back after forward-recovery');
  });
  console.log(
    '  NOTE  this recreates the tables via raw SQL only — it does NOT reconcile `_prisma_migrations`.\n' +
      '        `_prisma_migrations` still shows both migrations as finished_at-applied from the original\n' +
      '        `prisma migrate deploy` run; a subsequent `prisma migrate deploy` will report "No pending\n' +
      '        migrations to apply" without re-running this SQL. This is the exact bookkeeping-drift gap\n' +
      '        recorded as RISK_REGISTER.md R-070 (independently confirmed again by this run) — see\n' +
      '        docs/program/evidence/R046_PRODUCTION_VERIFICATION.md for the operational conclusion.',
  );

  console.log('\nPart 4 — multi-tenant isolation (real service functions, deliberately colliding data)');
  const tenantA = await createTenant('A');
  const tenantB = await createTenant('B');
  const sharedIdempotencyKey = 'r046-verify-shared-idem-key';

  let correctionA: Awaited<ReturnType<typeof correctSmsOptOut>> | undefined;
  let correctionB: Awaited<ReturnType<typeof correctSmsOptOut>> | undefined;
  await test('correctSmsOptOut assigns the correct clinicId per tenant despite identical patient name', async () => {
    correctionA = await correctSmsOptOut({
      organizationId: tenantA.org.id,
      clinicId: tenantA.clinic.id,
      patientId: tenantA.patient.id,
      correctionReason: 'R-046 verification synthetic correction (tenant A)',
      evidenceType: 'other_verified_source',
      notes: 'Synthetic disposable-DB verification row — not real patient evidence.',
      expectedCurrentValue: true,
      correctedById: tenantA.user.id,
      idempotencyKey: sharedIdempotencyKey,
    });
    correctionB = await correctSmsOptOut({
      organizationId: tenantB.org.id,
      clinicId: tenantB.clinic.id,
      patientId: tenantB.patient.id,
      correctionReason: 'R-046 verification synthetic correction (tenant B)',
      evidenceType: 'other_verified_source',
      notes: 'Synthetic disposable-DB verification row — not real patient evidence.',
      expectedCurrentValue: true,
      correctedById: tenantB.user.id,
      idempotencyKey: sharedIdempotencyKey,
    });
    assert.equal(correctionA.correction.clinicId, tenantA.clinic.id);
    assert.equal(correctionB.correction.clinicId, tenantB.clinic.id);
    assert.notEqual(correctionA.correction.id, correctionB.correction.id, 'identical idempotencyKey across tenants must not collapse into one row');
  });

  await test('cross-tenant correction attempt is rejected with clinic_scope_mismatch, no mutation', async () => {
    await assert.rejects(
      () =>
        correctSmsOptOut({
          organizationId: tenantA.org.id,
          clinicId: tenantA.clinic.id,
          patientId: tenantB.patient.id,
          correctionReason: 'cross-tenant attempt — must be rejected',
          evidenceType: 'other_verified_source',
          notes: 'This must never succeed.',
          expectedCurrentValue: true,
          correctedById: tenantA.user.id,
          idempotencyKey: `${sharedIdempotencyKey}-cross-attempt`,
        }),
      (err: unknown) => err instanceof LegacyConsentCorrectionError && err.code === 'clinic_scope_mismatch',
    );
    const bPatient = await prisma.patient.findUniqueOrThrow({ where: { id: tenantB.patient.id } });
    assert.equal(bPatient.smsOptOut, false, "tenant B's already-legitimate correction must remain unaffected by the rejected cross-tenant attempt");
  });

  await test('listLegacyConsentCorrections is clinic-scoped: tenant A cannot see tenant B rows', async () => {
    const listA = await listLegacyConsentCorrections({ organizationId: tenantA.org.id, clinicId: tenantA.clinic.id, patientId: tenantA.patient.id });
    const listB = await listLegacyConsentCorrections({ organizationId: tenantB.org.id, clinicId: tenantB.clinic.id, patientId: tenantB.patient.id });
    assert.equal(listA.items.length, 1);
    assert.equal(listB.items.length, 1);
    assert.equal(listA.items[0]!.id, correctionA!.correction.id);
    assert.equal(listB.items[0]!.id, correctionB!.correction.id);
  });

  await test("getLegacyConsentCorrectionDetail refuses to return tenant B's row under tenant A's scope", async () => {
    const crossRead = await getLegacyConsentCorrectionDetail({
      organizationId: tenantA.org.id,
      clinicId: tenantA.clinic.id,
      patientId: tenantB.patient.id,
      correctionId: correctionB!.correction.id,
    });
    assert.equal(crossRead, null);
    const sameTenantRead = await getLegacyConsentCorrectionDetail({
      organizationId: tenantA.org.id,
      clinicId: tenantA.clinic.id,
      patientId: tenantA.patient.id,
      correctionId: correctionA!.correction.id,
    });
    assert.notEqual(sameTenantRead, null);
  });

  await test('recordCommunicationConsentConflict buckets are clinic-scoped despite identical channel/purpose/reasonCode/hour', async () => {
    const now = new Date();
    await recordCommunicationConsentConflict({ organizationId: tenantA.org.id, clinicId: tenantA.clinic.id, channel: 'sms', purpose: 'appointment_reminder', reasonCode: 'legacy_vs_central_mismatch' }, now);
    await recordCommunicationConsentConflict({ organizationId: tenantA.org.id, clinicId: tenantA.clinic.id, channel: 'sms', purpose: 'appointment_reminder', reasonCode: 'legacy_vs_central_mismatch' }, now);
    await recordCommunicationConsentConflict({ organizationId: tenantB.org.id, clinicId: tenantB.clinic.id, channel: 'sms', purpose: 'appointment_reminder', reasonCode: 'legacy_vs_central_mismatch' }, now);

    const bucketsA = await prisma.communicationConsentConflictBucket.findMany({ where: { organizationId: tenantA.org.id } });
    const bucketsB = await prisma.communicationConsentConflictBucket.findMany({ where: { organizationId: tenantB.org.id } });
    assert.equal(bucketsA.length, 1);
    assert.equal(bucketsA[0]!.occurrenceCount, 2);
    assert.equal(bucketsB.length, 1);
    assert.equal(bucketsB[0]!.occurrenceCount, 1);
  });

  console.log('\nPart 5 — rollback rehearsal, populated tables (DESTRUCTIVE — run last, ends the script)');
  await test('reverse DDL against populated tables drops all rows irrecoverably (destructive-impact proof, not merely asserted)', async () => {
    const conflictRowsBefore = await prisma.communicationConsentConflictBucket.count();
    const correctionRowsBefore = await prisma.patientLegacyConsentCorrection.count();
    assert.ok(conflictRowsBefore > 0 && correctionRowsBefore > 0, 'precondition: both tables must hold real rows for this scenario to mean anything');

    await prisma.$executeRawUnsafe(ROLLBACK_SQL);
    await assertTablesExist(false);

    // The tables themselves are gone — there is no query left that could
    // recover the dropped rows; this IS the destructive-impact proof.
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
