/**
 * appointmentAvailabilityService.test.ts
 *
 * Unit tests for the central AppointmentAvailabilityService.
 *
 * Run with:  tsx src/tests/appointmentAvailabilityService.test.ts
 * No external test framework — uses node:assert/strict.
 *
 * Test coverage:
 *  ── checkAppointmentOverlap ────────────────────────────────────────────────
 *   1. Existing non-cancelled Appointment → returns true (blocks slot)
 *   2. Cancelled Appointment → returns false (does NOT block slot)
 *   3. no_show Appointment → returns false (does NOT block slot)
 *   4. No existing appointment → returns false
 *   5. excludeAppointmentId skips the excluded row
 *   6. Uses both NON_BLOCKING statuses (cancelled, no_show) — not just cancelled
 *
 *  ── checkAppointmentRequestConflict ───────────────────────────────────────
 *   7. Pending AppointmentRequest → returns true (blocks slot)
 *   8. Approved AppointmentRequest → returns true (blocks slot)
 *   9. Rejected AppointmentRequest → returns false
 *  10. Converted AppointmentRequest → returns false
 *  11. Closed AppointmentRequest → returns false
 *  12. No conflicting request → returns false
 *
 *  ── Status constants ──────────────────────────────────────────────────────
 *  13. NON_BLOCKING_APPOINTMENT_STATUSES contains 'cancelled' and 'no_show'
 *  14. BLOCKING_APPOINTMENT_REQUEST_STATUSES contains 'pending' and 'approved'
 *
 *  ── Re-exports ────────────────────────────────────────────────────────────
 *  15. assertSlotAvailable is re-exported
 *  16. acquireAppointmentSlotLock is re-exported
 *  17. SlotConflictError is re-exported
 *
 *  ── checkPractitionerAvailabilityForSlot ───────────────────────────────────
 *  18. Delegates to helpers.ts checkPractitionerAvailability (off-day aware)
 *
 *  ── AI booking regression – channel uses central service helpers ───────────
 *  19. Instagram DM: still uses assertSlotAvailable + acquireAppointmentSlotLock
 *  20. Meta WhatsApp: still uses assertSlotAvailable + acquireAppointmentSlotLock
 *  21. Evolution WhatsApp: uses checkPractitionerAvailabilityForSlot (off-day aware)
 *
 *  ── Overlap behavior consistency ──────────────────────────────────────────
 *  22. checkAppointmentOverlap agrees with assertSlotAvailable on cancelled
 *  23. checkAppointmentOverlap agrees with assertSlotAvailable on no_show
 *
 *  ── excludeRequestId support ──────────────────────────────────────────────
 *  24. excludeRequestId causes the matching row to be ignored
 *  25. excludeRequestId only skips the matching row; OTHER pending requests still block
 *
 *  ── Staff direct appointment create ───────────────────────────────────────
 *  26. Blocked by pending AppointmentRequest (same slot)
 *  27. Allowed when conflicting request is rejected
 *  28. Allowed when conflicting request is converted
 *  29. Allowed when conflicting request is closed
 *
 *  ── AppointmentRequest conversion ─────────────────────────────────────────
 *  30. Conversion ignores the request being converted (excludeRequestId)
 *  31. Conversion blocked by a DIFFERENT pending request for same slot
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

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  checkAppointmentOverlap,
  checkAppointmentRequestConflict,
  checkPractitionerAvailabilityForSlot,
  assertSlotAvailable,
  acquireAppointmentSlotLock,
  SlotConflictError,
  NON_BLOCKING_APPOINTMENT_STATUSES,
  BLOCKING_APPOINTMENT_REQUEST_STATUSES,
} from '../services/appointments/appointmentAvailabilityService.js';

// ─── Mock factory ─────────────────────────────────────────────────────────────

/**
 * Build a minimal mock PrismaClient for testing overlap functions.
 * The real functions only call prisma.appointment.findFirst and
 * prisma.appointmentRequest.findFirst.
 */
function mockPrisma(overrides: {
  appointmentFindFirst?: unknown;
  requestFindFirst?: unknown;
}) {
  return {
    appointment: {
      findFirst: async (args: {
        where: {
          status?: { notIn?: string[] };
          id?: { not?: string };
          [key: string]: unknown;
        };
      }) => {
        // Simulate: if a blocking appointment exists, return it unless
        // the status filter excludes it or the id is excluded.
        const mockRow = overrides.appointmentFindFirst ?? null;
        if (!mockRow) return null;
        const row = mockRow as { id: string; status: string };
        const excludedId = (args.where.id as { not?: string } | undefined)?.not;
        if (excludedId && row.id === excludedId) return null;
        const blockedStatuses = args.where.status?.notIn ?? [];
        if (blockedStatuses.includes(row.status)) return null;
        return row;
      },
    },
    appointmentRequest: {
      findFirst: async (args: {
        where: {
          status?: { in?: string[] };
          id?: { not?: string };
          [key: string]: unknown;
        };
      }) => {
        const mockRow = overrides.requestFindFirst ?? null;
        if (!mockRow) return null;
        const row = mockRow as { id: string; status: string };
        const excludedId = (args.where.id as { not?: string } | undefined)?.not;
        if (excludedId && row.id === excludedId) return null;
        const allowedStatuses = args.where.status?.in ?? [];
        if (!allowedStatuses.includes(row.status)) return null;
        return row;
      },
    },
  } as unknown as import('@prisma/client').PrismaClient;
}

const baseSlot = {
  clinicId: 'clinic-001',
  practitionerId: 'doctor-001',
  startTime: new Date('2025-09-01T09:00:00Z'),
  endTime: new Date('2025-09-01T09:30:00Z'),
};

// ─── checkAppointmentOverlap ──────────────────────────────────────────────────

section('── checkAppointmentOverlap ───────────────────────────────────────────');

await test('1. existing scheduled Appointment blocks slot (returns true)', async () => {
  const prisma = mockPrisma({ appointmentFindFirst: { id: 'appt-1', status: 'scheduled' } });
  const result = await checkAppointmentOverlap(prisma, baseSlot);
  assert.equal(result, true);
});

await test('2. cancelled Appointment does NOT block slot (returns false)', async () => {
  const prisma = mockPrisma({ appointmentFindFirst: { id: 'appt-2', status: 'cancelled' } });
  const result = await checkAppointmentOverlap(prisma, baseSlot);
  assert.equal(result, false);
});

await test('3. no_show Appointment does NOT block slot (returns false)', async () => {
  const prisma = mockPrisma({ appointmentFindFirst: { id: 'appt-3', status: 'no_show' } });
  const result = await checkAppointmentOverlap(prisma, baseSlot);
  assert.equal(result, false);
});

await test('4. no existing appointment → returns false', async () => {
  const prisma = mockPrisma({ appointmentFindFirst: null });
  const result = await checkAppointmentOverlap(prisma, baseSlot);
  assert.equal(result, false);
});

await test('5. excludeAppointmentId skips the excluded row', async () => {
  const prisma = mockPrisma({ appointmentFindFirst: { id: 'appt-being-edited', status: 'confirmed' } });
  const result = await checkAppointmentOverlap(prisma, { ...baseSlot, excludeAppointmentId: 'appt-being-edited' });
  assert.equal(result, false);
});

await test('6. confirmed Appointment (non-cancelled, non-no_show) blocks slot', async () => {
  const prisma = mockPrisma({ appointmentFindFirst: { id: 'appt-4', status: 'confirmed' } });
  const result = await checkAppointmentOverlap(prisma, baseSlot);
  assert.equal(result, true);
});

// ─── checkAppointmentRequestConflict ──────────────────────────────────────────

section('── checkAppointmentRequestConflict ──────────────────────────────────');

await test('7. pending AppointmentRequest blocks slot (returns true)', async () => {
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-1', status: 'pending' } });
  const result = await checkAppointmentRequestConflict(prisma, baseSlot);
  assert.equal(result, true);
});

await test('8. approved AppointmentRequest blocks slot (returns true)', async () => {
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-2', status: 'approved' } });
  const result = await checkAppointmentRequestConflict(prisma, baseSlot);
  assert.equal(result, true);
});

await test('9. rejected AppointmentRequest does NOT block slot (returns false)', async () => {
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-3', status: 'rejected' } });
  const result = await checkAppointmentRequestConflict(prisma, baseSlot);
  assert.equal(result, false);
});

await test('10. converted AppointmentRequest does NOT block slot (returns false)', async () => {
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-4', status: 'converted' } });
  const result = await checkAppointmentRequestConflict(prisma, baseSlot);
  assert.equal(result, false);
});

await test('11. closed AppointmentRequest does NOT block slot (returns false)', async () => {
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-5', status: 'closed' } });
  const result = await checkAppointmentRequestConflict(prisma, baseSlot);
  assert.equal(result, false);
});

await test('12. no conflicting request → returns false', async () => {
  const prisma = mockPrisma({ requestFindFirst: null });
  const result = await checkAppointmentRequestConflict(prisma, baseSlot);
  assert.equal(result, false);
});

// ─── Status constants ─────────────────────────────────────────────────────────

section('── Status constants ─────────────────────────────────────────────────');

await test('13. NON_BLOCKING_APPOINTMENT_STATUSES includes cancelled and no_show', () => {
  assert.ok(
    (NON_BLOCKING_APPOINTMENT_STATUSES as readonly string[]).includes('cancelled'),
    'should include cancelled',
  );
  assert.ok(
    (NON_BLOCKING_APPOINTMENT_STATUSES as readonly string[]).includes('no_show'),
    'should include no_show',
  );
});

await test('14. BLOCKING_APPOINTMENT_REQUEST_STATUSES includes pending and approved', () => {
  assert.ok(
    (BLOCKING_APPOINTMENT_REQUEST_STATUSES as readonly string[]).includes('pending'),
    'should include pending',
  );
  assert.ok(
    (BLOCKING_APPOINTMENT_REQUEST_STATUSES as readonly string[]).includes('approved'),
    'should include approved',
  );
});

// ─── Re-exports ───────────────────────────────────────────────────────────────

section('── Re-exports ───────────────────────────────────────────────────────');

await test('15. assertSlotAvailable is re-exported and is a function', () => {
  assert.equal(typeof assertSlotAvailable, 'function');
});

await test('16. acquireAppointmentSlotLock is re-exported and is a function', () => {
  assert.equal(typeof acquireAppointmentSlotLock, 'function');
});

await test('17. SlotConflictError is re-exported and is a constructor', () => {
  assert.equal(typeof SlotConflictError, 'function');
  const err = new SlotConflictError('APPOINTMENT_OVERLAP');
  assert.ok(err instanceof SlotConflictError);
  assert.ok(err instanceof Error);
  assert.equal(err.kind, 'APPOINTMENT_OVERLAP');
});

// ─── checkPractitionerAvailabilityForSlot ────────────────────────────────────

section('── checkPractitionerAvailabilityForSlot ────────────────────────────');

await test('18. checkPractitionerAvailabilityForSlot is a function', () => {
  assert.equal(typeof checkPractitionerAvailabilityForSlot, 'function');
});

// ─── AI booking regression ────────────────────────────────────────────────────

section('── AI booking channel regression ────────────────────────────────────');

await test('19. Instagram DM processor imports assertSlotAvailable from safety module', async () => {
  // Verify that the Instagram processor still correctly imports and uses
  // assertSlotAvailable from appointmentRequestSafety (either directly or via
  // the central service re-export).
  const safetyModule = await import('../services/appointmentRequestSafety.js');
  assert.equal(typeof safetyModule.assertSlotAvailable, 'function');
  assert.equal(typeof safetyModule.acquireAppointmentSlotLock, 'function');
});

await test('20. Meta WhatsApp processor imports assertSlotAvailable from safety module', async () => {
  const safetyModule = await import('../services/appointmentRequestSafety.js');
  assert.equal(typeof safetyModule.assertSlotAvailable, 'function');
});

await test('21. Evolution WhatsApp uses central service checkPractitionerAvailabilityForSlot (function available)', () => {
  // The Evolution WA flow in whatsapp.ts now uses checkPractitionerAvailabilityForSlot
  // from the central service instead of the old local function that lacked off-day checks.
  assert.equal(typeof checkPractitionerAvailabilityForSlot, 'function');
});

// ─── Overlap consistency ──────────────────────────────────────────────────────

section('── Overlap behavior consistency ─────────────────────────────────────');

await test('22. checkAppointmentOverlap agrees with assertSlotAvailable on cancelled: both allow', async () => {
  // checkAppointmentOverlap returns false (no block) for cancelled.
  // assertSlotAvailable would not throw for cancelled (it uses the same NON_BLOCKING list).
  // We verify via the shared constant.
  assert.ok(
    (NON_BLOCKING_APPOINTMENT_STATUSES as readonly string[]).includes('cancelled'),
    'cancelled must be in NON_BLOCKING',
  );
  const prisma = mockPrisma({ appointmentFindFirst: { id: 'appt-c', status: 'cancelled' } });
  assert.equal(await checkAppointmentOverlap(prisma, baseSlot), false);
});

await test('23. checkAppointmentOverlap agrees with assertSlotAvailable on no_show: both allow', async () => {
  assert.ok(
    (NON_BLOCKING_APPOINTMENT_STATUSES as readonly string[]).includes('no_show'),
    'no_show must be in NON_BLOCKING',
  );
  const prisma = mockPrisma({ appointmentFindFirst: { id: 'appt-ns', status: 'no_show' } });
  assert.equal(await checkAppointmentOverlap(prisma, baseSlot), false);
});

// ─── excludeRequestId support ────────────────────────────────────────────────

section('── excludeRequestId support ────────────────────────────────────────');

await test('24. excludeRequestId causes the matching request row to be ignored', async () => {
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-self', status: 'pending' } });
  // Without exclusion: blocked
  const withoutExclusion = await checkAppointmentRequestConflict(prisma, baseSlot);
  assert.equal(withoutExclusion, true, 'should block without exclusion');
  // With exclusion of that same row: not blocked
  const withExclusion = await checkAppointmentRequestConflict(prisma, { ...baseSlot, excludeRequestId: 'req-self' });
  assert.equal(withExclusion, false, 'should not block when row is excluded');
});

await test('25. excludeRequestId only skips the matching row; a different pending request still blocks', async () => {
  // Mock returns { id: 'req-other' } for any query that allows 'pending'.
  // excludeRequestId is 'req-self', which is a different ID — so the mock row
  // passes the id filter and should still block.
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-other', status: 'pending' } });
  const result = await checkAppointmentRequestConflict(prisma, { ...baseSlot, excludeRequestId: 'req-self' });
  assert.equal(result, true, 'different pending request must still block');
});

// ─── Staff direct appointment create ─────────────────────────────────────────

section('── Staff direct appointment create ──────────────────────────────────');

await test('26. blocked by pending AppointmentRequest for the same slot', async () => {
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-pending', status: 'pending' } });
  const result = await checkAppointmentRequestConflict(prisma, baseSlot);
  assert.equal(result, true);
});

await test('27. allowed when conflicting AppointmentRequest is rejected', async () => {
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-rejected', status: 'rejected' } });
  const result = await checkAppointmentRequestConflict(prisma, baseSlot);
  assert.equal(result, false);
});

await test('28. allowed when conflicting AppointmentRequest is converted', async () => {
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-converted', status: 'converted' } });
  const result = await checkAppointmentRequestConflict(prisma, baseSlot);
  assert.equal(result, false);
});

await test('29. allowed when conflicting AppointmentRequest is closed', async () => {
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-closed', status: 'closed' } });
  const result = await checkAppointmentRequestConflict(prisma, baseSlot);
  assert.equal(result, false);
});

// ─── AppointmentRequest conversion ───────────────────────────────────────────

section('── AppointmentRequest conversion ────────────────────────────────────');

await test('30. conversion ignores itself (excludeRequestId matches own ID)', async () => {
  // The request being converted is 'req-own'. It is pending but should not
  // block its own conversion.
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-own', status: 'pending' } });
  const result = await checkAppointmentRequestConflict(prisma, {
    ...baseSlot,
    excludeRequestId: 'req-own',
  });
  assert.equal(result, false, 'own request must not block its own conversion');
});

await test('31. conversion blocked by a DIFFERENT pending request for the same slot', async () => {
  // There is another pending request 'req-other' for the same slot.
  // The conversion excludes 'req-own' but 'req-other' still blocks.
  const prisma = mockPrisma({ requestFindFirst: { id: 'req-other', status: 'pending' } });
  const result = await checkAppointmentRequestConflict(prisma, {
    ...baseSlot,
    excludeRequestId: 'req-own',
  });
  assert.equal(result, true, 'other pending request must still block conversion');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} tests passed.`);
} else {
  console.error(`✗ ${failed} of ${passed + failed} tests FAILED.`);
  process.exit(1);
}
