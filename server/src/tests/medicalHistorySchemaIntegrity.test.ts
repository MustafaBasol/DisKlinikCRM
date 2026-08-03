/**
 * medicalHistorySchemaIntegrity.test.ts — US-01.1-P1 permanent regression
 * guard for the versioned medical-history schema (migration
 * 20260803135254_add_patient_medical_history_foundation).
 *
 * Read-only (never DROP/ALTER) — safe to run against any already-migrated
 * database, same convention as kvkkHigh007High008SchemaIntegrity.test.ts.
 * Its only job is to catch a future accidental index/constraint/FK removal
 * or cascade-delete regression on PatientMedicalHistory/MedicalCondition/
 * PatientCondition.
 *
 * Run with: tsx src/tests/medicalHistorySchemaIntegrity.test.ts
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

async function fksFor(table: string) {
  return prisma.$queryRawUnsafe<{ constraint_name: string; delete_rule: string }[]>(
    `SELECT tc.constraint_name, rc.delete_rule
     FROM information_schema.table_constraints tc
     JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
     WHERE tc.table_name = '${table}' AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.constraint_name`,
  );
}

async function main() {
  console.log('US-01.1-P1 medical-history schema integrity (regression guard)');

  await test('PatientMedicalHistory: unique (patientId, version) index exists', async () => {
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'PatientMedicalHistory' ORDER BY indexname`,
    );
    assert.deepEqual(idx.map((r) => r.indexname).sort(), [
      'PatientMedicalHistory_clinicId_idx',
      'PatientMedicalHistory_organizationId_idx',
      'PatientMedicalHistory_patientId_createdAt_idx',
      'PatientMedicalHistory_patientId_version_key',
      'PatientMedicalHistory_pkey',
    ]);

    const uniqueCols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = '"PatientMedicalHistory"'::regclass AND i.indisunique = true AND i.indisprimary = false`,
    );
    assert.deepEqual(
      uniqueCols.map((r) => r.column_name).sort(),
      ['patientId', 'version'],
      'the (patientId, version) uniqueness must remain — a regression here would allow duplicate/overwritten versions',
    );
  });

  await test('PatientMedicalHistory: exactly 4 FKs, ALL ON DELETE RESTRICT (no cascade delete of medical history)', async () => {
    const fks = await fksFor('PatientMedicalHistory');
    assert.deepEqual(fks.map((r) => r.constraint_name), [
      'PatientMedicalHistory_clinicId_fkey',
      'PatientMedicalHistory_organizationId_fkey',
      'PatientMedicalHistory_patientId_fkey',
      'PatientMedicalHistory_recordedById_fkey',
    ]);
    for (const fk of fks) {
      assert.equal(
        fk.delete_rule,
        'RESTRICT',
        `${fk.constraint_name} must remain ON DELETE RESTRICT — CASCADE here would silently destroy medical-history versions when an Organization/Clinic/Patient/User row is deleted`,
      );
    }
  });

  await test('MedicalCondition: unique code index, no FKs (global reference data, not tenant-scoped)', async () => {
    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'MedicalCondition' ORDER BY indexname`,
    );
    assert.deepEqual(idx.map((r) => r.indexname).sort(), [
      'MedicalCondition_category_idx',
      'MedicalCondition_code_key',
      'MedicalCondition_pkey',
    ]);

    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'MedicalCondition'`,
    );
    const names = cols.map((r) => r.column_name);
    assert.ok(!names.includes('organizationId'), 'MedicalCondition must remain global/tenant-independent reference data');
    assert.ok(!names.includes('clinicId'));
    assert.ok(!names.includes('patientId'));

    const fkCount = await prisma.$queryRawUnsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM information_schema.table_constraints WHERE table_name = 'MedicalCondition' AND constraint_type = 'FOREIGN KEY'`,
    );
    assert.equal(Number(fkCount[0]!.count), 0);
  });

  await test('PatientCondition: exactly 5 FKs, ALL ON DELETE RESTRICT (no cascade delete of condition links)', async () => {
    const fks = await fksFor('PatientCondition');
    assert.deepEqual(fks.map((r) => r.constraint_name), [
      'PatientCondition_clinicId_fkey',
      'PatientCondition_conditionId_fkey',
      'PatientCondition_historyId_fkey',
      'PatientCondition_organizationId_fkey',
      'PatientCondition_patientId_fkey',
    ]);
    for (const fk of fks) {
      assert.equal(fk.delete_rule, 'RESTRICT', `${fk.constraint_name} must remain ON DELETE RESTRICT`);
    }
  });

  await test('PatientMedicalHistory has no soft-delete/updatedAt column (immutable-by-schema-shape, no update path)', async () => {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'PatientMedicalHistory'`,
    );
    const names = cols.map((r) => r.column_name);
    assert.ok(!names.includes('deletedAt'), 'no soft-delete column — versions are never deleted, not even soft-deleted');
    assert.ok(!names.includes('updatedAt'), 'no updatedAt column — a version row is never updated after insert');
  });

  console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
