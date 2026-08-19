/**
 * patientIdentityUxFieldValidation.test.ts — F3-DATA-MIG-TODAY-001-UI-001
 *
 * Koşturma: cd server && npx tsx src/tests/patientIdentityUxFieldValidation.test.ts
 *
 * Scope: the Patient create/edit/detail UI alignment for gender, chartNumber
 * and primaryPractitionerId (server/src/schemas/index.ts, server/src/routes/patients.ts).
 * This suite does NOT touch identity documents / TCKN — no clinic-facing
 * create/update/read endpoint for PatientIdentityDocument exists yet (see
 * docs/program/NORAMEDI_MASTER_TRACKER.md, F3-DATA-MIG-TODAY-001-UI-001 entry),
 * so there is nothing to test there.
 *
 * validatePrimaryPractitioner() is imported directly from the real route
 * module (server/src/routes/patients.ts) and exercised against a mocked
 * prisma.user.findFirst — the same "call the real function, mock only the DB
 * edge" convention used by patientEmergencyContacts.test.ts. No live database
 * is used (Docker on this machine may be occupied by a concurrent hotfix
 * container — see docs/program/NORAMEDI_MASTER_TRACKER.md
 * F3-DATA-MIG-TODAY-001-PROD-001-R1 — so this suite deliberately avoids
 * touching any Postgres instance).
 *
 * Covers:
 *  1.  patientSchema/patientUpdateSchema accept gender/chartNumber/primaryPractitionerId
 *  2.  gender rejects values outside male|female|other
 *  3.  chartNumber/gender/primaryPractitionerId normalize '' -> null
 *  4.  chartNumber is trimmed
 *  5.  A client-supplied tcNo/tckn field is silently stripped (never reaches Prisma)
 *  6.  validatePrimaryPractitioner: no id -> valid, DB not queried
 *  7.  validatePrimaryPractitioner: id resolves in-clinic, active, role=doctor -> valid
 *  8.  validatePrimaryPractitioner: cross-clinic id -> rejected (query scoped by clinicId)
 *  9.  validatePrimaryPractitioner: inactive / non-doctor id -> rejected
 *  10. validatePrimaryPractitioner query always includes role:'doctor' + isActive:true + the caller's clinicId
 *  11. patientListSelect (BILLING's restricted GET /patients/:id shape) still excludes
 *      gender/chartNumber/primaryPractitionerId and any identity field (regression —
 *      BILLING must not gain administrative/demographic fields through this change)
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import { patientSchema, patientUpdateSchema, patientGenderValues } from '../schemas/index.js';
import { patientListSelect } from '../utils/prismaSelects.js';
import { validatePrimaryPractitioner } from '../routes/patients.js';

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

const validBase = { firstName: 'Test', lastName: 'Patient' };

// ---------------------------------------------------------------------------
section('=== Zod schema: gender / chartNumber / primaryPractitionerId ===');
// ---------------------------------------------------------------------------

await test('patientGenderValues is exactly male|female|other', () => {
  assert.deepEqual([...patientGenderValues].sort(), ['female', 'male', 'other']);
});

await test('patientSchema accepts each allowed gender value', () => {
  for (const g of patientGenderValues) {
    const result = patientSchema.safeParse({ ...validBase, gender: g });
    assert.equal(result.success, true, `gender=${g} should be accepted`);
    if (result.success) assert.equal(result.data.gender, g);
  }
});

await test('patientSchema rejects an out-of-vocabulary gender', () => {
  const result = patientSchema.safeParse({ ...validBase, gender: 'unknown' });
  assert.equal(result.success, false);
});

await test('patientSchema normalizes gender "" to null (not "other")', () => {
  const result = patientSchema.safeParse({ ...validBase, gender: '' });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.gender, null);
});

await test('patientSchema omitting gender leaves it undefined (partial update semantics preserved on create too)', () => {
  const result = patientSchema.safeParse({ ...validBase });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.gender, undefined);
});

await test('patientSchema trims chartNumber and normalizes blank/whitespace to null', () => {
  const trimmed = patientSchema.safeParse({ ...validBase, chartNumber: '  10423  ' });
  assert.equal(trimmed.success, true);
  if (trimmed.success) assert.equal(trimmed.data.chartNumber, '10423');

  const blank = patientSchema.safeParse({ ...validBase, chartNumber: '   ' });
  assert.equal(blank.success, true);
  if (blank.success) assert.equal(blank.data.chartNumber, null);
});

await test('patientSchema accepts a well-formed primaryPractitionerId UUID and normalizes "" to null', () => {
  const uuid = randomUUID();
  const withId = patientSchema.safeParse({ ...validBase, primaryPractitionerId: uuid });
  assert.equal(withId.success, true);
  if (withId.success) assert.equal(withId.data.primaryPractitionerId, uuid);

  const blank = patientSchema.safeParse({ ...validBase, primaryPractitionerId: '' });
  assert.equal(blank.success, true);
  if (blank.success) assert.equal(blank.data.primaryPractitionerId, null);
});

await test('patientSchema rejects a non-UUID primaryPractitionerId', () => {
  const result = patientSchema.safeParse({ ...validBase, primaryPractitionerId: 'not-a-uuid' });
  assert.equal(result.success, false);
});

await test('patientUpdateSchema (.partial()) allows a bare primaryPractitionerId-only patch', () => {
  const result = patientUpdateSchema.safeParse({ primaryPractitionerId: null });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.primaryPractitionerId, null);
});

await test('a client-supplied tcNo/tckn field is silently stripped, never reaches Prisma', () => {
  const result = patientSchema.safeParse({ ...validBase, tcNo: '12345678901', tckn: '12345678901' });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal('tcNo' in result.data, false);
    assert.equal('tckn' in result.data, false);
  }
});

// ---------------------------------------------------------------------------
section('=== validatePrimaryPractitioner: tenant + role + active scoping ===');
// ---------------------------------------------------------------------------

type FindFirstArgs = { where: Record<string, unknown> };
const originalFindFirst = prisma.user.findFirst;

async function withMockedFindFirst<T>(
  mock: (args: FindFirstArgs) => Promise<{ id: string } | null>,
  fn: () => Promise<T>,
): Promise<T> {
  let callCount = 0;
  (prisma.user as any).findFirst = async (args: FindFirstArgs) => {
    callCount++;
    return mock(args);
  };
  try {
    return await fn();
  } finally {
    (prisma.user as any).findFirst = originalFindFirst;
    void callCount;
  }
}

await test('no primaryPractitionerId (undefined) -> valid, DB not queried', async () => {
  let called = false;
  await withMockedFindFirst(
    async () => { called = true; return null; },
    async () => {
      const result = await validatePrimaryPractitioner(undefined, 'clinic-a');
      assert.equal(result, null);
    },
  );
  assert.equal(called, false, 'findFirst must not be called when no practitioner id is supplied');
});

await test('primaryPractitionerId explicitly null (unassigning) -> valid, DB not queried', async () => {
  let called = false;
  await withMockedFindFirst(
    async () => { called = true; return null; },
    async () => {
      const result = await validatePrimaryPractitioner(null, 'clinic-a');
      assert.equal(result, null);
    },
  );
  assert.equal(called, false);
});

await test('same-clinic active doctor -> valid', async () => {
  const practitionerId = randomUUID();
  await withMockedFindFirst(
    async (args) => {
      assert.equal(args.where.id, practitionerId);
      assert.equal(args.where.clinicId, 'clinic-a');
      return { id: practitionerId };
    },
    async () => {
      const result = await validatePrimaryPractitioner(practitionerId, 'clinic-a');
      assert.equal(result, null);
    },
  );
});

await test('every lookup is scoped by role:"doctor", isActive:true, and the CALLER-supplied clinicId', async () => {
  const practitionerId = randomUUID();
  let capturedWhere: Record<string, unknown> | undefined;
  await withMockedFindFirst(
    async (args) => { capturedWhere = args.where; return { id: practitionerId }; },
    async () => { await validatePrimaryPractitioner(practitionerId, 'clinic-target'); },
  );
  assert.equal(capturedWhere?.role, 'doctor');
  assert.equal(capturedWhere?.isActive, true);
  assert.equal(capturedWhere?.clinicId, 'clinic-target');
});

await test('a practitioner that exists but not in this clinic -> rejected (sibling-clinic denial)', async () => {
  // Simulates the real DB behaviour: the practitioner row exists, but the
  // clinicId in `where` does not match it, so findFirst legitimately returns
  // null — the same outcome a cross-clinic/cross-tenant lookup produces.
  const practitionerId = randomUUID();
  const result = await withMockedFindFirst(
    async () => null,
    async () => validatePrimaryPractitioner(practitionerId, 'clinic-b'),
  );
  assert.notEqual(result, null);
  assert.equal((result as any).error.primaryPractitionerId._errors.length > 0, true);
});

await test('an inactive practitioner id -> rejected', async () => {
  const practitionerId = randomUUID();
  const result = await withMockedFindFirst(
    async () => null, // isActive:true in the where clause excludes it
    async () => validatePrimaryPractitioner(practitionerId, 'clinic-a'),
  );
  assert.notEqual(result, null);
});

await test('a non-doctor user id (e.g. a receptionist) -> rejected', async () => {
  const userId = randomUUID();
  const result = await withMockedFindFirst(
    async () => null, // role:'doctor' in the where clause excludes it
    async () => validatePrimaryPractitioner(userId, 'clinic-a'),
  );
  assert.notEqual(result, null);
});

await test('rejection response shape matches the zod .format() convention consumed by the frontend', async () => {
  const result = await withMockedFindFirst(
    async () => null,
    async () => validatePrimaryPractitioner(randomUUID(), 'clinic-a'),
  );
  assert.deepEqual(Object.keys((result as any).error), ['primaryPractitionerId']);
  assert.equal(Array.isArray((result as any).error.primaryPractitionerId._errors), true);
});

// ---------------------------------------------------------------------------
section('=== BILLING field-scope regression ===');
// ---------------------------------------------------------------------------

await test('patientListSelect (BILLING restricted detail view) still excludes gender/chartNumber/primaryPractitionerId/identity fields', () => {
  const forbidden = ['gender', 'chartNumber', 'primaryPractitionerId', 'primaryPractitioner', 'identityDocuments'];
  for (const field of forbidden) {
    assert.equal((patientListSelect as any)[field], undefined, `patientListSelect must not include "${field}"`);
  }
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
