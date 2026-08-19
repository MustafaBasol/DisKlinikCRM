/**
 * patientIdentityAccess.test.ts — F3-DATA-MIG-TODAY-001-UI-001-R1
 *
 * Pure role-gate proofs for the patient identity (T.C. Kimlik No) endpoints
 * (GET/PUT/DELETE /api/patients/:id/identity — routes/patientIdentity.ts).
 * No live database — same "call the real function/list, mock only the DB
 * edge" convention as billingPatientAccess.test.ts and
 * patientIdentityUxFieldValidation.test.ts.
 *
 * Covers:
 *   7.  RECEPTIONIST is allowed to write (and read) a patient's TCKN.
 *   8.  DENTIST is denied TCKN write (and read).
 *   9.  BILLING is denied TCKN write and read.
 *   +   OWNER / ORG_ADMIN / CLINIC_MANAGER remain allowed; ASSISTANT remains
 *       denied (most-restrictive-role regression).
 *   +   READ and WRITE share the EXACT SAME role list (PATIENT_IDENTITY_ROLES)
 *       — a role that cannot write must not be able to even learn whether a
 *       TCKN exists.
 *   +   server/src/utils/roles.ts's canManagePatientIdentity() matches
 *       services/patientIdentityService.ts's PATIENT_IDENTITY_ROLES exactly —
 *       one role decision, not two independently-maintained lists.
 *   +   routes/patients.ts POST /patients (identity-at-create path) requires
 *       PATIENT_CREATE authorize(), which is a SUBSET of PATIENT_IDENTITY_ROLES
 *       — nobody can reach the identity-at-create path without also being
 *       allowed to manage identity directly.
 */

import assert from 'node:assert/strict';
import { normalizeRole, canManagePatientIdentity } from '../utils/roles.js';
import { PATIENT_IDENTITY_ROLES } from '../services/patientIdentityService.js';

// ─── authorize() ile aynı iki katmanlı kontrol (server/src/middleware/auth.ts:216-232) ──
function authorize(allowedRoles: string[], user: { role: string; canAccessAllClinics: boolean }): boolean {
  const normalizedList = allowedRoles.map((r) => r.toLowerCase());
  const canonicalRole = normalizeRole(user.role, user.canAccessAllClinics).toLowerCase();
  const rawRole = user.role.toLowerCase();
  return normalizedList.includes(canonicalRole) || normalizedList.includes(rawRole);
}

const owner = { role: 'owner', canAccessAllClinics: true };
const orgAdmin = { role: 'org_admin', canAccessAllClinics: false };
const clinicManager = { role: 'clinic_manager', canAccessAllClinics: false };
const receptionist = { role: 'receptionist', canAccessAllClinics: false };
const dentist = { role: 'doctor', canAccessAllClinics: false };
const billing = { role: 'billing', canAccessAllClinics: false };
const assistant = { role: 'assistant', canAccessAllClinics: false };

// POST /patients (server/src/routes/patients.ts) — identity-at-create path guard.
const PATIENT_CREATE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'];

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err?.message ?? err}`);
    failed++;
  }
}

console.log('\n=== PATIENT_IDENTITY_ROLES: allow list ===');

test('OWNER can write/read a patient TCKN', () => {
  assert.equal(authorize(PATIENT_IDENTITY_ROLES, owner), true);
});
test('ORG_ADMIN can write/read a patient TCKN', () => {
  assert.equal(authorize(PATIENT_IDENTITY_ROLES, orgAdmin), true);
});
test('CLINIC_MANAGER can write/read a patient TCKN', () => {
  assert.equal(authorize(PATIENT_IDENTITY_ROLES, clinicManager), true);
});
test('RECEPTIONIST can write/read a patient TCKN — required by the F3-DATA-MIG-TODAY-001-UI-001-R1 authorization contract', () => {
  assert.equal(authorize(PATIENT_IDENTITY_ROLES, receptionist), true);
});

console.log('\n=== PATIENT_IDENTITY_ROLES: deny list ===');

test('DENTIST is denied TCKN write/read — clinical role, not identity-management', () => {
  assert.equal(authorize(PATIENT_IDENTITY_ROLES, dentist), false);
});
test('BILLING is denied TCKN write AND read — financial-only patient access', () => {
  assert.equal(authorize(PATIENT_IDENTITY_ROLES, billing), false);
});
test('ASSISTANT (most restrictive role) is denied TCKN write/read', () => {
  assert.equal(authorize(PATIENT_IDENTITY_ROLES, assistant), false);
});

console.log('\n=== READ and WRITE are ONE role gate, not two ===');

test('PATIENT_IDENTITY_ROLES is exactly OWNER | ORG_ADMIN | CLINIC_MANAGER | RECEPTIONIST — no more, no less', () => {
  assert.deepEqual([...PATIENT_IDENTITY_ROLES].sort(), ['CLINIC_MANAGER', 'ORG_ADMIN', 'OWNER', 'RECEPTIONIST'].sort());
});

console.log('\n=== Single source of truth: services vs. utils/roles.ts ===');

test('canManagePatientIdentity() (utils/roles.ts) agrees with PATIENT_IDENTITY_ROLES for every canonical role', () => {
  const allRoles = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING', 'ASSISTANT'];
  for (const role of allRoles) {
    const user = { role, canAccessAllClinics: false };
    const viaRolesUtil = canManagePatientIdentity(user);
    const viaAuthorizeList = authorize(PATIENT_IDENTITY_ROLES, user);
    assert.equal(viaRolesUtil, viaAuthorizeList, `mismatch for role=${role}`);
  }
});

console.log('\n=== Identity-at-create path (POST /patients) cannot be reached by a role excluded from identity management ===');

test('every role allowed to POST /patients is also allowed to manage identity (subset relationship holds)', () => {
  for (const role of PATIENT_CREATE_ROLES) {
    const user = { role: role.toLowerCase(), canAccessAllClinics: false };
    assert.equal(authorize(PATIENT_IDENTITY_ROLES, user), true, `POST /patients role ${role} must also be a PATIENT_IDENTITY_ROLES member`);
  }
});
test('DENTIST and BILLING cannot POST /patients at all, so the identity-at-create path is unreachable for them regardless', () => {
  assert.equal(authorize(PATIENT_CREATE_ROLES, dentist), false);
  assert.equal(authorize(PATIENT_CREATE_ROLES, billing), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
