/**
 * clinicBulkExportSelectionHelpers.test.ts — KVKK-HIGH-004 (P0) explicit
 * clinic-selection logic for ClinicBulkExportSection.tsx.
 *
 * No React Testing Library / DOM test runner in this repo (see
 * src/pages/__tests__/bookingWidgetHelpers.test.ts) — the "never silently
 * select a clinic when the global switcher is 'all'" invariant is verified
 * at the level of the extracted pure functions the component actually
 * calls.
 *
 * Run with: tsx src/components/settings/__tests__/clinicBulkExportSelectionHelpers.test.ts
 */

import assert from 'node:assert/strict';

import {
  resolveExplicitClinicId,
  isClinicSelectionValid,
  initialClinicBulkExportState,
  type ClinicOption,
} from '../clinicBulkExportSelectionHelpers';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  const clinicA: ClinicOption = { id: 'clinic-a', name: 'Clinic A' };
  const clinicB: ClinicOption = { id: 'clinic-b', name: 'Clinic B' };
  const clinics = [clinicA, clinicB];

  section('1. All-clinics mode never auto-selects a clinic');

  await test('global "all" with no prior selection resolves to empty (forces an explicit in-section pick)', () => {
    assert.equal(resolveExplicitClinicId('all', clinics, ''), '');
  });

  await test('global "all" does not clear an already-made in-section selection', () => {
    // The user picked clinic B explicitly in-section; the global switcher
    // being (or becoming) "all" must not silently override that choice —
    // only an explicit specific global selection or a dropped-access clinic
    // changes it.
    assert.equal(resolveExplicitClinicId('all', clinics, clinicB.id), clinicB.id);
  });

  section('2. A specific, accessible global selection is adopted');

  await test('a specific accessible global clinic id is adopted over no prior selection', () => {
    assert.equal(resolveExplicitClinicId(clinicA.id, clinics, ''), clinicA.id);
  });

  await test('a specific accessible global clinic id is adopted even over a DIFFERENT prior in-section selection (non-default clinic selection)', () => {
    assert.equal(resolveExplicitClinicId(clinicB.id, clinics, clinicA.id), clinicB.id);
  });

  await test('a global clinic id not in the accessible list is never adopted, even though it is not "all"', () => {
    assert.equal(resolveExplicitClinicId('inaccessible-clinic', clinics, ''), '');
    assert.equal(resolveExplicitClinicId('inaccessible-clinic', clinics, clinicA.id), clinicA.id, 'a prior valid in-section selection must be kept');
  });

  section('3. Access-list changes clear a selection that has fallen out of it');

  await test('a previously valid in-section selection is cleared once it drops out of availableClinics', () => {
    assert.equal(resolveExplicitClinicId('all', [clinicB], clinicA.id), '', 'clinic A is no longer accessible — must clear, never keep a dangling id');
  });

  await test('an empty availableClinics list always resolves to empty, regardless of global selection', () => {
    assert.equal(resolveExplicitClinicId(clinicA.id, [], ''), '');
    assert.equal(resolveExplicitClinicId('all', [], clinicA.id), '');
  });

  section('4. isClinicSelectionValid mirrors the same accessible-list rule');

  await test('empty clinicId is never valid', () => {
    assert.equal(isClinicSelectionValid('', clinics), false);
  });

  await test('a clinicId present in availableClinics is valid; one absent from it is not', () => {
    assert.equal(isClinicSelectionValid(clinicA.id, clinics), true);
    assert.equal(isClinicSelectionValid('someone-elses-clinic', clinics), false);
  });

  section('5. State reset on clinic change clears every sensitive/transient field');

  await test('initialClinicBulkExportState returns a fully-cleared shape every call (no shared/mutated reference)', () => {
    const first = initialClinicBulkExportState();
    const second = initialClinicBulkExportState();
    assert.deepEqual(first, second);
    assert.notEqual(first, second, 'must be a fresh object each call, not a shared singleton a caller could accidentally mutate');

    const expectedKeys = [
      'activeJobId',
      'password',
      'confirmChecked',
      'downloadPassword',
      'downloadError',
      'submitError',
      'purpose',
      'restrictedNote',
      'enabled',
      'configError',
    ].sort();
    assert.deepEqual(Object.keys(first).sort(), expectedKeys, 'the reset shape must cover exactly the fields the component resets on clinic change — a regression guard if a new piece of state is added without wiring it into the reset');

    assert.equal(first.activeJobId, null);
    assert.equal(first.password, '');
    assert.equal(first.confirmChecked, false);
    assert.equal(first.downloadPassword, '');
    assert.equal(first.downloadError, null);
    assert.equal(first.submitError, null);
    assert.equal(first.purpose, '');
    assert.equal(first.restrictedNote, '');
    assert.equal(first.enabled, null);
    assert.equal(first.configError, null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
