/**
 * messagesRecordScope.test.ts — KVKK-HIGH-006: record-derived clinic scope
 * for the two remaining high-sensitivity `messages.ts` routes.
 *
 * Run with: tsx src/tests/messagesRecordScope.test.ts
 *
 * Scope: GET /api/messages/:id and POST /api/messages/:id/send. Both
 * previously derived their authorization filter from `req.user!.clinicId`
 * (the JWT's default clinic — explicitly documented in the codebase as
 * "UI default only, not authorization") instead of the centralized
 * `validateAndGetClinicIdScope` contract already used by the sibling
 * `GET /api/messages` route in the same file (line ~418).
 *
 * Bug (pre-fix): a multi-clinic OWNER/ORG_ADMIN whose JWT default clinic is
 * Clinic A could not read or send a `SentMessage` that actually belongs to
 * Clinic B, even when they are fully authorized for Clinic B — the lookup
 * `{ id, clinicId: req.user!.clinicId }` silently excluded it (404), and the
 * send route's provider/consent/audit calls would have used the WRONG
 * clinic's id had the record ever matched by coincidence.
 *
 * Fix: resolve the caller's accessible clinic scope via
 * `validateAndGetClinicIdScope(req.user!, undefined, res)`, locate the
 * `SentMessage` within that scope, then derive `clinicId` from the FOUND
 * record (`message.clinicId`) for every downstream read/send/provider/
 * consent/audit operation — never from `req.user!.clinicId` again.
 *
 * This file does not touch a live database (none is reachable in this
 * sandbox — see the evidence document for the connection-refusal proof).
 * Section 1 is a logic-simulation of `buildClinicIdScope` + the two routes'
 * post-fix authorization/derivation logic, mirroring the existing
 * `dentalChartClinicScope.test.ts` / `reportsClinicScope.test.ts` convention
 * for this repository. Section 2 is direct source-inspection of the actual
 * `server/src/routes/messages.ts` file, verifying the fix landed exactly as
 * described and that no other occurrence in the file was touched.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
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

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

// ─── Section 1: logic simulation ───────────────────────────────────────────────
// Mirrors buildClinicIdScope (server/src/utils/clinicScope.ts:179) for the
// no-explicit-selectedClinicId path used by both fixed routes.

type User = {
  clinicId: string;
  organizationId: string;
  allowedClinicIds: string[];
  canAccessAllClinics: boolean;
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    clinicId: 'clinic-A',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  };
}

type Clinic = { id: string; organizationId: string };
type SentMessage = { id: string; clinicId: string; status: string; channel: string; recipient: string; body: string };

let mockClinics: Clinic[] = [];
let mockMessages: SentMessage[] = [];

type ClinicIdScope = { clinicId: string } | { clinicId: { in: string[] } };

function buildClinicIdScope(user: User): ClinicIdScope | null {
  if (user.canAccessAllClinics) {
    const orgClinicIds = mockClinics.filter((c) => c.organizationId === user.organizationId).map((c) => c.id);
    return { clinicId: { in: orgClinicIds } };
  }
  if (user.allowedClinicIds.length === 0) return null;
  return { clinicId: { in: user.allowedClinicIds } };
}

function matchesScope(clinicId: string, scope: ClinicIdScope): boolean {
  return typeof scope.clinicId === 'string' ? clinicId === scope.clinicId : scope.clinicId.in.includes(clinicId);
}

// Post-fix: GET /messages/:id and POST /messages/:id/send shared shape —
// resolve scope, look the record up within it, derive clinicId from the
// FOUND record.
function findMessageInScope(user: User, id: string):
  | { status: 200; clinicId: string; message: SentMessage }
  | { status: 403 }
  | { status: 404 } {
  const scope = buildClinicIdScope(user);
  if (scope === null) return { status: 403 };
  const message = mockMessages.find((m) => m.id === id && matchesScope(m.clinicId, scope));
  if (!message) return { status: 404 };
  return { status: 200, clinicId: message.clinicId, message };
}

// Pre-fix behaviour being regression-guarded against.
function findMessageInScope_BUGGY(user: User, id: string):
  | { status: 200; clinicId: string; message: SentMessage }
  | { status: 404 } {
  const clinicId = user.clinicId; // varsayılan klinik — yetkilendirme kapsamı DEĞİL
  const message = mockMessages.find((m) => m.id === id && m.clinicId === clinicId);
  if (!message) return { status: 404 };
  return { status: 200, clinicId, message };
}

// ─── Scenario setup ─────────────────────────────────────────────────────────────
// Org-1: Clinic A (JWT default), Clinic B (sibling, assigned only via
// allowedClinicIds/canAccessAllClinics). Org-2: Clinic X (different org).

mockClinics = [
  { id: 'clinic-A', organizationId: 'org-1' },
  { id: 'clinic-B', organizationId: 'org-1' },
  { id: 'clinic-X', organizationId: 'org-2' },
];
mockMessages = [
  { id: 'msg-A-1', clinicId: 'clinic-A', status: 'prepared', channel: 'whatsapp', recipient: '+905550000001', body: 'A body' },
  { id: 'msg-B-1', clinicId: 'clinic-B', status: 'prepared', channel: 'whatsapp', recipient: '+905550000002', body: 'B body (sibling clinic, contains PHI-adjacent content)' },
  { id: 'msg-X-1', clinicId: 'clinic-X', status: 'prepared', channel: 'sms', recipient: '+905550000003', body: 'X body (different org)' },
];

async function main() {
  section('REGRESSION: multi-clinic OWNER, JWT default Clinic A, message actually owned by Clinic B');

  await test('BUGGY: old logic could not see the sibling-clinic message (false 404)', () => {
    const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], clinicId: 'clinic-A' });
    const res = findMessageInScope_BUGGY(user, 'msg-B-1');
    assert.equal(res.status, 404, 'root cause: OWNER should see every org clinic, but old code only looked in the default clinic');
  });

  await test('FIX: record-derived scope now finds the Clinic B message and returns its OWN clinicId', () => {
    const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], clinicId: 'clinic-A' });
    const res = findMessageInScope(user, 'msg-B-1');
    assert.equal(res.status, 200);
    assert.equal((res as any).clinicId, 'clinic-B', 'clinicId must be derived from the message record, not req.user.clinicId');
  });

  section('Clinic-scope matrix (GET /messages/:id and POST /messages/:id/send share this logic)');

  await test('1. Single-clinic user reading their own clinic message → 200', () => {
    const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
    const res = findMessageInScope(user, 'msg-A-1');
    assert.equal(res.status, 200);
  });

  await test('2. Multi-clinic user (allowedClinicIds includes sibling), authorized sibling-clinic access succeeds → 200', () => {
    const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
    const res = findMessageInScope(user, 'msg-B-1');
    assert.equal(res.status, 200);
    assert.equal((res as any).clinicId, 'clinic-B');
  });

  await test('3. Single-clinic (regular) user CANNOT read a message belonging to an inaccessible sibling clinic → 404, not leaked', () => {
    const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
    const res = findMessageInScope(user, 'msg-B-1');
    assert.equal(res.status, 404, 'inaccessible clinic record must remain unavailable, and must not be distinguishable from non-existence');
  });

  await test('4. OWNER/ORG_ADMIN (canAccessAllClinics) can read any in-org clinic message', () => {
    const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
    const res = findMessageInScope(user, 'msg-B-1');
    assert.equal(res.status, 200);
  });

  await test('5. Cross-organization message is denied (404 — existence not leaked, no 403 that would confirm the id is real)', () => {
    const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
    const res = findMessageInScope(user, 'msg-X-1');
    assert.equal(res.status, 404, 'cross-org record must be indistinguishable from a nonexistent id');
  });

  await test('6. Nonexistent message id → 404 (same shape as cross-org denial, no oracle for existence)', () => {
    const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
    const res = findMessageInScope(user, 'msg-does-not-exist');
    assert.equal(res.status, 404);
  });

  await test('7. User with zero clinic assignments → 403 up front (scope cannot be built at all)', () => {
    const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: [] });
    const res = findMessageInScope(user, 'msg-A-1');
    assert.equal(res.status, 403);
  });

  await test('8. 403 vs 404 distinction: no clinic assignment → 403; assigned-but-wrong-clinic record → 404', () => {
    const unassigned = findMessageInScope(makeUser({ allowedClinicIds: [] }), 'msg-A-1');
    const assignedButWrongClinic = findMessageInScope(makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] }), 'msg-B-1');
    assert.equal(unassigned.status, 403);
    assert.equal(assignedButWrongClinic.status, 404);
  });

  await test('9. Backward-compat: existing single-clinic account behavior for its own messages is unchanged', () => {
    const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
    const res = findMessageInScope(user, 'msg-A-1');
    assert.equal(res.status, 200);
    assert.equal((res as any).clinicId, 'clinic-A');
  });

  section('Send-route provider/consent/audit clinicId propagation (POST /messages/:id/send shape)');

  await test('10. Send operations use the target record\'s actual clinicId for provider dispatch, not the caller\'s default clinic', () => {
    const user = makeUser({ clinicId: 'clinic-A', canAccessAllClinics: true, allowedClinicIds: [] });
    const auth = findMessageInScope(user, 'msg-B-1');
    assert.equal(auth.status, 200);
    const dispatchClinicId = (auth as any).clinicId; // route: sendWhatsAppMessage(clinicId, ...)
    assert.equal(dispatchClinicId, 'clinic-B');
    assert.notEqual(dispatchClinicId, user.clinicId, 'provider dispatch must never fall back to the caller\'s JWT-default clinic');
  });

  await test('11. Consent-gate and audit-log clinicId is the same record-owned clinicId (unchanged decision inputs otherwise)', () => {
    const user = makeUser({ clinicId: 'clinic-A', canAccessAllClinics: true, allowedClinicIds: [] });
    const auth = findMessageInScope(user, 'msg-B-1');
    assert.equal(auth.status, 200);
    // route: assertCommunicationPermission({ clinicId, patientId: message.patientId, ... })
    // route: logActivity({ clinicId, ... })
    const consentClinicId = (auth as any).clinicId;
    const auditClinicId = (auth as any).clinicId;
    assert.equal(consentClinicId, auditClinicId);
    assert.equal(consentClinicId, (auth as any).message.clinicId, 'must be literally the same value read off the found record');
  });

  await test('12. Unauthorized send attempt never reaches provider/consent/audit logic (early 403/404 return)', () => {
    const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
    const res = findMessageInScope(user, 'msg-B-1');
    assert.equal(res.status, 404);
    // route-level: handler returns before assertCommunicationPermission/sendWhatsAppMessage/logActivity run.
  });

  // ─── Section 2: source-inspection regression (the actual file, not the model) ───

  section('Source regression — server/src/routes/messages.ts (actual fixed file)');

  const code = src('../routes/messages.ts');

  function extractBetween(marker1: string, marker2: string) {
    const start = code.indexOf(marker1);
    const end = code.indexOf(marker2, start);
    assert.ok(start !== -1, `marker not found: ${marker1}`);
    assert.ok(end !== -1 && end > start, `marker not found after start: ${marker2}`);
    return code.slice(start, end);
  }

  const getByIdRoute = extractBetween(
    "// GET /api/messages/:id",
    "// POST /api/messages/:id/send",
  );
  const sendRoute = extractBetween(
    "// POST /api/messages/:id/send",
    "// ── Meta WhatsApp Template Management",
  );

  await test('GET /messages/:id no longer derives clinicId from req.user!.clinicId', () => {
    assert.ok(!/req\.user(!|\?)?\.clinicId/.test(getByIdRoute), 'route body must not reference req.user.clinicId at all');
  });

  await test('GET /messages/:id calls validateAndGetClinicIdScope and checks the false branch', () => {
    assert.ok(getByIdRoute.includes('validateAndGetClinicIdScope('), 'must call the centralized helper');
    assert.ok(getByIdRoute.includes('if (scope === false) return;'), 'must handle the 403 branch');
    assert.ok(getByIdRoute.includes('...scope'), 'lookup where-clause must spread the resolved scope');
  });

  await test('POST /messages/:id/send no longer derives clinicId from req.user!.clinicId', () => {
    assert.ok(!/req\.user(!|\?)?\.clinicId/.test(sendRoute), 'route body must not reference req.user.clinicId at all');
  });

  await test('POST /messages/:id/send calls validateAndGetClinicIdScope and derives clinicId from the found record', () => {
    assert.ok(sendRoute.includes('validateAndGetClinicIdScope('), 'must call the centralized helper');
    assert.ok(sendRoute.includes('if (scope === false) return;'), 'must handle the 403 branch');
    assert.ok(sendRoute.includes('...scope'), 'lookup where-clause must spread the resolved scope');
    assert.ok(sendRoute.includes('const clinicId = message.clinicId;'), 'clinicId used for send/consent/audit must be derived from the found record');
  });

  await test('POST /messages/:id/send still gates SMS via sendClinicSms and WhatsApp via assertCommunicationPermission + sendWhatsAppMessage (provider/consent behavior unchanged)', () => {
    assert.ok(sendRoute.includes('sendClinicSms('), 'SMS pipeline call must remain');
    assert.ok(sendRoute.includes('assertCommunicationPermission('), 'consent gate call must remain');
    assert.ok(sendRoute.includes('sendWhatsAppMessage('), 'WhatsApp dispatch call must remain');
    assert.ok(sendRoute.includes("status !== 'prepared'"), '"only prepared messages can be sent" guard must remain unchanged');
  });

  await test('Zero raw req.user!.clinicId occurrences remain in the file (Batch 3\'s five plus this task\'s two together remediate all seven)', () => {
    const matches = code.match(/req\.user(!|\?)?\.clinicId/g) ?? [];
    assert.equal(matches.length, 0, `expected zero remaining raw occurrences post-reconciliation with Batch 3, found ${matches.length}`);
  });

  await test('Sibling GET /messages (list) route is untouched and still uses validateAndGetClinicIdScope with a selectable clinicId', () => {
    const listRoute = extractBetween("router.get('/messages',", "router.get('/messages/:id'");
    assert.ok(listRoute.includes('validateAndGetClinicIdScope(req.user!, selectedClinicId'), 'pre-existing correct sibling route must be unchanged');
  });

  // ─── Summary ─────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in test runner:', err);
  process.exit(1);
});
