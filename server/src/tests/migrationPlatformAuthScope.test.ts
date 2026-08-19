/**
 * migrationPlatformAuthScope.test.ts — F3-DATA-MIG-TODAY-001
 *
 * Authorization and tenant-isolation regression for the NEW Platform Admin
 * clinic data migration API (server/src/routes/platformMigration.ts).
 *
 * WHY THIS SHAPE. No live database is available in this task's environment, so
 * this suite uses the two patterns the repo already established for exactly
 * that situation (see patientsImportClinicScope.test.ts and
 * kvkkHigh006Batch2/3ClinicScope.test.ts):
 *
 *   1. SOURCE REGRESSION — read the real router and the real app wiring as
 *      text and assert, by exact substring and ORDERING, that the
 *      authorization gate exists, that it precedes every route, and that the
 *      router is mounted before the global clinic authenticate. Ordering is
 *      the property that actually matters here and it is checkable statically.
 *
 *   2. MOCK SIMULATION — re-implement the tenant-verification rule against an
 *      in-memory fixture so a denied request can be asserted to leave the
 *      store completely untouched (no rows, no audit).
 *
 * The DB-backed counterparts (real 401/403 status codes, real cross-tenant
 * writes) live in migrationExecutionDb.test.ts under
 * `server:test:disposable-db`, which requires a disposable Postgres.
 *
 * The negative proofs required by the accepted migration contract §10:
 *   OWNER_DENIED · ORG_ADMIN_DENIED · CLINIC_MANAGER_DENIED · RECEPTIONIST_DENIED
 *   DENTIST_DENIED · BILLING_DENIED · UNAUTHENTICATED_DENIED
 *   CLINIC_COOKIE_CANNOT_AUTHORIZE_PLATFORM_MIGRATION
 *   ORG_CLINIC_MISMATCH_REJECTED · CROSS_ORG_DESTINATION_REJECTED
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIRST_CUSTOMER_MATRIX_BY_FIELD } from '../services/migration/mapping/firstCustomerMatrix.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${(err as Error)?.message ?? err}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

function src(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

const routerSrc = src('../routes/platformMigration.ts');
const indexSrc = src('../index.ts');

// ═══════════════════════════════════════════════════════════════════════════
section('1. The authorization gate exists and precedes every route');

await test('the router applies authenticatePlatformAdmin + platform CSRF via router.use', () => {
  assert.ok(
    routerSrc.includes(
      "router.use(authenticatePlatformAdmin as express.RequestHandler, csrfProtection('platform'));",
    ),
    'expected the same gate composition platformAdmin.ts:154 uses',
  );
});

await test('the gate appears BEFORE the first route declaration', () => {
  const gateIdx = routerSrc.indexOf('router.use(authenticatePlatformAdmin');
  assert.ok(gateIdx >= 0, 'gate not found');

  // The first router.get/post/put/delete in the file must come after the gate.
  const firstRoute = routerSrc.search(/router\.(get|post|put|patch|delete)\(/);
  assert.ok(firstRoute >= 0, 'no routes found');
  assert.ok(
    gateIdx < firstRoute,
    'a route is declared before the authentication gate — it would be publicly reachable',
  );
});

await test('EVERY route in the router is declared after the gate (none slips above it)', () => {
  const gateIdx = routerSrc.indexOf('router.use(authenticatePlatformAdmin');
  const routeRe = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  const before: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = routeRe.exec(routerSrc)) !== null) {
    if (match.index < gateIdx) before.push(`${match[1]} ${match[2]}`);
  }
  assert.deepEqual(before, [], `these routes bypass the auth gate: ${before.join(', ')}`);
});

await test('the router declares no unauthenticated escape hatch', () => {
  // platformAdmin.ts legitimately has /auth/login before its gate. This router
  // must have nothing of the kind — it is not an auth surface.
  assert.ok(!routerSrc.includes("'/auth/"), 'the migration router must expose no auth routes');
});

// ═══════════════════════════════════════════════════════════════════════════
section('2. Mount ordering — a clinic session can never reach these routes');

await test('the migration router is mounted on /api/platform', () => {
  assert.ok(
    indexSrc.includes("app.use('/api/platform', platformMigrationRoutes);"),
    'migration router is not mounted on the platform prefix',
  );
});

await test('it is mounted BEFORE the global clinic authenticate middleware', () => {
  const mountIdx = indexSrc.indexOf("app.use('/api/platform', platformMigrationRoutes);");
  const clinicAuthIdx = indexSrc.indexOf(
    "app.use('/api', authenticate as express.RequestHandler);",
  );
  assert.ok(mountIdx >= 0, 'mount not found');
  assert.ok(clinicAuthIdx >= 0, 'clinic authenticate not found');
  assert.ok(
    mountIdx < clinicAuthIdx,
    'the migration router must mount before the clinic auth middleware, as the other platform routers do',
  );
});

await test('it mounts alongside the other platform routers, not among the clinic routers', () => {
  const mountIdx = indexSrc.indexOf("app.use('/api/platform', platformMigrationRoutes);");
  const siblingIdx = indexSrc.indexOf("app.use('/api/platform', platformAdminRoutes);");
  const clinicAuthIdx = indexSrc.indexOf(
    "app.use('/api', authenticate as express.RequestHandler);",
  );
  assert.ok(siblingIdx < mountIdx && mountIdx < clinicAuthIdx);
});

await test('CLINIC_COOKIE_CANNOT_AUTHORIZE_PLATFORM_MIGRATION — separate secrets and identity table', () => {
  const authSrc = src('../middleware/platformAuth.ts');
  // The platform JWT is verified with PLATFORM_JWT_SECRET, requires a platform
  // type claim, and resolves against prisma.platformAdmin. A clinic session
  // token satisfies none of the three.
  assert.ok(authSrc.includes('PLATFORM_JWT_SECRET'), 'platform auth must use its own secret');
  assert.ok(
    authSrc.includes("decoded.type !== 'platform'"),
    'platform auth must reject a non-platform token type',
  );
  assert.ok(
    authSrc.includes('prisma.platformAdmin.findUnique'),
    'platform auth must resolve against the platformAdmin table, not user',
  );
});

await test('OWNER/ORG_ADMIN/CLINIC_MANAGER/RECEPTIONIST/DENTIST/BILLING are all denied by construction', () => {
  // Clinic roles are carried on the clinic session (req.user) and are checked
  // by `authorize([...])`. The migration router never imports either, so there
  // is no code path by which a clinic role reaches it — the denial is
  // structural rather than a per-role check that could be edited to add one.
  assert.ok(
    !routerSrc.includes("from '../middleware/auth.js'"),
    'the migration router must not import the clinic auth middleware',
  );
  assert.ok(
    !routerSrc.includes('authorize('),
    'the migration router must not use the clinic role authorizer — its gate is platform-admin identity, not a clinic role',
  );
  assert.ok(
    !routerSrc.includes('req.user'),
    'the migration router must never read the clinic user off the request',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
section('3. Tenant addressing is verified server-side, never inferred from data');

await test('the router resolves the target through resolveAndVerifyTarget', () => {
  assert.ok(routerSrc.includes('resolveAndVerifyTarget(organizationId, clinicId)'));
});

await test('ORG_CLINIC_MISMATCH is an explicit check, not an assumption', () => {
  const serviceSrc = src('../services/migration/migrationRunService.ts');
  assert.ok(
    serviceSrc.includes('clinic.organizationId !== organization.id'),
    'the clinic-belongs-to-organization check must be explicit — Prisma does not enforce it',
  );
  assert.ok(serviceSrc.includes("'ORG_CLINIC_MISMATCH'"));
});

await test('the source workbook can never nominate the destination tenant', () => {
  // SUBE_ID (the vendor branch column) must not be readable as a destination.
  assert.ok(
    !routerSrc.includes('SUBE_ID'),
    'the router must not reference the vendor branch column',
  );
  // Asserted against the LOADED matrix rather than by scanning source text:
  // entries are built through a helper that defaults destinationField, so a
  // textual scan runs into the NEXT entry's field and proves nothing.
  const subeEntry = FIRST_CUSTOMER_MATRIX_BY_FIELD.get('SUBE_ID');
  assert.ok(subeEntry, 'SUBE_ID should be dispositioned in the matrix');
  assert.equal(
    subeEntry!.destinationField ?? null,
    null,
    'SUBE_ID must have no destination — the destination clinic is operator-selected',
  );
  assert.equal(
    subeEntry!.disposition,
    'IGNORE_VENDOR_INTERNAL',
    'SUBE_ID must be deliberately ignored, not merely lacking a destination',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
section('4. Cross-tenant simulation — a denied request mutates nothing');

interface FixtureOrg {
  id: string;
  clinicIds: string[];
}
const orgs: FixtureOrg[] = [
  { id: 'org-1', clinicIds: ['clinic-A', 'clinic-B'] },
  { id: 'org-2', clinicIds: ['clinic-ORG2'] },
];

let createdRuns: { organizationId: string; clinicId: string }[] = [];
let auditRows: string[] = [];

function resetFixtures() {
  createdRuns = [];
  auditRows = [];
}

/** Mirrors resolveAndVerifyTarget + the run-create handler. */
function simCreateRun(
  organizationId: string,
  clinicId: string,
): { status: number; code?: string } {
  const org = orgs.find((o) => o.id === organizationId);
  if (!org) return { status: 404, code: 'ORGANIZATION_NOT_FOUND' };

  const owningOrg = orgs.find((o) => o.clinicIds.includes(clinicId));
  if (!owningOrg) return { status: 404, code: 'CLINIC_NOT_FOUND' };

  if (owningOrg.id !== org.id) return { status: 400, code: 'ORG_CLINIC_MISMATCH' };

  createdRuns.push({ organizationId, clinicId });
  auditRows.push('clinic_data_migration.run_created');
  return { status: 201 };
}

await test('CROSS_ORG_DESTINATION_REJECTED — org-1 + org-2 clinic → 400, zero mutations', () => {
  resetFixtures();
  const result = simCreateRun('org-1', 'clinic-ORG2');
  assert.equal(result.status, 400);
  assert.equal(result.code, 'ORG_CLINIC_MISMATCH');
  assert.equal(createdRuns.length, 0, 'no run may be created');
  assert.equal(auditRows.length, 0, 'no audit row may be written for a rejected request');
});

await test('unknown organization → 404, zero mutations', () => {
  resetFixtures();
  const result = simCreateRun('org-does-not-exist', 'clinic-A');
  assert.equal(result.status, 404);
  assert.equal(result.code, 'ORGANIZATION_NOT_FOUND');
  assert.equal(createdRuns.length, 0);
  assert.equal(auditRows.length, 0);
});

await test('unknown clinic → 404, zero mutations', () => {
  resetFixtures();
  const result = simCreateRun('org-1', 'clinic-nope');
  assert.equal(result.status, 404);
  assert.equal(result.code, 'CLINIC_NOT_FOUND');
  assert.equal(createdRuns.length, 0);
  assert.equal(auditRows.length, 0);
});

await test('a coherent org+clinic pair succeeds and lands in exactly that tenant', () => {
  resetFixtures();
  const result = simCreateRun('org-1', 'clinic-B');
  assert.equal(result.status, 201);
  assert.equal(createdRuns.length, 1);
  assert.deepEqual(createdRuns[0], { organizationId: 'org-1', clinicId: 'clinic-B' });
  assert.equal(auditRows.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
section('5. No raw PII can reach an audit payload or a log line');

await test('audit metadata never carries the operator-supplied filename', () => {
  const uploadBlock = routerSrc.slice(
    routerSrc.indexOf("'/migrations/runs/:id/upload'"),
    routerSrc.indexOf("'/migrations/runs/:id/analyze'"),
  );
  const metaMatch = uploadBlock.match(/safeMetadata:\s*\{([^}]*)\}/);
  assert.ok(metaMatch, 'upload should write safeMetadata');
  const meta = metaMatch[1]!;
  assert.ok(!meta.includes('originalname'), 'the raw upload filename must never be audited');
  assert.ok(!meta.includes('sourceFileNameSafe'), 'not even the sanitized display name is audited');
  assert.ok(meta.includes('format') && meta.includes('sha256'));
});

await test('the identity value never appears on a row outcome or an audit payload', () => {
  const executorSrc = src('../services/migration/executor.ts');
  // The only place the plaintext is touched is the encryptor call.
  const plaintextUses = executorSrc.split('\n').filter((l) => l.includes('identity.normalized'));
  assert.ok(plaintextUses.length > 0, 'expected the encryptor to consume the normalized value');
  for (const line of plaintextUses) {
    assert.ok(
      line.includes('encryptIdentityValue') ||
        line.includes('identity.normalized &&') ||
        line.includes('if (identity'),
      `identity plaintext used outside the encryptor call: ${line.trim()}`,
    );
  }
  assert.ok(
    !executorSrc.includes('identityRawValue,') || !executorSrc.includes('safeMetadata'),
    'the raw identity value must never be placed in audit metadata',
  );
});

await test('the executor logs only through the safe log-context builder', () => {
  const executorSrc = src('../services/migration/executor.ts');
  const loggerCalls = executorSrc.match(/logger\.(info|warn|error|debug)\(/g) ?? [];
  assert.ok(loggerCalls.length > 0, 'expected the executor to log progress');
  // Every logger call's first argument must be safeLogContext(...).
  const re = /logger\.(?:info|warn|error|debug)\(\s*\n?\s*([A-Za-z{])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(executorSrc)) !== null) {
    assert.ok(
      executorSrc.slice(m.index, m.index + 80).includes('safeLogContext'),
      'every executor log call must pass safeLogContext as its first argument',
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
section('6. The frozen basic clinic importer boundary is untouched');

await test('the migration router shares no module with patientsImport.ts', () => {
  const basicSrc = src('../routes/patientsImport.ts');
  // The basic importer parses via utils/excelImport.ts. The migration engine
  // must not reuse it — reusing it would couple the frozen boundary to this
  // feature's change cadence.
  assert.ok(basicSrc.includes("from '../utils/excelImport.js'"));
  assert.ok(
    !routerSrc.includes('excelImport'),
    'the migration router must not reuse the basic importer parser',
  );
});

await test('the basic importer still declares its own unchanged role matrix', () => {
  const basicSrc = src('../routes/patientsImport.ts');
  const match = basicSrc.match(/const IMPORT_ROLES = \[([^\]]*)\];/);
  assert.ok(match, 'IMPORT_ROLES not found');
  const roles = match[1]!
    .split(',')
    .map((s) => s.trim().replace(/['"]/g, ''))
    .filter(Boolean);
  assert.deepEqual(
    roles.sort(),
    ['CLINIC_MANAGER', 'ORG_ADMIN', 'OWNER', 'RECEPTIONIST'].sort(),
    'the basic importer role matrix must be unchanged by this sprint',
  );
});

/**
 * `notes:` LEFT THIS FORBIDDEN LIST IN F3-DATA-MIG-TODAY-001-FINAL-R7, and
 * the test below replaces it with a NARROWER guard rather than simply
 * dropping the check.
 *
 * Why it left: the four columns that fed it (ONEMLINOT / KONTROLNOTU /
 * UZUNNOT / KANGURUBU) were withheld ONLY for being KVKK Art. 6
 * special-category, and that disposition is now rejected for an incumbent
 * clinic's own operational record. Sensitivity governs HOW the data moves,
 * not WHETHER it may.
 *
 * Why the guard stays: the consent fields are a DIFFERENT rule. A migration
 * may never manufacture a lawful basis, and nothing about R7 touches that.
 */
await test('the migration feature never writes consent, postalCode, source or createdAt', () => {
  const executorSrc = src('../services/migration/executor.ts');
  const createBlock = executorSrc.slice(
    executorSrc.indexOf('tx.patient.create('),
    executorSrc.indexOf('tx.migrationRecord.create('),
  );
  for (const forbidden of [
    'communicationConsent:',
    'marketingConsent:',
    'smsOptOut:',
    'postalCode:',
    'createdAt:',
    'deletedAt:',
    'isAnonymized:',
    'source:',
  ]) {
    assert.ok(
      !createBlock.includes(forbidden),
      `the migration must not set ${forbidden} on a patient`,
    );
  }
});

await test('R7: patient.notes is written ONLY from the reviewed draft, never from a literal or a source value', () => {
  const executorSrc = src('../services/migration/executor.ts');
  const createBlock = executorSrc.slice(
    executorSrc.indexOf('tx.patient.create('),
    executorSrc.indexOf('tx.migrationRecord.create('),
  );
  // Exactly one assignment, and it is the vendor-neutral draft field. A
  // literal, a workbook cell or a vendor column name here would mean the
  // executor had learned source semantics it must not have.
  const assignments = createBlock.match(/(^|[^A-Za-z0-9_.])notes:\s*([^,]+),/gm) ?? [];
  assert.equal(assignments.length, 1, 'expected exactly one notes: assignment in the patient create');
  assert.ok(
    /notes:\s*row\.draft\.notes,/.test(createBlock),
    'notes must come from row.draft.notes and nothing else',
  );

  // And the draft field itself may only be populated through the destination
  // catalog key, i.e. through a mapping an operator resolved.
  const rowBuilderSrc = src('../services/migration/rowBuilder.ts');
  assert.ok(
    rowBuilderSrc.includes("notes: asString(read('patient.notes')),"),
    'the draft may only take notes from the patient.notes destination mapping',
  );

  // compileMapping only compiles WRITING states, so a column still sitting in
  // SENSITIVE_REVIEW_REQUIRED contributes nothing. Guard that too: if this
  // set ever grew to include the review state, unapproved special-category
  // text would start importing itself.
  const writingStates = rowBuilderSrc.match(/const WRITING_STATES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(writingStates, 'WRITING_STATES not found in rowBuilder.ts');
  const states = writingStates[1]!
    .split(',')
    .map((x) => x.trim().replace(/['\"]/g, ''))
    .filter(Boolean);
  assert.deepEqual(
    states.sort(),
    ['AUTO_CONFIDENT', 'RESOLVED'],
    'only an explicitly decided mapping may ever be written',
  );
  assert.ok(
    !states.includes('SENSITIVE_REVIEW_REQUIRED'),
    'a merely-proposed special-category mapping must never be compiled into a write',
  );
});

/**
 * R1/BLOCKER-1. primaryClinicId is deliberately NOT in the forbidden list any
 * more: leaving it null made every imported patient invisible to organization
 * patient metrics, which filter on it. It must be set, and it must be set to
 * the run's server-validated target clinic — never to a workbook branch value.
 */
await test('the migration sets primaryClinicId to the run target clinic only', () => {
  const executorSrc = src('../services/migration/executor.ts');
  const createBlock = executorSrc.slice(
    executorSrc.indexOf('tx.patient.create('),
    executorSrc.indexOf('tx.migrationRecord.create('),
  );
  assert.ok(
    /primaryClinicId:\s*clinicId\s*,/.test(createBlock),
    "primaryClinicId must be assigned the run's validated target clinicId",
  );
  // The only value it may take is the run's clinicId binding. Any source-derived
  // expression (a mapped draft field or a branch column) is forbidden.
  assert.ok(
    !/primaryClinicId:\s*row\./.test(createBlock),
    'primaryClinicId must never come from a source row',
  );
  // Comments are stripped first: the create block DOCUMENTS that SUBE_ID is not
  // a source for this field, and a naive scan would flag its own explanation.
  const codeOnly = createBlock
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(
    !/SUBE_ID/i.test(codeOnly),
    'no source branch identifier may appear in the patient create block',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(60)}`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız oldu.`);
  process.exit(1);
} else {
  console.log('\nTüm testler geçti.');
}
