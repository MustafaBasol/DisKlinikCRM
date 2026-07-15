/**
 * publicBookingNoticeEvidence.test.ts — KVKK-CRIT-001a unit tests.
 *
 * Covers:
 *   Language normalization:
 *   1.  Supported value passes through unchanged
 *   2.  Unsupported value falls back to the given fallback (when supported)
 *   3.  Unsupported value + unsupported fallback → 'tr'
 *
 *   Evidence token validation (validateNoticeEvidenceToken):
 *   4.  Missing/empty token → failure 'missing'
 *   5.  Unknown token → failure 'not_found'
 *   6.  Token belonging to another clinic → failure 'wrong_clinic' (cross-clinic reuse blocked)
 *   7.  Token issued for a different channel → failure 'wrong_channel'
 *   8.  Expired token → failure 'expired'
 *   9.  Already-linked token → failure 'already_linked' (cannot reuse across two appointment requests)
 *   10. Valid, unexpired, unlinked, same-clinic token → ok:true
 *
 *   Evidence linking (linkNoticeEvidenceToRequest):
 *   11. First link succeeds (updateMany count=1) → true
 *   12. Concurrent second link on the same evidence loses the race (count=0) → false
 *
 *   No-consent naming semantics:
 *   13. PublicBookingNoticeEvidence Prisma model fields never use consent/approval/accepted/granted wording
 *   14. Service module exports contain no consent/approval/accepted/granted-named symbols
 *
 *   Channel/version/language constants:
 *   15. NOTICE_CHANNEL is fixed to 'web_booking'
 *   16. SUPPORTED_NOTICE_LANGUAGES covers all four shipped app locales (tr/en/fr/de)
 *
 * Run with: cd server && npx tsx src/tests/publicBookingNoticeEvidence.test.ts
 * No external test framework — uses node:assert/strict. No DB connection
 * required: validateNoticeEvidenceToken/linkNoticeEvidenceToRequest are
 * exercised against a minimal mock Prisma transaction client, following the
 * pattern established in publicBookingAvailability.test.ts.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Test harness ────────────────────────────────────────────────────────────

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

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  normalizeNoticeLanguage,
  validateNoticeEvidenceToken,
  linkNoticeEvidenceToRequest,
  NOTICE_CHANNEL,
  SUPPORTED_NOTICE_LANGUAGES,
} from '../services/publicBookingNoticeEvidence.js';

// ── 1-3. Language normalization ───────────────────────────────────────────────

section('1-3. normalizeNoticeLanguage');

await test('1. supported value passes through unchanged', () => {
  assert.equal(normalizeNoticeLanguage('fr', 'tr'), 'fr');
});

await test("2. unsupported value falls back to supported fallback ('en')", () => {
  assert.equal(normalizeNoticeLanguage('xx', 'en'), 'en');
});

await test("3. unsupported value + unsupported fallback → 'tr'", () => {
  assert.equal(normalizeNoticeLanguage('xx', 'zz'), 'tr');
});

// ── Mock Prisma-like tx for evidence lookups ──────────────────────────────────

type MockEvidenceRow = {
  id: string;
  clinicId: string;
  channel: string;
  expiresAt: Date;
  appointmentRequestId: string | null;
};

function mockTx(rowsByToken: Record<string, MockEvidenceRow>, updateManyCounts: number[] = []) {
  let updateCallIndex = 0;
  const tx = {
    publicBookingNoticeEvidence: {
      findUnique: async ({ where }: { where: { token: string } }) => {
        return rowsByToken[where.token] ?? null;
      },
      updateMany: async (_args: { where: { id: string; appointmentRequestId: null }; data: unknown }) => {
        const count = updateManyCounts[updateCallIndex] ?? 0;
        updateCallIndex += 1;
        return { count };
      },
    },
  };
  return tx as unknown as import('@prisma/client').Prisma.TransactionClient;
}

const CLINIC_A = 'clinic-aaa';
const CLINIC_B = 'clinic-bbb';
const future = new Date(Date.now() + 60 * 60 * 1000);
const past = new Date(Date.now() - 60 * 1000);

// ── 4-10. validateNoticeEvidenceToken ─────────────────────────────────────────

section('4-10. validateNoticeEvidenceToken');

await test("4. missing/empty token → failure 'missing'", async () => {
  const tx = mockTx({});
  const result = await validateNoticeEvidenceToken(tx, { clinicId: CLINIC_A, token: '' });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'missing');
});

await test("5. unknown token → failure 'not_found'", async () => {
  const tx = mockTx({});
  const result = await validateNoticeEvidenceToken(tx, { clinicId: CLINIC_A, token: 'does-not-exist' });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'not_found');
});

await test("6. token issued for another clinic → failure 'wrong_clinic' (cross-clinic reuse blocked)", async () => {
  const tx = mockTx({
    tok1: { id: 'ev-1', clinicId: CLINIC_B, channel: NOTICE_CHANNEL, expiresAt: future, appointmentRequestId: null },
  });
  const result = await validateNoticeEvidenceToken(tx, { clinicId: CLINIC_A, token: 'tok1' });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'wrong_clinic');
});

await test("7. token issued for a different channel → failure 'wrong_channel'", async () => {
  const tx = mockTx({
    tok2: { id: 'ev-2', clinicId: CLINIC_A, channel: 'whatsapp', expiresAt: future, appointmentRequestId: null },
  });
  const result = await validateNoticeEvidenceToken(tx, { clinicId: CLINIC_A, token: 'tok2' });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'wrong_channel');
});

await test("8. expired token → failure 'expired'", async () => {
  const tx = mockTx({
    tok3: { id: 'ev-3', clinicId: CLINIC_A, channel: NOTICE_CHANNEL, expiresAt: past, appointmentRequestId: null },
  });
  const result = await validateNoticeEvidenceToken(tx, { clinicId: CLINIC_A, token: 'tok3' });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'expired');
});

await test("9. already-linked token → failure 'already_linked' (no reuse across two appointment requests)", async () => {
  const tx = mockTx({
    tok4: { id: 'ev-4', clinicId: CLINIC_A, channel: NOTICE_CHANNEL, expiresAt: future, appointmentRequestId: 'req-existing' },
  });
  const result = await validateNoticeEvidenceToken(tx, { clinicId: CLINIC_A, token: 'tok4' });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'already_linked');
});

await test('10. valid, unexpired, unlinked, same-clinic token → ok:true', async () => {
  const tx = mockTx({
    tok5: { id: 'ev-5', clinicId: CLINIC_A, channel: NOTICE_CHANNEL, expiresAt: future, appointmentRequestId: null },
  });
  const result = await validateNoticeEvidenceToken(tx, { clinicId: CLINIC_A, token: 'tok5' });
  assert.equal(result.ok, true);
  assert.equal(result.evidence?.id, 'ev-5');
});

// ── 11-12. linkNoticeEvidenceToRequest ────────────────────────────────────────

section('11-12. linkNoticeEvidenceToRequest');

await test('11. first link succeeds (updateMany count=1) → true', async () => {
  const tx = mockTx({}, [1]);
  const linked = await linkNoticeEvidenceToRequest(tx, { evidenceId: 'ev-1', appointmentRequestId: 'req-1' });
  assert.equal(linked, true);
});

await test('12. concurrent second link on same evidence loses race (count=0) → false', async () => {
  const tx = mockTx({}, [0]);
  const linked = await linkNoticeEvidenceToRequest(tx, { evidenceId: 'ev-1', appointmentRequestId: 'req-2' });
  assert.equal(linked, false);
});

// ── 13-14. No-consent naming semantics ────────────────────────────────────────

section('13-14. No-consent naming semantics');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORBIDDEN_WORDS = /consent|approval|accepted|granted/i;

await test('13. PublicBookingNoticeEvidence Prisma model fields never use consent/approval/accepted/granted wording', () => {
  const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const start = schema.indexOf('model PublicBookingNoticeEvidence {');
  assert.ok(start !== -1, 'PublicBookingNoticeEvidence model not found in schema.prisma');
  const end = schema.indexOf('\n}', start);
  const modelBlock = schema.slice(start, end);
  assert.equal(
    FORBIDDEN_WORDS.test(modelBlock),
    false,
    'PublicBookingNoticeEvidence model must not contain consent/approval/accepted/granted wording',
  );
});

await test('14. service module source contains no consent/approval/accepted/granted-named exports', () => {
  const servicePath = path.resolve(__dirname, '../services/publicBookingNoticeEvidence.ts');
  const source = fs.readFileSync(servicePath, 'utf8');
  const exportLines = source
    .split('\n')
    .filter((line) => /^export (const|function|interface|type)/.test(line.trim()));
  for (const line of exportLines) {
    assert.equal(
      FORBIDDEN_WORDS.test(line),
      false,
      `Exported symbol must not use consent/approval/accepted/granted wording: ${line.trim()}`,
    );
  }
});

// ── 15-16. Channel/language constants ─────────────────────────────────────────

section('15-16. Channel/version/language constants');

await test("15. NOTICE_CHANNEL is fixed to 'web_booking'", () => {
  assert.equal(NOTICE_CHANNEL, 'web_booking');
});

await test('16. SUPPORTED_NOTICE_LANGUAGES covers all four shipped app locales (tr/en/fr/de)', () => {
  for (const lang of ['tr', 'en', 'fr', 'de']) {
    assert.ok((SUPPORTED_NOTICE_LANGUAGES as readonly string[]).includes(lang), `missing ${lang}`);
  }
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
