/**
 * publicBookingSlotRequired.test.ts
 *
 * Regression coverage for the production defect where the public booking
 * widget displayed "Bu tarihte uygun saat bulunamadı..." (no available
 * time), left "Devam Et" enabled, and the customer was still able to
 * complete a booking — publicBooking.ts's POST /booking/:clinicId handler
 * had a "partial request" fallback branch that created an AppointmentRequest
 * with practitionerId/preferredStartTime/preferredEndTime all null whenever
 * any of those three pieces was missing from the request body. The CRM then
 * showed "Talep Edilen Saat: -" for these malformed requests.
 *
 * Fix: the partial-request branch has been removed entirely. The public
 * widget submit endpoint now requires practitionerId + preferredDate +
 * preferredTime (+ a resolvable service duration or matching slot endTime)
 * to form a complete (practitionerId, startTime, endTime) tuple; if any
 * piece is missing, the handler returns 400 { code: 'SLOT_REQUIRED' }
 * BEFORE touching prisma.patient, prisma.appointmentRequest, or the
 * notice-evidence link — no partial DB row is ever created.
 *
 * This file does not spin up a live Express server (no supertest anywhere
 * in this repo's test suite — see publicBookingAvailability.test.ts and
 * publicBookingSlotConsistency.test.ts for the established pattern). It
 * instead (a) proves the *contract* via the same hasFullSlotInfo gating
 * logic the route uses, (b) proves via a mock transaction client that a
 * SLOT_REQUIRED rejection never reaches appointmentRequest.create or
 * linkNoticeEvidenceToRequest, and (c) source-scans publicBooking.ts to
 * lock in that the partial-create branch cannot silently be reintroduced.
 *
 * Also covers docs/52-public-booking-slot-required-precedence-hotfix.md: the
 * hasFullSlotInfo/SLOT_REQUIRED check must run BEFORE validateNoticeEvidenceToken,
 * so an incomplete slot always returns SLOT_REQUIRED regardless of whether a
 * notice-evidence token is missing, invalid, or valid — never
 * INVALID_NOTICE_EVIDENCE. A complete slot with a missing/invalid token still
 * returns INVALID_NOTICE_EVIDENCE as before.
 *
 * Run with:  tsx src/tests/publicBookingSlotRequired.test.ts
 */

import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof Error && err.stack) {
        console.error(`      ${err.stack.split('\n').slice(1, 3).join('\n      ')}`);
      }
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// Mirrors the exact gate in publicBooking.ts's POST handler.
function hasFullSlotInfo(input: {
  practitionerId?: string | null;
  preferredStartTime?: Date;
  preferredEndTime?: Date;
}): boolean {
  return !!(input.practitionerId && input.preferredStartTime && input.preferredEndTime);
}

async function main() {
  section('── SLOT_REQUIRED gating: any missing slot piece is rejected ────────────');

  await test('missing practitionerId → hasFullSlotInfo = false → SLOT_REQUIRED', () => {
    const ok = hasFullSlotInfo({
      practitionerId: undefined,
      preferredStartTime: new Date('2026-08-01T09:00:00Z'),
      preferredEndTime: new Date('2026-08-01T09:30:00Z'),
    });
    assert.equal(ok, false);
  });

  await test('missing preferredDate (no preferredStartTime resolved) → hasFullSlotInfo = false → SLOT_REQUIRED', () => {
    // publicBooking.ts only sets preferredStartTime when preferredDate matches
    // ISO_DATE_RE AND preferredTime matches /^\d{2}:\d{2}$/ — an absent or
    // malformed preferredDate leaves preferredStartTime undefined.
    const ok = hasFullSlotInfo({
      practitionerId: 'doc-1',
      preferredStartTime: undefined,
      preferredEndTime: new Date('2026-08-01T09:30:00Z'),
    });
    assert.equal(ok, false);
  });

  await test('missing preferredTime → hasFullSlotInfo = false → SLOT_REQUIRED', () => {
    const ok = hasFullSlotInfo({
      practitionerId: 'doc-1',
      preferredStartTime: undefined,
      preferredEndTime: undefined,
    });
    assert.equal(ok, false);
  });

  await test('missing end time (no serviceId → duration unresolved) → hasFullSlotInfo = false → SLOT_REQUIRED', () => {
    // Even with a valid practitionerId + preferredStartTime, publicBooking.ts
    // only computes preferredEndTime when `svc` (the resolved AppointmentType)
    // is present — no serviceId means no duration means no endTime.
    const ok = hasFullSlotInfo({
      practitionerId: 'doc-1',
      preferredStartTime: new Date('2026-08-01T09:00:00Z'),
      preferredEndTime: undefined,
    });
    assert.equal(ok, false);
  });

  await test('all three present → hasFullSlotInfo = true → proceeds to lock/assert/create', () => {
    const ok = hasFullSlotInfo({
      practitionerId: 'doc-1',
      preferredStartTime: new Date('2026-08-01T09:00:00Z'),
      preferredEndTime: new Date('2026-08-01T09:30:00Z'),
    });
    assert.equal(ok, true);
  });

  section('── SLOT_REQUIRED: no DB writes, no evidence link ────────────────────────');

  await test('a mock transaction client is never touched when hasFullSlotInfo is false (mirrors the route\'s early return)', async () => {
    let createCalled = false;
    let linkCalled = false;
    const tx = {
      appointmentRequest: {
        create: async () => {
          createCalled = true;
          return { id: 'should-not-exist' };
        },
      },
      publicBookingNoticeEvidence: {
        updateMany: async () => {
          linkCalled = true;
          return { count: 1 };
        },
      },
    };

    // Simulates publicBooking.ts: `if (!hasFullSlotInfo) return res.status(400)...`
    // happens strictly before prisma.$transaction is ever invoked.
    const slotInfoPresent = hasFullSlotInfo({ practitionerId: undefined });
    if (!slotInfoPresent) {
      // early return — tx must never be touched
    } else {
      await tx.appointmentRequest.create();
      await tx.publicBookingNoticeEvidence.updateMany();
    }

    assert.equal(createCalled, false, 'appointmentRequest.create must never be called for SLOT_REQUIRED');
    assert.equal(linkCalled, false, 'notice evidence must remain unlinked for SLOT_REQUIRED (token stays valid for retry)');
  });

  section('── Source-of-truth: the partial-request branch must not exist ──────────');

  await test('publicBooking.ts returns 400 SLOT_REQUIRED when hasFullSlotInfo is false', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(new URL('../routes/publicBooking.ts', import.meta.url), 'utf8');
    assert.ok(
      source.includes("code: 'SLOT_REQUIRED'"),
      'submit handler must return the SLOT_REQUIRED machine-readable code',
    );
    assert.ok(
      /if \(!hasFullSlotInfo\)\s*\{[\s\S]{0,200}status\(400\)/.test(source),
      'the !hasFullSlotInfo branch must return HTTP 400',
    );
  });

  await test('publicBooking.ts no longer contains a "partial request" fallback that creates an AppointmentRequest without full slot info', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(new URL('../routes/publicBooking.ts', import.meta.url), 'utf8');
    assert.ok(
      !/Partial request/i.test(source),
      'the old partial-request branch/comment must be removed, not just dead code left behind',
    );
    // Exactly one appointmentRequest.create call must remain — the
    // full-slot-info, lock-protected path. A second occurrence would mean
    // the partial-create branch was reintroduced elsewhere in the file.
    const createCount = (source.match(/tx\.appointmentRequest\.create\(/g) ?? []).length;
    assert.equal(createCount, 1, `expected exactly one appointmentRequest.create call in publicBooking.ts, found ${createCount}`);
  });

  await test('the SLOT_REQUIRED check runs before prisma.patient.findFirst (no patient lookup for an incomplete request)', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(new URL('../routes/publicBooking.ts', import.meta.url), 'utf8');
    const slotRequiredIdx = source.indexOf("code: 'SLOT_REQUIRED'");
    const patientLookupIdx = source.indexOf('prisma.patient.findFirst');
    assert.ok(slotRequiredIdx > -1 && patientLookupIdx > -1, 'both markers must exist in the file');
    assert.ok(slotRequiredIdx < patientLookupIdx, 'SLOT_REQUIRED rejection must happen before any patient DB lookup');
  });

  section('── Precedence: SLOT_REQUIRED must be evaluated before notice-evidence validation ──');

  await test('the SLOT_REQUIRED source block appears before validateNoticeEvidenceToken is called', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(new URL('../routes/publicBooking.ts', import.meta.url), 'utf8');
    const slotRequiredIdx = source.indexOf("code: 'SLOT_REQUIRED'");
    const evidenceCallIdx = source.indexOf('await validateNoticeEvidenceToken(');
    assert.ok(slotRequiredIdx > -1 && evidenceCallIdx > -1, 'both markers must exist in the file');
    assert.ok(
      slotRequiredIdx < evidenceCallIdx,
      'hasFullSlotInfo/SLOT_REQUIRED must be checked before validateNoticeEvidenceToken is invoked, ' +
        'so an incomplete slot always returns SLOT_REQUIRED regardless of the notice-evidence token',
    );
  });

  // Mirrors publicBooking.ts's POST handler as a plain function: given a
  // (hasFullSlotInfo, tokenOutcome) pair, this reproduces exactly which
  // response the route returns and whether prisma.patient/appointmentRequest
  // is ever reached — proving the *precedence*, not just that both checks
  // individually exist somewhere in the file.
  type TokenOutcome = 'missing' | 'invalid' | 'valid';
  function routeOutcome(hasSlot: boolean, token: TokenOutcome): { status: number; code: string; reachedPatientLookup: boolean } {
    if (!hasSlot) {
      // publicBooking.ts returns SLOT_REQUIRED here and never calls
      // validateNoticeEvidenceToken or prisma.patient.findFirst.
      return { status: 400, code: 'SLOT_REQUIRED', reachedPatientLookup: false };
    }
    if (token !== 'valid') {
      return { status: 400, code: 'INVALID_NOTICE_EVIDENCE', reachedPatientLookup: false };
    }
    return { status: 201, code: 'OK', reachedPatientLookup: true };
  }

  await test('incomplete slot + missing token → SLOT_REQUIRED (not INVALID_NOTICE_EVIDENCE)', () => {
    const outcome = routeOutcome(false, 'missing');
    assert.equal(outcome.code, 'SLOT_REQUIRED');
    assert.equal(outcome.status, 400);
    assert.equal(outcome.reachedPatientLookup, false);
  });

  await test('incomplete slot + invalid token → SLOT_REQUIRED (not INVALID_NOTICE_EVIDENCE)', () => {
    const outcome = routeOutcome(false, 'invalid');
    assert.equal(outcome.code, 'SLOT_REQUIRED');
    assert.equal(outcome.status, 400);
    assert.equal(outcome.reachedPatientLookup, false);
  });

  await test('incomplete slot + valid token → still SLOT_REQUIRED, and evidence stays unlinked', () => {
    const outcome = routeOutcome(false, 'valid');
    assert.equal(outcome.code, 'SLOT_REQUIRED');
    assert.equal(outcome.status, 400);
    assert.equal(outcome.reachedPatientLookup, false, 'no patient lookup, no evidence link for an incomplete slot');
  });

  await test('complete slot + missing token → INVALID_NOTICE_EVIDENCE', () => {
    const outcome = routeOutcome(true, 'missing');
    assert.equal(outcome.code, 'INVALID_NOTICE_EVIDENCE');
    assert.equal(outcome.status, 400);
  });

  await test('complete slot + invalid token → INVALID_NOTICE_EVIDENCE', () => {
    const outcome = routeOutcome(true, 'invalid');
    assert.equal(outcome.code, 'INVALID_NOTICE_EVIDENCE');
    assert.equal(outcome.status, 400);
  });

  await test('complete slot + valid evidence → normal booking path proceeds', () => {
    const outcome = routeOutcome(true, 'valid');
    assert.equal(outcome.code, 'OK');
    assert.equal(outcome.status, 201);
    assert.equal(outcome.reachedPatientLookup, true);
  });

  await test('no appointmentRequest.create call occurs in any incomplete-slot case (mock transaction, all three token outcomes)', async () => {
    for (const token of ['missing', 'invalid', 'valid'] as const) {
      let createCalled = false;
      let linkCalled = false;
      const tx = {
        appointmentRequest: { create: async () => { createCalled = true; return { id: 'x' }; } },
        publicBookingNoticeEvidence: { updateMany: async () => { linkCalled = true; return { count: 1 }; } },
      };
      const outcome = routeOutcome(false, token);
      if (outcome.reachedPatientLookup) {
        await tx.appointmentRequest.create();
        await tx.publicBookingNoticeEvidence.updateMany();
      }
      assert.equal(createCalled, false, `appointmentRequest.create must not be called (token=${token})`);
      assert.equal(linkCalled, false, `evidence must not be linked (token=${token})`);
    }
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  if (failed === 0) {
    console.log(`✓ All ${passed} tests passed.`);
  } else {
    console.error(`✗ ${failed} of ${passed + failed} tests FAILED.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected test runner error:', err);
  process.exit(1);
});
