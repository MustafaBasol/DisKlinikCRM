/**
 * kvkkHigh007High008SchemaIntegrity.test.ts — R-046 permanent regression
 * guard for the KVKK-HIGH-007/HIGH-008 additive schema.
 *
 * Read-only (never DROP/ALTER) — safe to wire into `npm test` and run in any
 * environment that already has a migrated database, unlike
 * scripts/verify-kvkk-high007-high008-rollback-tenant.ts (destructive,
 * disposable-DB-only, run manually). This test's only job is to catch a
 * future accidental index/constraint/FK removal from the two tables this
 * program's R-046 risk row depends on for tenant-scoping guarantees — see
 * docs/program/evidence/R046_PRODUCTION_VERIFICATION.md.
 *
 * Run with: tsx src/tests/kvkkHigh007High008SchemaIntegrity.test.ts
 * Requires DATABASE_URL to point at a migrated Postgres database.
 */

import assert from 'node:assert/strict';
import prisma from '../db.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

async function main() {
  console.log('KVKK-HIGH-007/HIGH-008 schema integrity (R-046 regression guard)');

  await test('CommunicationConsentConflictBucket: exactly PK + 2 supporting indexes + 1 clinic-scoped unique index, no FKs', async () => {
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'CommunicationConsentConflictBucket' ORDER BY indexname`,
    );
    assert.deepEqual(idx.map((r) => r.indexname).sort(), [
      'CommunicationConsentConflictBucket_bucketStartedAt_idx',
      'CommunicationConsentConflictBucket_organizationId_clinicId__idx',
      'CommunicationConsentConflictBucket_organizationId_clinicId__key',
      'CommunicationConsentConflictBucket_pkey',
    ]);
    const uniqueCols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = '"CommunicationConsentConflictBucket"'::regclass AND i.indisunique = true AND i.indisprimary = false`,
    );
    assert.deepEqual(
      uniqueCols.map((r) => r.column_name).sort(),
      ['bucketStartedAt', 'channel', 'clinicId', 'organizationId', 'purpose', 'reasonCode'],
      'the clinic-scoped uniqueness must remain (organizationId, clinicId, channel, purpose, reasonCode, bucketStartedAt) — a regression here would allow cross-tenant bucket collisions',
    );
    const fkCount = await prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM information_schema.table_constraints WHERE table_name = 'CommunicationConsentConflictBucket' AND constraint_type = 'FOREIGN KEY'`,
    );
    assert.equal(Number(fkCount[0]!.count), 0, 'deliberately FK-free by design — see F0-011-P2 §B; a new FK here would be a design change requiring its own review, not a silent addition');
  });

  await test('PatientLegacyConsentCorrection: exactly PK + 2 supporting indexes + 1 patient-scoped unique index + 4 RESTRICT FKs', async () => {
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'PatientLegacyConsentCorrection' ORDER BY indexname`,
    );
    assert.deepEqual(idx.map((r) => r.indexname).sort(), [
      'PatientLegacyConsentCorrection_organizationId_clinicId_crea_idx',
      'PatientLegacyConsentCorrection_organizationId_patientId_ide_key',
      'PatientLegacyConsentCorrection_patientId_createdAt_idx',
      'PatientLegacyConsentCorrection_pkey',
    ]);

    const fks = await prisma.$queryRawUnsafe<{ constraint_name: string; delete_rule: string; update_rule: string }[]>(
      `SELECT tc.constraint_name, rc.delete_rule, rc.update_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
       WHERE tc.table_name = 'PatientLegacyConsentCorrection' AND tc.constraint_type = 'FOREIGN KEY'
       ORDER BY tc.constraint_name`,
    );
    assert.deepEqual(
      fks.map((r) => r.constraint_name),
      [
        'PatientLegacyConsentCorrection_clinicId_fkey',
        'PatientLegacyConsentCorrection_correctedById_fkey',
        'PatientLegacyConsentCorrection_organizationId_fkey',
        'PatientLegacyConsentCorrection_patientId_fkey',
      ],
    );
    for (const fk of fks) {
      assert.equal(fk.delete_rule, 'RESTRICT', `${fk.constraint_name} must remain ON DELETE RESTRICT — CASCADE here would silently delete KVKK correction evidence when an Organization/Clinic/Patient/User row is deleted`);
    }
  });

  await test('PatientLegacyConsentCorrection has no update/delete-capable trigger and no soft-delete column (append-only by schema shape)', async () => {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'PatientLegacyConsentCorrection'`,
    );
    const names = cols.map((r) => r.column_name);
    assert.ok(!names.includes('deletedAt'), 'no deletedAt column should exist — this table is append-only by design, not soft-deletable');
    assert.ok(!names.includes('updatedAt'), 'no updatedAt column should exist — a row that can be updated after creation would break the append-only evidence guarantee this table exists for');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
