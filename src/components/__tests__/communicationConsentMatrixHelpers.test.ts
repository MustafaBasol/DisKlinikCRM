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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
