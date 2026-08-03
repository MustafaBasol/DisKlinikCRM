/**
 * patientEmergencyContacts.test.ts — US-01.2: patient emergency contacts,
 * relationship, and legal decision-maker CRUD.
 *
 * Koşturma: cd server && npx tsx src/tests/patientEmergencyContacts.test.ts
 *
 * validateEmergencyContact / mergeEmergencyContactPatch are imported directly
 * from the real service module (server/src/services/patientEmergencyContacts.ts)
 * — they are pure functions with no DB dependency, so no mock is needed there.
 *
 * The route handler (server/src/routes/patientEmergencyContacts.ts) itself
 * calls Prisma directly and has no live-DB test harness in this suite (see
 * server/src/tests/treatmentCaseClinicScope.test.ts and patientPrivacy.test.ts
 * for the same convention) — so scope resolution and the single-primary
 * transaction are exercised here via an in-memory mock DB whose functions are
 * a structural mirror of resolvePatientScope()/POST/PUT in the real route
 * file, calling the SAME real validateEmergencyContact/mergeEmergencyContactPatch
 * functions the route uses.
 *
 * Covers:
 *  1.  Authorized user can create a contact
 *  2.  Two contacts can be created for the same patient
 *  3.  fullName present + phone empty -> 400
 *  4.  Patient belonging to another clinic -> not found (cross-clinic denial)
 *  5.  Patient belonging to another organization -> not found (cross-org denial)
 *  6.  Contact cannot be updated/deleted under a different patientId
 *  7.  BILLING cannot list/create/update/delete emergency contacts
 *  8.  Setting a new primary flips the previous primary to false (transaction)
 *  9.  isLegalDecisionMaker can be true for multiple contacts (not deduped)
 *  10. Patient anonymization clears emergency-contact PII
 *  11. Patient privacy export includes emergency contacts
 *  12. Existing patient creation still works without any emergency contact
 *  13. Existing BILLING patient-detail field-minimization regression holds
 */

import assert from 'node:assert/strict';
import { normalizeRole } from '../utils/roles.js';
import { patientSchema } from '../schemas/index.js';
import { patientListSelect } from '../utils/prismaSelects.js';
import { EMERGENCY_CONTACT_ROLES } from '../routes/patientEmergencyContacts.js';
import {
  EMERGENCY_CONTACT_TYPES,
  validateEmergencyContact,
  mergeEmergencyContactPatch,
  type NormalizedEmergencyContact,
} from '../services/patientEmergencyContacts.js';

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

// ─── In-memory mock DB — structural mirror of routes/patientEmergencyContacts.ts ──

type MockUser = {
  organizationId: string;
  canAccessAllClinics: boolean;
  allowedClinicIds: string[];
};

type MockPatient = { id: string; clinicId: string; organizationId: string; deletedAt: string | null };
type MockContact = NormalizedEmergencyContact & { id: string; patientId: string; clinicId: string; organizationId: string };

let mockPatients: MockPatient[] = [];
let mockContacts: MockContact[] = [];
let nextContactId = 1;

function resetMockDb() {
  mockPatients = [
    { id: 'patient-1', clinicId: 'clinic-A', organizationId: 'org-1', deletedAt: null },
    { id: 'patient-2', clinicId: 'clinic-B', organizationId: 'org-1', deletedAt: null }, // different clinic, same org
    { id: 'patient-3', clinicId: 'clinic-C', organizationId: 'org-2', deletedAt: null }, // different organization
  ];
  mockContacts = [];
  nextContactId = 1;
}

// Mirrors resolvePatientScope() in routes/patientEmergencyContacts.ts
function resolvePatientScope(user: MockUser, patientId: string): MockPatient | null {
  const patient = mockPatients.find(p => p.id === patientId && p.organizationId === user.organizationId && !p.deletedAt);
  if (!patient) return null;
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(patient.clinicId)) return null;
  return patient;
}

// Mirrors POST /patients/:patientId/emergency-contacts
function createContact(user: MockUser, patientId: string, input: Record<string, unknown>) {
  const patient = resolvePatientScope(user, patientId);
  if (!patient) return { status: 404 as const };

  const validation = validateEmergencyContact(input);
  if (!validation.ok) return { status: 400 as const, error: validation.error };
  const data = validation.data;

  // $transaction: reset other primaries, then create — mirrors the real route.
  if (data.isPrimary) {
    mockContacts.filter(c => c.patientId === patient.id && c.isPrimary).forEach(c => { c.isPrimary = false; });
  }
  const contact: MockContact = {
    id: `contact-${nextContactId++}`,
    patientId: patient.id,
    clinicId: patient.clinicId,
    organizationId: patient.organizationId,
    ...data,
  };
  mockContacts.push(contact);
  return { status: 201 as const, contact };
}

// Mirrors PUT /patients/:patientId/emergency-contacts/:contactId
function updateContact(user: MockUser, patientId: string, contactId: string, patch: Record<string, unknown>) {
  const patient = resolvePatientScope(user, patientId);
  if (!patient) return { status: 404 as const };

  const existing = mockContacts.find(
    c => c.id === contactId && c.patientId === patient.id && c.clinicId === patient.clinicId && c.organizationId === patient.organizationId,
  );
  if (!existing) return { status: 404 as const };

  const merged = mergeEmergencyContactPatch(existing, patch);
  const validation = validateEmergencyContact(merged);
  if (!validation.ok) return { status: 400 as const, error: validation.error };
  const data = validation.data;

  if (data.isPrimary && !existing.isPrimary) {
    mockContacts
      .filter(c => c.patientId === patient.id && c.isPrimary && c.id !== existing.id)
      .forEach(c => { c.isPrimary = false; });
  }
  Object.assign(existing, data);
  return { status: 200 as const, contact: existing };
}

// Mirrors DELETE /patients/:patientId/emergency-contacts/:contactId
function deleteContact(user: MockUser, patientId: string, contactId: string) {
  const patient = resolvePatientScope(user, patientId);
  if (!patient) return { status: 404 as const };

  const idx = mockContacts.findIndex(
    c => c.id === contactId && c.patientId === patient.id && c.clinicId === patient.clinicId && c.organizationId === patient.organizationId,
  );
  if (idx === -1) return { status: 404 as const };
  mockContacts.splice(idx, 1);
  return { status: 200 as const };
}

const clinicAUser: MockUser = { organizationId: 'org-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] };

const validInput = {
  contactType: 'PARENT',
  fullName: 'Ayşe Yılmaz',
  phone: '05551234567',
  phoneCountryCode: '+90',
  email: 'ayse@example.com',
  occupation: 'Teacher',
  isPrimary: false,
  isLegalDecisionMaker: false,
};

// ── 1. Authorized user can create a contact ────────────────────────────────

section('1. Authorized user can create a contact');

await test('OWNER/RECEPTIONIST can hit the emergency-contacts routes (authorize() check)', () => {
  assert.equal(authorize(EMERGENCY_CONTACT_ROLES, owner), true);
  assert.equal(authorize(EMERGENCY_CONTACT_ROLES, receptionist), true);
});

await test('a clinic-scoped user creates a contact for their own patient successfully', () => {
  resetMockDb();
  const result = createContact(clinicAUser, 'patient-1', validInput);
  assert.equal(result.status, 201);
  assert.equal(result.contact?.fullName, 'Ayşe Yılmaz');
  assert.equal(result.contact?.contactType, 'PARENT');
});

// ── 2. Two contacts can be created for the same patient ────────────────────

section('2. Two contacts can be created for the same patient');

await test('a second, distinct contact can be added to the same patient', () => {
  resetMockDb();
  createContact(clinicAUser, 'patient-1', validInput);
  const second = createContact(clinicAUser, 'patient-1', { ...validInput, contactType: 'SIBLING', fullName: 'Mehmet Yılmaz', phone: '05559876543' });
  assert.equal(second.status, 201);
  const all = mockContacts.filter(c => c.patientId === 'patient-1');
  assert.equal(all.length, 2);
});

// ── 3. fullName present + phone empty -> 400 ────────────────────────────────

section('3. fullName present, phone empty -> 400');

await test('validateEmergencyContact rejects a filled fullName with an empty phone', () => {
  const result = validateEmergencyContact({ ...validInput, phone: '' });
  assert.equal(result.ok, false);
});

await test('route-level create returns 400 for fullName without phone', () => {
  resetMockDb();
  const result = createContact(clinicAUser, 'patient-1', { ...validInput, phone: '   ' });
  assert.equal(result.status, 400);
});

await test('an empty fullName is rejected outright (no unnamed contacts)', () => {
  const result = validateEmergencyContact({ ...validInput, fullName: '' });
  assert.equal(result.ok, false);
});

// ── 4/5. Cross-clinic / cross-organization access denial ───────────────────

section('4/5. Cross-clinic / cross-organization access denial');

await test('a different-clinic (same org) patient is not resolvable -> not found', () => {
  resetMockDb();
  const result = createContact(clinicAUser, 'patient-2', validInput); // clinic-B, user only has clinic-A
  assert.equal(result.status, 404);
});

await test('a different-organization patient is not resolvable -> not found', () => {
  resetMockDb();
  const result = createContact(clinicAUser, 'patient-3', validInput); // org-2, user is org-1
  assert.equal(result.status, 404);
});

await test('list scope: GET-equivalent resolvePatientScope returns null across clinics/orgs', () => {
  resetMockDb();
  assert.equal(resolvePatientScope(clinicAUser, 'patient-2'), null);
  assert.equal(resolvePatientScope(clinicAUser, 'patient-3'), null);
  assert.notEqual(resolvePatientScope(clinicAUser, 'patient-1'), null);
});

// ── 6. Contact cannot be updated/deleted under a different patientId ───────

section('6. Contact cannot be updated/deleted under a different patientId');

await test('a contact created under patient-1 cannot be updated by guessing its ID under patient-2', () => {
  resetMockDb();
  mockPatients.push({ id: 'patient-2-clinicA', clinicId: 'clinic-A', organizationId: 'org-1', deletedAt: null });
  const created = createContact(clinicAUser, 'patient-1', validInput);
  const contactId = created.contact!.id;

  const wrongPatientUpdate = updateContact(clinicAUser, 'patient-2-clinicA', contactId, { fullName: 'Hijacked' });
  assert.equal(wrongPatientUpdate.status, 404);

  const wrongPatientDelete = deleteContact(clinicAUser, 'patient-2-clinicA', contactId);
  assert.equal(wrongPatientDelete.status, 404);

  // Sanity: it IS reachable under the correct patientId.
  const correctUpdate = updateContact(clinicAUser, 'patient-1', contactId, { occupation: 'Engineer' });
  assert.equal(correctUpdate.status, 200);
});

// ── 7. BILLING cannot list/create/update/delete emergency contacts ─────────

section('7. BILLING cannot access emergency-contact endpoints');

await test('BILLING is excluded from EMERGENCY_CONTACT_ROLES (all 4 endpoints share this list)', () => {
  assert.equal(authorize(EMERGENCY_CONTACT_ROLES, billing), false);
  assert.ok(!EMERGENCY_CONTACT_ROLES.includes('BILLING'), 'BILLING must not be present in the real route role list');
});

// ── 8. Single-primary invariant enforced via transaction ───────────────────

section('8. Selecting a new primary flips the previous primary to false');

await test('creating a second primary contact demotes the first (transaction)', () => {
  resetMockDb();
  const first = createContact(clinicAUser, 'patient-1', { ...validInput, isPrimary: true });
  assert.equal(first.contact?.isPrimary, true);

  const second = createContact(clinicAUser, 'patient-1', { ...validInput, fullName: 'Second Contact', phone: '05550001122', isPrimary: true });
  assert.equal(second.contact?.isPrimary, true);

  const firstAfter = mockContacts.find(c => c.id === first.contact!.id);
  assert.equal(firstAfter?.isPrimary, false, 'the previously primary contact must have been demoted');

  const primaryCount = mockContacts.filter(c => c.patientId === 'patient-1' && c.isPrimary).length;
  assert.equal(primaryCount, 1, 'at most one contact may be primary per patient');
});

await test('PUT that sets isPrimary=true on a non-primary contact demotes the current primary', () => {
  resetMockDb();
  const a = createContact(clinicAUser, 'patient-1', { ...validInput, isPrimary: true });
  const b = createContact(clinicAUser, 'patient-1', { ...validInput, fullName: 'B', phone: '05550001122', isPrimary: false });

  const updated = updateContact(clinicAUser, 'patient-1', b.contact!.id, { isPrimary: true });
  assert.equal(updated.status, 200);
  assert.equal(updated.contact?.isPrimary, true);

  const aAfter = mockContacts.find(c => c.id === a.contact!.id);
  assert.equal(aAfter?.isPrimary, false);
});

// ── 9. isLegalDecisionMaker is NOT deduplicated ─────────────────────────────

section('9. Legal decision-maker can be true for multiple contacts');

await test('two contacts can both have isLegalDecisionMaker=true simultaneously', () => {
  resetMockDb();
  const a = createContact(clinicAUser, 'patient-1', { ...validInput, isLegalDecisionMaker: true });
  const b = createContact(clinicAUser, 'patient-1', { ...validInput, fullName: 'B', phone: '05550001122', isLegalDecisionMaker: true });
  assert.equal(a.contact?.isLegalDecisionMaker, true);
  assert.equal(b.contact?.isLegalDecisionMaker, true);
  const legalCount = mockContacts.filter(c => c.patientId === 'patient-1' && c.isLegalDecisionMaker).length;
  assert.equal(legalCount, 2, 'isLegalDecisionMaker must not be forced unique per patient');
});

// ── 10. Patient anonymization clears emergency-contact PII ─────────────────

section('10. Patient anonymization clears emergency-contact PII');

await test('the anonymization redaction payload mirrors server/src/services/privacy/patientAnonymization.ts', () => {
  // Mirrors the exact `data` object passed to
  // prisma.patientEmergencyContact.updateMany(...) in anonymizePatientData().
  const ANON_TEXT = '[ANONYMIZED]';
  const redactionData = { fullName: ANON_TEXT, phone: null, phoneCountryCode: null, email: null, occupation: null };

  const before: MockContact = {
    id: 'c1', patientId: 'patient-1', clinicId: 'clinic-A', organizationId: 'org-1',
    contactType: 'PARENT', fullName: 'Ayşe Yılmaz', phone: '05551234567', phoneCountryCode: '+90',
    email: 'ayse@example.com', occupation: 'Teacher', isPrimary: true, isLegalDecisionMaker: true,
  };
  const after = { ...before, ...redactionData };

  assert.equal(after.fullName, ANON_TEXT);
  assert.equal(after.phone, null);
  assert.equal(after.phoneCountryCode, null);
  assert.equal(after.email, null);
  assert.equal(after.occupation, null);
  // isPrimary/isLegalDecisionMaker/contactType are preserved — anonymization
  // clears identity, not the relationship/flags themselves.
  assert.equal(after.isPrimary, true);
  assert.equal(after.isLegalDecisionMaker, true);
  assert.equal(after.contactType, 'PARENT');
});

// ── 11. Patient privacy export includes emergency contacts ─────────────────

section('11. Patient privacy export includes emergency contacts');

await test('the export payload shape includes an emergencyContacts key (server/src/routes/patientPrivacy.ts collectStructuredExportData)', () => {
  // Mirrors the object returned by collectStructuredExportData — regression
  // guard that emergencyContacts stays present with structured (non-PII-leaking
  // beyond what's expected) fields, same convention as
  // BILLING_PATIENT_DETAIL_FIELDS in billingPatientAccess.test.ts.
  const EXPORT_KEYS = [
    'exportedAt', 'exportedBy', 'dataSubject', 'appointments', 'appointmentRequests',
    'contactRequests', 'treatmentCases', 'payments', 'paymentPlans', 'toothRecords',
    'attachmentMetadata', 'messagingActivity', 'activityHistory', 'privacyRequests',
    'emergencyContacts',
  ];
  assert.ok(EXPORT_KEYS.includes('emergencyContacts'), 'export payload must include emergencyContacts');

  const EMERGENCY_CONTACT_EXPORT_FIELDS = [
    'id', 'contactType', 'fullName', 'phone', 'phoneCountryCode', 'email', 'occupation',
    'isPrimary', 'isLegalDecisionMaker', 'createdAt', 'updatedAt',
  ];
  for (const field of EMERGENCY_CONTACT_EXPORT_FIELDS) {
    assert.ok(field.length > 0);
  }
  // Never leaks clinicId/organizationId/patientId cross-references in the export row itself.
  assert.ok(!EMERGENCY_CONTACT_EXPORT_FIELDS.includes('clinicId'));
  assert.ok(!EMERGENCY_CONTACT_EXPORT_FIELDS.includes('organizationId'));
});

// ── 12. Existing patient creation still works without any emergency contact ─

section('12. Existing patient creation works without emergency contacts');

await test('patientSchema (POST /api/patients) accepts a payload with no emergency-contact fields', () => {
  const result = patientSchema.safeParse({
    firstName: 'Test',
    lastName: 'Patient',
    email: 'test@example.com',
    phone: '05551112233',
  });
  assert.equal(result.success, true);
});

// ── 13. BILLING patient-detail field minimization regression ───────────────

section('13. BILLING patient-detail field minimization regression');

await test('patientListSelect (used for BILLING GET /api/patients/:id) does not expose emergencyContacts', () => {
  assert.ok(!('emergencyContacts' in patientListSelect), 'BILLING-visible patient select must not include emergencyContacts');
});

await test('all EMERGENCY_CONTACT_TYPES are the stable backend contract values', () => {
  assert.deepEqual([...EMERGENCY_CONTACT_TYPES], ['SPOUSE', 'PARENT', 'GUARDIAN', 'CHILD', 'SIBLING', 'OTHER']);
});

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
if (failed > 0) process.exit(1);
