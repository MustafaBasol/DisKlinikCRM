/**
 * patientContactPoints.test.ts — F3-DATA-MIG-TODAY-001-R10: SECONDARY patient
 * phone numbers (PatientContactPoint).
 *
 * Koşturma: cd server && npx tsx src/tests/patientContactPoints.test.ts
 *
 * Convention (identical to server/src/tests/patientEmergencyContacts.test.ts,
 * the nearest sibling): standalone tsx script, node:assert/strict, hand-rolled
 * pass/fail counters — NOT vitest. No database is required, so this suite
 * belongs to the `server:test:non-disposable` chain.
 *
 * The pure functions (validateContactPoint, mergeContactPointPatch,
 * normalizeContactPointDigits, isContactPointDuplicate) and the real role list
 * are imported directly from the route module
 * (server/src/routes/patientContactPoints.ts) — the tests below call the SAME
 * code the route calls, never a copy. Scope resolution and the Prisma writes
 * are exercised through an in-memory mock DB that is a structural mirror of
 * resolvePatientScope() / GET / POST / PUT / DELETE in that file.
 *
 * Two invariants are ALSO asserted as static source scans of the real route
 * file, because a mock can only prove what the mock does — the scan proves the
 * shipped handler cannot do the forbidden thing at all:
 *   - no write to Patient.phone (or any prisma.patient.update) anywhere;
 *   - the number is never logged and never placed in audit metadata.
 *
 * Covers:
 *  1.  Create / list / update / delete happy paths
 *  2.  Patient.phone is NEVER modified by any contact-point operation
 *      (the single most important invariant — mock assertion + source scan)
 *  3.  A secondary number is never used for patient lookup / matching
 *  4.  Unknown contactType rejected (400), closed vocabulary
 *  5.  Duplicate (patientId, contactType, value) -> 409, never 500
 *  6.  Cross-tenant: other organization denied; unauthorized clinic in the
 *      same organization denied; a row cannot be reached under another patient
 *  7.  No EmergencyContact row is created by any contact-point operation
 *  8.  `source` is forced to 'staff' and never read from the client
 *  9.  value / normalizedValue normalization + length and label bounds
 * 10.  Role matrix matches PUT /api/patients/:id; BILLING excluded
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeRole } from '../utils/roles.js';
import { patientListSelect } from '../utils/prismaSelects.js';
import { patientSchema, patientUpdateSchema } from '../schemas/index.js';
import {
  CONTACT_POINT_ROLES,
  CONTACT_POINT_TYPES,
  CONTACT_POINT_API_SOURCE,
  CONTACT_POINT_DUPLICATE_CODE,
  CONTACT_POINT_VALUE_MAX_LENGTH,
  CONTACT_POINT_LABEL_MAX_LENGTH,
  validateContactPoint,
  mergeContactPointPatch,
  normalizeContactPointDigits,
  isContactPointDuplicate,
  type ContactPointType,
} from '../routes/patientContactPoints.js';

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

function readSource(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

/**
 * Comments are stripped before every source scan below. Without this the scans
 * are false-positive machines: the route file's own header comment explains
 * that it never calls prisma.patient.update, so a naive scan for that literal
 * matches the PROSE and reports a violation that does not exist in the code.
 * Block comments are removed first, then line comments; the route file has no
 * "//" sequence inside any string or regex literal, so this is safe here.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const routeSourceRaw = readSource('../routes/patientContactPoints.ts');
const routeSource = stripComments(routeSourceRaw);

// ─── authorize() — same two-layer check as server/src/middleware/auth.ts ────

function authorize(allowedRoles: string[], user: { role: string; canAccessAllClinics: boolean }): boolean {
  const normalizedList = allowedRoles.map(r => r.toLowerCase());
  const canonicalRole = normalizeRole(user.role, user.canAccessAllClinics).toLowerCase();
  const rawRole = user.role.toLowerCase();
  return normalizedList.includes(canonicalRole) || normalizedList.includes(rawRole);
}

const owner = { role: 'owner', canAccessAllClinics: true };
const receptionist = { role: 'receptionist', canAccessAllClinics: false };
const billing = { role: 'billing', canAccessAllClinics: false };

// ─── In-memory mock DB — structural mirror of routes/patientContactPoints.ts ──

type MockUser = {
  organizationId: string;
  canAccessAllClinics: boolean;
  allowedClinicIds: string[];
};

type MockPatient = {
  id: string;
  clinicId: string;
  organizationId: string;
  phone: string | null;
  deletedAt: string | null;
};

type MockContactPoint = {
  id: string;
  patientId: string;
  clinicId: string;
  organizationId: string;
  contactType: ContactPointType;
  value: string;
  normalizedValue: string | null;
  label: string | null;
  source: string;
};

type MockEmergencyContact = { id: string; patientId: string };

const PRIMARY_PHONE_1 = '05551110001';
const PRIMARY_PHONE_2 = '05552220002';
const PRIMARY_PHONE_3 = '05553330003';

let mockPatients: MockPatient[] = [];
let mockContactPoints: MockContactPoint[] = [];
let mockEmergencyContacts: MockEmergencyContact[] = [];
let nextContactPointId = 1;

function resetMockDb() {
  mockPatients = [
    { id: 'patient-1', clinicId: 'clinic-A', organizationId: 'org-1', phone: PRIMARY_PHONE_1, deletedAt: null },
    // same org, DIFFERENT clinic — clinicAUser is not assigned to it
    { id: 'patient-2', clinicId: 'clinic-B', organizationId: 'org-1', phone: PRIMARY_PHONE_2, deletedAt: null },
    // DIFFERENT organization entirely
    { id: 'patient-3', clinicId: 'clinic-C', organizationId: 'org-2', phone: PRIMARY_PHONE_3, deletedAt: null },
  ];
  mockContactPoints = [];
  mockEmergencyContacts = [];
  nextContactPointId = 1;
}

function snapshotPhones(): Array<[string, string | null]> {
  return mockPatients.map(p => [p.id, p.phone] as [string, string | null]);
}

/** Mirrors resolvePatientScope() in routes/patientContactPoints.ts. */
function resolvePatientScope(user: MockUser, patientId: string): MockPatient | null {
  const patient = mockPatients.find(
    p => p.id === patientId && p.organizationId === user.organizationId && !p.deletedAt,
  );
  if (!patient) return null;
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(patient.clinicId)) return null;
  return patient;
}

/** Mirrors the @@unique([patientId, contactType, value]) index: Prisma raises
 * a P2002 error, which the route classifies with the REAL
 * isContactPointDuplicate() imported above. */
function enforceUniqueOrThrow(patientId: string, contactType: string, value: string, ignoreId?: string) {
  const clash = mockContactPoints.find(
    c => c.patientId === patientId && c.contactType === contactType && c.value === value && c.id !== ignoreId,
  );
  if (clash) {
    const err = new Error('Unique constraint failed') as Error & { code: string };
    err.code = 'P2002';
    throw err;
  }
}

/** Mirrors GET /patients/:patientId/contact-points */
function listContactPoints(user: MockUser, patientId: string) {
  const patient = resolvePatientScope(user, patientId);
  if (!patient) return { status: 404 as const };
  const contactPoints = mockContactPoints.filter(
    c => c.patientId === patient.id && c.clinicId === patient.clinicId && c.organizationId === patient.organizationId,
  );
  return { status: 200 as const, contactPoints };
}

/** Mirrors POST /patients/:patientId/contact-points */
function createContactPoint(user: MockUser, patientId: string, input: Record<string, unknown>) {
  const patient = resolvePatientScope(user, patientId);
  if (!patient) return { status: 404 as const };

  const validation = validateContactPoint(input);
  if (!validation.ok) return { status: 400 as const, error: validation.error };
  const data = validation.data;

  try {
    enforceUniqueOrThrow(patient.id, data.contactType, data.value);
  } catch (err: unknown) {
    if (isContactPointDuplicate(err)) {
      return { status: 409 as const, code: CONTACT_POINT_DUPLICATE_CODE };
    }
    return { status: 500 as const };
  }

  const contactPoint: MockContactPoint = {
    id: `cp-${nextContactPointId++}`,
    patientId: patient.id,
    clinicId: patient.clinicId,
    organizationId: patient.organizationId,
    contactType: data.contactType,
    value: data.value,
    normalizedValue: data.normalizedValue,
    label: data.label,
    // Hard-coded exactly as the route does — `input.source` is never read.
    source: CONTACT_POINT_API_SOURCE,
  };
  mockContactPoints.push(contactPoint);
  return { status: 201 as const, contactPoint };
}

/** Mirrors PUT /patients/:patientId/contact-points/:contactPointId */
function updateContactPoint(user: MockUser, patientId: string, contactPointId: string, patch: Record<string, unknown>) {
  const patient = resolvePatientScope(user, patientId);
  if (!patient) return { status: 404 as const };

  const existing = mockContactPoints.find(
    c => c.id === contactPointId
      && c.patientId === patient.id
      && c.clinicId === patient.clinicId
      && c.organizationId === patient.organizationId,
  );
  if (!existing) return { status: 404 as const };

  const merged = mergeContactPointPatch(existing, patch);
  const validation = validateContactPoint(merged);
  if (!validation.ok) return { status: 400 as const, error: validation.error };
  const data = validation.data;

  try {
    enforceUniqueOrThrow(patient.id, data.contactType, data.value, existing.id);
  } catch (err: unknown) {
    if (isContactPointDuplicate(err)) {
      return { status: 409 as const, code: CONTACT_POINT_DUPLICATE_CODE };
    }
    return { status: 500 as const };
  }

  existing.contactType = data.contactType;
  existing.value = data.value;
  existing.normalizedValue = data.normalizedValue;
  existing.label = data.label;
  // `source` intentionally untouched — provenance is not rewritten by an edit.
  return { status: 200 as const, contactPoint: existing };
}

/** Mirrors DELETE /patients/:patientId/contact-points/:contactPointId */
function deleteContactPoint(user: MockUser, patientId: string, contactPointId: string) {
  const patient = resolvePatientScope(user, patientId);
  if (!patient) return { status: 404 as const };

  const idx = mockContactPoints.findIndex(
    c => c.id === contactPointId
      && c.patientId === patient.id
      && c.clinicId === patient.clinicId
      && c.organizationId === patient.organizationId,
  );
  if (idx === -1) return { status: 404 as const };
  mockContactPoints.splice(idx, 1);
  return { status: 204 as const };
}

/**
 * Mirrors the ONLY patient phone lookup the product performs — routes/
 * patients.ts check-phone-duplicate and routes/whatsappInbox.ts both match on
 * Patient.phone. Deliberately does NOT consult mockContactPoints: that is the
 * behaviour under test in section 3.
 */
function findPatientsByPhone(user: MockUser, phone: string): MockPatient[] {
  const digits = normalizeContactPointDigits(phone);
  return mockPatients.filter(p => {
    if (p.organizationId !== user.organizationId || p.deletedAt) return false;
    if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(p.clinicId)) return false;
    return p.phone != null && normalizeContactPointDigits(p.phone) === digits;
  });
}

const clinicAUser: MockUser = { organizationId: 'org-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] };
const clinicBUser: MockUser = { organizationId: 'org-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-B'] };
const otherOrgUser: MockUser = { organizationId: 'org-2', canAccessAllClinics: true, allowedClinicIds: [] };

const SECONDARY_VALUE = '0216 555 90 11';
const validInput = { contactType: 'work', value: SECONDARY_VALUE, label: 'iş' };

// ── 1. Create / list / update / delete happy paths ─────────────────────────

section('1. Create / list / update / delete happy paths');

await test('POST creates a contact point for the caller\'s own patient (201)', () => {
  resetMockDb();
  const result = createContactPoint(clinicAUser, 'patient-1', validInput);
  assert.equal(result.status, 201);
  assert.equal(result.contactPoint?.contactType, 'work');
  assert.equal(result.contactPoint?.value, '0216 555 90 11');
  assert.equal(result.contactPoint?.label, 'iş');
  assert.equal(result.contactPoint?.clinicId, 'clinic-A');
  assert.equal(result.contactPoint?.organizationId, 'org-1');
});

await test('POST computes normalizedValue server-side as a digits-only projection', () => {
  resetMockDb();
  const result = createContactPoint(clinicAUser, 'patient-1', validInput);
  assert.equal(result.contactPoint?.normalizedValue, '02165559011');
});

await test('GET lists the patient\'s contact points, scoped to patient + clinic + org', () => {
  resetMockDb();
  createContactPoint(clinicAUser, 'patient-1', validInput);
  createContactPoint(clinicAUser, 'patient-1', { contactType: 'home', value: '0212 444 33 22' });
  const listed = listContactPoints(clinicAUser, 'patient-1');
  assert.equal(listed.status, 200);
  assert.equal(listed.contactPoints?.length, 2);
});

await test('several distinct contact points can coexist for one patient', () => {
  resetMockDb();
  for (const contactType of CONTACT_POINT_TYPES) {
    const result = createContactPoint(clinicAUser, 'patient-1', { contactType, value: `0216 000 00 0${CONTACT_POINT_TYPES.indexOf(contactType)}` });
    assert.equal(result.status, 201, `${contactType} should be accepted`);
  }
  assert.equal(mockContactPoints.length, CONTACT_POINT_TYPES.length);
});

await test('PUT updates value/label and recomputes normalizedValue (200)', () => {
  resetMockDb();
  const created = createContactPoint(clinicAUser, 'patient-1', validInput);
  const updated = updateContactPoint(clinicAUser, 'patient-1', created.contactPoint!.id, {
    value: '+90 (532) 111 22 33',
    label: 'yeni',
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.contactPoint?.value, '+90 (532) 111 22 33');
  assert.equal(updated.contactPoint?.normalizedValue, '905321112233');
  assert.equal(updated.contactPoint?.label, 'yeni');
  assert.equal(updated.contactPoint?.contactType, 'work', 'an omitted key keeps its stored value');
});

await test('PUT with label:null explicitly clears the label', () => {
  resetMockDb();
  const created = createContactPoint(clinicAUser, 'patient-1', validInput);
  const updated = updateContactPoint(clinicAUser, 'patient-1', created.contactPoint!.id, { label: null });
  assert.equal(updated.status, 200);
  assert.equal(updated.contactPoint?.label, null);
});

await test('DELETE removes the row and returns 204', () => {
  resetMockDb();
  const created = createContactPoint(clinicAUser, 'patient-1', validInput);
  const deleted = deleteContactPoint(clinicAUser, 'patient-1', created.contactPoint!.id);
  assert.equal(deleted.status, 204);
  assert.equal(mockContactPoints.length, 0);
  assert.equal(listContactPoints(clinicAUser, 'patient-1').contactPoints?.length, 0);
});

await test('DELETE of an unknown id is 404, not 204', () => {
  resetMockDb();
  assert.equal(deleteContactPoint(clinicAUser, 'patient-1', 'cp-does-not-exist').status, 404);
});

// ── 2. Patient.phone is NEVER modified — THE critical invariant ────────────

section('2. Patient.phone is NEVER modified by any contact-point operation');

await test('create / update / delete leave every Patient.phone byte-identical', () => {
  resetMockDb();
  const before = snapshotPhones();

  const created = createContactPoint(clinicAUser, 'patient-1', validInput);
  assert.deepEqual(snapshotPhones(), before, 'POST must not touch Patient.phone');

  updateContactPoint(clinicAUser, 'patient-1', created.contactPoint!.id, { value: '0555 999 88 77' });
  assert.deepEqual(snapshotPhones(), before, 'PUT must not touch Patient.phone');

  deleteContactPoint(clinicAUser, 'patient-1', created.contactPoint!.id);
  assert.deepEqual(snapshotPhones(), before, 'DELETE must not touch Patient.phone');

  assert.equal(mockPatients.find(p => p.id === 'patient-1')?.phone, PRIMARY_PHONE_1);
});

await test('a patient with NO primary phone does not gain one from a contact point', () => {
  resetMockDb();
  mockPatients.push({ id: 'patient-nophone', clinicId: 'clinic-A', organizationId: 'org-1', phone: null, deletedAt: null });
  const created = createContactPoint(clinicAUser, 'patient-nophone', validInput);
  assert.equal(created.status, 201);
  assert.equal(mockPatients.find(p => p.id === 'patient-nophone')?.phone, null,
    'a secondary number must never be promoted into the empty primary slot');
});

await test('SOURCE SCAN: the route file contains no prisma.patient write of any kind', () => {
  assert.ok(!/prisma\.patient\.update/.test(routeSource), 'found prisma.patient.update in the contact-points route');
  assert.ok(!/prisma\.patient\.updateMany/.test(routeSource), 'found prisma.patient.updateMany in the contact-points route');
  assert.ok(!/prisma\.patient\.create/.test(routeSource), 'found prisma.patient.create in the contact-points route');
  assert.ok(!/prisma\.patient\.delete/.test(routeSource), 'found prisma.patient.delete in the contact-points route');
});

await test('SOURCE SCAN: the route never assigns to or selects a `phone` field', () => {
  // The ONLY prisma.patient call permitted here is the scope-resolving
  // findFirst, which selects id/clinicId/organizationId and no phone at all.
  assert.ok(/prisma\.patient\.findFirst/.test(routeSource), 'expected the scope-resolving findFirst to still exist');
  assert.ok(!/\bphone\s*:/.test(routeSource), 'found a `phone:` field assignment/selection in the contact-points route');
});

await test('META: stripComments removes prose but never real code (the scans above depend on it)', () => {
  const sample = [
    '/** doc: this file never calls prisma.patient.update anywhere. */',
    "const a = prisma.patientContactPoint.create({ data: {} }); // trailing prisma.patient.update note",
    "const digits = value.replace(/\\D/g, '');",
  ].join('\n');
  const stripped = stripComments(sample);
  assert.ok(!/prisma\.patient\.update/.test(stripped), 'stripComments must remove both block and line comment prose');
  assert.ok(/prisma\.patientContactPoint\.create/.test(stripped), 'stripComments must NOT remove real code');
  assert.ok(/value\.replace/.test(stripped), 'stripComments must NOT eat a regex literal');
  // And on the real file: the header prose exists, the code does not.
  assert.ok(/prisma\.patient\.update/.test(routeSourceRaw), 'the header comment should still document the no-write rule');
});

// ── 3. A secondary number is never a patient-matching key ──────────────────

section('3. A secondary number is never used for patient lookup / matching');

await test('lookup by a patient\'s PRIMARY phone finds that patient', () => {
  resetMockDb();
  const found = findPatientsByPhone(clinicAUser, PRIMARY_PHONE_1);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'patient-1');
});

await test('lookup by a number stored ONLY as a contact point finds nobody', () => {
  resetMockDb();
  createContactPoint(clinicAUser, 'patient-1', validInput);
  const found = findPatientsByPhone(clinicAUser, SECONDARY_VALUE);
  assert.equal(found.length, 0, 'a contact point must never be a patient-matching key');
});

await test('a contact point equal to ANOTHER patient\'s primary phone does not cross-link them', () => {
  resetMockDb();
  // patient-1 records patient-2's primary number as a secondary contact.
  createContactPoint(clinicAUser, 'patient-1', { contactType: 'other', value: PRIMARY_PHONE_2 });
  const found = findPatientsByPhone({ organizationId: 'org-1', canAccessAllClinics: true, allowedClinicIds: [] }, PRIMARY_PHONE_2);
  assert.equal(found.length, 1, 'only the owner of the PRIMARY number may match');
  assert.equal(found[0].id, 'patient-2');
});

await test('SOURCE SCAN: the route resolves patients by id only, never by phone/normalizedValue', () => {
  // Scan the whole resolvePatientScope body — the `where` object is built a
  // few lines above the findFirst call, so a window anchored on the call
  // alone would miss the id predicate entirely.
  const start = routeSource.indexOf('async function resolvePatientScope');
  assert.ok(start >= 0, 'expected resolvePatientScope in the route file');
  const end = routeSource.indexOf('router.get(', start);
  assert.ok(end > start, 'expected the first router handler after resolvePatientScope');
  const body = routeSource.slice(start, end);

  assert.ok(/prisma\.patient\.findFirst/.test(body), 'expected the scope-resolving findFirst inside resolvePatientScope');
  assert.ok(/id:\s*patientId/.test(body), 'the patient lookup must key on the patient id');
  assert.ok(/organizationId:\s*orgId/.test(body), 'the patient lookup must be organization-scoped');
  assert.ok(/allowedClinicIds\.includes\(patient\.clinicId\)/.test(body), 'the clinic-assignment check must be present');
  assert.ok(!/normalizedValue/.test(body), 'the patient lookup must not mention normalizedValue');
  assert.ok(!/\bphone\b/.test(body), 'the patient lookup must not mention phone');
  assert.ok(!/patientContactPoint/.test(body), 'the patient lookup must not consult contact points');
});

// ── 4. Closed contactType vocabulary ──────────────────────────────────────

section('4. Unknown contactType is rejected');

await test('CONTACT_POINT_TYPES is exactly the schema vocabulary', () => {
  assert.deepEqual([...CONTACT_POINT_TYPES], ['mobile', 'home', 'work', 'other']);
});

await test('each allowed contactType validates', () => {
  for (const contactType of CONTACT_POINT_TYPES) {
    const result = validateContactPoint({ contactType, value: '05551112233' });
    assert.equal(result.ok, true, `${contactType} should validate`);
  }
});

await test('an out-of-vocabulary contactType is rejected (400), never coerced to "other"', () => {
  resetMockDb();
  const result = createContactPoint(clinicAUser, 'patient-1', { contactType: 'fax', value: '05551112233' });
  assert.equal(result.status, 400);
  assert.equal(mockContactPoints.length, 0);
});

await test('contactType is case-sensitive — "MOBILE" is rejected, not silently lowercased', () => {
  assert.equal(validateContactPoint({ contactType: 'MOBILE', value: '05551112233' }).ok, false);
});

await test('a missing / non-string contactType is rejected', () => {
  assert.equal(validateContactPoint({ value: '05551112233' }).ok, false);
  assert.equal(validateContactPoint({ contactType: 42, value: '05551112233' }).ok, false);
  assert.equal(validateContactPoint({ contactType: null, value: '05551112233' }).ok, false);
});

await test('PUT cannot smuggle an invalid contactType past the merge (400)', () => {
  resetMockDb();
  const created = createContactPoint(clinicAUser, 'patient-1', validInput);
  const updated = updateContactPoint(clinicAUser, 'patient-1', created.contactPoint!.id, { contactType: 'pager' });
  assert.equal(updated.status, 400);
  assert.equal(mockContactPoints[0].contactType, 'work', 'the stored row must be unchanged after a rejected patch');
});

// ── 5. Duplicate -> 409, never 500 ────────────────────────────────────────

section('5. Duplicate (patientId, contactType, value) -> 409');

await test('creating the same (contactType, value) twice for one patient returns 409', () => {
  resetMockDb();
  assert.equal(createContactPoint(clinicAUser, 'patient-1', validInput).status, 201);
  const second = createContactPoint(clinicAUser, 'patient-1', validInput);
  assert.equal(second.status, 409, 'a unique-constraint violation must be a clean 409');
  assert.notEqual(second.status, 500);
  assert.equal(second.code, CONTACT_POINT_DUPLICATE_CODE);
  assert.equal(mockContactPoints.length, 1);
});

await test('the same value under a DIFFERENT contactType is allowed (the key is the triple)', () => {
  resetMockDb();
  createContactPoint(clinicAUser, 'patient-1', { contactType: 'work', value: SECONDARY_VALUE });
  const other = createContactPoint(clinicAUser, 'patient-1', { contactType: 'home', value: SECONDARY_VALUE });
  assert.equal(other.status, 201);
});

await test('the same (contactType, value) for a DIFFERENT patient is allowed (family shared line)', () => {
  resetMockDb();
  mockPatients.push({ id: 'patient-1b', clinicId: 'clinic-A', organizationId: 'org-1', phone: null, deletedAt: null });
  createContactPoint(clinicAUser, 'patient-1', validInput);
  const sibling = createContactPoint(clinicAUser, 'patient-1b', validInput);
  assert.equal(sibling.status, 201);
});

await test('PUT into an existing (contactType, value) pair returns 409, not 500', () => {
  resetMockDb();
  createContactPoint(clinicAUser, 'patient-1', { contactType: 'work', value: SECONDARY_VALUE });
  const second = createContactPoint(clinicAUser, 'patient-1', { contactType: 'work', value: '0212 444 33 22' });
  const collide = updateContactPoint(clinicAUser, 'patient-1', second.contactPoint!.id, { value: SECONDARY_VALUE });
  assert.equal(collide.status, 409);
  assert.equal(collide.code, CONTACT_POINT_DUPLICATE_CODE);
});

await test('an idempotent PUT of a row onto its own values is NOT a self-conflict', () => {
  resetMockDb();
  const created = createContactPoint(clinicAUser, 'patient-1', validInput);
  const same = updateContactPoint(clinicAUser, 'patient-1', created.contactPoint!.id, { value: SECONDARY_VALUE });
  assert.equal(same.status, 200);
});

await test('isContactPointDuplicate classifies P2002 only — not P2034 or a plain Error', () => {
  assert.equal(isContactPointDuplicate({ code: 'P2002' }), true);
  assert.equal(isContactPointDuplicate({ code: 'P2034' }), false);
  assert.equal(isContactPointDuplicate({ code: 'P2025' }), false);
  assert.equal(isContactPointDuplicate(new Error('boom')), false);
  assert.equal(isContactPointDuplicate(null), false);
  assert.equal(isContactPointDuplicate(undefined), false);
});

// ── 6. Cross-tenant denial ────────────────────────────────────────────────

section('6. Cross-tenant denial (organization + clinic)');

await test('a caller from ANOTHER ORGANIZATION cannot read or write a patient\'s contact points', () => {
  resetMockDb();
  createContactPoint(clinicAUser, 'patient-1', validInput);
  const cpId = mockContactPoints[0].id;

  assert.equal(listContactPoints(otherOrgUser, 'patient-1').status, 404);
  assert.equal(createContactPoint(otherOrgUser, 'patient-1', { contactType: 'home', value: '0212 111 11 11' }).status, 404);
  assert.equal(updateContactPoint(otherOrgUser, 'patient-1', cpId, { label: 'hijack' }).status, 404);
  assert.equal(deleteContactPoint(otherOrgUser, 'patient-1', cpId).status, 404);
  assert.equal(mockContactPoints.length, 1, 'nothing may have been created or destroyed cross-org');
  assert.equal(mockContactPoints[0].label, 'iş', 'the row must be untouched');
});

await test('a caller in an UNAUTHORIZED CLINIC of the SAME organization is denied', () => {
  resetMockDb();
  createContactPoint(clinicAUser, 'patient-1', validInput);
  const cpId = mockContactPoints[0].id;

  // clinicBUser is org-1 (same org) but assigned only to clinic-B.
  assert.equal(listContactPoints(clinicBUser, 'patient-1').status, 404);
  assert.equal(createContactPoint(clinicBUser, 'patient-1', { contactType: 'home', value: '0212 111 11 11' }).status, 404);
  assert.equal(updateContactPoint(clinicBUser, 'patient-1', cpId, { label: 'hijack' }).status, 404);
  assert.equal(deleteContactPoint(clinicBUser, 'patient-1', cpId).status, 404);
  assert.equal(mockContactPoints.length, 1);
  assert.equal(mockContactPoints[0].label, 'iş');
});

await test('resolvePatientScope returns null across clinics and organizations', () => {
  resetMockDb();
  assert.equal(resolvePatientScope(clinicAUser, 'patient-2'), null, 'different clinic, same org');
  assert.equal(resolvePatientScope(clinicAUser, 'patient-3'), null, 'different organization');
  assert.notEqual(resolvePatientScope(clinicAUser, 'patient-1'), null);
});

await test('a soft-deleted patient is not resolvable', () => {
  resetMockDb();
  mockPatients.find(p => p.id === 'patient-1')!.deletedAt = '2026-01-01T00:00:00.000Z';
  assert.equal(createContactPoint(clinicAUser, 'patient-1', validInput).status, 404);
});

await test('a contact point cannot be reached by guessing its id under a DIFFERENT patient', () => {
  resetMockDb();
  mockPatients.push({ id: 'patient-1c', clinicId: 'clinic-A', organizationId: 'org-1', phone: null, deletedAt: null });
  const created = createContactPoint(clinicAUser, 'patient-1', validInput);
  const cpId = created.contactPoint!.id;

  assert.equal(updateContactPoint(clinicAUser, 'patient-1c', cpId, { label: 'hijack' }).status, 404);
  assert.equal(deleteContactPoint(clinicAUser, 'patient-1c', cpId).status, 404);
  // Sanity: it IS reachable under the correct patientId.
  assert.equal(updateContactPoint(clinicAUser, 'patient-1', cpId, { label: 'ok' }).status, 200);
});

await test('clinicId / organizationId come from the PATIENT ROW, not from client input', () => {
  resetMockDb();
  const created = createContactPoint(clinicAUser, 'patient-1', {
    ...validInput,
    clinicId: 'clinic-B',
    organizationId: 'org-2',
    patientId: 'patient-3',
  });
  assert.equal(created.status, 201);
  assert.equal(created.contactPoint?.clinicId, 'clinic-A');
  assert.equal(created.contactPoint?.organizationId, 'org-1');
  assert.equal(created.contactPoint?.patientId, 'patient-1');
});

// ── 7. No EmergencyContact row is created ─────────────────────────────────

section('7. Contact points never create an EmergencyContact row');

await test('no emergency contact is created by create / update / delete', () => {
  resetMockDb();
  const created = createContactPoint(clinicAUser, 'patient-1', validInput);
  updateContactPoint(clinicAUser, 'patient-1', created.contactPoint!.id, { label: 'x' });
  deleteContactPoint(clinicAUser, 'patient-1', created.contactPoint!.id);
  assert.equal(mockEmergencyContacts.length, 0, 'contact points and emergency contacts are separate models');
});

await test('SOURCE SCAN: the route code never references patientEmergencyContact', () => {
  assert.ok(
    !/patientEmergencyContact/i.test(routeSource),
    'the contact-points route must not touch the emergency-contact model',
  );
});

// ── 8. `source` is server-controlled ──────────────────────────────────────

section('8. `source` is forced to "staff" and never accepted from the client');

await test('API-created rows always carry source = "staff"', () => {
  resetMockDb();
  const created = createContactPoint(clinicAUser, 'patient-1', validInput);
  assert.equal(created.contactPoint?.source, CONTACT_POINT_API_SOURCE);
  assert.equal(CONTACT_POINT_API_SOURCE, 'staff');
});

await test('a client-supplied source is ignored — never "legacy_migration" or "import"', () => {
  resetMockDb();
  const created = createContactPoint(clinicAUser, 'patient-1', { ...validInput, source: 'legacy_migration' });
  assert.equal(created.contactPoint?.source, 'staff');
});

await test('validateContactPoint never emits a `source` key at all', () => {
  const result = validateContactPoint({ ...validInput, source: 'import' } as Record<string, unknown>);
  assert.equal(result.ok, true);
  assert.ok(result.ok && !('source' in result.data), 'source must not survive validation');
});

await test('PUT does not rewrite the stored provenance', () => {
  resetMockDb();
  const created = createContactPoint(clinicAUser, 'patient-1', validInput);
  mockContactPoints[0].source = 'legacy_migration';
  updateContactPoint(clinicAUser, 'patient-1', created.contactPoint!.id, { source: 'staff', label: 'edited' });
  assert.equal(mockContactPoints[0].source, 'legacy_migration');
});

// ── 9. value / label validation and normalization ─────────────────────────

section('9. value / label validation and normalization');

await test('a blank or whitespace-only value is rejected (400)', () => {
  resetMockDb();
  assert.equal(createContactPoint(clinicAUser, 'patient-1', { contactType: 'home', value: '' }).status, 400);
  assert.equal(createContactPoint(clinicAUser, 'patient-1', { contactType: 'home', value: '   ' }).status, 400);
  assert.equal(validateContactPoint({ contactType: 'home' }).ok, false);
  assert.equal(validateContactPoint({ contactType: 'home', value: 5551112233 }).ok, false);
});

await test('value is trimmed but otherwise stored exactly as entered', () => {
  const result = validateContactPoint({ contactType: 'home', value: '  +90 (216) 555 90 11  ' });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.value, '+90 (216) 555 90 11');
});

await test('a value longer than the max is rejected; one at exactly the max is accepted', () => {
  const atMax = '1'.repeat(CONTACT_POINT_VALUE_MAX_LENGTH);
  assert.equal(validateContactPoint({ contactType: 'home', value: atMax }).ok, true);
  const overMax = '1'.repeat(CONTACT_POINT_VALUE_MAX_LENGTH + 1);
  assert.equal(validateContactPoint({ contactType: 'home', value: overMax }).ok, false);
});

await test('normalizeContactPointDigits strips every non-digit and returns null when none remain', () => {
  assert.equal(normalizeContactPointDigits('+90 (216) 555-90-11'), '902165559011');
  assert.equal(normalizeContactPointDigits('0555 111 22 33'), '05551112233');
  assert.equal(normalizeContactPointDigits('yok'), null);
  assert.equal(normalizeContactPointDigits(''), null);
});

await test('a value with no digits still stores the raw value with normalizedValue = null', () => {
  const result = validateContactPoint({ contactType: 'other', value: 'dahili' });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.data.value, 'dahili');
  assert.equal(result.ok && result.data.normalizedValue, null);
});

await test('an empty or whitespace label normalizes to null; an over-long label is rejected', () => {
  assert.equal(validateContactPoint({ contactType: 'home', value: '05551112233', label: '   ' }).ok, true);
  const blank = validateContactPoint({ contactType: 'home', value: '05551112233', label: '   ' });
  assert.equal(blank.ok && blank.data.label, null);
  const overMax = validateContactPoint({
    contactType: 'home',
    value: '05551112233',
    label: 'a'.repeat(CONTACT_POINT_LABEL_MAX_LENGTH + 1),
  });
  assert.equal(overMax.ok, false);
  assert.equal(validateContactPoint({ contactType: 'home', value: '05551112233', label: 7 }).ok, false);
});

await test('mergeContactPointPatch applies only the keys PRESENT in the patch', () => {
  const existing = { contactType: 'work', value: '0216 555 90 11', label: 'iş' };
  assert.deepEqual(mergeContactPointPatch(existing, {}), { contactType: 'work', value: '0216 555 90 11', label: 'iş' });
  assert.deepEqual(mergeContactPointPatch(existing, { label: null }), { contactType: 'work', value: '0216 555 90 11', label: null });
  assert.deepEqual(mergeContactPointPatch(existing, { value: '05551112233' }), { contactType: 'work', value: '05551112233', label: 'iş' });
});

// ── 10. Role matrix and log privacy ───────────────────────────────────────

section('10. Role matrix, field minimization and log privacy');

await test('CONTACT_POINT_ROLES matches the PUT /api/patients/:id matrix', () => {
  assert.deepEqual([...CONTACT_POINT_ROLES], ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST']);
  assert.equal(authorize(CONTACT_POINT_ROLES, owner), true);
  assert.equal(authorize(CONTACT_POINT_ROLES, receptionist), true);
});

await test('BILLING is excluded from all four contact-point endpoints', () => {
  assert.equal(authorize(CONTACT_POINT_ROLES, billing), false);
  assert.ok(!CONTACT_POINT_ROLES.includes('BILLING'), 'BILLING must not be in the real route role list');
});

await test('all four handlers are guarded by the SAME authorize(CONTACT_POINT_ROLES) list', () => {
  const guards = routeSource.match(/authorize\(CONTACT_POINT_ROLES\)/g) ?? [];
  assert.equal(guards.length, 4, 'expected exactly four guarded handlers (GET/POST/PUT/DELETE)');
});

await test('SOURCE SCAN: neither `value` nor `normalizedValue` is ever logged or audited', () => {
  const consoleCalls = routeSource.match(/console\.(error|warn|log|info)\([^\n]*\n?[^\n]*/g) ?? [];
  assert.ok(consoleCalls.length > 0, 'expected at least one console call to inspect');
  for (const call of consoleCalls) {
    assert.ok(/safeErrorFields\(err\)/.test(call), `console call must use safeErrorFields: ${call.slice(0, 90)}`);
    assert.ok(!/data\.value|existing\.value|normalizedValue|req\.body/.test(call), `console call leaks the number: ${call.slice(0, 90)}`);
  }
  const metadataBlocks = routeSource.match(/metadata:\s*\{[^}]*\}/g) ?? [];
  assert.equal(metadataBlocks.length, 3, 'expected audit metadata on create/update/delete');
  for (const block of metadataBlocks) {
    assert.ok(!/value/.test(block), `audit metadata leaks the number: ${block}`);
    assert.ok(/contactPointId/.test(block), 'audit metadata must carry the id');
  }
});

await test('activity descriptions carry the contactType only, never the number', () => {
  const descriptions = routeSource.match(/description:\s*`[^`]*`/g) ?? [];
  assert.equal(descriptions.length, 3, 'expected one description per mutating handler');
  for (const description of descriptions) {
    assert.ok(!/\$\{[^}]*value[^}]*\}/.test(description), `description interpolates the number: ${description}`);
    assert.ok(/contactType/.test(description), `description should name the contact type: ${description}`);
  }
});

await test('patientListSelect does not expose contactPoints (BILLING field minimization holds)', () => {
  assert.ok(!('contactPoints' in patientListSelect), 'the BILLING-visible patient select must not include contactPoints');
  assert.ok(!('district' in patientListSelect), 'district must behave like its address siblings and stay out of the list select');
});

// ── 11. Task 1 companion — `district` on the patient write schemas ────────

section('11. `district` is accepted on patient create/update (F3-DATA-MIG-TODAY-001-R10)');

const validPatientBase = { firstName: 'Ali', lastName: 'Veli' };

await test('patientSchema accepts district and keeps city independent', () => {
  const result = patientSchema.safeParse({ ...validPatientBase, city: 'İstanbul', district: 'Kadıköy' });
  assert.equal(result.success, true);
  assert.equal(result.success && result.data.city, 'İstanbul');
  assert.equal(result.success && result.data.district, 'Kadıköy');
});

await test('district is optional and nullable, exactly like its address siblings', () => {
  assert.equal(patientSchema.safeParse({ ...validPatientBase }).success, true);
  const nulled = patientSchema.safeParse({ ...validPatientBase, district: null });
  assert.equal(nulled.success, true);
  assert.equal(nulled.success && nulled.data.district, null);
});

await test('patientUpdateSchema allows a bare district-only patch', () => {
  const result = patientUpdateSchema.safeParse({ district: 'Beşiktaş' });
  assert.equal(result.success, true);
  assert.equal(result.success && result.data.district, 'Beşiktaş');
});

await test('the patient schema still STRIPS unknown keys (no .strict/.passthrough regression)', () => {
  const result = patientSchema.safeParse({ ...validPatientBase, district: 'Kadıköy', ilce: 'Kadıköy', tcNo: '12345678901' });
  assert.equal(result.success, true);
  assert.ok(result.success && !('ilce' in result.data), 'unknown keys must be stripped, not rejected or kept');
  assert.ok(result.success && !('tcNo' in result.data), 'unknown keys must be stripped, not rejected or kept');
});

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
if (failed > 0) process.exit(1);
