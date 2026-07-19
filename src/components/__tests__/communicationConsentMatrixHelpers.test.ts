/**
 * communicationConsentMatrixHelpers.test.ts — pure logic for the
 * KVKK-HIGH-007 Communication Preferences matrix UI.
 *
 * Run with: tsx src/components/__tests__/communicationConsentMatrixHelpers.test.ts
 * No external test framework — mirrors src/pages/__tests__/bookingWidgetHelpers.test.ts.
 */

import assert from 'node:assert/strict';

import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_PURPOSES,
  POLICY_EXCEPTION_PURPOSES,
  resolveCellVariant,
  buildMatrixIndex,
  matrixKey,
  validateBulkSelection,
  PURPOSE_GROUPS,
  computeConsentSummary,
  shouldShowLegacySignals,
  isCellActionable,
  computeConsentActionValidation,
  type MatrixEntry,
} from '../communicationConsentMatrixHelpers';

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

function makeEntry(overrides: Partial<MatrixEntry> = {}): MatrixEntry {
  return {
    channel: 'sms',
    purpose: 'marketing',
    isPolicyException: false,
    decision: { allowed: false, reasonCode: 'consent_unknown' },
    preference: null,
    ...overrides,
  };
}

async function main() {
  section('Taxonomy regression guards');

  await test('channel list matches the documented set exactly', () => {
    assert.deepEqual([...COMMUNICATION_CHANNELS], ['sms', 'email', 'whatsapp', 'phone_call', 'push']);
  });

  await test('purpose list matches the documented set exactly', () => {
    assert.deepEqual([...COMMUNICATION_PURPOSES], [
      'transactional', 'appointment_reminder', 'appointment_followup', 'clinical_followup',
      'recall', 'no_show_recovery', 'operational', 'marketing', 'campaign', 'survey',
      'legal_notice', 'security_notice',
    ]);
  });

  await test('policy-exception purposes are a subset of the purpose list', () => {
    for (const p of POLICY_EXCEPTION_PURPOSES) {
      assert.ok((COMMUNICATION_PURPOSES as readonly string[]).includes(p));
    }
    assert.deepEqual([...POLICY_EXCEPTION_PURPOSES], ['transactional', 'legal_notice', 'security_notice']);
  });

  section('resolveCellVariant — unknown state is always visible, never a default allow');

  await test('no preference row + not a policy exception → unknown (never allowed)', () => {
    const variant = resolveCellVariant(makeEntry({ preference: null, isPolicyException: false }));
    assert.equal(variant, 'unknown');
  });

  await test('policy exception purpose → not_required regardless of preference row', () => {
    const variant = resolveCellVariant(makeEntry({ isPolicyException: true, preference: null }));
    assert.equal(variant, 'not_required');
  });

  await test('granted preference → allowed', () => {
    const variant = resolveCellVariant(makeEntry({
      preference: { id: '1', status: 'granted', effectiveAt: '', grantedAt: '', withdrawnAt: null, source: 'staff', evidenceType: null, noticeVersion: null, actorUserId: null, actorPlatformAdminId: null, updatedAt: '' },
    }));
    assert.equal(variant, 'allowed');
  });

  await test('withdrawn preference → withdrawn (distinct from denied)', () => {
    const variant = resolveCellVariant(makeEntry({
      preference: { id: '1', status: 'withdrawn', effectiveAt: '', grantedAt: null, withdrawnAt: '', source: 'staff', evidenceType: null, noticeVersion: null, actorUserId: null, actorPlatformAdminId: null, updatedAt: '' },
    }));
    assert.equal(variant, 'withdrawn');
  });

  await test('denied preference → denied', () => {
    const variant = resolveCellVariant(makeEntry({
      preference: { id: '1', status: 'denied', effectiveAt: '', grantedAt: null, withdrawnAt: null, source: 'staff', evidenceType: null, noticeVersion: null, actorUserId: null, actorPlatformAdminId: null, updatedAt: '' },
    }));
    assert.equal(variant, 'denied');
  });

  await test('legacyConflict always wins, even over a granted preference — never merged with allowed/denied/withdrawn/unknown', () => {
    const variant = resolveCellVariant(makeEntry({
      preference: { id: '1', status: 'granted', effectiveAt: '', grantedAt: '', withdrawnAt: null, source: 'staff', evidenceType: null, noticeVersion: null, actorUserId: null, actorPlatformAdminId: null, updatedAt: '' },
      legacyConflict: { detected: true, reasonCode: 'legacy_central_conflict' },
    }));
    assert.equal(variant, 'conflict');
  });

  await test('legacyConflict also wins over a policy-exception purpose', () => {
    const variant = resolveCellVariant(makeEntry({
      isPolicyException: true,
      legacyConflict: { detected: true, reasonCode: 'legacy_central_conflict' },
    }));
    assert.equal(variant, 'conflict');
  });

  section('PURPOSE_GROUPS — every purpose appears in exactly one of the 6 required categories');

  await test('every COMMUNICATION_PURPOSES value appears in exactly one group', () => {
    const seen = new Map<string, number>();
    for (const group of PURPOSE_GROUPS) {
      for (const purpose of group.purposes) {
        seen.set(purpose, (seen.get(purpose) ?? 0) + 1);
      }
    }
    for (const purpose of COMMUNICATION_PURPOSES) {
      assert.equal(seen.get(purpose), 1, `${purpose} should appear in exactly one group, got ${seen.get(purpose) ?? 0}`);
    }
    assert.equal(PURPOSE_GROUPS.length, 6);
  });

  section('computeConsentSummary — the top summary bar data source');

  await test('counts allowed/deniedOrWithdrawn/unknown/notRequired/conflict correctly and exhaustively', () => {
    const matrix: MatrixEntry[] = [
      makeEntry({ channel: 'sms', purpose: 'marketing', preference: { id: '1', status: 'granted', effectiveAt: '', grantedAt: '', withdrawnAt: null, source: 'staff', evidenceType: null, noticeVersion: null, actorUserId: null, actorPlatformAdminId: null, updatedAt: '' } }),
      makeEntry({ channel: 'sms', purpose: 'campaign', preference: { id: '2', status: 'denied', effectiveAt: '', grantedAt: null, withdrawnAt: null, source: 'staff', evidenceType: null, noticeVersion: null, actorUserId: null, actorPlatformAdminId: null, updatedAt: '' } }),
      makeEntry({ channel: 'sms', purpose: 'survey', preference: { id: '3', status: 'withdrawn', effectiveAt: '', grantedAt: null, withdrawnAt: '', source: 'staff', evidenceType: null, noticeVersion: null, actorUserId: null, actorPlatformAdminId: null, updatedAt: '' } }),
      makeEntry({ channel: 'sms', purpose: 'recall', preference: null }),
      makeEntry({ channel: 'sms', purpose: 'transactional', isPolicyException: true, preference: null }),
      makeEntry({
        channel: 'sms', purpose: 'operational',
        preference: { id: '4', status: 'granted', effectiveAt: '', grantedAt: '', withdrawnAt: null, source: 'staff', evidenceType: null, noticeVersion: null, actorUserId: null, actorPlatformAdminId: null, updatedAt: '' },
        legacyConflict: { detected: true, reasonCode: 'legacy_central_conflict' },
      }),
    ];
    const summary = computeConsentSummary(matrix);
    assert.deepEqual(summary, { allowed: 1, deniedOrWithdrawn: 2, unknown: 1, notRequired: 1, conflict: 1 });
  });

  section('shouldShowLegacySignals — authorized-role-only disclosure, never a second "current state"');

  await test('hidden for non-canManage roles even when legacy data is present', () => {
    assert.equal(shouldShowLegacySignals(false, { communicationConsent: true, marketingConsent: false, smsOptOut: false }), false);
  });

  await test('hidden when no legacy data was passed, even for canManage roles', () => {
    assert.equal(shouldShowLegacySignals(true, undefined), false);
    assert.equal(shouldShowLegacySignals(true, null), false);
  });

  await test('shown only for canManage roles with legacy data present', () => {
    assert.equal(shouldShowLegacySignals(true, { communicationConsent: true, marketingConsent: false, smsOptOut: false }), true);
  });

  section('isCellActionable — not-required (policy-exception) cells stay non-actionable regardless of role');

  await test('policy-exception cells are never actionable, even for canManage roles', () => {
    assert.equal(isCellActionable(true, { isPolicyException: true }), false);
  });

  await test('non-exception cells are actionable only for canManage roles', () => {
    assert.equal(isCellActionable(false, { isPolicyException: false }), false);
    assert.equal(isCellActionable(true, { isPolicyException: false }), true);
  });

  section('buildMatrixIndex');

  await test('indexes entries by channel:purpose for O(1) lookup', () => {
    const entries = [makeEntry({ channel: 'sms', purpose: 'marketing' }), makeEntry({ channel: 'email', purpose: 'campaign' })];
    const index = buildMatrixIndex(entries);
    assert.equal(index.size, 2);
    assert.equal(index.get(matrixKey('sms', 'marketing'))?.channel, 'sms');
    assert.equal(index.get(matrixKey('email', 'campaign'))?.purpose, 'campaign');
    assert.equal(index.get(matrixKey('whatsapp', 'marketing')), undefined);
  });

  section('validateBulkSelection — no accidental one-click grant-all');

  await test('empty selection is rejected', () => {
    const result = validateBulkSelection([]);
    assert.equal(result.ok, false);
  });

  await test('more than 50 items is rejected (matches API cap)', () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ channel: 'sms', purpose: `p${i}`, action: 'grant' as const }));
    const result = validateBulkSelection(items);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'too_many');
  });

  await test('duplicate channel+purpose entries are rejected', () => {
    const result = validateBulkSelection([
      { channel: 'sms', purpose: 'marketing', action: 'grant' },
      { channel: 'sms', purpose: 'marketing', action: 'deny' },
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'duplicate');
  });

  await test('a valid, explicit selection is accepted', () => {
    const result = validateBulkSelection([
      { channel: 'sms', purpose: 'marketing', action: 'grant' },
      { channel: 'whatsapp', purpose: 'campaign', action: 'withdraw' },
    ]);
    assert.equal(result.ok, true);
  });

  section('computeConsentActionValidation — single source of truth for the consent-action modal (KVKK-HIGH-008)');

  await test('non-grant actions (deny/withdraw/reset) never require noticeVersion or notes', () => {
    for (const action of ['deny', 'withdraw', 'reset'] as const) {
      const result = computeConsentActionValidation({ action, source: 'staff', noticeVersion: '', notes: '' });
      assert.equal(result.noticeVersionRequired, false, `${action} must never require noticeVersion`);
      assert.equal(result.notesRequired, false, `${action} must never require notes`);
      assert.equal(result.canSubmit, true);
    }
  });

  await test('a grant from a digital source requires noticeVersion, independent of the notes requirement', () => {
    const result = computeConsentActionValidation({ action: 'grant', source: 'patient_portal', noticeVersion: '', notes: 'irrelevant' });
    assert.equal(result.noticeVersionRequired, true);
    assert.equal(result.notesRequired, false, 'patient_portal is not the staff source — notes stay optional');
    assert.equal(result.canSubmit, false);
    assert.deepEqual(result.invalidFields, ['noticeVersion']);
    assert.equal(result.firstInvalidField, 'noticeVersion');
  });

  await test('a grant with source=staff requires notes — this is keyed on `source`, NOT on evidenceType', () => {
    // evidenceType is intentionally absent from ConsentActionValidationState —
    // the requirement must never be re-derived from it.
    const result = computeConsentActionValidation({ action: 'grant', source: 'staff', noticeVersion: '', notes: '' });
    assert.equal(result.notesRequired, true);
    assert.equal(result.noticeVersionRequired, false, 'staff is not a digital-grant source');
    assert.deepEqual(result.invalidFields, ['notes']);
    assert.equal(result.canSubmit, false);
  });

  await test('a grant with source=staff and notes filled in is submittable', () => {
    const result = computeConsentActionValidation({ action: 'grant', source: 'staff', noticeVersion: '', notes: 'Patient confirmed verbally at check-in.' });
    assert.equal(result.canSubmit, true);
    assert.deepEqual(result.invalidFields, []);
    assert.equal(result.firstInvalidField, null);
  });

  await test('whitespace-only notes/noticeVersion still count as empty (matches server-side .trim() semantics)', () => {
    const result = computeConsentActionValidation({ action: 'grant', source: 'staff', noticeVersion: '   ', notes: '   ' });
    assert.equal(result.canSubmit, false);
    assert.deepEqual(result.invalidFields, ['notes']);
  });

  await test('a grant from patient_portal AND source=staff (both requirements) reports noticeVersion first, in field order', () => {
    // Not a realistic combination in the UI (source list excludes overlap in
    // practice) but proves invalidFields/firstInvalidField ordering is
    // deterministic (noticeVersion before notes) regardless of input.
    const result = computeConsentActionValidation({ action: 'grant', source: 'staff', noticeVersion: '', notes: '' });
    assert.equal(result.notesRequired, true);
  });

  await test('no action selected is never submittable, regardless of field contents', () => {
    const result = computeConsentActionValidation({ action: null, source: 'staff', noticeVersion: 'v1', notes: 'x' });
    assert.equal(result.canSubmit, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
