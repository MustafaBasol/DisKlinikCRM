/**
 * medicalConditionCatalogIntegrity.test.ts — US-01.1-P1 clinical-coding
 * safety regression guard for the MedicalCondition seed catalog
 * (server/prisma/seedMedicalConditions.ts), added 2026-08-03 after an
 * audit found two selectable lookup codes carried the WRONG clinical
 * meaning (Z91.010 mislabeled as latex allergy — it is actually peanut
 * allergy; Z88.4 mislabeled as "other anti-infective agent" allergy — it
 * is actually anesthetic-agent allergy) plus two non-billable FY2026
 * header codes offered as if they were selectable diagnoses (J45.9,
 * G40.9). All four are corrected in CATALOG; this test is a permanent,
 * DB-free guard against the same class of error recurring silently.
 *
 * Pure logic only — imports the real, live CATALOG array plus a reviewed
 * canonical-mapping fixture (medicalConditionCatalogCanonical.ts) that
 * cites its authoritative CDC/NCHS ICD-10-CM FY2026 source. No database
 * required.
 *
 * Run: npx tsx src/tests/medicalConditionCatalogIntegrity.test.ts
 */

import assert from 'node:assert/strict';
import { CATALOG, SEED_CONDITION_CATEGORIES } from '../../prisma/seedMedicalConditions.js';
import { CANONICAL_CATALOG, TRAP_CODES } from './fixtures/medicalConditionCatalogCanonical.js';

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

function findInCatalog(code: string) {
  return CATALOG.find((entry) => entry.code === code);
}

async function main() {
  console.log('US-01.1-P1 medical condition catalog integrity (clinical-coding safety guard)');

  await test('every code in CATALOG is unique', () => {
    const codes = CATALOG.map((c) => c.code);
    assert.equal(new Set(codes).size, codes.length, 'duplicate code found in CATALOG');
  });

  await test('CATALOG has exactly 21 entries (documented initial scope, not expanded)', () => {
    assert.equal(CATALOG.length, 21);
  });

  await test('every category is one of the allowed categories', () => {
    for (const entry of CATALOG) {
      assert.ok(
        (SEED_CONDITION_CATEGORIES as readonly string[]).includes(entry.category),
        `${entry.code} has unexpected category "${entry.category}"`,
      );
    }
  });

  await test('no empty English or Turkish label', () => {
    for (const entry of CATALOG) {
      assert.ok(entry.nameEn.trim().length > 0, `${entry.code} has an empty nameEn`);
      assert.ok(entry.nameTr.trim().length > 0, `${entry.code} has an empty nameTr`);
    }
  });

  await test('Z91.010, if present in CATALOG, must map to peanut allergy — never latex', () => {
    const entry = findInCatalog('Z91.010');
    if (entry) {
      assert.match(entry.nameEn, /peanut/i, 'Z91.010 must read as peanut allergy per CDC/NCHS FY2026');
      assert.doesNotMatch(entry.nameEn, /latex/i, 'Z91.010 must NOT be labeled as latex allergy');
    }
  });

  await test('Z91.010 is absent from CATALOG (latex allergy correctly lives under Z91.040 instead)', () => {
    assert.equal(findInCatalog('Z91.010'), undefined);
  });

  await test('Z91.040 maps to latex allergy, since latex remains in the catalog', () => {
    const entry = findInCatalog('Z91.040');
    assert.ok(entry, 'Z91.040 must be present — latex allergy is a dental-relevant catalog entry');
    assert.match(entry!.nameEn, /latex/i);
  });

  await test('Z88.3 / Z88.4 meanings are not swapped', () => {
    const z883 = findInCatalog('Z88.3');
    const z884 = findInCatalog('Z88.4');
    if (z883) {
      assert.match(z883.nameEn, /other anti-infective/i, 'Z88.3 must mean "other anti-infective agents"');
      assert.doesNotMatch(z883.nameEn, /anesthetic/i);
    }
    if (z884) {
      assert.match(z884.nameEn, /anesthetic/i, 'Z88.4 must mean "anesthetic agent" if ever reintroduced');
      assert.doesNotMatch(z884.nameEn, /anti-infective/i);
    }
  });

  await test('Z88.4 is absent from CATALOG ("other anti-infective agent" allergy correctly lives under Z88.3 instead)', () => {
    assert.equal(findInCatalog('Z88.4'), undefined);
  });

  await test('J45.9 / G40.9 (non-billable FY2026 header codes) are absent — replaced by billable leaf codes', () => {
    assert.equal(findInCatalog('J45.9'), undefined);
    assert.equal(findInCatalog('G40.9'), undefined);
    assert.ok(findInCatalog('J45.909'), 'J45.909 (billable) must be present instead of J45.9');
    assert.ok(findInCatalog('G40.909'), 'G40.909 (billable) must be present instead of G40.9');
  });

  await test('every one of the 21 codes matches the reviewed canonical CDC/NCHS FY2026 fixture exactly', () => {
    assert.equal(CANONICAL_CATALOG.length, 21, 'canonical fixture must cover exactly the 21 catalog entries');
    for (const entry of CATALOG) {
      const canonical = CANONICAL_CATALOG.find((c) => c.code === entry.code);
      assert.ok(canonical, `${entry.code} has no reviewed canonical fixture entry — cannot verify it hasn't drifted`);
      assert.equal(
        entry.nameEn,
        canonical!.canonical,
        `${entry.code}: nameEn "${entry.nameEn}" no longer matches the reviewed canonical descriptor "${canonical!.canonical}"`,
      );
      assert.ok(canonical!.billable, `${entry.code}: canonical fixture marks this code non-billable — it must not be selectable`);
    }
  });

  await test('trap codes (known historical mislabels / non-billable headers) stay out of CATALOG', () => {
    for (const trap of TRAP_CODES) {
      assert.equal(findInCatalog(trap.code), undefined, `${trap.code} must not reappear in CATALOG under its old, incorrect usage`);
    }
  });

  console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
