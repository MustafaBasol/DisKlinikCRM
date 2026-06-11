/**
 * appointmentRequestOverlapSafety.test.ts
 *
 * Unit tests for the concurrency-safe appointment request creation helpers.
 *
 * Run with:  tsx src/tests/appointmentRequestOverlapSafety.test.ts
 * No external test framework — uses node:assert/strict.
 *
 * Test coverage:
 *  ── SlotConflictError ──────────────────────────────────────────────────────
 *   1. kind/message/instanceof for each kind value
 *   2. Backward compat: error.message === kind (callers checking .message still work)
 *
 *  ── Status constants ───────────────────────────────────────────────────────
 *   3. BLOCKING statuses include pending + approved
 *   4. NON_BLOCKING statuses include cancelled + no_show
 *
 *  ── computeSlotLockKey ─────────────────────────────────────────────────────
 *   5. Same inputs → same key pair (deterministic)
 *   6. Different practitionerId → different key
 *   7. Different startTime → different key
 *   8. Different clinicId → different key
 *   9. null practitionerId → deterministic (uses 'null' string)
 *  10. null and non-null practitionerId → different keys
 *
 *  ── acquireAppointmentSlotLock ─────────────────────────────────────────────
 *  11. Calls $executeRaw with the deterministic key pair
 *  12. Same slot maps to same $executeRaw arguments
 *  13. Different slot maps to different $executeRaw arguments
 *
 *  ── Call order: lock → assertSlotAvailable ─────────────────────────────────
 *  14. Lock acquired before appointment.findFirst in combined flow
 *  15. Lock acquired before appointmentRequest.findFirst in combined flow
 *
 *  ── assertSlotAvailable ────────────────────────────────────────────────────
 *  16. Resolves when no conflicts
 *  17. Throws APPOINTMENT_OVERLAP for existing non-cancelled Appointment
 *  18. Throws APPOINTMENT_REQUEST_CONFLICT for pending AppointmentRequest
 *  19. No throw when appointment overlap is null (cancelled/no_show excluded)
 *  20. No throw when request conflict is null (rejected/converted excluded)
 *  21. APPOINTMENT_OVERLAP takes priority over request conflict
 *
 *  ── Status semantics ───────────────────────────────────────────────────────
 *  22. cancelled Appointment: DB query returns null → no block
 *  23. rejected AppointmentRequest: DB query returns null → no block
 *
 *  ── Deterministic concurrent duplicate simulation ──────────────────────────
 *  24. Instagram: second call detects conflict after first committed
 *  25. Meta WhatsApp: same
 *  26. Evolution WhatsApp: same
 *  27. Existing Appointment blocks AppointmentRequest for same slot
 *
 * Concurrency limitation:
 *   True parallel DB race tests require a live PostgreSQL instance with
 *   parallel connections. These tests verify:
 *   - computeSlotLockKey produces the correct deterministic key
 *   - acquireAppointmentSlotLock calls $executeRaw with that key
 *   - lock is acquired BEFORE assertSlotAvailable checks
 *   The actual serialization guarantee is enforced by PostgreSQL's
 *   pg_advisory_xact_lock blocking the second transaction until the first
 *   commits or rolls back.
 */

import assert from 'node:assert/strict';

// ─── Test harness ──────────────────────────────────────────────────────────────

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
  assertSlotAvailable,
  acquireAppointmentSlotLock,
  computeSlotLockKey,
  SlotConflictError,
  BLOCKING_APPOINTMENT_REQUEST_STATUSES,
  NON_BLOCKING_APPOINTMENT_STATUSES,
} from '../services/appointmentRequestSafety.js';
import type { Prisma } from '@prisma/client';

// ─── Mock transaction client builders ─────────────────────────────────────────

/**
 * Minimal mock for assertSlotAvailable tests.
 * appointment.findFirst and appointmentRequest.findFirst only.
 * $executeRaw is a no-op (not called by assertSlotAvailable directly).
 */
function makeMockTx(opts: {
  appointmentOverlap?: { id: string } | null;
  requestConflict?: { id: string } | null;
}): Prisma.TransactionClient {
  return {
    appointment: {
      findFirst: async () => opts.appointmentOverlap ?? null,
    },
    appointmentRequest: {
      findFirst: async () => opts.requestConflict ?? null,
    },
    $executeRaw: async (..._args: unknown[]) => 0,
  } as unknown as Prisma.TransactionClient;
}

/**
 * Mock that records the order of all significant DB calls.
 * Used to verify: lock → appointment.findFirst → appointmentRequest.findFirst.
 */
function makeMockTxWithCallOrder(opts: {
  callOrder: string[];
  executeRawArgs?: unknown[][];
  appointmentOverlap?: { id: string } | null;
  requestConflict?: { id: string } | null;
}): Prisma.TransactionClient {
  return {
    appointment: {
      findFirst: async () => {
        opts.callOrder.push('appointment.findFirst');
        return opts.appointmentOverlap ?? null;
      },
    },
    appointmentRequest: {
      findFirst: async () => {
        opts.callOrder.push('appointmentRequest.findFirst');
        return opts.requestConflict ?? null;
      },
    },
    $executeRaw: (...args: unknown[]) => {
      opts.callOrder.push('$executeRaw');
      opts.executeRawArgs?.push(args);
      return Promise.resolve(0);
    },
  } as unknown as Prisma.TransactionClient;
}

const BASE_ARGS = {
  clinicId: 'clinic-test-1',
  practitionerId: 'practitioner-test-1',
  startTime: new Date('2026-06-15T09:00:00Z'),
  endTime: new Date('2026-06-15T10:00:00Z'),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {
  // ── SlotConflictError ──────────────────────────────────────────────────────
  section('SlotConflictError');

  await test('kind is set correctly for APPOINTMENT_OVERLAP', () => {
    const e = new SlotConflictError('APPOINTMENT_OVERLAP');
    assert.equal(e.kind, 'APPOINTMENT_OVERLAP');
    assert.equal(e.message, 'APPOINTMENT_OVERLAP');
    assert.equal(e.name, 'SlotConflictError');
    assert.ok(e instanceof Error);
  });

  await test('kind is set correctly for APPOINTMENT_REQUEST_CONFLICT', () => {
    const e = new SlotConflictError('APPOINTMENT_REQUEST_CONFLICT');
    assert.equal(e.kind, 'APPOINTMENT_REQUEST_CONFLICT');
    assert.equal(e.message, 'APPOINTMENT_REQUEST_CONFLICT');
  });

  await test('kind is set correctly for APPOINTMENT_OUTSIDE_AVAILABILITY', () => {
    const e = new SlotConflictError('APPOINTMENT_OUTSIDE_AVAILABILITY');
    assert.equal(e.kind, 'APPOINTMENT_OUTSIDE_AVAILABILITY');
    assert.equal(e.message, 'APPOINTMENT_OUTSIDE_AVAILABILITY');
  });

  await test('backward compat: error.message === kind (callers using .message still work)', () => {
    const e = new SlotConflictError('APPOINTMENT_OVERLAP');
    // Existing callers check: error.message === 'APPOINTMENT_OVERLAP'
    assert.equal(e.message, 'APPOINTMENT_OVERLAP');
    assert.ok(e instanceof SlotConflictError);
  });

  // ── Status constants ───────────────────────────────────────────────────────
  section('Status constants');

  await test('BLOCKING_APPOINTMENT_REQUEST_STATUSES contains pending and approved', () => {
    assert.ok(BLOCKING_APPOINTMENT_REQUEST_STATUSES.includes('pending'));
    assert.ok(BLOCKING_APPOINTMENT_REQUEST_STATUSES.includes('approved'));
    assert.equal(BLOCKING_APPOINTMENT_REQUEST_STATUSES.length, 2);
  });

  await test('NON_BLOCKING_APPOINTMENT_STATUSES contains cancelled and no_show', () => {
    assert.ok(NON_BLOCKING_APPOINTMENT_STATUSES.includes('cancelled'));
    assert.ok(NON_BLOCKING_APPOINTMENT_STATUSES.includes('no_show'));
    assert.equal(NON_BLOCKING_APPOINTMENT_STATUSES.length, 2);
  });

  // ── computeSlotLockKey ────────────────────────────────────────────────────
  section('computeSlotLockKey — determinism and collision avoidance');

  await test('same inputs produce same key pair (deterministic)', () => {
    const clinicId = 'clinic-lock-1';
    const practitionerId = 'prac-lock-1';
    const startTime = new Date('2026-06-15T09:00:00Z');

    const [k1a, k2a] = computeSlotLockKey(clinicId, practitionerId, startTime);
    const [k1b, k2b] = computeSlotLockKey(clinicId, practitionerId, startTime);

    assert.equal(k1a, k1b, 'key1 must be stable');
    assert.equal(k2a, k2b, 'key2 must be stable');
  });

  await test('different practitionerId produces different key pair', () => {
    const clinicId = 'clinic-lock-1';
    const startTime = new Date('2026-06-15T09:00:00Z');

    const [k1a, k2a] = computeSlotLockKey(clinicId, 'prac-A', startTime);
    const [k1b, k2b] = computeSlotLockKey(clinicId, 'prac-B', startTime);

    assert.ok(k1a !== k1b || k2a !== k2b, 'different practitionerId must yield different key pair');
  });

  await test('different startTime produces different key pair', () => {
    const clinicId = 'clinic-lock-1';
    const practitionerId = 'prac-lock-1';

    const [k1a, k2a] = computeSlotLockKey(clinicId, practitionerId, new Date('2026-06-15T09:00:00Z'));
    const [k1b, k2b] = computeSlotLockKey(clinicId, practitionerId, new Date('2026-06-15T10:00:00Z'));

    assert.ok(k1a !== k1b || k2a !== k2b, 'different startTime must yield different key pair');
  });

  await test('different clinicId produces different key pair', () => {
    const practitionerId = 'prac-lock-1';
    const startTime = new Date('2026-06-15T09:00:00Z');

    const [k1a, k2a] = computeSlotLockKey('clinic-A', practitionerId, startTime);
    const [k1b, k2b] = computeSlotLockKey('clinic-B', practitionerId, startTime);

    assert.ok(k1a !== k1b || k2a !== k2b, 'different clinicId must yield different key pair');
  });

  await test('null practitionerId is deterministic (does not change on re-call)', () => {
    const clinicId = 'clinic-lock-1';
    const startTime = new Date('2026-06-15T09:00:00Z');

    const [k1a, k2a] = computeSlotLockKey(clinicId, null, startTime);
    const [k1b, k2b] = computeSlotLockKey(clinicId, null, startTime);

    assert.equal(k1a, k1b, 'null practitionerId: key1 must be stable');
    assert.equal(k2a, k2b, 'null practitionerId: key2 must be stable');
  });

  await test('null and non-null practitionerId produce different keys', () => {
    const clinicId = 'clinic-lock-1';
    const startTime = new Date('2026-06-15T09:00:00Z');

    const [k1a, k2a] = computeSlotLockKey(clinicId, null, startTime);
    const [k1b, k2b] = computeSlotLockKey(clinicId, 'prac-lock-1', startTime);

    assert.ok(k1a !== k1b || k2a !== k2b, 'null vs non-null practitionerId must differ');
  });

  await test('key values are valid PostgreSQL int4 range', () => {
    const [key1, key2] = computeSlotLockKey('clinic-lock-1', 'prac-lock-1', new Date('2026-06-15T09:00:00Z'));
    const MIN_INT4 = -2147483648;
    const MAX_INT4 = 2147483647;
    assert.ok(key1 >= MIN_INT4 && key1 <= MAX_INT4, `key1=${key1} must be in int4 range`);
    assert.ok(key2 >= MIN_INT4 && key2 <= MAX_INT4, `key2=${key2} must be in int4 range`);
  });

  // ── acquireAppointmentSlotLock ────────────────────────────────────────────
  section('acquireAppointmentSlotLock — $executeRaw call verification');

  await test('calls $executeRaw with the key pair from computeSlotLockKey', async () => {
    const clinicId = 'clinic-lock-1';
    const practitionerId = 'prac-lock-1';
    const startTime = new Date('2026-06-15T09:00:00Z');

    let rawCalled = false;
    const capturedArgs: unknown[] = [];

    const mockTx = {
      $executeRaw: (...args: unknown[]) => {
        rawCalled = true;
        capturedArgs.push(...args);
        return Promise.resolve(0);
      },
    } as unknown as Prisma.TransactionClient;

    await acquireAppointmentSlotLock(mockTx, { clinicId, practitionerId, startTime });

    assert.ok(rawCalled, '$executeRaw must be called');
    // capturedArgs[0] is TemplateStringsArray, [1] and [2] are key1 and key2
    const [key1, key2] = computeSlotLockKey(clinicId, practitionerId, startTime);
    assert.equal(capturedArgs[1], key1, 'key1 passed to $executeRaw matches computeSlotLockKey');
    assert.equal(capturedArgs[2], key2, 'key2 passed to $executeRaw matches computeSlotLockKey');
  });

  await test('same slot maps to same $executeRaw arguments on repeated calls', async () => {
    const clinicId = 'clinic-lock-2';
    const practitionerId = 'prac-lock-2';
    const startTime = new Date('2026-06-20T14:00:00Z');

    const calls: unknown[][] = [];
    const mockTx = {
      $executeRaw: (...args: unknown[]) => {
        calls.push([...args]);
        return Promise.resolve(0);
      },
    } as unknown as Prisma.TransactionClient;

    await acquireAppointmentSlotLock(mockTx, { clinicId, practitionerId, startTime });
    await acquireAppointmentSlotLock(mockTx, { clinicId, practitionerId, startTime });

    assert.equal(calls.length, 2, 'two calls made');
    assert.equal(calls[0][1], calls[1][1], 'key1 is same on both calls');
    assert.equal(calls[0][2], calls[1][2], 'key2 is same on both calls');
  });

  await test('different slots produce different $executeRaw arguments', async () => {
    const clinicId = 'clinic-lock-3';
    const calls: unknown[][] = [];
    const mockTx = {
      $executeRaw: (...args: unknown[]) => {
        calls.push([...args]);
        return Promise.resolve(0);
      },
    } as unknown as Prisma.TransactionClient;

    await acquireAppointmentSlotLock(mockTx, { clinicId, practitionerId: 'prac-X', startTime: new Date('2026-06-15T09:00:00Z') });
    await acquireAppointmentSlotLock(mockTx, { clinicId, practitionerId: 'prac-X', startTime: new Date('2026-06-15T10:00:00Z') });

    assert.ok(calls[0][1] !== calls[1][1] || calls[0][2] !== calls[1][2], 'different slots produce different key pairs');
  });

  // ── Call order: lock → assertSlotAvailable ────────────────────────────────
  section('Call order: acquireAppointmentSlotLock → assertSlotAvailable');

  await test('lock ($executeRaw) is called BEFORE appointment.findFirst', async () => {
    const callOrder: string[] = [];
    const mockTx = makeMockTxWithCallOrder({ callOrder });

    await acquireAppointmentSlotLock(mockTx, {
      clinicId: 'clinic-order-1',
      practitionerId: 'prac-order-1',
      startTime: new Date('2026-06-15T09:00:00Z'),
    });
    await assertSlotAvailable(mockTx, {
      clinicId: 'clinic-order-1',
      practitionerId: 'prac-order-1',
      startTime: new Date('2026-06-15T09:00:00Z'),
      endTime: new Date('2026-06-15T10:00:00Z'),
    });

    assert.equal(callOrder[0], '$executeRaw', '1st call must be the advisory lock');
    assert.equal(callOrder[1], 'appointment.findFirst', '2nd call must be appointment overlap check');
    assert.equal(callOrder[2], 'appointmentRequest.findFirst', '3rd call must be request conflict check');
  });

  await test('lock is acquired before appointmentRequest.findFirst in combined flow', async () => {
    const callOrder: string[] = [];
    const mockTx = makeMockTxWithCallOrder({ callOrder });

    await acquireAppointmentSlotLock(mockTx, {
      clinicId: 'clinic-order-2',
      practitionerId: 'prac-order-2',
      startTime: new Date('2026-06-16T11:00:00Z'),
    });
    await assertSlotAvailable(mockTx, {
      clinicId: 'clinic-order-2',
      practitionerId: 'prac-order-2',
      startTime: new Date('2026-06-16T11:00:00Z'),
      endTime: new Date('2026-06-16T12:00:00Z'),
    });

    const lockIdx = callOrder.indexOf('$executeRaw');
    const reqIdx = callOrder.indexOf('appointmentRequest.findFirst');
    assert.ok(lockIdx < reqIdx, `lock (pos ${lockIdx}) must precede appointmentRequest.findFirst (pos ${reqIdx})`);
  });

  // ── assertSlotAvailable: no conflict ──────────────────────────────────────
  section('assertSlotAvailable — no conflict');

  await test('resolves when no Appointment and no AppointmentRequest conflict', async () => {
    const tx = makeMockTx({ appointmentOverlap: null, requestConflict: null });
    // Should not throw
    await assert.doesNotReject(() => assertSlotAvailable(tx, BASE_ARGS));
  });

  // ── assertSlotAvailable: Appointment overlap ───────────────────────────────
  section('assertSlotAvailable — Appointment overlap');

  await test('throws APPOINTMENT_OVERLAP when a non-cancelled Appointment exists', async () => {
    const tx = makeMockTx({ appointmentOverlap: { id: 'appt-1' }, requestConflict: null });
    await assert.rejects(
      () => assertSlotAvailable(tx, BASE_ARGS),
      (err: unknown) => {
        assert.ok(err instanceof SlotConflictError);
        assert.equal(err.kind, 'APPOINTMENT_OVERLAP');
        return true;
      },
    );
  });

  await test('does NOT throw when Appointment overlap is null (simulating cancelled/no_show excluded by query)', async () => {
    // The DB query filters out cancelled/no_show rows via status: { notIn: [...] }.
    // Here we simulate that the DB returned null (no matching non-cancelled appointment).
    const tx = makeMockTx({ appointmentOverlap: null, requestConflict: null });
    await assert.doesNotReject(() => assertSlotAvailable(tx, BASE_ARGS));
  });

  // ── assertSlotAvailable: AppointmentRequest conflict ──────────────────────
  section('assertSlotAvailable — AppointmentRequest conflict');

  await test('throws APPOINTMENT_REQUEST_CONFLICT when a pending AppointmentRequest exists', async () => {
    const tx = makeMockTx({ appointmentOverlap: null, requestConflict: { id: 'req-1' } });
    await assert.rejects(
      () => assertSlotAvailable(tx, BASE_ARGS),
      (err: unknown) => {
        assert.ok(err instanceof SlotConflictError);
        assert.equal(err.kind, 'APPOINTMENT_REQUEST_CONFLICT');
        return true;
      },
    );
  });

  await test('does NOT throw when AppointmentRequest conflict is null (rejected/converted/closed excluded by query)', async () => {
    // The DB query only matches status IN ['pending', 'approved'].
    // Rejected, converted, and closed rows are excluded, so findFirst returns null.
    const tx = makeMockTx({ appointmentOverlap: null, requestConflict: null });
    await assert.doesNotReject(() => assertSlotAvailable(tx, BASE_ARGS));
  });

  // ── assertSlotAvailable: Appointment blocks before AppointmentRequest check
  section('assertSlotAvailable — Appointment overlap takes priority');

  await test('throws APPOINTMENT_OVERLAP even when a request conflict also exists (checks in order)', async () => {
    const tx = makeMockTx({ appointmentOverlap: { id: 'appt-2' }, requestConflict: { id: 'req-2' } });
    await assert.rejects(
      () => assertSlotAvailable(tx, BASE_ARGS),
      (err: unknown) => {
        assert.ok(err instanceof SlotConflictError);
        // Appointment check runs first, so kind should be APPOINTMENT_OVERLAP
        assert.equal(err.kind, 'APPOINTMENT_OVERLAP');
        return true;
      },
    );
  });

  // ── Channel-specific behavior: cancelled/non-blocking statuses ─────────────
  section('Status semantics: non-blocking statuses do not block slot');

  await test('cancelled Appointment: DB query returns null, no error thrown', async () => {
    // The assertSlotAvailable query filters status: { notIn: ['cancelled', 'no_show'] }.
    // A cancelled appointment would not be returned by findFirst → null → no throw.
    const tx = makeMockTx({ appointmentOverlap: null, requestConflict: null });
    await assert.doesNotReject(() => assertSlotAvailable(tx, BASE_ARGS));
  });

  await test('rejected AppointmentRequest: DB query returns null, no error thrown', async () => {
    // The query filters status: { in: ['pending', 'approved'] }.
    // A rejected request is not in that set → findFirst returns null → no throw.
    const tx = makeMockTx({ appointmentOverlap: null, requestConflict: null });
    await assert.doesNotReject(() => assertSlotAvailable(tx, BASE_ARGS));
  });

  // ── Deterministic concurrent duplicate simulation ──────────────────────────
  section('Deterministic concurrent duplicate simulation');

  await test('Instagram: second call detects conflict after first committed', async () => {
    // Simulates: two Instagram messages arrive for the same slot nearly simultaneously.
    // The first call finds no conflict and would create the record.
    // The second call (simulating the committed state) finds the first record and throws.

    let callCount = 0;
    const mockTx = {
      appointment: {
        findFirst: async () => null, // No existing Appointment in either call
      },
      appointmentRequest: {
        findFirst: async () => {
          callCount++;
          // First call: no conflict yet (race condition window)
          // Second call: first record now exists in DB
          return callCount >= 2 ? { id: 'req-instagram-first' } : null;
        },
      },
    } as unknown as Prisma.TransactionClient;

    // First call: no conflict, would proceed to create
    await assert.doesNotReject(() => assertSlotAvailable(mockTx, BASE_ARGS));

    // Second call: finds the first request — throws APPOINTMENT_REQUEST_CONFLICT
    await assert.rejects(
      () => assertSlotAvailable(mockTx, BASE_ARGS),
      (err: unknown) => {
        assert.ok(err instanceof SlotConflictError);
        assert.equal(err.kind, 'APPOINTMENT_REQUEST_CONFLICT');
        return true;
      },
    );
  });

  await test('Meta WhatsApp: second call detects conflict after first committed', async () => {
    let callCount = 0;
    const mockTx = {
      appointment: { findFirst: async () => null },
      appointmentRequest: {
        findFirst: async () => {
          callCount++;
          return callCount >= 2 ? { id: 'req-meta-first' } : null;
        },
      },
    } as unknown as Prisma.TransactionClient;

    await assert.doesNotReject(() => assertSlotAvailable(mockTx, BASE_ARGS));
    await assert.rejects(
      () => assertSlotAvailable(mockTx, BASE_ARGS),
      (err: unknown) => {
        assert.ok(err instanceof SlotConflictError);
        assert.equal(err.kind, 'APPOINTMENT_REQUEST_CONFLICT');
        return true;
      },
    );
  });

  await test('Evolution WhatsApp: second call detects conflict after first committed', async () => {
    let callCount = 0;
    const mockTx = {
      appointment: { findFirst: async () => null },
      appointmentRequest: {
        findFirst: async () => {
          callCount++;
          return callCount >= 2 ? { id: 'req-evo-first' } : null;
        },
      },
    } as unknown as Prisma.TransactionClient;

    await assert.doesNotReject(() => assertSlotAvailable(mockTx, BASE_ARGS));
    await assert.rejects(
      () => assertSlotAvailable(mockTx, BASE_ARGS),
      (err: unknown) => {
        assert.ok(err instanceof SlotConflictError);
        assert.equal(err.kind, 'APPOINTMENT_REQUEST_CONFLICT');
        return true;
      },
    );
  });

  await test('existing Appointment blocks AppointmentRequest for same slot', async () => {
    // A converted/confirmed appointment already exists → new request should be blocked.
    const tx = makeMockTx({ appointmentOverlap: { id: 'appt-confirmed-1' }, requestConflict: null });
    await assert.rejects(
      () => assertSlotAvailable(tx, BASE_ARGS),
      (err: unknown) => {
        assert.ok(err instanceof SlotConflictError);
        assert.equal(err.kind, 'APPOINTMENT_OVERLAP');
        return true;
      },
    );
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Unexpected test runner error:', err);
  process.exit(1);
});
