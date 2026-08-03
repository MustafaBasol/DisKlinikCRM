/**
 * medicalConditionCatalogSeedIdempotency.test.ts — US-01.1-P1.
 *
 * Proves, against a REAL disposable PostgreSQL instance, that
 * runSeedMedicalConditions() (server/prisma/seedMedicalConditions.ts) is
 * genuinely idempotent and upserts the CORRECTED code/descriptor values —
 * added 2026-08-03 alongside a clinical-coding audit that fixed two
 * mislabeled lookup codes (Z91.010, Z88.4) and two non-billable header
 * codes offered as selectable diagnoses (J45.9, G40.9). This test is the
 * only place the real upsert logic runs against a live database — the
 * catalog-integrity test (medicalConditionCatalogIntegrity.test.ts) checks
 * the CATALOG data shape only, with no DB.
 *
 * Run: npx tsx src/tests/dbVerification/medicalConditionCatalogSeedIdempotency.test.ts
 * Requires DATABASE_URL to point at a disposable, migrated Postgres before import.
 */

import assert from 'node:assert/strict';
import { CATALOG, runSeedMedicalConditions } from '../../../prisma/seedMedicalConditions.js';
import { createSuite, prisma } from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('medicalConditionCatalogSeedIdempotency');

async function main() {
  section('1. First run creates every catalog row with the corrected code/descriptor values');

  await test('first run: created count equals CATALOG length, updated count is 0', async () => {
    const result = await runSeedMedicalConditions(prisma);
    assert.equal(result.total, CATALOG.length);
    assert.equal(result.created, CATALOG.length, `expected all ${CATALOG.length} rows to be newly created`);
    assert.equal(result.updated, 0);
  });

  await test('every corrected code/descriptor pair persisted exactly as in CATALOG', async () => {
    for (const entry of CATALOG) {
      const row = await prisma.medicalCondition.findUnique({ where: { code: entry.code } });
      assert.ok(row, `expected a MedicalCondition row for code ${entry.code}`);
      assert.equal(row!.category, entry.category);
      assert.equal(row!.nameEn, entry.nameEn);
      assert.equal(row!.nameTr, entry.nameTr);
    }
  });

  await test('Z91.010 (old, incorrect latex mapping) was never inserted; Z91.040 (correct latex mapping) was', async () => {
    const wrong = await prisma.medicalCondition.findUnique({ where: { code: 'Z91.010' } });
    const correct = await prisma.medicalCondition.findUnique({ where: { code: 'Z91.040' } });
    assert.equal(wrong, null);
    assert.ok(correct);
    assert.match(correct!.nameEn, /latex/i);
  });

  await test('Z88.4 (old, incorrect "other anti-infective" mapping) was never inserted; Z88.3 (correct) was', async () => {
    const wrong = await prisma.medicalCondition.findUnique({ where: { code: 'Z88.4' } });
    const correct = await prisma.medicalCondition.findUnique({ where: { code: 'Z88.3' } });
    assert.equal(wrong, null);
    assert.ok(correct);
    assert.match(correct!.nameEn, /other anti-infective/i);
  });

  section('2. Re-running the seed does not create duplicates and is a pure no-op update');

  await test('second run: created count is 0, updated count equals CATALOG length, no new rows', async () => {
    const before = await prisma.medicalCondition.count();
    const result = await runSeedMedicalConditions(prisma);
    const after = await prisma.medicalCondition.count();

    assert.equal(result.created, 0, 'a re-run must never create a new row for a code that already exists');
    assert.equal(result.updated, CATALOG.length);
    assert.equal(after, before, 'row count must be unchanged after a re-run');
  });

  await test('third consecutive run remains stable (no drift, no duplicate codes)', async () => {
    await runSeedMedicalConditions(prisma);
    const total = await prisma.medicalCondition.count();
    const codes = await prisma.medicalCondition.findMany({ select: { code: true } });
    assert.equal(total, CATALOG.length);
    assert.equal(new Set(codes.map((c) => c.code)).size, codes.length, 'no duplicate codes may exist after repeated re-runs');
  });

  const ok = summary();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
