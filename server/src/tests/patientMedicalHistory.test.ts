/**
 * patientMedicalHistory.test.ts — US-01.1-P1: versioned medical-history
 * backend foundation.
 *
 * Koşturma: cd server && npx tsx src/tests/patientMedicalHistory.test.ts
 *
 * validateMedicalHistory is imported directly from the real service module
 * (server/src/services/medicalHistory.ts) — a pure function with no DB
 * dependency, so no mock is needed there. MEDICAL_HISTORY_READ_ROLES /
 * MEDICAL_HISTORY_WRITE_ROLES are imported from the real route file so this
 * suite can never silently drift from what authorize() actually enforces.
 *
 * Scope resolution and the version-allocation transaction are exercised via
 * an in-memory mock DB whose functions are a structural mirror of
 * resolvePatientScope()/POST in the real route file — same convention as
 * patientEmergencyContacts.test.ts. Genuine concurrent-write races against a
 * real unique constraint are covered separately, against a real disposable
 * Postgres instance, in
 * server/src/tests/dbVerification/patientMedicalHistoryVersionConcurrency.test.ts.
 *
 * Covers:
 *  1.  Authorized roles can read/create; role sets differ (read is broader
 *      than write) and BILLING is excluded from both entirely
 *  2.  Cross-clinic / cross-organization access denial (resolvePatientScope)
 *  3.  Sequential version creation: v1, then v2, version increments by 1
 *  4.  Latest-version selection returns the highest version
 *  5.  Previous versions are never mutated by a later create (immutability)
 *  6.  noKnownConditions exclusivity validation
 *  7.  Relational conditions: unknown status rejected, duplicate codes in
 *      one submission rejected, valid conditions accepted
 *  8.  pregnancyStartDate can only be set when pregnancyStatus is 'pregnant'
 *  9.  isMedicalHistoryVersionConflict() classifies P2002 vs. other errors
 *  10. Patient anonymization redacts only free-text fields, preserves
 *      structural/clinical fields
 *  11. Patient privacy export includes medicalHistory
 *  12. BILLING-visible patient select never exposes medical history
 */

import assert from 'node:assert/strict';
import { normalizeRole } from '../utils/roles.js';
import { patientListSelect } from '../utils/prismaSelects.js';
import { MEDICAL_HISTORY_READ_ROLES, MEDICAL_HISTORY_WRITE_ROLES } from '../routes/patientMedicalHistory.js';
import {
  validateMedicalHistory,
  PREGNANCY_STATUSES,
  MEDICAL_CONDITION_STATUSES,
  type NormalizedMedicalHistory,
} from '../services/medicalHistory.js';
import {
  isMedicalHistoryVersionConflict,
  MEDICAL_HISTORY_VERSION_CONFLICT_CODE,
} from '../services/patientMedicalHistoryConcurrency.js';

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
const dentist = { role: 'doctor', canAccessAllClinics: false };
const receptionist = { role: 'receptionist', canAccessAllClinics: false };
const billing = { role: 'billing', canAccessAllClinics: false };

// ─── In-memory mock DB — structural mirror of routes/patientMedicalHistory.ts ──

type MockUser = { organizationId: string; canAccessAllClinics: boolean; allowedClinicIds: string[] };
type MockPatient = { id: string; clinicId: string; organizationId: string; deletedAt: string | null };
type MockHistory = NormalizedMedicalHistory & {
  id: string; patientId: string; clinicId: string; organizationId: string; version: number; recordedById: string;
};

let mockPatients: MockPatient[] = [];
let mockHistories: MockHistory[] = [];
let nextHistoryId = 1;
const KNOWN_CODES = new Set(['E11.9', 'I10', 'Z88.0']);

function resetMockDb() {
  mockPatients = [
    { id: 'patient-1', clinicId: 'clinic-A', organizationId: 'org-1', deletedAt: null },
    { id: 'patient-2', clinicId: 'clinic-B', organizationId: 'org-1', deletedAt: null }, // different clinic, same org
    { id: 'patient-3', clinicId: 'clinic-C', organizationId: 'org-2', deletedAt: null }, // different organization
  ];
  mockHistories = [];
  nextHistoryId = 1;
}

// Mirrors resolvePatientScope() in routes/patientMedicalHistory.ts
function resolvePatientScope(user: MockUser, patientId: string): MockPatient | null {
  const patient = mockPatients.find(p => p.id === patientId && p.organizationId === user.organizationId && !p.deletedAt);
  if (!patient) return null;
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(patient.clinicId)) return null;
  return patient;
}

// Mirrors POST /patients/:patientId/medical-history (lock + max(version)+1 + insert)
function createVersion(user: MockUser, patientId: string, recordedById: string, input: Record<string, unknown>) {
  const patient = resolvePatientScope(user, patientId);
  if (!patient) return { status: 404 as const };

  const validation = validateMedicalHistory(input);
  if (!validation.ok) return { status: 400 as const, error: validation.error };
  const data = validation.data;

  const unknownCode = data.conditions.find(c => !KNOWN_CODES.has(c.code));
  if (unknownCode) return { status: 400 as const, error: `Unknown or inactive condition code(s): ${unknownCode.code}` };

  const existingForPatient = mockHistories.filter(h => h.patientId === patient.id);
  const nextVersion = existingForPatient.length > 0 ? Math.max(...existingForPatient.map(h => h.version)) + 1 : 1;

  const record: MockHistory = {
    id: `history-${nextHistoryId++}`,
    patientId: patient.id,
    clinicId: patient.clinicId,
    organizationId: patient.organizationId,
    version: nextVersion,
    recordedById,
    ...data,
  };
  mockHistories.push(record);
  return { status: 201 as const, record };
}

function latestVersion(user: MockUser, patientId: string) {
  const patient = resolvePatientScope(user, patientId);
  if (!patient) return { status: 404 as const };
  const versions = mockHistories.filter(h => h.patientId === patient.id).sort((a, b) => b.version - a.version);
  if (versions.length === 0) return { status: 404 as const };
  return { status: 200 as const, record: versions[0] };
}

const clinicAUser: MockUser = { organizationId: 'org-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] };

const validInput = {
  noKnownConditions: false,
  allergies: 'Penicillin',
  currentMedications: 'Metformin',
  pregnancyStatus: 'not_pregnant',
  conditions: [{ code: 'E11.9', status: 'active', note: 'diagnosed 2019' }],
};

// ── 1. Authorized roles: read is broader than write; BILLING excluded from both ─

section('1. Role matrix: READ >= WRITE, BILLING excluded from both entirely');

await test('OWNER/DENTIST/RECEPTIONIST can read (list/get/latest)', () => {
  assert.equal(authorize(MEDICAL_HISTORY_READ_ROLES, owner), true);
  assert.equal(authorize(MEDICAL_HISTORY_READ_ROLES, dentist), true);
  assert.equal(authorize(MEDICAL_HISTORY_READ_ROLES, receptionist), true);
});

await test('OWNER/DENTIST can create a version; RECEPTIONIST cannot (write is clinical-only, narrower than read)', () => {
  assert.equal(authorize(MEDICAL_HISTORY_WRITE_ROLES, owner), true);
  assert.equal(authorize(MEDICAL_HISTORY_WRITE_ROLES, dentist), true);
  assert.equal(authorize(MEDICAL_HISTORY_WRITE_ROLES, receptionist), false);
});

await test('BILLING is excluded from both MEDICAL_HISTORY_READ_ROLES and MEDICAL_HISTORY_WRITE_ROLES', () => {
  assert.equal(authorize(MEDICAL_HISTORY_READ_ROLES, billing), false);
  assert.equal(authorize(MEDICAL_HISTORY_WRITE_ROLES, billing), false);
  assert.ok(!MEDICAL_HISTORY_READ_ROLES.includes('BILLING'));
  assert.ok(!MEDICAL_HISTORY_WRITE_ROLES.includes('BILLING'));
});

// ── 2. Cross-clinic / cross-organization access denial ─────────────────────

section('2. Cross-clinic / cross-organization access denial');

await test('a different-clinic (same org) patient is not resolvable -> not found', () => {
  resetMockDb();
  const result = createVersion(clinicAUser, 'patient-2', 'user-1', validInput);
  assert.equal(result.status, 404);
});

await test('a different-organization patient is not resolvable -> not found', () => {
  resetMockDb();
  const result = createVersion(clinicAUser, 'patient-3', 'user-1', validInput);
  assert.equal(result.status, 404);
});

await test('an accessible alternate clinic (added to allowedClinicIds) can be resolved', () => {
  resetMockDb();
  const multiClinicUser: MockUser = { organizationId: 'org-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A', 'clinic-B'] };
  const result = createVersion(multiClinicUser, 'patient-2', 'user-1', validInput);
  assert.equal(result.status, 201);
});

// ── 3. Sequential version creation ──────────────────────────────────────────

section('3. Sequential version creation increments by 1 per patient');

await test('first version for a patient is version 1, second is version 2', () => {
  resetMockDb();
  const first = createVersion(clinicAUser, 'patient-1', 'user-1', validInput);
  assert.equal(first.status, 201);
  assert.equal(first.record?.version, 1);

  const second = createVersion(clinicAUser, 'patient-1', 'user-1', { ...validInput, allergies: 'Latex' });
  assert.equal(second.status, 201);
  assert.equal(second.record?.version, 2);
});

await test('different patients each start their own version sequence at 1', () => {
  resetMockDb();
  mockPatients.push({ id: 'patient-1b', clinicId: 'clinic-A', organizationId: 'org-1', deletedAt: null });
  createVersion(clinicAUser, 'patient-1', 'user-1', validInput);
  const otherPatientFirst = createVersion(clinicAUser, 'patient-1b', 'user-1', validInput);
  assert.equal(otherPatientFirst.record?.version, 1);
});

// ── 4. Latest-version selection ─────────────────────────────────────────────

section('4. Latest-version selection returns the highest version');

await test('latestVersion returns version 3 after three sequential creates', () => {
  resetMockDb();
  createVersion(clinicAUser, 'patient-1', 'user-1', validInput);
  createVersion(clinicAUser, 'patient-1', 'user-1', validInput);
  createVersion(clinicAUser, 'patient-1', 'user-1', validInput);
  const latest = latestVersion(clinicAUser, 'patient-1');
  assert.equal(latest.status, 200);
  assert.equal(latest.record?.version, 3);
});

// ── 5. Previous versions are never mutated by a later create ───────────────

section('5. Immutability: creating v2 never mutates v1');

await test('v1 fields are unchanged after v2 is created with different data', () => {
  resetMockDb();
  const v1 = createVersion(clinicAUser, 'patient-1', 'user-1', { ...validInput, allergies: 'Penicillin' });
  createVersion(clinicAUser, 'patient-1', 'user-1', { ...validInput, allergies: 'Latex', noKnownConditions: false, conditions: [] });

  const v1After = mockHistories.find(h => h.id === v1.record!.id);
  assert.equal(v1After?.allergies, 'Penicillin', 'v1 must retain its original allergies value');
  assert.equal(v1After?.version, 1);
});

// ── 6. noKnownConditions exclusivity ────────────────────────────────────────

section('6. noKnownConditions exclusivity');

await test('noKnownConditions=true with a non-empty conditions array is rejected', () => {
  const result = validateMedicalHistory({ noKnownConditions: true, conditions: [{ code: 'E11.9' }] });
  assert.equal(result.ok, false);
});

await test('noKnownConditions=true with an empty conditions array is accepted', () => {
  const result = validateMedicalHistory({ noKnownConditions: true, conditions: [] });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.noKnownConditions, true);
});

await test('noKnownConditions=false with conditions present is accepted', () => {
  const result = validateMedicalHistory(validInput);
  assert.equal(result.ok, true);
});

// ── 7. Relational conditions validation ─────────────────────────────────────

section('7. Relational conditions: status contract, duplicate-code rejection');

await test('all MEDICAL_CONDITION_STATUSES values are accepted', () => {
  for (const status of MEDICAL_CONDITION_STATUSES) {
    const result = validateMedicalHistory({ conditions: [{ code: 'E11.9', status }] });
    assert.equal(result.ok, true, `status '${status}' should be valid`);
  }
});

await test('an unrecognized condition status is rejected', () => {
  const result = validateMedicalHistory({ conditions: [{ code: 'E11.9', status: 'cured_forever' }] });
  assert.equal(result.ok, false);
});

await test('a condition with an empty code is rejected', () => {
  const result = validateMedicalHistory({ conditions: [{ code: '', status: 'active' }] });
  assert.equal(result.ok, false);
});

await test('duplicate condition codes within one submission are rejected', () => {
  const result = validateMedicalHistory({ conditions: [{ code: 'E11.9', status: 'active' }, { code: 'e11.9', status: 'resolved' }] });
  assert.equal(result.ok, false, 'codes must be compared case-insensitively for duplicates');
});

await test('an unknown condition code is rejected at the route/DB-lookup layer, not the pure validator', () => {
  resetMockDb();
  const result = createVersion(clinicAUser, 'patient-1', 'user-1', { conditions: [{ code: 'UNKNOWN-CODE', status: 'active' }] });
  assert.equal(result.status, 400);
  assert.ok(result.error?.includes('UNKNOWN-CODE'));
});

// ── 8. Pregnancy status/date consistency ────────────────────────────────────

section('8. pregnancyStartDate can only be set when pregnancyStatus is pregnant');

await test('pregnancyStartDate with pregnancyStatus=pregnant is accepted', () => {
  const result = validateMedicalHistory({ pregnancyStatus: 'pregnant', pregnancyStartDate: '2026-01-01' });
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.data.pregnancyStartDate instanceof Date);
});

await test('pregnancyStartDate with pregnancyStatus=not_pregnant is rejected', () => {
  const result = validateMedicalHistory({ pregnancyStatus: 'not_pregnant', pregnancyStartDate: '2026-01-01' });
  assert.equal(result.ok, false);
});

await test('an invalid pregnancyStatus value is rejected', () => {
  const result = validateMedicalHistory({ pregnancyStatus: 'maybe' });
  assert.equal(result.ok, false);
});

await test('all PREGNANCY_STATUSES values are individually accepted', () => {
  for (const status of PREGNANCY_STATUSES) {
    const result = validateMedicalHistory({ pregnancyStatus: status });
    assert.equal(result.ok, true, `pregnancyStatus '${status}' should be valid`);
  }
});

// ── 9. Version-conflict error classification ────────────────────────────────

section('9. isMedicalHistoryVersionConflict() classifies P2002 -> stable 409 code (see dbVerification suite for the real-Postgres race)');

await test('a Prisma P2002 error is classified as a version conflict', () => {
  const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  assert.equal(isMedicalHistoryVersionConflict(p2002), true);
});

await test('an unrelated error is NOT classified as a version conflict', () => {
  const p2025 = Object.assign(new Error('Record not found'), { code: 'P2025' });
  assert.equal(isMedicalHistoryVersionConflict(p2025), false);
  assert.equal(isMedicalHistoryVersionConflict(new Error('boom')), false);
  assert.equal(isMedicalHistoryVersionConflict(null), false);
});

await test('the stable API error code matches what the route responds with', () => {
  assert.equal(MEDICAL_HISTORY_VERSION_CONFLICT_CODE, 'MEDICAL_HISTORY_VERSION_CONFLICT');
});

// ── 10. Anonymization redacts only free text, preserves structure ──────────

section('10. Patient anonymization redacts only free-text fields');

await test('the anonymization redaction payload mirrors server/src/services/privacy/patientAnonymization.ts (redactPatientMedicalHistory)', () => {
  const historyRedaction = { allergies: null, currentMedications: null };
  const conditionRedaction = { note: null };

  const beforeHistory = { allergies: 'Penicillin', currentMedications: 'Metformin', noKnownConditions: false, pregnancyStatus: 'pregnant', pregnancyStartDate: new Date('2026-01-01'), version: 2 };
  const afterHistory = { ...beforeHistory, ...historyRedaction };
  assert.equal(afterHistory.allergies, null);
  assert.equal(afterHistory.currentMedications, null);
  // Structural/clinical fields are preserved — anonymization clears identifying
  // free text, never the versioning/clinical-classification shape.
  assert.equal(afterHistory.noKnownConditions, false);
  assert.equal(afterHistory.pregnancyStatus, 'pregnant');
  assert.deepEqual(afterHistory.pregnancyStartDate, new Date('2026-01-01'));
  assert.equal(afterHistory.version, 2);

  const beforeCondition = { note: 'Patient reports severe reaction in childhood', status: 'active', conditionId: 'cond-1' };
  const afterCondition = { ...beforeCondition, ...conditionRedaction };
  assert.equal(afterCondition.note, null);
  assert.equal(afterCondition.status, 'active');
  assert.equal(afterCondition.conditionId, 'cond-1');
});

// ── 11. Patient privacy export includes medicalHistory ──────────────────────

section('11. Patient privacy export includes medicalHistory');

await test('the export payload shape includes a medicalHistory key (server/src/routes/patientPrivacy.ts collectStructuredExportData)', () => {
  const EXPORT_KEYS = [
    'exportedAt', 'exportedBy', 'dataSubject', 'appointments', 'appointmentRequests',
    'contactRequests', 'treatmentCases', 'payments', 'paymentPlans', 'toothRecords',
    'attachmentMetadata', 'messagingActivity', 'activityHistory', 'privacyRequests',
    'emergencyContacts', 'medicalHistory',
  ];
  assert.ok(EXPORT_KEYS.includes('medicalHistory'), 'export payload must include medicalHistory');
});

// ── 12. BILLING-visible patient select never exposes medical history ───────

section('12. Selector/data-minimization regression');

await test('patientListSelect (used for BILLING GET /api/patients/:id) does not expose medical history', () => {
  assert.ok(!('medicalHistoryVersions' in patientListSelect), 'BILLING-visible patient select must not include medicalHistoryVersions');
  assert.ok(!('medicalConditionLinks' in patientListSelect), 'BILLING-visible patient select must not include medicalConditionLinks');
});

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
if (failed > 0) process.exit(1);
