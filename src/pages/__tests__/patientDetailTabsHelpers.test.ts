/**
 * patientDetailTabsHelpers.test.ts — pure URL/tab-derivation logic for
 * PatientDetail.tsx (KVKK-HIGH-008 F-2).
 *
 * Run with: tsx src/pages/__tests__/patientDetailTabsHelpers.test.ts
 * No external test framework — mirrors bookingWidgetHelpers.test.ts.
 */

import assert from 'node:assert/strict';
import {
  PATIENT_DETAIL_TAB_KEYS,
  computeVisiblePatientDetailTabs,
  resolvePatientDetailActiveTab,
  requiresUrlNormalization,
} from '../patientDetailTabsHelpers';

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

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  section('computeVisiblePatientDetailTabs — imaging is the only role/feature-filtered tab');

  await test('imaging is excluded when canSeeImaging is false', () => {
    const tabs = computeVisiblePatientDetailTabs(false);
    assert.ok(!tabs.includes('imaging'));
    assert.equal(tabs.length, PATIENT_DETAIL_TAB_KEYS.length - 1);
  });

  await test('imaging is included when canSeeImaging is true, and every other tab is always present', () => {
    const tabs = computeVisiblePatientDetailTabs(true);
    assert.deepEqual(tabs, PATIENT_DETAIL_TAB_KEYS as unknown as string[]);
  });

  section('resolvePatientDetailActiveTab — missing/invalid/unauthorized all fall back to overview');

  await test('a missing tab param resolves to overview', () => {
    assert.equal(resolvePatientDetailActiveTab(null, computeVisiblePatientDetailTabs(true)), 'overview');
  });

  await test('a valid, visible tab param is used as-is', () => {
    assert.equal(resolvePatientDetailActiveTab('communication', computeVisiblePatientDetailTabs(true)), 'communication');
  });

  await test('an unknown tab param falls back to overview', () => {
    assert.equal(resolvePatientDetailActiveTab('doesnotexist', computeVisiblePatientDetailTabs(true)), 'overview');
  });

  await test('a feature-disabled tab param (imaging, canSeeImaging=false) falls back to overview, never crashes', () => {
    assert.equal(resolvePatientDetailActiveTab('imaging', computeVisiblePatientDetailTabs(false)), 'overview');
  });

  await test('the same imaging tab param IS honored once canSeeImaging becomes true', () => {
    assert.equal(resolvePatientDetailActiveTab('imaging', computeVisiblePatientDetailTabs(true)), 'imaging');
  });

  await test('every declared tab key resolves to itself when visible (deep link support for all right-side tabs)', () => {
    for (const tab of PATIENT_DETAIL_TAB_KEYS) {
      assert.equal(resolvePatientDetailActiveTab(tab, computeVisiblePatientDetailTabs(true)), tab, `tab "${tab}" must be directly linkable`);
    }
  });

  section('requiresUrlNormalization — only present-but-invalid triggers a rewrite, never a simply-absent param');

  await test('a missing tab param never requires normalization (old bookmarked URLs are left alone)', () => {
    assert.equal(requiresUrlNormalization(null, computeVisiblePatientDetailTabs(true)), false);
  });

  await test('a valid tab param never requires normalization', () => {
    assert.equal(requiresUrlNormalization('privacy', computeVisiblePatientDetailTabs(true)), false);
  });

  await test('an unknown tab param requires normalization', () => {
    assert.equal(requiresUrlNormalization('bogus', computeVisiblePatientDetailTabs(true)), true);
  });

  await test('a feature-disabled tab param requires normalization until the feature becomes visible', () => {
    assert.equal(requiresUrlNormalization('imaging', computeVisiblePatientDetailTabs(false)), true);
    assert.equal(requiresUrlNormalization('imaging', computeVisiblePatientDetailTabs(true)), false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
