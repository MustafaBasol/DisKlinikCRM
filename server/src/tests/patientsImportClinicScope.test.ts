/**
 * patientsImportClinicScope.test.ts — Cross-tenant clinic-scope regression tests
 * for the patient Excel import endpoints (server/src/routes/patientsImport.ts).
 *
 * Koşturma: cd server && npx tsx src/tests/patientsImportClinicScope.test.ts
 *
 * Bug (CODE_BLOCKER_BEFORE_ONBOARDING, docs/program/evidence/
 * KVKK_REMAINING_CODE_GAP_AUDIT_20260724.md): the shared row-validation helper
 * `validatePatientRows` in patientsImport.ts trusted the query-string
 * `?clinicId=` (`selectedClinicId`, read straight off `req.query.clinicId`)
 * as the fallback target clinic for any row that omitted its own per-row
 * `clinicId` column — WITHOUT checking it against the caller's
 * `accessibleIds` (from getAccessibleClinicIds()). The per-row
 * `clinicIdFromRow` path already did this check correctly; the query-level
 * fallback did not. An authenticated RECEPTIONIST (or other IMPORT_ROLES
 * member) could submit
 *   POST /api/patients/import-confirm?clinicId=<other org's or other
 *   same-org clinic's UUID>
 * and have patient PII written into a clinic/organization they have no
 * access to.
 *
 * Fix: both /patients/import-preview and /patients/import-confirm now
 * validate `selectedClinicId` (when present and not 'all') against
 * `accessibleIds` — reusing the same getAccessibleClinicIds() helper
 * already used elsewhere in this file (and in usersImport.ts's per-row
 * clinicIds validation) — and reject with 403 *before* the workbook is
 * parsed or any row is processed. This mirrors the codebase-wide
 * resolveEffectiveClinicId()/validateAndGetScope() convention (see
 * server/src/utils/clinicScope.ts) of returning the same stable,
 * non-disclosing 'Access denied to requested clinic' error regardless of
 * whether the target clinic doesn't exist, belongs to another
 * organization, or simply isn't in the caller's allowedClinicIds.
 *
 * This suite has two parts (same shape as kvkkHigh006Batch2/3ClinicScope.test.ts
 * and imagingBridgePairing.test.ts — no live database is available in this
 * task's environment, so DB-backed integration coverage is out of reach here):
 *  1. Mock-based simulation — inline-replicates getAccessibleClinicIds() and
 *     the fixed handler's gate-then-parse-then-create flow against an
 *     in-memory "mockPatients" store, so a denied request can be asserted to
 *     leave the store completely untouched (no rows processed, no fallback
 *     write to the caller's own/default clinic either).
 *  2. Source regression checks — read the actual patientsImport.ts file and
 *     assert, by exact substring/ordering, that the access-check now guards
 *     both routes before parseExcelFile(), that the pre-existing per-row
 *     clinicIdFromRow validation is untouched, and that the allowed-role
 *     matrix (IMPORT_ROLES) has not been broadened.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ─── Test harness (same shape as sibling clinic-scope regression suites) ────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err?.message ?? err}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

// ─── clinicScope.ts mantığının inline kopyası (gerçek modülle aynı) ─────────

type User = {
  id: string;
  clinicId: string;
  organizationId: string;
  allowedClinicIds: string[];
  canAccessAllClinics: boolean;
  role: string;
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    clinicId: 'clinic-A',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    role: 'RECEPTIONIST',
    ...overrides,
  };
}

let mockOrgClinics: { id: string; organizationId: string }[] = [
  { id: 'clinic-A', organizationId: 'org-1' },
  { id: 'clinic-B', organizationId: 'org-1' },
  { id: 'clinic-C', organizationId: 'org-1' },
  { id: 'clinic-ORG2', organizationId: 'org-2' },
];

async function getAccessibleClinicIds(user: User): Promise<string[]> {
  if (user.canAccessAllClinics) {
    return mockOrgClinics.filter((c) => c.organizationId === user.organizationId).map((c) => c.id);
  }
  return user.allowedClinicIds;
}

const IMPORT_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'];

// ─── In-memory hasta deposu (disposable, gerçek DB yok) ─────────────────────

type MockPatient = { id: string; organizationId: string; clinicId: string; firstName: string; lastName: string; phone: string };
let mockPatients: MockPatient[] = [];
let mockActivityLog: { clinicId: string; action: string; entityType: string }[] = [];

function resetFixtures() {
  mockPatients = [];
  mockActivityLog = [];
}

type PatientRowInput = { firstName: string; lastName: string; phone: string; clinicId?: string };

// Mirrors the FIXED /patients/import-confirm handler: gate on selectedClinicId
// BEFORE any row is parsed/created, then fall back to per-row clinicIdFromRow
// validation exactly as before (unchanged).
async function simImportConfirm(
  user: User,
  rawSelectedClinicId: unknown,
  rows: PatientRowInput[],
): Promise<{ status: number; imported?: number; error?: string }> {
  const selectedClinicId = typeof rawSelectedClinicId === 'string' ? rawSelectedClinicId.trim() : undefined;

  const accessibleIds = await getAccessibleClinicIds(user);

  // ── THE FIX: reject before any workbook/row processing ──
  if (selectedClinicId && selectedClinicId !== 'all' && !accessibleIds.includes(selectedClinicId)) {
    return { status: 403, error: 'Access denied to requested clinic' };
  }

  // ── Unchanged per-row resolution logic ──
  let imported = 0;
  for (const row of rows) {
    const clinicIdFromRow = row.clinicId?.trim() ?? '';
    let resolvedClinicId: string | undefined;
    if (clinicIdFromRow) {
      if (!accessibleIds.includes(clinicIdFromRow)) continue; // invalid row, skipped
      resolvedClinicId = clinicIdFromRow;
    } else if (selectedClinicId && selectedClinicId !== 'all') {
      resolvedClinicId = selectedClinicId;
    } else {
      continue; // 'clinicId zorunludur' — invalid row, skipped
    }

    const patient: MockPatient = {
      id: `patient-${mockPatients.length + 1}`,
      organizationId: user.organizationId,
      clinicId: resolvedClinicId,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
    };
    mockPatients.push(patient);
    mockActivityLog.push({ clinicId: resolvedClinicId, action: 'created', entityType: 'patient' });
    imported++;
  }

  return { status: 200, imported };
}

// ══════════════════════════════════════════════════════════════════════════
// TESTLER
// ══════════════════════════════════════════════════════════════════════════

section('patients/import-confirm — clinic-scope simülasyonu (mock)');

await test('Cross-organization rejection: org-1 user submits org-2 clinic via ?clinicId= → 403, zero mutations', async () => {
  resetFixtures();
  const user = makeUser({ organizationId: 'org-1', allowedClinicIds: ['clinic-A'] });
  const rows: PatientRowInput[] = [{ firstName: 'Ali', lastName: 'Veli', phone: '+905550000001' }];

  const result = await simImportConfirm(user, 'clinic-ORG2', rows);

  assert.equal(result.status, 403);
  assert.equal(mockPatients.length, 0, 'no patients should be created anywhere');
  assert.ok(!mockPatients.some((p) => p.clinicId === 'clinic-ORG2'), 'no patient attached to the unauthorized clinic');
  assert.ok(!mockPatients.some((p) => p.clinicId === user.clinicId), 'no silent fallback write to the caller\'s own/default clinic');
  assert.equal(mockActivityLog.length, 0, 'no import-success activity record');
});

await test('Same-organization inaccessible-clinic rejection: user scoped to clinic-A submits sibling clinic-B → 403, zero mutations', async () => {
  resetFixtures();
  // Multi-clinic org (org-1 has clinic-A, clinic-B, clinic-C) but this user is
  // only assigned to clinic-A — distinct control from org membership.
  const user = makeUser({ organizationId: 'org-1', allowedClinicIds: ['clinic-A'] });
  const rows: PatientRowInput[] = [{ firstName: 'Ayşe', lastName: 'Demir', phone: '+905550000002' }];

  const result = await simImportConfirm(user, 'clinic-B', rows);

  assert.equal(result.status, 403);
  assert.equal(mockPatients.length, 0);
  assert.ok(!mockPatients.some((p) => p.clinicId === 'clinic-B'));
  assert.equal(mockActivityLog.length, 0);
});

await test('Accessible explicit clinic success: user submits a clinic they are authorized for → import succeeds under that clinic', async () => {
  resetFixtures();
  const user = makeUser({ organizationId: 'org-1', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const rows: PatientRowInput[] = [{ firstName: 'Mehmet', lastName: 'Can', phone: '+905550000003' }];

  const result = await simImportConfirm(user, 'clinic-B', rows);

  assert.equal(result.status, 200);
  assert.equal(result.imported, 1);
  assert.equal(mockPatients.length, 1);
  assert.equal(mockPatients[0].clinicId, 'clinic-B');
  assert.equal(mockActivityLog.length, 1);
});

await test('Default clinic behavior preserved: omitted query clinicId with accessible per-row clinicId still succeeds', async () => {
  resetFixtures();
  const user = makeUser({ organizationId: 'org-1', allowedClinicIds: ['clinic-A'] });
  const rows: PatientRowInput[] = [{ firstName: 'Zeynep', lastName: 'Kaya', phone: '+905550000004', clinicId: 'clinic-A' }];

  const result = await simImportConfirm(user, undefined, rows);

  assert.equal(result.status, 200, 'omitting the query clinicId must not itself trigger a 403');
  assert.equal(result.imported, 1);
  assert.equal(mockPatients[0].clinicId, 'clinic-A');
});

await test('Default clinic behavior preserved: omitted query clinicId with no per-row clinicId → row skipped, not a 403 (unchanged pre-existing behavior)', async () => {
  resetFixtures();
  const user = makeUser({ organizationId: 'org-1', allowedClinicIds: ['clinic-A'] });
  const rows: PatientRowInput[] = [{ firstName: 'Can', lastName: 'Öz', phone: '+905550000005' }];

  const result = await simImportConfirm(user, undefined, rows);

  assert.equal(result.status, 200);
  assert.equal(result.imported, 0, 'row without any clinicId source is skipped, not silently defaulted');
  assert.equal(mockPatients.length, 0);
});

await test('Blank query clinicId ("") does not bypass scope validation or produce a cross-tenant write', async () => {
  resetFixtures();
  const user = makeUser({ organizationId: 'org-1', allowedClinicIds: ['clinic-A'] });
  const rows: PatientRowInput[] = [{ firstName: 'Deniz', lastName: 'Ak', phone: '+905550000006' }];

  const result = await simImportConfirm(user, '', rows);

  assert.equal(result.status, 200, 'blank clinicId is treated as omitted, not as an authorization bypass');
  assert.equal(result.imported, 0);
  assert.equal(mockPatients.length, 0);
});

await test('Malformed/array query clinicId representation does not bypass scope validation', async () => {
  resetFixtures();
  const user = makeUser({ organizationId: 'org-1', allowedClinicIds: ['clinic-A'] });
  const rows: PatientRowInput[] = [{ firstName: 'Ece', lastName: 'Yıldız', phone: '+905550000007' }];

  // Express would parse `?clinicId=clinic-ORG2&clinicId=clinic-A` as an array,
  // and `?clinicId[]=x` as an object — neither is a `string`.
  const arrayLike = ['clinic-ORG2', 'clinic-A'];
  const objectLike = { '0': 'clinic-ORG2' };

  const resultArray = await simImportConfirm(user, arrayLike, rows);
  const resultObject = await simImportConfirm(user, objectLike, rows);

  assert.equal(resultArray.status, 200, 'non-string clinicId must not be trusted as a validated selection');
  assert.equal(resultArray.imported, 0, 'without a resolvable clinicId, no row is processed for creation');
  assert.equal(resultObject.status, 200);
  assert.equal(resultObject.imported, 0);
  assert.equal(mockPatients.length, 0, 'no cross-tenant write occurred via a malformed query representation');
});

await test('Role regression: RECEPTIONIST remains in IMPORT_ROLES (allowed), DENTIST remains excluded (unchanged matrix)', () => {
  assert.ok(IMPORT_ROLES.includes('RECEPTIONIST'), 'RECEPTIONIST must remain allowed — no narrowing');
  assert.ok(!IMPORT_ROLES.includes('DENTIST'), 'DENTIST must remain excluded — no broadening');
});

// ─── Source regression checks ────────────────────────────────────────────
section('Source regression — server/src/routes/patientsImport.ts');

const routeSrc = src('../routes/patientsImport.ts');

await test('IMPORT_ROLES matrix is unchanged (OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST only)', () => {
  const match = routeSrc.match(/const IMPORT_ROLES = \[([^\]]*)\];/);
  assert.ok(match, 'IMPORT_ROLES constant not found');
  const roles = match![1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.deepEqual(roles.sort(), ['CLINIC_MANAGER', 'ORG_ADMIN', 'OWNER', 'RECEPTIONIST'].sort());
});

await test('import-preview: selectedClinicId is validated against accessibleIds before parseExcelFile()', () => {
  const start = routeSrc.indexOf("'/patients/import-preview'");
  const end = routeSrc.indexOf("'/patients/import-confirm'");
  assert.ok(start >= 0 && end > start, 'could not isolate import-preview handler block');
  const block = routeSrc.slice(start, end);

  const accessibleIdx = block.indexOf('getAccessibleClinicIds(');
  const guardIdx = block.indexOf('!accessibleIds.includes(selectedClinicId)');
  const forbiddenIdx = block.indexOf("res.status(403).json({ error: 'Access denied to requested clinic' })");
  const parseIdx = block.indexOf('parseExcelFile(');

  assert.ok(accessibleIdx >= 0, 'expected getAccessibleClinicIds to be called');
  assert.ok(guardIdx >= 0, 'expected the accessibleIds.includes(selectedClinicId) guard');
  assert.ok(forbiddenIdx >= 0, 'expected a 403 Access denied response');
  assert.ok(parseIdx >= 0, 'expected parseExcelFile to be called');
  assert.ok(accessibleIdx < guardIdx, 'accessibleIds must be resolved before the guard checks it');
  assert.ok(guardIdx < parseIdx, 'the clinic-scope guard must run before the workbook is parsed');
  assert.ok(forbiddenIdx < parseIdx, 'the 403 response must be reachable before parseExcelFile runs');
});

await test('import-confirm: selectedClinicId is validated against accessibleIds before parseExcelFile() and before any patient is created', () => {
  const start = routeSrc.indexOf("'/patients/import-confirm'");
  assert.ok(start >= 0, 'could not find import-confirm handler');
  const block = routeSrc.slice(start);

  const accessibleIdx = block.indexOf('getAccessibleClinicIds(');
  const guardIdx = block.indexOf('!accessibleIds.includes(selectedClinicId)');
  const forbiddenIdx = block.indexOf("res.status(403).json({ error: 'Access denied to requested clinic' })");
  const parseIdx = block.indexOf('parseExcelFile(');
  const createIdx = block.indexOf('prisma.patient.create(');

  assert.ok(accessibleIdx >= 0);
  assert.ok(guardIdx >= 0);
  assert.ok(forbiddenIdx >= 0);
  assert.ok(parseIdx >= 0);
  assert.ok(createIdx >= 0);
  assert.ok(accessibleIdx < guardIdx, 'accessibleIds must be resolved before the guard checks it');
  assert.ok(guardIdx < parseIdx, 'the clinic-scope guard must run before the workbook is parsed');
  assert.ok(guardIdx < createIdx, 'the clinic-scope guard must run before any patient.create call');
  assert.ok(forbiddenIdx < createIdx, 'the 403 response must be reachable before any patient is created');
});

await test('query clinicId is type-narrowed to string before use (rejects array/object query representations)', () => {
  const occurrences = routeSrc.match(/typeof rawClinicId === 'string' \? rawClinicId\.trim\(\) : undefined/g) ?? [];
  assert.equal(occurrences.length, 2, 'expected the string type-guard in both import-preview and import-confirm');
});

await test('pre-existing per-row clinicIdFromRow validation is unchanged (still checks accessibleIds directly)', () => {
  assert.ok(routeSrc.includes('const clinicIdFromRow = row.clinicId?.trim() ?? \'\';'));
  assert.ok(routeSrc.includes('if (!accessibleIds.includes(clinicIdFromRow)) {'));
  assert.ok(routeSrc.includes('clinicId erişilemez veya bu organizasyona ait değil'));
});

await test('getAccessibleClinicIds remains the single source of accessible-clinic truth (no second reimplementation)', () => {
  assert.ok(routeSrc.includes("import { getAccessibleClinicIds } from '../utils/clinicScope.js';"));
  const defineCount = (routeSrc.match(/function getAccessibleClinicIds/g) ?? []).length;
  assert.equal(defineCount, 0, 'patientsImport.ts must not define its own copy of getAccessibleClinicIds');
});

// ─── Sonuç ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız oldu.`);
  process.exit(1);
} else {
  console.log('\nTüm testler geçti.');
}
