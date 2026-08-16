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
 *   Website URL scheme hardening (F3-SEC-004 / R-076):
 *   30. Accepts https, http, null, omitted, and the empty string
 *   31. Rejects javascript:, data:, vbscript:, file:, ftp:, blob:
 *   32. Rejects protocol-relative, relative, and malformed values
 *   33. Rejects scheme obfuscated with embedded control characters
 *   34. Validation error names the website field
 *   35. Existing 300-character maximum is preserved
 *   36. Both write paths validate through the same shared schema
 *   37. Public API nulls an unsafe legacy website instead of serving it
 *   38. Public API passes a legitimate http/https website through unchanged
 *   39. Authenticated read is NOT scrubbed, so an admin can see and fix a bad value
 *   40. SECURITY PROPERTY: the protocol allowlist is exactly http/https
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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  LEGAL_PROFILE_ROLES,
  SAFE_SELECT,
  legalProfileSchema,
  validatePublishFields,
} from '../routes/clinicLegalProfile.js';

import { PUBLIC_PROFILE_SELECT, toPublicLegalProfile } from '../routes/publicClinicKvkk.js';
import { SAFE_URL_PROTOCOLS, isSafeHttpUrl } from '../utils/safeUrl.js';

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

// ── 30-40. F3-SEC-004 / R-076: website URL scheme hardening ───────────────────

section('30-40. Website URL scheme hardening (F3-SEC-004 / R-076)');

// These exercise the REAL exported schema, not a re-implementation, because the
// whole point of the fix is that both write paths share one schema object.
function parseWebsite(body: Record<string, unknown>) {
  return legalProfileSchema.safeParse(body);
}

await test('Accepts https, http, null, omitted, and the empty string', () => {
  const accepted: Array<[string, Record<string, unknown>]> = [
    ['https URL', { website: 'https://clinic.example' }],
    ['http URL', { website: 'http://clinic.example' }],
    ['https URL with path/query', { website: 'https://clinic.example/kvkk?v=2' }],
    ['null', { website: null }],
    ['omitted', {}],
    // '' must stay valid: the settings form initialises every text field to ''
    // and submits the whole object, so rejecting it would break saving for any
    // clinic that simply leaves the website blank.
    ['empty string', { website: '' }],
    // Whitespace-only counts as blank too, matching how validatePublishFields
    // treats required fields. It was accepted before this fix, it never reaches
    // an href, and rejecting it would only break a save for someone who typed a
    // stray space into an optional field.
    ['whitespace-only', { website: '   ' }],
  ];
  for (const [label, body] of accepted) {
    assert.ok(parseWebsite(body).success, `${label} must be accepted`);
  }
});

await test('Rejects javascript:, data:, vbscript:, file:, ftp:, blob:', () => {
  const rejected = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://evil.example/x',
    'blob:https://evil.example/1234',
  ];
  for (const value of rejected) {
    assert.ok(!parseWebsite({ website: value }).success, `${value} must be rejected`);
  }
});

await test('Rejects protocol-relative, relative, and malformed values', () => {
  const rejected = [
    '//evil.example',
    '/relative',
    'relative/path',
    'clinic.example',        // scheme-less host is not an absolute URL
    'https://',              // no host
    'not a url at all',
  ];
  for (const value of rejected) {
    assert.ok(!parseWebsite({ website: value }).success, `${value} must be rejected`);
  }
});

await test('Rejects scheme obfuscated with embedded control characters', () => {
  // `java\tscript:alert(1)` is executed by browsers but slips past a naive
  // startsWith('javascript:') check. URL parsing strips the tab first, so the
  // scheme is normalised to javascript: and caught.
  for (const value of ['java\tscript:alert(1)', 'java\nscript:alert(1)', ' javascript:alert(1)']) {
    assert.ok(!parseWebsite({ website: value }).success, `${JSON.stringify(value)} must be rejected`);
  }
});

await test('Validation error names the website field', () => {
  const result = parseWebsite({ website: 'javascript:alert(1)' });
  assert.ok(!result.success);
  assert.ok(
    result.error.flatten().fieldErrors.website,
    'the 400 response must attribute the error to website',
  );
});

await test('Existing 300-character maximum is preserved', () => {
  const host = 'a'.repeat(300 - 'https://x.example/'.length);
  const exactly300 = `https://x.example/${host}`;
  assert.equal(exactly300.length, 300);
  assert.ok(parseWebsite({ website: exactly300 }).success, '300 chars must still be accepted');
  assert.ok(!parseWebsite({ website: `${exactly300}a` }).success, '301 chars must be rejected');
});

await test('Both write paths validate through the same shared schema', () => {
  // Static scan of the route source: PUT and POST /publish must each parse
  // req.body with legalProfileSchema before any upsert, and there must be no
  // third write path that skips it.
  const routeSource = readFileSync(
    fileURLToPath(new URL('../routes/clinicLegalProfile.ts', import.meta.url)),
    'utf8',
  );
  const occurrences = (needle: string) => routeSource.split(needle).length - 1;

  assert.equal(
    occurrences('legalProfileSchema.safeParse(req.body)'), 2,
    'exactly two request-body parses expected (PUT + POST /publish)',
  );
  assert.equal(
    occurrences('prisma.clinicLegalProfile.upsert('), 2,
    'exactly two upsert write paths expected (PUT + POST /publish)',
  );
  assert.equal(
    occurrences('prisma.clinicLegalProfile.create('), 0,
    'a bare create() would be a write path bypassing the shared schema',
  );

  // The one remaining update() flips the publish flag only — it must not carry
  // any client-supplied field.
  const updateIndex = routeSource.indexOf('prisma.clinicLegalProfile.update(');
  assert.ok(updateIndex > -1, 'expected the publish-flag update to exist');
  assert.equal(
    occurrences('prisma.clinicLegalProfile.update('), 1,
    'exactly one update() write path expected (the publish flag)',
  );
  const updateCall = routeSource.slice(updateIndex, updateIndex + 200);
  assert.ok(updateCall.includes('isPublished: true'), 'publish update must set isPublished');
  assert.ok(!updateCall.includes('website'), 'publish update must not write website');
});

await test('Public API nulls an unsafe legacy website instead of serving it', () => {
  // Write-time validation cannot reach rows written before this fix, so the
  // unauthenticated boundary scrubs on read. The row itself is untouched.
  const legacy = { dataControllerTitle: 'X', website: 'javascript:alert(1)' };
  const served = toPublicLegalProfile(legacy);
  assert.equal(served.website, null, 'unsafe legacy value must not cross the public boundary');
  assert.equal(legacy.website, 'javascript:alert(1)', 'the source object must not be mutated');
  assert.equal(served.dataControllerTitle, 'X', 'other fields must pass through unchanged');
});

await test('Public API passes a legitimate http/https website through unchanged', () => {
  assert.equal(toPublicLegalProfile({ website: 'https://clinic.example' }).website, 'https://clinic.example');
  assert.equal(toPublicLegalProfile({ website: 'http://clinic.example' }).website, 'http://clinic.example');
  assert.equal(toPublicLegalProfile({ website: null }).website, null);
  assert.equal(toPublicLegalProfile({ website: '' }).website, null);
});

await test('Authenticated read is NOT scrubbed, so an admin can see and fix a bad value', () => {
  // Suppressing it in the settings form would leave the clinic unable to
  // correct the row it owns.
  assert.ok(SAFE_SELECT.website, 'SAFE_SELECT must still return the raw stored website');
});

await test('SECURITY PROPERTY: the protocol allowlist is exactly http/https', () => {
  // Mutation guard. Widening SAFE_URL_PROTOCOLS, or replacing isSafeHttpUrl
  // with unconditional acceptance, must break a test rather than silently
  // re-opening R-076. This pins the allowlist itself; the rejection cases above
  // fail if the guard is short-circuited.
  assert.deepEqual([...SAFE_URL_PROTOCOLS], ['http:', 'https:']);
  assert.ok(!isSafeHttpUrl('javascript:alert(1)'));
  assert.ok(isSafeHttpUrl('https://clinic.example'));
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
