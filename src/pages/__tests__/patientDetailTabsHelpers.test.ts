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
  PRIMARY_PATIENT_DETAIL_TAB_KEYS,
  computeVisiblePatientDetailTabs,
  resolvePatientDetailActiveTab,
  requiresUrlNormalization,
  splitPatientDetailTabsForNav,
  isMinorPatient,
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

  section('isMinorPatient — US-01.2 minor-without-legal-decision-maker warning input');

  await test('null/undefined dateOfBirth is never treated as a minor', () => {
    assert.equal(isMinorPatient(null), false);
    assert.equal(isMinorPatient(undefined), false);
  });

  await test('an invalid date string is never treated as a minor', () => {
    assert.equal(isMinorPatient('not-a-date'), false);
  });

  await test('a patient turning 18 exactly today is NOT a minor', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    assert.equal(isMinorPatient('2008-06-15', now), false);
  });

  await test('a patient turning 18 tomorrow is still a minor today', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    assert.equal(isMinorPatient('2008-06-16', now), true);
  });

  await test('a clearly adult patient (35 years old) is not a minor', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    assert.equal(isMinorPatient('1991-01-01', now), false);
  });

  await test('a newborn (Date object, not string) is a minor', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    assert.equal(isMinorPatient(new Date('2026-01-01'), now), true);
  });

  section('splitPatientDetailTabsForNav — US-01.X primary row / More-menu grouping');

  await test('every visible tab key is placed in exactly one of primary/more (none lost, none duplicated)', () => {
    const visible = computeVisiblePatientDetailTabs(true);
    const { primary, more } = splitPatientDetailTabsForNav(visible);
    assert.deepEqual([...primary, ...more].sort(), [...visible].sort());
    assert.equal(new Set([...primary, ...more]).size, visible.length);
  });

  await test('primary/more split preserves original relative order within each group (no reordering)', () => {
    const visible = computeVisiblePatientDetailTabs(true);
    const { primary, more } = splitPatientDetailTabsForNav(visible);
    const visibleIndex = new Map(visible.map((tab, i) => [tab, i]));
    for (let i = 1; i < primary.length; i++) {
      assert.ok(visibleIndex.get(primary[i - 1]!)! < visibleIndex.get(primary[i]!)!, 'primary group out of order');
    }
    for (let i = 1; i < more.length; i++) {
      assert.ok(visibleIndex.get(more[i - 1]!)! < visibleIndex.get(more[i]!)!, 'more group out of order');
    }
  });

  await test('emergencyContacts is not a primary tab, so it collapses into the More group', () => {
    const { primary, more } = splitPatientDetailTabsForNav(computeVisiblePatientDetailTabs(true));
    assert.ok(!primary.includes('emergencyContacts'));
    assert.ok(more.includes('emergencyContacts'));
  });

  await test('a role/feature-filtered tab (imaging, canSeeImaging=false) is absent from both primary and more', () => {
    const { primary, more } = splitPatientDetailTabsForNav(computeVisiblePatientDetailTabs(false));
    assert.ok(!primary.includes('imaging'));
    assert.ok(!more.includes('imaging'));
  });

  await test('imaging (when visible) is grouped under More, not the primary row', () => {
    const { primary, more } = splitPatientDetailTabsForNav(computeVisiblePatientDetailTabs(true));
    assert.ok(!primary.includes('imaging'));
    assert.ok(more.includes('imaging'));
  });

  await test('PRIMARY_PATIENT_DETAIL_TAB_KEYS only names tabs that actually exist in PATIENT_DETAIL_TAB_KEYS', () => {
    for (const key of PRIMARY_PATIENT_DETAIL_TAB_KEYS) {
      assert.ok((PATIENT_DETAIL_TAB_KEYS as readonly string[]).includes(key), `unknown primary tab key "${key}"`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
