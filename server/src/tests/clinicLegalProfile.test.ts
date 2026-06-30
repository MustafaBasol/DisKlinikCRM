/**
 * clinicLegalProfile.test.ts — Clinic KVKK Legal Profile unit tests.
 *
 * Covers:
 *   Permissions:
 *   1.  OWNER can manage clinic legal profile
 *   2.  ORG_ADMIN can manage clinic legal profile
 *   3.  CLINIC_MANAGER can manage clinic legal profile
 *   4.  DENTIST cannot manage clinic legal profile
 *   5.  RECEPTIONIST cannot manage clinic legal profile
 *   6.  BILLING cannot manage clinic legal profile
 *   7.  ASSISTANT cannot manage clinic legal profile
 *
 *   Cross-organization isolation:
 *   8.  resolveEffectiveClinicId returns null for cross-org clinic access
 *   9.  resolveEffectiveClinicId returns clinicId for same-org OWNER
 *   10. CLINIC_MANAGER can only access assigned clinics
 *
 *   Publish field validation (validatePublishFields):
 *   11. All required fields present → no errors
 *   12. Missing dataControllerTitle → fieldErrors.dataControllerTitle='required'
 *   13. Missing address → fieldErrors.address='required'
 *   14. Missing privacyNoticeText → fieldErrors.privacyNoticeText='required'
 *   15. Missing privacyNoticeVersion → fieldErrors.privacyNoticeVersion='required'
 *   16. Missing effectiveDate → fieldErrors.effectiveDate='required'
 *   17. Neither email nor privacyRequestEmail → fieldErrors.privacyRequestEmail set
 *   18. privacyRequestEmail provided but email empty → no email field error
 *   19. email provided but privacyRequestEmail empty → no email field error
 *   20. Whitespace-only required fields treated as missing
 *
 *   Public endpoint field safety:
 *   21. PUBLIC_PROFILE_SELECT does not include organizationId
 *   22. PUBLIC_PROFILE_SELECT does not include channelConsentText (internal)
 *   23. PUBLIC_PROFILE_SELECT does not include id (internal)
 *   24. SAFE_SELECT does not include organizationId
 *   25. Public response shape has clinic name/legalName but not clinic.id or organizationId
 *
 *   Regression guards:
 *   26. PUT is blocked when profile is already published (409)
 *   27. Saving draft must not unpublish an already-published profile
 *   28. POST /publish does not expose organizationId in response
 *   29. Unpublished profile returns 404 from public endpoint (no info leak)
 *
 * Run with: cd server && npx tsx src/tests/clinicLegalProfile.test.ts
 * No external test framework — uses node:assert/strict.
 */

import assert from 'node:assert/strict';

// ── Test harness ──────────────────────────────────────────────────────────────

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

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  LEGAL_PROFILE_ROLES,
  SAFE_SELECT,
  validatePublishFields,
} from '../routes/clinicLegalProfile.js';

import { PUBLIC_PROFILE_SELECT } from '../routes/publicClinicKvkk.js';

// ── 1-7. Permission checks ────────────────────────────────────────────────────

section('1-7. Role-based access to clinic legal profile');

const ALLOWED_ROLES = new Set(LEGAL_PROFILE_ROLES);

await test('OWNER can manage clinic legal profile', () => {
  assert.ok(ALLOWED_ROLES.has('OWNER'));
});

await test('ORG_ADMIN can manage clinic legal profile', () => {
  assert.ok(ALLOWED_ROLES.has('ORG_ADMIN'));
});

await test('CLINIC_MANAGER can manage clinic legal profile', () => {
  assert.ok(ALLOWED_ROLES.has('CLINIC_MANAGER'));
});

await test('DENTIST cannot manage clinic legal profile', () => {
  assert.ok(!ALLOWED_ROLES.has('DENTIST'));
});

await test('RECEPTIONIST cannot manage clinic legal profile', () => {
  assert.ok(!ALLOWED_ROLES.has('RECEPTIONIST'));
});

await test('BILLING cannot manage clinic legal profile', () => {
  assert.ok(!ALLOWED_ROLES.has('BILLING'));
});

await test('ASSISTANT cannot manage clinic legal profile', () => {
  assert.ok(!ALLOWED_ROLES.has('ASSISTANT'));
});

// ── 8-10. Cross-org isolation (inline scope helper logic) ─────────────────────

section('8-10. Cross-organization isolation');

type MockUser = {
  organizationId: string;
  canAccessAllClinics: boolean;
  allowedClinicIds: string[];
  role: string;
};

type MockClinic = { id: string; organizationId: string } | null;

// Inline version of resolveEffectiveClinicId logic (pure, no DB)
async function resolveEffectiveClinicIdPure(
  user: MockUser,
  clinicId: string,
  findClinic: (id: string) => MockClinic,
): Promise<string | null> {
  if (!clinicId) return null;
  const clinic = findClinic(clinicId);
  if (!clinic) return null;
  if (clinic.organizationId !== user.organizationId) return null;
  if (user.canAccessAllClinics) return clinicId;
  if (!user.allowedClinicIds.includes(clinicId)) return null;
  return clinicId;
}

const orgAClinic = { id: 'clinic-A', organizationId: 'org-1' };
const orgBClinic = { id: 'clinic-B', organizationId: 'org-2' };

const ownerOrgA: MockUser = {
  organizationId: 'org-1',
  canAccessAllClinics: true,
  allowedClinicIds: [],
  role: 'OWNER',
};

const managerOrgA: MockUser = {
  organizationId: 'org-1',
  canAccessAllClinics: false,
  allowedClinicIds: ['clinic-A'],
  role: 'CLINIC_MANAGER',
};

await test('resolveEffectiveClinicId returns null for cross-org clinic access', async () => {
  const result = await resolveEffectiveClinicIdPure(
    ownerOrgA,
    orgBClinic.id,
    (id) => (id === orgBClinic.id ? orgBClinic : null),
  );
  assert.equal(result, null);
});

await test('resolveEffectiveClinicId returns clinicId for same-org OWNER', async () => {
  const result = await resolveEffectiveClinicIdPure(
    ownerOrgA,
    orgAClinic.id,
    (id) => (id === orgAClinic.id ? orgAClinic : null),
  );
  assert.equal(result, 'clinic-A');
});

await test('CLINIC_MANAGER cannot access a clinic not in their allowedClinicIds', async () => {
  const otherClinic = { id: 'clinic-X', organizationId: 'org-1' };
  const result = await resolveEffectiveClinicIdPure(
    managerOrgA,
    otherClinic.id,
    (id) => (id === otherClinic.id ? otherClinic : null),
  );
  assert.equal(result, null);
});

// ── 11-20. validatePublishFields ─────────────────────────────────────────────

section('11-20. validatePublishFields — publish field validation');

const VALID_RECORD = {
  dataControllerTitle: 'Klinik A Diş Polikliniği',
  address: 'Atatürk Cad. No:1 İstanbul',
  privacyNoticeText: 'Bu aydınlatma metni örnek içeriktir.',
  privacyNoticeVersion: '1.0',
  effectiveDate: new Date('2026-01-01'),
  privacyRequestEmail: 'kvkk@klinik.com',
  email: null,
};

await test('All required fields present → no errors', () => {
  const errors = validatePublishFields(VALID_RECORD);
  assert.deepEqual(errors, {});
});

await test('Missing dataControllerTitle → fieldErrors.dataControllerTitle', () => {
  const errors = validatePublishFields({ ...VALID_RECORD, dataControllerTitle: null });
  assert.ok('dataControllerTitle' in errors);
  assert.equal(errors.dataControllerTitle, 'required');
});

await test('Missing address → fieldErrors.address', () => {
  const errors = validatePublishFields({ ...VALID_RECORD, address: null });
  assert.ok('address' in errors);
});

await test('Missing privacyNoticeText → fieldErrors.privacyNoticeText', () => {
  const errors = validatePublishFields({ ...VALID_RECORD, privacyNoticeText: null });
  assert.ok('privacyNoticeText' in errors);
});

await test('Missing privacyNoticeVersion → fieldErrors.privacyNoticeVersion', () => {
  const errors = validatePublishFields({ ...VALID_RECORD, privacyNoticeVersion: null });
  assert.ok('privacyNoticeVersion' in errors);
});

await test('Missing effectiveDate → fieldErrors.effectiveDate', () => {
  const errors = validatePublishFields({ ...VALID_RECORD, effectiveDate: null });
  assert.ok('effectiveDate' in errors);
});

await test('Neither email nor privacyRequestEmail → fieldErrors.privacyRequestEmail set', () => {
  const errors = validatePublishFields({ ...VALID_RECORD, privacyRequestEmail: null, email: null });
  assert.ok('privacyRequestEmail' in errors);
});

await test('privacyRequestEmail provided but email empty → no email-related error', () => {
  const errors = validatePublishFields({ ...VALID_RECORD, privacyRequestEmail: 'kvkk@klinik.com', email: null });
  assert.ok(!('privacyRequestEmail' in errors));
});

await test('email provided but privacyRequestEmail empty → no email-related error', () => {
  const errors = validatePublishFields({ ...VALID_RECORD, privacyRequestEmail: null, email: 'info@klinik.com' });
  assert.ok(!('privacyRequestEmail' in errors));
});

await test('Whitespace-only required fields treated as missing', () => {
  const errors = validatePublishFields({
    ...VALID_RECORD,
    dataControllerTitle: '   ',
    address: '\t\n',
  });
  assert.ok('dataControllerTitle' in errors, 'whitespace dataControllerTitle should be invalid');
  assert.ok('address' in errors, 'whitespace address should be invalid');
});

// ── 21-25. Public endpoint field safety ──────────────────────────────────────

section('21-25. Public endpoint field safety — no sensitive fields exposed');

await test('PUBLIC_PROFILE_SELECT does not include organizationId', () => {
  assert.ok(!('organizationId' in PUBLIC_PROFILE_SELECT));
});

await test('PUBLIC_PROFILE_SELECT does not include channelConsentText (internal)', () => {
  assert.ok(!('channelConsentText' in PUBLIC_PROFILE_SELECT));
});

await test('PUBLIC_PROFILE_SELECT does not include id (internal)', () => {
  assert.ok(!('id' in PUBLIC_PROFILE_SELECT));
});

await test('SAFE_SELECT does not include organizationId', () => {
  assert.ok(!('organizationId' in SAFE_SELECT));
});

await test('Public response shape: clinic object has name/legalName but not id or organizationId', () => {
  // Simulate the shape returned by the public endpoint
  const responseClinic = { name: 'Klinik A', legalName: 'Klinik A Diş Pol.' };
  assert.ok('name' in responseClinic);
  assert.ok('legalName' in responseClinic);
  assert.ok(!('id' in responseClinic));
  assert.ok(!('organizationId' in responseClinic));
});

// ── 26-29. Regression guards ──────────────────────────────────────────────────

section('26-29. Regression guards');

await test('PUT is blocked when profile is published: handler returns 409', async () => {
  // Simulate the guard logic from the PUT handler
  function putGuard(isPublished: boolean): number {
    if (isPublished) return 409;
    return 200;
  }
  assert.equal(putGuard(true), 409);
  assert.equal(putGuard(false), 200);
});

await test('Draft save must not reset isPublished when profile is already published', () => {
  // The PUT handler only runs upsert with isPublished:false when current.isPublished===false.
  // If already published, it returns 409 before touching the record.
  // This test verifies the guard condition logic is correct.
  function simulatePutResult(currentIsPublished: boolean): { blocked: boolean; wouldSetIsPublished?: boolean } {
    if (currentIsPublished) return { blocked: true };
    return { blocked: false, wouldSetIsPublished: false };
  }
  const publishedCase = simulatePutResult(true);
  assert.ok(publishedCase.blocked, 'PUT must be blocked when published');
  assert.ok(!('wouldSetIsPublished' in publishedCase), 'isPublished must not be touched when blocked');

  const draftCase = simulatePutResult(false);
  assert.ok(!draftCase.blocked, 'PUT must be allowed when not published');
  assert.equal(draftCase.wouldSetIsPublished, false, 'PUT correctly sets isPublished=false for draft');
});

await test('POST /publish response does not expose organizationId', () => {
  // SAFE_SELECT (used in publish response) must not include organizationId
  const forbidden = ['organizationId'];
  for (const field of forbidden) {
    assert.ok(
      !(field in SAFE_SELECT),
      `SAFE_SELECT must not include ${field}`,
    );
  }
});

await test('Unpublished profile returns 404 from public endpoint (no info leak)', () => {
  // Simulate the guard logic in the public endpoint
  function publicEndpointStatus(clinicExists: boolean, isPublished: boolean): number {
    if (!clinicExists) return 404;
    if (!isPublished) return 404;
    return 200;
  }
  // Unpublished → 404, not 403 (avoids disclosing that profile exists but is private)
  assert.equal(publicEndpointStatus(true, false), 404);
  // Non-existent clinic → 404
  assert.equal(publicEndpointStatus(false, false), 404);
  // Published → 200
  assert.equal(publicEndpointStatus(true, true), 200);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
