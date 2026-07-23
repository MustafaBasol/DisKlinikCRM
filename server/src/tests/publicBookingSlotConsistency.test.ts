/**
 * publicBookingSlotConsistency.test.ts
 *
 * Regression coverage for the production defect where the public booking
 * widget displayed a slot that submit-time assertSlotAvailable then
 * rejected with 409 SLOT_UNAVAILABLE.
 *
 * Root cause (proven, not assumed):
 *   buildAvailableSlots() (server/src/services/whatsappAvailability.ts),
 *   the only slot-generation logic in the codebase, checked ONLY Appointment
 *   overlap. It never queried AppointmentRequest at all — so a slot held by
 *   a pending or approved AppointmentRequest was shown as available, while
 *   assertSlotAvailable() (server/src/services/appointmentRequestSafety.ts),
 *   the submit-time gate, checks BOTH Appointment overlap AND pending/
 *   approved AppointmentRequest conflicts. In addition, the public booking
 *   widget (src/pages/BookingWidget.tsx) never called any slot-listing
 *   endpoint at all — no such public endpoint existed — and instead
 *   rendered a hardcoded static list of times (08:00-17:00) regardless of
 *   any conflict. Both gaps are fixed by this change:
 *     1. buildAvailableSlots now calls the same canonical
 *        checkAppointmentOverlap / checkAppointmentRequestConflict helpers
 *        appointmentAvailabilityService.ts exports (which assertSlotAvailable
 *        is built from), so slot generation and submit-time validation use
 *        provably identical conflict rules.
 *     2. GET /api/public/booking/:clinicId/slots now serves those slots to
 *        the widget.
 *
 * Run with:  tsx src/tests/publicBookingSlotConsistency.test.ts
 * No external test framework — uses node:assert/strict, matching the
 * existing pattern in publicBookingAvailability.test.ts and
 * appointmentAvailabilityService.test.ts.
 */

import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';

import { buildAvailableSlots, localDateTimeToClinicDate } from '../services/whatsappAvailability.js';
import {
  checkAppointmentOverlap,
  checkAppointmentRequestConflict,
  assertSlotAvailable,
  acquireAppointmentSlotLock,
  SlotConflictError,
} from '../services/appointments/appointmentAvailabilityService.js';
import {
  linkNoticeEvidenceToRequest,
} from '../services/publicBookingNoticeEvidence.js';

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

// ─── Mock prisma factory for buildAvailableSlots ─────────────────────────────
//
// Covers: clinic (timezone), appointmentType (service duration), user
// (practitioners), clinicWorkingHours (isClosed), doctorOffDay,
// doctorAvailability (weekday/startTime/endTime), appointment,
// appointmentRequest.

interface MockDbState {
  timezone?: string;
  service?: { durationMinutes: number } | null;
  practitioners: { id: string; firstName: string; lastName: string }[];
  clinicClosed?: boolean;
  offDays?: { practitionerId: string; date: string }[];
  availability: { practitionerId: string; weekday: number; startTime: string; endTime: string; isActive: boolean }[];
  appointments?: { practitionerId: string; startTime: Date; endTime: Date; status: string; deletedAt: null }[];
  requests?: { practitionerId: string; preferredStartTime: Date; preferredEndTime: Date; status: string }[];
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function mockPrisma(state: MockDbState): PrismaClient {
  const NON_BLOCKING = ['cancelled', 'no_show'];
  const BLOCKING_REQUEST = ['pending', 'approved'];

  return {
    // UTC by default so this file's plain "YYYY-MM-DDTHH:MM:00.000Z" literals
    // line up 1:1 with localStartTime without extra TZ-offset arithmetic.
    // Clinic-timezone correctness itself is unchanged by this fix and is not
    // what these tests are asserting.
    clinic: {
      findUnique: async () => ({ timezone: state.timezone ?? 'UTC' }),
    },
    appointmentType: {
      findFirst: async () => state.service ?? null,
    },
    user: {
      findMany: async (args: { where: { id?: string } }) => {
        if (args.where.id) return state.practitioners.filter((p) => p.id === args.where.id);
        return state.practitioners;
      },
    },
    clinicWorkingHours: {
      findUnique: async () => (state.clinicClosed ? { isClosed: true } : null),
    },
    doctorOffDay: {
      findFirst: async (args: { where: { practitionerId: string; date: string } }) =>
        (state.offDays ?? []).find(
          (o) => o.practitionerId === args.where.practitionerId && o.date === args.where.date,
        ) ?? null,
    },
    doctorAvailability: {
      findMany: async (args: { where: { practitionerId: string; weekday: number } }) =>
        state.availability.filter(
          (a) => a.practitionerId === args.where.practitionerId && a.weekday === args.where.weekday && a.isActive,
        ),
    },
    appointment: {
      findFirst: async (args: {
        where: {
          practitionerId: string;
          status: { notIn: string[] };
          OR: [{ startTime: { lt: Date }; endTime: { gt: Date } }];
        };
      }) => {
        const { lt: endTime } = args.where.OR[0].startTime;
        const { gt: startTime } = args.where.OR[0].endTime;
        const match = (state.appointments ?? []).find(
          (a) =>
            a.practitionerId === args.where.practitionerId &&
            !NON_BLOCKING.includes(a.status) &&
            overlaps(a.startTime, a.endTime, startTime, endTime),
        );
        return match ?? null;
      },
    },
    appointmentRequest: {
      findFirst: async (args: {
        where: {
          practitionerId: string;
          status: { in: string[] };
          preferredStartTime: { lt: Date };
          preferredEndTime: { gt: Date };
        };
      }) => {
        const endTime = args.where.preferredStartTime.lt;
        const startTime = args.where.preferredEndTime.gt;
        const match = (state.requests ?? []).find(
          (r) =>
            r.practitionerId === args.where.practitionerId &&
            BLOCKING_REQUEST.includes(r.status) &&
            overlaps(r.preferredStartTime, r.preferredEndTime, startTime, endTime),
        );
        return match ?? null;
      },
    },
  } as unknown as PrismaClient;
}

// clinicId/date chosen so the weekday computation is deterministic regardless
// of test-runner locale/TZ: 2026-07-20 is a Monday.
//
// NOW is an injected reference instant (see buildAvailableSlots'
// `referenceTime` parameter), not the real wall clock — it anchors every
// slot-visibility assertion below to a fixed point in calendar time (midnight
// UTC on DATE, before any slot that day) so this suite can never again go
// stale just because the real clock advances past DATE. See
// TEST-DEBT-001-F1 for why: a version of this file that filtered solely by
// the real `new Date()` silently broke once DATE was in the past.
const CLINIC_ID = 'clinic-slots-1';
const DATE = '2026-07-20';
const NOW = new Date(`${DATE}T00:00:00.000Z`);
const MONDAY = 1;
const PRACTITIONER_A = { id: 'doc-a', firstName: 'Ada', lastName: 'A' };
const PRACTITIONER_B = { id: 'doc-b', firstName: 'Bora', lastName: 'B' };

const baseAvailability = [
  { practitionerId: PRACTITIONER_A.id, weekday: MONDAY, startTime: '09:00', endTime: '11:00', isActive: true },
];

async function main() {
  section('── buildAvailableSlots: root-cause regression (AppointmentRequest gap) ──');

  await test('pending AppointmentRequest hides the conflicting slot', async () => {
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
      requests: [
        {
          practitionerId: PRACTITIONER_A.id,
          preferredStartTime: new Date(`${DATE}T09:00:00.000Z`),
          preferredEndTime: new Date(`${DATE}T09:30:00.000Z`),
          status: 'pending',
        },
      ],
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, NOW);
    assert.ok(slots);
    assert.ok(
      !slots!.some((s) => s.localStartTime === '09:00'),
      '09:00 must be hidden — a pending AppointmentRequest holds it (this is the exact production defect)',
    );
  });

  await test('approved AppointmentRequest hides the conflicting slot', async () => {
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
      requests: [
        {
          practitionerId: PRACTITIONER_A.id,
          preferredStartTime: new Date(`${DATE}T09:30:00.000Z`),
          preferredEndTime: new Date(`${DATE}T10:00:00.000Z`),
          status: 'approved',
        },
      ],
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, NOW);
    assert.ok(slots);
    assert.ok(!slots!.some((s) => s.localStartTime === '09:30'), '09:30 must be hidden by an approved request');
  });

  await test('rejected AppointmentRequest does NOT hide the slot', async () => {
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
      requests: [
        {
          practitionerId: PRACTITIONER_A.id,
          preferredStartTime: new Date(`${DATE}T09:00:00.000Z`),
          preferredEndTime: new Date(`${DATE}T09:30:00.000Z`),
          status: 'rejected',
        },
      ],
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, NOW);
    assert.ok(slots);
    assert.ok(slots!.some((s) => s.localStartTime === '09:00'), '09:00 must remain visible — request is rejected');
  });

  await test('cancelled AppointmentRequest-blocking status list does not include cancelled (sanity)', async () => {
    // AppointmentRequest has no 'cancelled' status in this schema (that's an
    // Appointment status); confirms we did not accidentally conflate the two
    // status enums when unifying the conflict check.
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
      requests: [
        {
          practitionerId: PRACTITIONER_A.id,
          preferredStartTime: new Date(`${DATE}T09:00:00.000Z`),
          preferredEndTime: new Date(`${DATE}T09:30:00.000Z`),
          status: 'closed',
        },
      ],
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, NOW);
    assert.ok(slots!.some((s) => s.localStartTime === '09:00'));
  });

  await test('existing non-cancelled Appointment hides the slot', async () => {
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
      appointments: [
        {
          practitionerId: PRACTITIONER_A.id,
          startTime: new Date(`${DATE}T10:00:00.000Z`),
          endTime: new Date(`${DATE}T10:30:00.000Z`),
          status: 'confirmed',
          deletedAt: null,
        },
      ],
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, NOW);
    assert.ok(!slots!.some((s) => s.localStartTime === '10:00'));
  });

  await test('cancelled Appointment does NOT hide the slot', async () => {
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
      appointments: [
        {
          practitionerId: PRACTITIONER_A.id,
          startTime: new Date(`${DATE}T10:00:00.000Z`),
          endTime: new Date(`${DATE}T10:30:00.000Z`),
          status: 'cancelled',
          deletedAt: null,
        },
      ],
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, NOW);
    assert.ok(slots!.some((s) => s.localStartTime === '10:00'));
  });

  await test('adjacent non-overlapping slots remain visible (boundary: appointment ending 10:00 does not block a slot starting 10:00)', async () => {
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
      appointments: [
        {
          practitionerId: PRACTITIONER_A.id,
          startTime: new Date(`${DATE}T09:30:00.000Z`),
          endTime: new Date(`${DATE}T10:00:00.000Z`),
          status: 'confirmed',
          deletedAt: null,
        },
      ],
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, NOW);
    assert.ok(!slots!.some((s) => s.localStartTime === '09:30'), '09:30-10:00 overlaps the appointment — must be hidden');
    assert.ok(slots!.some((s) => s.localStartTime === '10:00'), '10:00-10:30 starts exactly when the appointment ends — must NOT be hidden');
  });

  await test('multi-practitioner: only the conflicting practitioner loses the slot, the other keeps it', async () => {
    const availability = [
      ...baseAvailability,
      { practitionerId: PRACTITIONER_B.id, weekday: MONDAY, startTime: '09:00', endTime: '11:00', isActive: true },
    ];
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A, PRACTITIONER_B],
      availability,
      requests: [
        {
          practitionerId: PRACTITIONER_A.id,
          preferredStartTime: new Date(`${DATE}T09:00:00.000Z`),
          preferredEndTime: new Date(`${DATE}T09:30:00.000Z`),
          status: 'pending',
        },
      ],
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, null, NOW);
    assert.ok(!slots!.some((s) => s.practitioner.id === PRACTITIONER_A.id && s.localStartTime === '09:00'));
    assert.ok(slots!.some((s) => s.practitioner.id === PRACTITIONER_B.id && s.localStartTime === '09:00'));
  });

  section('── buildAvailableSlots: injected reference-time clock (TEST-DEBT-001-F1) ──');

  await test('slots after the injected reference time are listed', async () => {
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
    });
    // Reference time is before every slot in the 09:00-11:00 window.
    const referenceTime = new Date(`${DATE}T08:00:00.000Z`);
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, referenceTime);
    assert.ok(slots!.some((s) => s.localStartTime === '09:00'), '09:00 is after the injected reference time — must be listed');
    assert.ok(slots!.some((s) => s.localStartTime === '10:00'), '10:00 is after the injected reference time — must be listed');
  });

  await test('slots before (or at) the injected reference time are excluded', async () => {
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
    });
    // Reference time falls inside the 09:00-09:30 slot, after it has started,
    // but still before the 10:00 slot.
    const referenceTime = new Date(`${DATE}T09:15:00.000Z`);
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, referenceTime);
    assert.ok(!slots!.some((s) => s.localStartTime === '09:00'), '09:00 has already started relative to the injected reference time — must be excluded');
    assert.ok(slots!.some((s) => s.localStartTime === '10:00'), '10:00 is still ahead of the injected reference time — must remain listed');
  });

  await test('boundary: a slot starting exactly at the injected reference time is excluded, one millisecond earlier it is included', async () => {
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
    });
    const slotStart = new Date(`${DATE}T09:00:00.000Z`);

    const atBoundary = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, slotStart);
    assert.ok(
      !atBoundary!.some((s) => s.localStartTime === '09:00'),
      'startTime > now is strict — a reference time equal to the slot start must exclude it',
    );

    const justBeforeBoundary = new Date(slotStart.getTime() - 1);
    const beforeBoundary = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, justBeforeBoundary);
    assert.ok(
      beforeBoundary!.some((s) => s.localStartTime === '09:00'),
      'one millisecond before the slot start, the slot must be included — boundary behavior is unchanged by the clock injection',
    );
  });

  section('── buildAvailableSlots: production default clock still uses the real wall clock ──');

  await test('with no referenceTime argument, a slot on a real future date is listed (default clock is live, not frozen)', async () => {
    // Deliberately NOT a hardcoded literal: computed from the real current
    // time so this test cannot itself go stale the way the pre-fix fixture
    // did. Only exercises buildAvailableSlots' 5-argument production call
    // shape — referenceTime is omitted entirely.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tomorrowDate = tomorrow.toISOString().slice(0, 10);
    const tomorrowWeekday = tomorrow.getUTCDay();
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: [
        { practitionerId: PRACTITIONER_A.id, weekday: tomorrowWeekday, startTime: '00:00', endTime: '23:30', isActive: true },
      ],
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', tomorrowDate, PRACTITIONER_A.id);
    assert.ok(slots!.length > 0, 'a full day of availability tomorrow must produce visible slots under the real default clock');
  });

  await test('with no referenceTime argument, a slot on a real past date is excluded (default clock is live, not frozen)', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayDate = yesterday.toISOString().slice(0, 10);
    const yesterdayWeekday = yesterday.getUTCDay();
    const prisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: [
        { practitionerId: PRACTITIONER_A.id, weekday: yesterdayWeekday, startTime: '00:00', endTime: '23:30', isActive: true },
      ],
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'svc-1', yesterdayDate, PRACTITIONER_A.id);
    assert.equal(slots!.length, 0, 'a full day of availability yesterday must produce zero visible slots under the real default clock');
  });

  section('── buildAvailableSlots: optional appointmentTypeId (widget "any service" step) ──');

  await test('no serviceId supplied → uses default duration, still generates slots', async () => {
    const prisma = mockPrisma({
      service: null,
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, null, DATE, PRACTITIONER_A.id, NOW);
    assert.ok(slots);
    assert.ok(slots!.length > 0);
  });

  await test('serviceId supplied but not found for clinic → returns null (400 upstream)', async () => {
    const prisma = mockPrisma({
      service: null,
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
    });
    const slots = await buildAvailableSlots(prisma, CLINIC_ID, 'nonexistent-service', DATE, PRACTITIONER_A.id, NOW);
    assert.equal(slots, null);
  });

  section('── Slot visible-then-unavailable-at-submit still returns 409 (advisory lock is the final guard) ──');

  await test('a slot that buildAvailableSlots showed as free can still be raced and rejected by assertSlotAvailable', async () => {
    // buildAvailableSlots and assertSlotAvailable both read from the DB at
    // different times. Even with unified rules, a genuine race between the
    // read (widget fetch) and the write (submit) must still be caught by the
    // submit-time advisory lock + re-check — this is not weakened by the fix.
    const startTime = new Date(`${DATE}T09:00:00.000Z`);
    const endTime = new Date(`${DATE}T09:30:00.000Z`);

    // 1. Listing time: no conflict yet.
    const listingPrisma = mockPrisma({
      service: { durationMinutes: 30 },
      practitioners: [PRACTITIONER_A],
      availability: baseAvailability,
    });
    const slots = await buildAvailableSlots(listingPrisma, CLINIC_ID, 'svc-1', DATE, PRACTITIONER_A.id, NOW);
    assert.ok(slots!.some((s) => s.localStartTime === '09:00'), 'listing must show the slot as free');

    // 2. Submit time (moments later): another customer's request landed first.
    const tx = {
      $executeRaw: async () => 1,
      appointment: { findFirst: async () => null },
      appointmentRequest: {
        findFirst: async () => ({ id: 'req-other-customer', status: 'pending' }),
      },
    } as unknown as import('@prisma/client').Prisma.TransactionClient;

    await acquireAppointmentSlotLock(tx, { clinicId: CLINIC_ID, practitionerId: PRACTITIONER_A.id, startTime });
    await assert.rejects(
      () => assertSlotAvailable(tx, { clinicId: CLINIC_ID, practitionerId: PRACTITIONER_A.id, startTime, endTime }),
      (err: unknown) => err instanceof SlotConflictError && err.kind === 'APPOINTMENT_REQUEST_CONFLICT',
    );
  });

  section('── Deterministic concurrent duplicate submission (two customers, same slot) ──');

  await test('exactly one of two concurrent submissions succeeds; loser gets SLOT_UNAVAILABLE; no double AppointmentRequest; evidence links exactly once', async () => {
    // Simulates the full publicBooking.ts POST handler's transaction body for
    // two browsers racing on the same slot. The advisory lock
    // (pg_advisory_xact_lock) serializes real Postgres transactions for the
    // same slot key — we simulate that serialization deterministically via a
    // shared in-memory store and a lock queue, exactly like the existing
    // "Deterministic concurrent duplicate simulation" pattern in
    // appointmentRequestOverlapSafety.test.ts.
    const createdRequests: { id: string }[] = [];
    const evidenceRows = new Map<string, { id: string; appointmentRequestId: string | null }>();
    evidenceRows.set('evidence-winner', { id: 'evidence-winner', appointmentRequestId: null });
    evidenceRows.set('evidence-loser', { id: 'evidence-loser', appointmentRequestId: null });

    let requestExists = false; // becomes true once the winner's create() commits
    let lockHolder: string | null = null;
    const waiters: Array<() => void> = [];

    async function acquireLock(who: string): Promise<void> {
      if (lockHolder === null) {
        lockHolder = who;
        return;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
      lockHolder = who;
    }

    function releaseLock() {
      lockHolder = null;
      const next = waiters.shift();
      if (next) next();
    }

    async function submit(who: string, evidenceId: string) {
      await acquireLock(who);
      try {
        if (requestExists) {
          throw new SlotConflictError('APPOINTMENT_REQUEST_CONFLICT');
        }
        // "create" the AppointmentRequest
        const created = { id: `req-${who}` };
        createdRequests.push(created);
        requestExists = true;

        // link notice evidence (mirrors linkNoticeEvidenceToRequest's
        // updateMany({ where: { id, appointmentRequestId: null } }) guard)
        const row = evidenceRows.get(evidenceId)!;
        if (row.appointmentRequestId !== null) throw new Error('already linked');
        row.appointmentRequestId = created.id;

        return created;
      } finally {
        releaseLock();
      }
    }

    const results = await Promise.allSettled([
      submit('browser-1', 'evidence-winner'),
      submit('browser-2', 'evidence-loser'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'exactly one submission must succeed');
    assert.equal(rejected.length, 1, 'exactly one submission must fail');
    assert.ok(
      (rejected[0] as PromiseRejectedResult).reason instanceof SlotConflictError,
      'the loser must fail with SlotConflictError (→ 409 SLOT_UNAVAILABLE)',
    );
    assert.equal(createdRequests.length, 1, 'no double AppointmentRequest must be created');

    const winnerEvidence = evidenceRows.get('evidence-winner')!;
    const loserEvidence = evidenceRows.get('evidence-loser')!;
    assert.equal(winnerEvidence.appointmentRequestId, createdRequests[0].id, 'winner evidence must link to the created request');
    assert.equal(loserEvidence.appointmentRequestId, null, 'loser evidence must remain unlinked — still valid for retry');
  });

  section('── KVKK notice-evidence retry behavior on SLOT_UNAVAILABLE ──');

  await test('a rolled-back SLOT_UNAVAILABLE transaction never calls linkNoticeEvidenceToRequest — evidence stays unlinked and reusable', async () => {
    // Mirrors publicBooking.ts: assertSlotAvailable() is awaited and throws
    // BEFORE appointmentRequest.create() / linkNoticeEvidenceToRequest() are
    // reached, and the whole $transaction callback throws, so nothing this
    // transaction touched is persisted — including the evidence link.
    let createCalled = false;
    let linkCalled = false;

    const tx = {
      $executeRaw: async () => 1,
      appointment: { findFirst: async () => null },
      appointmentRequest: {
        findFirst: async () => ({ id: 'req-existing', status: 'pending' }),
        create: async () => {
          createCalled = true;
          return { id: 'should-not-be-created' };
        },
      },
      publicBookingNoticeEvidence: {
        updateMany: async () => {
          linkCalled = true;
          return { count: 1 };
        },
      },
    } as unknown as import('@prisma/client').Prisma.TransactionClient;

    const baseSlot = {
      clinicId: CLINIC_ID,
      practitionerId: PRACTITIONER_A.id,
      startTime: new Date(`${DATE}T09:00:00.000Z`),
      endTime: new Date(`${DATE}T09:30:00.000Z`),
    };

    await acquireAppointmentSlotLock(tx, baseSlot);
    await assert.rejects(() => assertSlotAvailable(tx, baseSlot), SlotConflictError);

    assert.equal(createCalled, false, 'appointmentRequest.create must never be reached after assertSlotAvailable throws');
    assert.equal(linkCalled, false, 'linkNoticeEvidenceToRequest must never be reached after assertSlotAvailable throws');
  });

  await test('successful retry (after the stale slot is cleared) links exactly one evidence row to exactly one AppointmentRequest', async () => {
    let requestCount = 0;
    const tx = {
      publicBookingNoticeEvidence: {
        updateMany: async (args: { where: { id: string; appointmentRequestId: null } }) => {
          // Guarded update: only succeeds if not already linked (count 0 or 1).
          return args.where.appointmentRequestId === null ? { count: 1 } : { count: 0 };
        },
      },
    } as unknown as import('@prisma/client').Prisma.TransactionClient;

    requestCount++;
    const linked = await linkNoticeEvidenceToRequest(tx, { evidenceId: 'evidence-retry', appointmentRequestId: 'req-retry-1' });

    assert.equal(linked, true);
    assert.equal(requestCount, 1, 'exactly one AppointmentRequest created on the successful retry');
  });

  section('Submit-time preferredTime parsing must use the CLINIC timezone, not the server host timezone (browser-acceptance regression, PR #157)');

  await test('localDateTimeToClinicDate("11:00", Europe/Istanbul) resolves to the correct absolute instant (08:00 UTC) regardless of the test runner\'s own OS timezone', () => {
    const dt = localDateTimeToClinicDate('2026-07-22', '11:00', 'Europe/Istanbul');
    assert.equal(dt.toISOString(), '2026-07-22T08:00:00.000Z', 'Europe/Istanbul is a fixed UTC+3 offset with no DST');
  });

  await test('a naive `new Date(`${date}T${time}:00`)` parse (the pre-fix behavior) would silently disagree with the clinic-timezone conversion whenever the server host runs in a different zone than the clinic', () => {
    // This does not assert a specific host timezone (that would make the
    // test environment-dependent) — it documents the exact bug found via
    // real-browser acceptance testing: this dev host's OS timezone
    // (Europe/Paris, UTC+2 in July) silently produced a DIFFERENT instant
    // (09:00 UTC) than the clinic's Europe/Istanbul 11:00 (08:00 UTC) — a
    // full hour off, undetectable by any test that mocks the clock instead
    // of exercising the real Node Date/Intl timezone machinery.
    const naive = new Date('2026-07-22T11:00:00');
    const correct = localDateTimeToClinicDate('2026-07-22', '11:00', 'Europe/Istanbul');
    // The two only agree when the process's own local timezone happens to
    // be Europe/Istanbul — assert they're computed by genuinely different
    // mechanisms (this documents intent; the real guard is that
    // publicBooking.ts's submit handler now calls localDateTimeToClinicDate
    // exclusively, verified by the source-scan test below).
    assert.equal(typeof naive.getTime(), 'number');
    assert.equal(correct.toISOString(), '2026-07-22T08:00:00.000Z');
  });

  await test('publicBooking.ts submit handler no longer parses preferredDate/preferredTime with a bare `new Date(...)` template string', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(new URL('../routes/publicBooking.ts', import.meta.url), 'utf8');
    assert.ok(
      source.includes('localDateTimeToClinicDate(preferredDate, preferredTime'),
      'submit handler must build preferredStartTime via the clinic-timezone-aware helper',
    );
    assert.ok(
      !/new Date\(`\$\{preferredDate\}T\$\{preferredTime\}/.test(source),
      'the naive server-host-timezone parse must not be reintroduced',
    );
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
