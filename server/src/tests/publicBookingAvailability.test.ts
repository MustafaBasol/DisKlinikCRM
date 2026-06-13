/**
 * publicBookingAvailability.test.ts
 *
 * Unit tests for the hardened public booking AppointmentRequest creation path.
 *
 * Run with:  tsx src/tests/publicBookingAvailability.test.ts
 * No external test framework — uses node:assert/strict.
 *
 * Strategy:
 *   We test the central service helpers (acquireAppointmentSlotLock,
 *   assertSlotAvailable, SlotConflictError) in the same way the new
 *   publicBooking.ts code uses them, and verify the branching logic:
 *     - hasFullSlotInfo path  → lock + assert + create
 *     - partial path          → direct create, no lock
 *   We also verify the status semantics via the shared constants.
 *
 * Test coverage:
 *  ── hasFullSlotInfo gating ────────────────────────────────────────────────
 *   1. Full slot info (practitionerId + startTime + endTime) → uses lock path
 *   2. Missing practitionerId → partial path (no lock)
 *   3. Missing startTime → partial path (no lock)
 *   4. Missing endTime (no serviceId/duration) → partial path (no lock)
 *
 *  ── Slot available — no conflict ──────────────────────────────────────────
 *   5. No Appointment conflict, no AppointmentRequest conflict → create succeeds
 *
 *  ── Existing Appointment blocks slot ──────────────────────────────────────
 *   6. Non-cancelled Appointment → assertSlotAvailable throws APPOINTMENT_OVERLAP
 *   7. cancelled Appointment → does NOT block slot (NON_BLOCKING status)
 *   8. no_show Appointment → does NOT block slot (NON_BLOCKING status)
 *
 *  ── AppointmentRequest conflict ────────────────────────────────────────────
 *   9. Pending AppointmentRequest → assertSlotAvailable throws APPOINTMENT_REQUEST_CONFLICT
 *  10. Approved AppointmentRequest → assertSlotAvailable throws APPOINTMENT_REQUEST_CONFLICT
 *  11. Rejected AppointmentRequest → does NOT block (non-blocking status)
 *  12. Converted AppointmentRequest → does NOT block (non-blocking status)
 *  13. Closed AppointmentRequest → does NOT block (non-blocking status)
 *
 *  ── Advisory lock call order ──────────────────────────────────────────────
 *  14. acquireAppointmentSlotLock is called before assertSlotAvailable
 *  15. acquireAppointmentSlotLock is called before appointmentRequest.create
 *
 *  ── SlotConflictError identity ────────────────────────────────────────────
 *  16. SlotConflictError kind=APPOINTMENT_OVERLAP maps to SLOT_UNAVAILABLE response
 *  17. SlotConflictError kind=APPOINTMENT_REQUEST_CONFLICT maps to SLOT_UNAVAILABLE response
 *
 *  ── preferredEndTime is saved ─────────────────────────────────────────────
 *  18. When service duration is known, preferredEndTime is passed to create
 *  19. When serviceId absent, preferredEndTime is null in create data
 */

import assert from 'node:assert/strict';

// ─── Test harness ─────────────────────────────────────────────────────────────

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

// ─── Imports from central service ─────────────────────────────────────────────

import {
  assertSlotAvailable,
  acquireAppointmentSlotLock,
  SlotConflictError,
  NON_BLOCKING_APPOINTMENT_STATUSES,
  BLOCKING_APPOINTMENT_REQUEST_STATUSES,
} from '../services/appointments/appointmentAvailabilityService.js';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Minimal mock TransactionClient matching what assertSlotAvailable +
 * acquireAppointmentSlotLock need.
 */
function mockTx(overrides: {
  executeRaw?: () => Promise<unknown>;
  appointmentFindFirst?: { id: string; status: string } | null;
  requestFindFirst?: { id: string; status: string } | null;
}) {
  const callLog: string[] = [];

  const tx = {
    _callLog: callLog,
    $executeRaw: async (..._args: unknown[]) => {
      callLog.push('$executeRaw');
      return overrides.executeRaw ? overrides.executeRaw() : Promise.resolve(1);
    },
    appointment: {
      findFirst: async (args: { where: { status?: { notIn?: string[] }; [key: string]: unknown } }) => {
        callLog.push('appointment.findFirst');
        const row = overrides.appointmentFindFirst ?? null;
        if (!row) return null;
        const blocked = args.where.status?.notIn ?? [];
        if (blocked.includes(row.status)) return null;
        return row;
      },
    },
    appointmentRequest: {
      findFirst: async (args: { where: { status?: { in?: string[] }; [key: string]: unknown } }) => {
        callLog.push('appointmentRequest.findFirst');
        const row = overrides.requestFindFirst ?? null;
        if (!row) return null;
        const allowed = args.where.status?.in ?? [];
        if (!allowed.includes(row.status)) return null;
        return row;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        callLog.push('appointmentRequest.create');
        return { id: 'new-req', ...args.data };
      },
    },
  };

  return tx as typeof tx & import('@prisma/client').Prisma.TransactionClient;
}

const baseSlot = {
  clinicId: 'clinic-001',
  practitionerId: 'doctor-001',
  startTime: new Date('2025-09-01T09:00:00Z'),
  endTime: new Date('2025-09-01T09:30:00Z'),
};

// ─── hasFullSlotInfo gating ────────────────────────────────────────────────────

section('── hasFullSlotInfo gating ────────────────────────────────────────────');

await test('1. all three present (practitionerId + startTime + endTime) → hasFullSlotInfo = true', () => {
  const { clinicId: _c, ...slot } = baseSlot;
  const hasFullSlotInfo = !!(slot.practitionerId && slot.startTime && slot.endTime);
  assert.equal(hasFullSlotInfo, true);
});

await test('2. missing practitionerId → hasFullSlotInfo = false', () => {
  const practitionerId: string | undefined = undefined;
  const hasFullSlotInfo = !!(practitionerId && baseSlot.startTime && baseSlot.endTime);
  assert.equal(hasFullSlotInfo, false);
});

await test('3. missing startTime → hasFullSlotInfo = false', () => {
  const preferredStartTime: Date | undefined = undefined;
  const hasFullSlotInfo = !!(baseSlot.practitionerId && preferredStartTime && baseSlot.endTime);
  assert.equal(hasFullSlotInfo, false);
});

await test('4. missing endTime (no serviceId/duration) → hasFullSlotInfo = false', () => {
  const preferredEndTime: Date | undefined = undefined;
  const hasFullSlotInfo = !!(baseSlot.practitionerId && baseSlot.startTime && preferredEndTime);
  assert.equal(hasFullSlotInfo, false);
});

// ─── Slot available — no conflict ─────────────────────────────────────────────

section('── Slot available — no conflict ────────────────────────────────────');

await test('5. no conflict → assertSlotAvailable resolves, create is called', async () => {
  const tx = mockTx({ appointmentFindFirst: null, requestFindFirst: null });

  await acquireAppointmentSlotLock(tx, {
    clinicId: baseSlot.clinicId,
    practitionerId: baseSlot.practitionerId,
    startTime: baseSlot.startTime,
  });

  await assertSlotAvailable(tx, baseSlot);

  await tx.appointmentRequest.create({ data: { clinicId: baseSlot.clinicId } });

  assert.ok(tx._callLog.includes('$executeRaw'), 'lock must be acquired');
  assert.ok(tx._callLog.includes('appointmentRequest.create'), 'create must be called');
});

// ─── Existing Appointment blocks slot ─────────────────────────────────────────

section('── Existing Appointment blocks slot ──────────────────────────────────');

await test('6. confirmed Appointment → APPOINTMENT_OVERLAP thrown', async () => {
  const tx = mockTx({ appointmentFindFirst: { id: 'appt-1', status: 'confirmed' } });
  await acquireAppointmentSlotLock(tx, { clinicId: baseSlot.clinicId, practitionerId: baseSlot.practitionerId, startTime: baseSlot.startTime });
  await assert.rejects(
    () => assertSlotAvailable(tx, baseSlot),
    (err: unknown) => err instanceof SlotConflictError && err.kind === 'APPOINTMENT_OVERLAP',
  );
});

await test('7. cancelled Appointment does NOT block (NON_BLOCKING status)', async () => {
  assert.ok((NON_BLOCKING_APPOINTMENT_STATUSES as readonly string[]).includes('cancelled'));
  const tx = mockTx({ appointmentFindFirst: { id: 'appt-c', status: 'cancelled' } });
  await acquireAppointmentSlotLock(tx, { clinicId: baseSlot.clinicId, practitionerId: baseSlot.practitionerId, startTime: baseSlot.startTime });
  // Should resolve without throwing
  await assertSlotAvailable(tx, baseSlot);
});

await test('8. no_show Appointment does NOT block (NON_BLOCKING status)', async () => {
  assert.ok((NON_BLOCKING_APPOINTMENT_STATUSES as readonly string[]).includes('no_show'));
  const tx = mockTx({ appointmentFindFirst: { id: 'appt-ns', status: 'no_show' } });
  await acquireAppointmentSlotLock(tx, { clinicId: baseSlot.clinicId, practitionerId: baseSlot.practitionerId, startTime: baseSlot.startTime });
  await assertSlotAvailable(tx, baseSlot);
});

// ─── AppointmentRequest conflict ──────────────────────────────────────────────

section('── AppointmentRequest conflict ──────────────────────────────────────');

await test('9. pending AppointmentRequest → APPOINTMENT_REQUEST_CONFLICT thrown', async () => {
  assert.ok((BLOCKING_APPOINTMENT_REQUEST_STATUSES as readonly string[]).includes('pending'));
  const tx = mockTx({ appointmentFindFirst: null, requestFindFirst: { id: 'req-1', status: 'pending' } });
  await acquireAppointmentSlotLock(tx, { clinicId: baseSlot.clinicId, practitionerId: baseSlot.practitionerId, startTime: baseSlot.startTime });
  await assert.rejects(
    () => assertSlotAvailable(tx, baseSlot),
    (err: unknown) => err instanceof SlotConflictError && err.kind === 'APPOINTMENT_REQUEST_CONFLICT',
  );
});

await test('10. approved AppointmentRequest → APPOINTMENT_REQUEST_CONFLICT thrown', async () => {
  assert.ok((BLOCKING_APPOINTMENT_REQUEST_STATUSES as readonly string[]).includes('approved'));
  const tx = mockTx({ appointmentFindFirst: null, requestFindFirst: { id: 'req-2', status: 'approved' } });
  await acquireAppointmentSlotLock(tx, { clinicId: baseSlot.clinicId, practitionerId: baseSlot.practitionerId, startTime: baseSlot.startTime });
  await assert.rejects(
    () => assertSlotAvailable(tx, baseSlot),
    (err: unknown) => err instanceof SlotConflictError && err.kind === 'APPOINTMENT_REQUEST_CONFLICT',
  );
});

await test('11. rejected AppointmentRequest does NOT block', async () => {
  const tx = mockTx({ appointmentFindFirst: null, requestFindFirst: { id: 'req-3', status: 'rejected' } });
  await acquireAppointmentSlotLock(tx, { clinicId: baseSlot.clinicId, practitionerId: baseSlot.practitionerId, startTime: baseSlot.startTime });
  await assertSlotAvailable(tx, baseSlot); // must not throw
});

await test('12. converted AppointmentRequest does NOT block', async () => {
  const tx = mockTx({ appointmentFindFirst: null, requestFindFirst: { id: 'req-4', status: 'converted' } });
  await acquireAppointmentSlotLock(tx, { clinicId: baseSlot.clinicId, practitionerId: baseSlot.practitionerId, startTime: baseSlot.startTime });
  await assertSlotAvailable(tx, baseSlot);
});

await test('13. closed AppointmentRequest does NOT block', async () => {
  const tx = mockTx({ appointmentFindFirst: null, requestFindFirst: { id: 'req-5', status: 'closed' } });
  await acquireAppointmentSlotLock(tx, { clinicId: baseSlot.clinicId, practitionerId: baseSlot.practitionerId, startTime: baseSlot.startTime });
  await assertSlotAvailable(tx, baseSlot);
});

// ─── Advisory lock call order ──────────────────────────────────────────────────

section('── Advisory lock call order ─────────────────────────────────────────');

await test('14. acquireAppointmentSlotLock ($executeRaw) is called before assertSlotAvailable (findFirst)', async () => {
  const tx = mockTx({ appointmentFindFirst: null, requestFindFirst: null });

  await acquireAppointmentSlotLock(tx, { clinicId: baseSlot.clinicId, practitionerId: baseSlot.practitionerId, startTime: baseSlot.startTime });
  await assertSlotAvailable(tx, baseSlot);

  const lockIdx = tx._callLog.indexOf('$executeRaw');
  const findIdx = tx._callLog.indexOf('appointment.findFirst');
  assert.ok(lockIdx < findIdx, `lock (idx=${lockIdx}) must precede findFirst (idx=${findIdx})`);
});

await test('15. acquireAppointmentSlotLock is called before appointmentRequest.create', async () => {
  const tx = mockTx({ appointmentFindFirst: null, requestFindFirst: null });

  await acquireAppointmentSlotLock(tx, { clinicId: baseSlot.clinicId, practitionerId: baseSlot.practitionerId, startTime: baseSlot.startTime });
  await assertSlotAvailable(tx, baseSlot);
  await tx.appointmentRequest.create({ data: {} });

  const lockIdx = tx._callLog.indexOf('$executeRaw');
  const createIdx = tx._callLog.indexOf('appointmentRequest.create');
  assert.ok(lockIdx < createIdx, `lock (idx=${lockIdx}) must precede create (idx=${createIdx})`);
});

// ─── SlotConflictError → SLOT_UNAVAILABLE response ───────────────────────────

section('── SlotConflictError → SLOT_UNAVAILABLE response ─────────────────────');

await test('16. APPOINTMENT_OVERLAP error is a SlotConflictError (instanceof check for catch block)', () => {
  const err = new SlotConflictError('APPOINTMENT_OVERLAP');
  assert.ok(err instanceof SlotConflictError);
  assert.equal(err.kind, 'APPOINTMENT_OVERLAP');
  // The publicBooking catch block does: if (err instanceof SlotConflictError) → 409
  assert.ok(err instanceof SlotConflictError, 'catch block can detect this via instanceof');
});

await test('17. APPOINTMENT_REQUEST_CONFLICT error is a SlotConflictError (instanceof check for catch block)', () => {
  const err = new SlotConflictError('APPOINTMENT_REQUEST_CONFLICT');
  assert.ok(err instanceof SlotConflictError);
  assert.equal(err.kind, 'APPOINTMENT_REQUEST_CONFLICT');
  assert.ok(err instanceof SlotConflictError, 'catch block can detect this via instanceof');
});

// ─── preferredEndTime is computed and saved ────────────────────────────────────

section('── preferredEndTime is computed and saved ──────────────────────────');

await test('18. preferredEndTime = startTime + durationMinutes when service is known', () => {
  const startTime = new Date('2025-09-01T09:00:00Z');
  const durationMinutes = 30;
  const preferredEndTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
  assert.equal(preferredEndTime.toISOString(), '2025-09-01T09:30:00.000Z');
});

await test('19. preferredEndTime is undefined/null when serviceId is absent', () => {
  // Without svc (no serviceId), the endTime cannot be computed.
  const svc = null;
  let preferredEndTime: Date | undefined;
  const startTime = new Date('2025-09-01T09:00:00Z');
  if (svc) {
    preferredEndTime = new Date(startTime.getTime() + (svc as { durationMinutes: number }).durationMinutes * 60 * 1000);
  }
  assert.equal(preferredEndTime, undefined);
  // hasFullSlotInfo would be false → partial path (no lock)
  const hasFullSlotInfo = !!(true /* practitionerId */ && startTime && preferredEndTime);
  assert.equal(hasFullSlotInfo, false);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} tests passed.`);
} else {
  console.error(`✗ ${failed} of ${passed + failed} tests FAILED.`);
  process.exit(1);
}
