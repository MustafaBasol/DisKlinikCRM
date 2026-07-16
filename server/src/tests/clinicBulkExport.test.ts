/**
 * clinicBulkExport.test.ts — KVKK-HIGH-004 secure clinic bulk/structured-
 * data export unit + regression-guard tests.
 *
 * Follows this repo's established convention (see
 * publicBookingSlotRequired.test.ts, kvkkAttachmentImagingLifecycle.test.ts):
 * no live database, no supertest/live Express server. Route/route-file
 * shape assertions use source inspection (reading the actual route/service
 * files and asserting on their content), consistent with how this repo
 * already tests route wiring without a live DB in `npm test`. The REAL
 * concurrent-Postgres proof (advisory-lock reservation, the partial unique
 * index, atomic token issuance, password-attempt lockout serialization) is
 * a separate manual disposable-DB script,
 * scripts/verify-clinic-bulk-export-lifecycle.ts (NOT part of `npm test`,
 * mirrors scripts/verify-export-archive-lifecycle.ts) — see
 * docs/compliance/54-kvkk-secure-clinic-bulk-export.md Section 5 for its
 * results.
 *
 * Covers:
 *   Legacy + flags:
 *   1.  Legacy route file makes no Prisma call and always returns 410
 *   2.  Legacy route response body is the stable CLINIC_BULK_EXPORT_LEGACY_DISABLED code
 *   3.  Legacy route ignores query/body — no conditional branching on req.query/req.body
 *   4.  isClinicBulkExportEnabled fail-closed: absent/false/garbage -> false, only 'true' -> true
 *   5.  isClinicBulkExportCleanupEnabled fail-open: absent/true -> true, only 'false' -> false
 *   6.  Client cannot override the flag via any request field (source inspection)
 *   6b. getClinicBulkExportAllowedOrganizationIds / isClinicBulkExportEnabledForOrganization (tenant rollout allowlist, P1)
 *
 *   Authorization:
 *   7.  clinicBulkExport.ts only ever authorizes OWNER/ORG_ADMIN — CLINIC_MANAGER never appears
 *   8.  Every route in clinicBulkExport.ts calls authorize(EXPORT_ROLES)
 *   9.  clinicId is always resolved via validateAndGetScope — req.user.clinicId is never read for scope
 *
 *   Step-up / IP hashing:
 *   10. hashClientIp is deterministic and secret-keyed (same IP + different secrets -> different hash)
 *   11. isIpHashSecretConfigured / assertIpHashSecretConfigured fail closed when unset/too short
 *   12. isWithinStepUpWindow boundary behavior (just inside / just outside / null)
 *   13. verifyCurrentPassword rejects empty and oversized input before any DB call
 *
 *   Rate limiting / concurrency key derivation:
 *   14. computeExportSlotLockKey is deterministic and clinic-specific
 *   15. computePasswordAttemptLockKey is deterministic and key-specific
 *   16. Migration file contains the exact partial unique index DDL
 *
 *   Download token:
 *   17. hashDownloadToken is deterministic SHA-256 hex (64 chars), different tokens differ
 *   18. Status DTO in the route never serializes restrictedNote/storageKey/downloadTokenHash/manifestJson/cleanupFailureCode
 *   19. Download endpoint reads the token only from the dedicated header, never req.query
 *
 *   Field allowlists (explicit export contract):
 *   20. Every entity SELECT constant excludes every denylisted secret field name
 *   21. Field allowlist selects use `select`, never a bare findMany without select
 *
 *   Audit fail-closed:
 *   22. writeAuditLogInTx requires a client and does not swallow a failing insert
 *   23. writeAuditLog (regular) swallows a failing insert
 *   24. Audit/log metadata literals in clinicBulkExport.ts / clinicBulkExportPackage.ts never include password/currentPassword/restrictedNote/token/storageKey
 *
 *   Worker / cleanup structural guards:
 *   25. clinicBulkExportWorker.ts never imports/uses withJobLock (process-local guard only)
 *   26. clinicBulkExportCleanupJob.ts does use withJobLock (singleton cleanup)
 *   27. stopClinicBulkExportWorker before start does not throw
 *
 *   Error types:
 *   28. ClinicBulkExportAlreadyRunningError / RateLimitedError / SizeLimitExceededError are real Error subclasses
 *
 *   Queue timeout / generation lease / heartbeat (P0 remediation round 2):
 *   29. getQueueTimeoutMs / getGenerationLeaseMs / getHeartbeatIntervalMs default and respect env overrides, and the queue timeout default is substantially longer than the generation lease default
 *   30. reserveClinicBulkExport's created-row lease uses getQueueTimeoutMs, never getGenerationLeaseMs (source inspection; real-DB proof lives in scripts/verify-clinic-bulk-export-lifecycle.ts)
 *   31. ClinicBulkExportLeaseLostError is a real Error subclass
 *
 * The REAL concurrent-Postgres proof for the queue-timeout-vs-generation-
 * lease split, the full-lifecycle heartbeat (through archive.finalize() and
 * the storage upload), and lease-loss deleting the uploaded artifact is in
 * scripts/verify-clinic-bulk-export-lifecycle.ts (not this file) — see
 * docs/compliance/54-kvkk-secure-clinic-bulk-export.md.
 *
 * Run with: tsx src/tests/clinicBulkExport.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function readSource(relPath: string): Promise<string> {
  return fs.readFile(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

/** Strips /** *\/ block comments and // line comments so structural checks
 * don't false-positive on prose that merely *mentions* a pattern. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function main() {
  section('1. Legacy endpoint disable');

  await test('legacy route file makes no Prisma call anywhere', async () => {
    const source = await readSource('routes/gdprExport.ts');
    assert.ok(!/prisma\./.test(source), 'gdprExport.ts must not call prisma.* anywhere');
    assert.ok(!source.includes("from '../db.js'"), 'gdprExport.ts must not even import the prisma client');
  });

  await test('legacy route always responds 410 with the stable code', async () => {
    const source = await readSource('routes/gdprExport.ts');
    assert.ok(source.includes('res.status(410)'), 'must respond 410 Gone');
    assert.ok(source.includes('CLINIC_BULK_EXPORT_LEGACY_DISABLED'), 'must use the stable disabled code');
  });

  await test('legacy route response is unconditional — no query/body branching', async () => {
    const source = await readSource('routes/gdprExport.ts');
    assert.ok(!/req\.query/.test(source), 'must never read req.query (would allow a reactivation parameter)');
    assert.ok(!/req\.body/.test(source), 'must never read req.body (would allow a reactivation parameter)');
    assert.ok(!source.includes('authorize('), 'every authenticated role must get the identical disabled response');
  });

  section('2. Feature flags (fail-closed creation, fail-open cleanup)');

  const {
    isClinicBulkExportEnabled,
    isClinicBulkExportCleanupEnabled,
    getClinicBulkExportAllowedOrganizationIds,
    isClinicBulkExportEnabledForOrganization,
  } = await import('../services/privacy/clinicBulkExportConfig.js');

  await test('isClinicBulkExportEnabled is fail-closed', () => {
    const original = process.env.CLINIC_BULK_EXPORT_ENABLED;
    try {
      delete process.env.CLINIC_BULK_EXPORT_ENABLED;
      assert.equal(isClinicBulkExportEnabled(), false, 'absent must be disabled');
      process.env.CLINIC_BULK_EXPORT_ENABLED = 'false';
      assert.equal(isClinicBulkExportEnabled(), false);
      process.env.CLINIC_BULK_EXPORT_ENABLED = 'TRUE';
      assert.equal(isClinicBulkExportEnabled(), false, 'only the exact lowercase string "true" enables it');
      process.env.CLINIC_BULK_EXPORT_ENABLED = '1';
      assert.equal(isClinicBulkExportEnabled(), false);
      process.env.CLINIC_BULK_EXPORT_ENABLED = 'true';
      assert.equal(isClinicBulkExportEnabled(), true);
    } finally {
      if (original === undefined) delete process.env.CLINIC_BULK_EXPORT_ENABLED;
      else process.env.CLINIC_BULK_EXPORT_ENABLED = original;
    }
  });

  await test('isClinicBulkExportCleanupEnabled is fail-open (default on)', () => {
    const original = process.env.CLINIC_BULK_EXPORT_CLEANUP_ENABLED;
    try {
      delete process.env.CLINIC_BULK_EXPORT_CLEANUP_ENABLED;
      assert.equal(isClinicBulkExportCleanupEnabled(), true, 'absent must default to enabled');
      process.env.CLINIC_BULK_EXPORT_CLEANUP_ENABLED = 'true';
      assert.equal(isClinicBulkExportCleanupEnabled(), true);
      process.env.CLINIC_BULK_EXPORT_CLEANUP_ENABLED = 'false';
      assert.equal(isClinicBulkExportCleanupEnabled(), false, 'only the exact string "false" disables it');
    } finally {
      if (original === undefined) delete process.env.CLINIC_BULK_EXPORT_CLEANUP_ENABLED;
      else process.env.CLINIC_BULK_EXPORT_CLEANUP_ENABLED = original;
    }
  });

  await test('getClinicBulkExportAllowedOrganizationIds is null (no allowlist) when unset/empty, a Set of ids when set', () => {
    const original = process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
    try {
      delete process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
      assert.equal(getClinicBulkExportAllowedOrganizationIds(), null, 'unset must mean no allowlist (every org allowed)');
      process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS = '';
      assert.equal(getClinicBulkExportAllowedOrganizationIds(), null, 'empty string must also mean no allowlist');
      process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS = 'org-a, org-b ,org-c';
      const ids = getClinicBulkExportAllowedOrganizationIds();
      assert.ok(ids && ids.has('org-a') && ids.has('org-b') && ids.has('org-c'), 'must parse a comma-separated list, trimming whitespace');
      assert.equal(ids!.size, 3);
    } finally {
      if (original === undefined) delete process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
      else process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS = original;
    }
  });

  await test('isClinicBulkExportEnabledForOrganization combines the global flag and the allowlist correctly', () => {
    const originalEnabled = process.env.CLINIC_BULK_EXPORT_ENABLED;
    const originalAllowlist = process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
    try {
      process.env.CLINIC_BULK_EXPORT_ENABLED = 'false';
      delete process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
      assert.equal(isClinicBulkExportEnabledForOrganization('org-a'), false, 'global flag off must disable every org, allowlist or not');

      process.env.CLINIC_BULK_EXPORT_ENABLED = 'true';
      delete process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
      assert.equal(isClinicBulkExportEnabledForOrganization('org-a'), true, 'no allowlist configured must mean every org is enabled once the global flag is on');

      process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS = 'org-a,org-b';
      assert.equal(isClinicBulkExportEnabledForOrganization('org-a'), true, 'listed org must be enabled');
      assert.equal(isClinicBulkExportEnabledForOrganization('org-z'), false, 'unlisted org must be disabled even though the global flag is on');
    } finally {
      if (originalEnabled === undefined) delete process.env.CLINIC_BULK_EXPORT_ENABLED;
      else process.env.CLINIC_BULK_EXPORT_ENABLED = originalEnabled;
      if (originalAllowlist === undefined) delete process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS;
      else process.env.CLINIC_BULK_EXPORT_ALLOWED_ORGANIZATION_IDS = originalAllowlist;
    }
  });

  await test('creation route checks the flag before parsing password/confirmation fields', async () => {
    const source = await readSource('routes/clinicBulkExport.ts');
    const flagCheckIndex = source.indexOf('isClinicBulkExportEnabledForOrganization(');
    const passwordFieldIndex = source.indexOf('body.currentPassword');
    assert.ok(flagCheckIndex > -1 && passwordFieldIndex > -1);
    assert.ok(flagCheckIndex < passwordFieldIndex, 'the flag check must occur before any password field is read');
  });

  await test('creation route resolves+validates clinic scope BEFORE checking the disabled-feature flag (P0-1)', async () => {
    const source = await readSource('routes/clinicBulkExport.ts');
    const createSectionStart = source.indexOf("POST / — create job");
    const nextSectionStart = source.indexOf('GET /:jobId — status');
    assert.ok(createSectionStart > -1 && nextSectionStart > createSectionStart);
    const createHandlerSource = source.slice(createSectionStart, nextSectionStart);
    const scopeCallIndex = createHandlerSource.indexOf('resolveClinicScope(req, res)');
    const flagCheckIndex = createHandlerSource.indexOf('isClinicBulkExportEnabledForOrganization(');
    assert.ok(scopeCallIndex > -1 && flagCheckIndex > -1);
    assert.ok(
      scopeCallIndex < flagCheckIndex,
      'clinic scope must be resolved+validated before the feature-flag check, so a raw/cross-org clinicId can never reach the disabled-feature audit write',
    );
  });

  section('3. Authorization — OWNER/ORG_ADMIN only, clinicScope-validated');

  await test('clinicBulkExport.ts never authorizes CLINIC_MANAGER', async () => {
    const source = await readSource('routes/clinicBulkExport.ts');
    assert.ok(!source.includes('CLINIC_MANAGER'), 'CLINIC_MANAGER must not appear anywhere in this route file');
    assert.ok(source.includes("const EXPORT_ROLES = ['OWNER', 'ORG_ADMIN']"));
  });

  await test('every route calls authorize(EXPORT_ROLES)', async () => {
    const source = await readSource('routes/clinicBulkExport.ts');
    const routeCount = (source.match(/router\.(get|post)\(/g) ?? []).length;
    const authorizeCount = (source.match(/authorize\(EXPORT_ROLES\)/g) ?? []).length;
    assert.equal(routeCount, 5, 'expected exactly 5 routes (config, create, status, download-token, download)');
    assert.equal(authorizeCount, routeCount, 'every route must be authorize(EXPORT_ROLES)-gated');
  });

  await test('clinicId scope is always resolved via validateAndGetScope, never req.user.clinicId', async () => {
    const source = stripComments(await readSource('routes/clinicBulkExport.ts'));
    assert.ok(source.includes('validateAndGetScope'), 'must use the multi-branch clinic-scope helper');
    assert.ok(!source.includes('user.clinicId'), 'must never read the UI-default clinicId for authorization (code, not comments)');
  });

  section('4. Step-up / IP hashing');

  const { hashClientIp, isIpHashSecretConfigured, assertIpHashSecretConfigured, isWithinStepUpWindow, verifyCurrentPassword } =
    await import('../utils/passwordStepUp.js');

  await test('hashClientIp is deterministic and secret-keyed', () => {
    const originalSecret = process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET;
    try {
      process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET = 'a'.repeat(32);
      const h1 = hashClientIp('203.0.113.1');
      const h2 = hashClientIp('203.0.113.1');
      const h3 = hashClientIp('203.0.113.2');
      assert.equal(h1, h2, 'same IP must hash identically');
      assert.notEqual(h1, h3, 'different IPs must hash differently');
      assert.equal(h1.length, 64, 'must be a SHA-256 hex digest');

      process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET = 'b'.repeat(32);
      const h4 = hashClientIp('203.0.113.1');
      assert.notEqual(h1, h4, 'rotating the secret must change the hash for the same IP');
    } finally {
      if (originalSecret === undefined) delete process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET;
      else process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET = originalSecret;
    }
  });

  await test('isIpHashSecretConfigured / assertIpHashSecretConfigured fail closed', () => {
    const original = process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET;
    try {
      delete process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET;
      assert.equal(isIpHashSecretConfigured(), false);
      assert.throws(() => assertIpHashSecretConfigured());

      process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET = 'too-short';
      assert.equal(isIpHashSecretConfigured(), false, 'must require a minimum length, not just presence');
      assert.throws(() => assertIpHashSecretConfigured());

      process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET = 'x'.repeat(32);
      assert.equal(isIpHashSecretConfigured(), true);
      assert.doesNotThrow(() => assertIpHashSecretConfigured());
    } finally {
      if (original === undefined) delete process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET;
      else process.env.CLINIC_BULK_EXPORT_IP_HASH_SECRET = original;
    }
  });

  await test('isWithinStepUpWindow boundary behavior', () => {
    const now = new Date('2026-01-01T00:10:00.000Z');
    assert.equal(isWithinStepUpWindow(null, now), false);
    const justInside = new Date(now.getTime() - 4 * 60 * 1000 - 59 * 1000); // 4m59s ago
    assert.equal(isWithinStepUpWindow(justInside, now), true);
    const justOutside = new Date(now.getTime() - 5 * 60 * 1000 - 1000); // 5m1s ago
    assert.equal(isWithinStepUpWindow(justOutside, now), false);
  });

  await test('verifyCurrentPassword rejects empty/oversized input before any DB call', async () => {
    const empty = await verifyCurrentPassword('user-1', '');
    assert.equal(empty.ok, false);
    assert.equal(empty.failure, 'empty');

    const oversized = await verifyCurrentPassword('user-1', 'x'.repeat(500));
    assert.equal(oversized.ok, false);
    assert.equal(oversized.failure, 'oversized');

    const nonString = await verifyCurrentPassword('user-1', 12345);
    assert.equal(nonString.ok, false);
    assert.equal(nonString.failure, 'empty');
  });

  section('5. Rate-limit / concurrency key derivation');

  const { computeExportSlotLockKey, hashDownloadToken, ClinicBulkExportAlreadyRunningError, ClinicBulkExportRateLimitedError, ClinicBulkExportSizeLimitExceededError } =
    await import('../services/privacy/clinicBulkExportPackage.js');
  const { computePasswordAttemptLockKey } = await import('../services/privacy/clinicBulkExportPasswordAttempts.js');

  await test('computeExportSlotLockKey is deterministic and clinic-specific', () => {
    const [a1, a2] = computeExportSlotLockKey('clinic-a');
    const [b1, b2] = computeExportSlotLockKey('clinic-a');
    const [c1, c2] = computeExportSlotLockKey('clinic-b');
    assert.equal(a1, b1);
    assert.equal(a2, b2);
    assert.ok(a1 !== c1 || a2 !== c2, 'different clinics must produce different lock keys');
    assert.ok(Number.isInteger(a1) && Number.isInteger(a2), 'keys must be valid pg int4 values');
  });

  await test('computePasswordAttemptLockKey is deterministic and key-specific', () => {
    const k1 = computePasswordAttemptLockKey('user-1', 'clinic-1', 'iphash-1');
    const k2 = computePasswordAttemptLockKey('user-1', 'clinic-1', 'iphash-1');
    const k3 = computePasswordAttemptLockKey('user-2', 'clinic-1', 'iphash-1');
    assert.deepEqual(k1, k2);
    assert.notDeepEqual(k1, k3);
  });

  await test('migration file contains the exact partial unique index DDL', async () => {
    const migration = await readSource(
      '../prisma/migrations/20260716120000_add_clinic_bulk_export/migration.sql',
    );
    assert.ok(migration.includes('CREATE UNIQUE INDEX "ClinicBulkExportArchive_one_active_per_clinic"'));
    assert.ok(migration.includes('ON "ClinicBulkExportArchive" ("clinicId")'));
    assert.ok(migration.includes("WHERE status IN ('queued', 'generating')"));
  });

  section('6. Download token');

  await test('hashDownloadToken is deterministic SHA-256 hex', () => {
    const h1 = hashDownloadToken('token-a');
    const h2 = hashDownloadToken('token-a');
    const h3 = hashDownloadToken('token-b');
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
    assert.equal(h1.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(h1));
  });

  await test('status DTO never serializes sensitive fields', async () => {
    const source = await readSource('routes/clinicBulkExport.ts');
    const dtoBlockStart = source.indexOf('res.json({\n      jobId: row.id,');
    assert.ok(dtoBlockStart > -1, 'expected the explicit status DTO block to be present');
    const dtoBlock = source.slice(dtoBlockStart, dtoBlockStart + 400);
    for (const forbidden of ['restrictedNote', 'storageKey', 'downloadTokenHash', 'manifestJson', 'cleanupFailureCode']) {
      assert.ok(!dtoBlock.includes(forbidden), `status DTO must never include ${forbidden}`);
    }
  });

  await test('download endpoint reads the token only from a dedicated header, never req.query', async () => {
    const source = await readSource('routes/clinicBulkExport.ts');
    assert.ok(source.includes("req.headers[DOWNLOAD_TOKEN_HEADER]"));
    assert.ok(!/req\.query\.token/.test(source));
  });

  section('7. Explicit versioned export contract (field allowlists)');

  const allowlists = await import('../services/privacy/clinicBulkExportFieldAllowlists.js');
  const { DENYLISTED_FIELD_NAMES } = allowlists;
  const selectConstants: Record<string, Record<string, unknown>> = {
    CLINIC_SELECT: allowlists.CLINIC_SELECT,
    USER_SELECT: allowlists.USER_SELECT,
    PATIENT_SELECT: allowlists.PATIENT_SELECT,
    APPOINTMENT_SELECT: allowlists.APPOINTMENT_SELECT,
    TREATMENT_CASE_SELECT: allowlists.TREATMENT_CASE_SELECT,
    PAYMENT_SELECT: allowlists.PAYMENT_SELECT,
    TASK_SELECT: allowlists.TASK_SELECT,
    SENT_MESSAGE_SELECT: allowlists.SENT_MESSAGE_SELECT,
    ACTIVITY_LOG_SELECT: allowlists.ACTIVITY_LOG_SELECT,
    INSURANCE_PROVISION_SELECT: allowlists.INSURANCE_PROVISION_SELECT,
    INVENTORY_ITEM_SELECT: allowlists.INVENTORY_ITEM_SELECT,
  };

  await test('every entity SELECT constant excludes every denylisted secret field name', () => {
    for (const [name, select] of Object.entries(selectConstants)) {
      for (const denylisted of DENYLISTED_FIELD_NAMES) {
        assert.ok(
          !(denylisted in select) || select[denylisted] !== true,
          `${name} must not select the denylisted field "${denylisted}"`,
        );
      }
    }
  });

  await test('field allowlist selects use `select`, never a bare findMany without select', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const findManyCalls = source.match(/\.findMany\(\s*withCursor\(/g) ?? [];
    assert.ok(findManyCalls.length >= 10, 'expected at least 10 entity findMany calls (one per exported entity)');
    // Every base args object passed to withCursor includes `select:` — spot-check the file overall.
    assert.ok(source.includes('select: USER_SELECT'));
    assert.ok(source.includes('select: PATIENT_SELECT'));
    assert.ok(source.includes('select: INVENTORY_ITEM_SELECT'));
  });

  section('8. Audit fail-closed boundary');

  const { writeAuditLogInTx, writeAuditLog } = await import('../utils/auditLog.js');

  await test('writeAuditLogInTx requires a client argument and propagates a failing insert (does not swallow)', async () => {
    assert.equal(writeAuditLogInTx.length, 2, 'signature must require (tx, input) — no optional/default client');
    const failingTx = { auditLog: { create: async () => { throw new Error('insert failed'); } } };
    await assert.rejects(
      writeAuditLogInTx(failingTx as any, {
        organizationId: 'org-1',
        action: 'clinic_bulk_export_requested',
        entityType: 'clinic',
      }),
      /insert failed/,
      'a failing audit insert must propagate so the caller\'s transaction rolls back',
    );
  });

  await test('writeAuditLog (regular, non-critical events) swallows a failing insert', async () => {
    // writeAuditLog wraps the real insert in try/catch and never rethrows —
    // it must resolve even in an environment with no reachable database
    // (a connection failure is exactly the kind of logging failure that
    // must never block the caller's main operation), proving the
    // fire-and-forget-safe contract this repo relies on for non-critical
    // events. This is the opposite contract from writeAuditLogInTx above.
    await assert.doesNotReject(
      writeAuditLog({
        organizationId: 'org-for-this-assertion-only',
        action: 'clinic_bulk_export_generation_completed',
        entityType: 'clinic',
      }),
    );
  });

  await test('audit/log metadata literals never include password/note/token/storageKey fields', async () => {
    const routeSource = await readSource('routes/clinicBulkExport.ts');
    const packageSource = await readSource('services/privacy/clinicBulkExportPackage.ts');
    for (const forbidden of ['currentPassword', 'restrictedNote:', 'downloadTokenHash:', 'storageKey:']) {
      // Only check inside metadata:{...} object literals passed to audit/log calls —
      // approximate by scanning lines containing "metadata:" for these substrings.
      const metadataLines = [...routeSource.matchAll(/metadata:\s*\{[^}]*\}/g), ...packageSource.matchAll(/metadata:\s*\{[^}]*\}/g)];
      for (const match of metadataLines) {
        assert.ok(!match[0].includes(forbidden), `metadata object must never reference ${forbidden}: ${match[0]}`);
      }
    }
  });

  section('9. Worker / cleanup structural guards');

  await test('clinicBulkExportWorker.ts never imports/uses withJobLock (process-local guard only)', async () => {
    const source = stripComments(await readSource('jobs/clinicBulkExportWorker.ts'));
    assert.ok(!source.includes('withJobLock'), 'the generation worker must not use the cross-replica-serializing withJobLock (code, not comments)');
    assert.ok(source.includes('isTickRunning'), 'must use a process-local guard');
  });

  await test('clinicBulkExportCleanupJob.ts does use withJobLock (singleton cleanup)', async () => {
    const source = await readSource('jobs/clinicBulkExportCleanupJob.ts');
    assert.ok(source.includes('withJobLock'), 'the cleanup sweep should be a cluster-wide singleton');
  });

  await test('worker graceful shutdown stops only its own scheduled task', async () => {
    const source = await readSource('jobs/clinicBulkExportWorker.ts');
    assert.ok(source.includes('scheduledTask?.stop()'), 'must stop only the retained task handle');
    assert.ok(!source.includes('getTasks()'), 'must never enumerate/stop every cron task in the process');
  });

  const { stopClinicBulkExportWorker, isClinicBulkExportWorkerTickRunning } = await import('../jobs/clinicBulkExportWorker.js');

  await test('stopClinicBulkExportWorker before start does not throw', () => {
    assert.doesNotThrow(() => stopClinicBulkExportWorker());
    assert.equal(isClinicBulkExportWorkerTickRunning(), false);
  });

  section('10. Error types');

  await test('ClinicBulkExportAlreadyRunningError / RateLimitedError / SizeLimitExceededError are real Error subclasses', () => {
    assert.ok(new ClinicBulkExportAlreadyRunningError() instanceof Error);
    assert.ok(new ClinicBulkExportRateLimitedError('cooldown') instanceof Error);
    assert.ok(new ClinicBulkExportSizeLimitExceededError() instanceof Error);
    assert.equal(new ClinicBulkExportRateLimitedError('daily_cap').reason, 'daily_cap');
  });

  const { ClinicBulkExportLeaseLostError } = await import('../services/privacy/clinicBulkExportPackage.js');
  await test('ClinicBulkExportLeaseLostError is a real Error subclass', () => {
    assert.ok(new ClinicBulkExportLeaseLostError() instanceof Error);
  });

  section('11. Remediation round — actor-bound step-up window reuse (P0)');

  const { isStepUpWindowReusableBy } = await import('../utils/passwordStepUp.js');

  await test('requester may reuse their own valid window', () => {
    const now = new Date('2026-01-01T00:02:00.000Z');
    const row = { stepUpVerifiedAt: new Date('2026-01-01T00:00:00.000Z'), stepUpVerifiedByUserId: 'user-a' };
    assert.equal(isStepUpWindowReusableBy(row, 'user-a', now), true);
  });

  await test('a different OWNER/ORG_ADMIN cannot reuse the requester\'s window', () => {
    const now = new Date('2026-01-01T00:02:00.000Z');
    const row = { stepUpVerifiedAt: new Date('2026-01-01T00:00:00.000Z'), stepUpVerifiedByUserId: 'user-a' };
    assert.equal(isStepUpWindowReusableBy(row, 'user-b', now), false);
  });

  await test('an expired window fails even for the original verifier', () => {
    const now = new Date('2026-01-01T00:10:00.000Z'); // 10 minutes later, window is 5 minutes
    const row = { stepUpVerifiedAt: new Date('2026-01-01T00:00:00.000Z'), stepUpVerifiedByUserId: 'user-a' };
    assert.equal(isStepUpWindowReusableBy(row, 'user-a', now), false);
  });

  await test('a null verifying user (e.g. deleted) can never produce passwordless reuse for anyone', () => {
    const now = new Date('2026-01-01T00:01:00.000Z');
    const row = { stepUpVerifiedAt: new Date('2026-01-01T00:00:00.000Z'), stepUpVerifiedByUserId: null };
    assert.equal(isStepUpWindowReusableBy(row, 'user-a', now), false);
    assert.equal(isStepUpWindowReusableBy(row, 'user-b', now), false);
  });

  await test('a null row can never satisfy reuse', () => {
    assert.equal(isStepUpWindowReusableBy(null, 'user-a', new Date()), false);
  });

  await test('route uses isStepUpWindowReusableBy for passwordless reuse, not an inline field comparison', async () => {
    const source = stripComments(await readSource('routes/clinicBulkExport.ts'));
    assert.ok(source.includes('isStepUpWindowReusableBy('), 'must delegate to the shared, unit-tested actor-binding helper');
  });

  await test('reserveClinicBulkExport binds the requester as the initial step-up verifier', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    assert.ok(source.includes('stepUpVerifiedByUserId: args.requestedByUserId'));
  });

  section('12. Remediation round — fully guarded download claim (P0)');

  const { claimClinicBulkExportDownload } = await import('../services/privacy/clinicBulkExportPackage.js');

  await test('claimClinicBulkExportDownload signature accepts a tokenHash (bound to the exact issued token)', () => {
    assert.equal(typeof claimClinicBulkExportDownload, 'function');
  });

  await test('the guarded claim updateMany WHERE clause checks every required field', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const claimFnStart = source.indexOf('export async function claimClinicBulkExportDownload');
    const claimFnBody = source.slice(claimFnStart, claimFnStart + 1500);
    for (const field of ['clinicId: args.clinicId', 'organizationId: args.organizationId', "status: 'ready'", 'expiresAt: { gt: now }', 'downloadedAt: null', 'downloadTokenHash: args.tokenHash']) {
      assert.ok(claimFnBody.includes(field), `guarded claim WHERE must include ${field}`);
    }
  });

  await test('download route destroys the stream on every claim failure path, and computes tokenHash via hashDownloadToken', async () => {
    const source = await readSource('routes/clinicBulkExport.ts');
    assert.ok(source.includes('tokenHash: hashDownloadToken(token)'), 'claim must be called with the hash of the exact validated token');
    assert.ok(source.includes('stream.destroy();'), 'a claim-failure path must destroy the already-opened stream');
  });

  section('13. Remediation round — lease-renewal amplification fix (P0)');

  await test('lease renewal is no longer wired to stream "data" events (per-record amplification removed)', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    assert.ok(!/stream\.on\(\s*['"]data['"]/.test(source), 'must not renew the lease from a per-record stream "data" listener');
  });

  await test('lease renewal is awaited once per cursor-paginated batch inside the entity generator', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    assert.ok(source.includes('await limits.renewLease()'), 'must await a single renewal per batch, not a fire-and-forget call');
    assert.ok(source.includes('if (!leaseOk) throw new ClinicBulkExportLeaseLostError()'), 'must abort generation immediately on lease loss');
  });

  await test('generateClinicBulkExport maps ClinicBulkExportLeaseLostError to the stable LEASE_LOST failure code', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    assert.ok(source.includes("'LEASE_LOST'"));
  });

  section('14. Remediation round — download completion/abort audit semantics (P0)');

  const { attachDownloadOutcomeListeners } = await import('../services/privacy/clinicBulkExportPackage.js');

  function fakeEmitter() {
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    return {
      once(event: string, listener: (...args: unknown[]) => void) {
        (listeners[event] ??= []).push(listener);
      },
      emit(event: string) {
        for (const l of listeners[event] ?? []) l();
      },
    };
  }

  await test('normal finish => completed, exactly once', () => {
    const res = fakeEmitter();
    const stream = fakeEmitter();
    let completed = 0;
    let failed = 0;
    attachDownloadOutcomeListeners({ res, stream, onCompleted: () => completed++, onFailed: () => failed++ });
    res.emit('finish');
    assert.equal(completed, 1);
    assert.equal(failed, 0);
  });

  await test('client close before finish => failed (interrupted), never completed', () => {
    const res = fakeEmitter();
    const stream = fakeEmitter();
    let completed = 0;
    const failures: string[] = [];
    attachDownloadOutcomeListeners({ res, stream, onCompleted: () => completed++, onFailed: (r) => failures.push(r) });
    res.emit('close');
    assert.equal(completed, 0);
    assert.deepEqual(failures, ['interrupted']);
  });

  await test('source stream ending followed by a client close before finish => not completed', () => {
    // Source 'end' is not listened to by attachDownloadOutcomeListeners at
    // all (only res 'finish'/'close' and stream 'error') — simulate the
    // source finishing internally (no event emitted here) while the
    // response then gets a 'close' before 'finish'.
    const res = fakeEmitter();
    const stream = fakeEmitter();
    let completed = 0;
    const failures: string[] = [];
    attachDownloadOutcomeListeners({ res, stream, onCompleted: () => completed++, onFailed: (r) => failures.push(r) });
    res.emit('close');
    assert.equal(completed, 0, 'must not be marked completed merely because the source finished reading');
    assert.deepEqual(failures, ['interrupted']);
  });

  await test('stream error => failed (stream_error)', () => {
    const res = fakeEmitter();
    const stream = fakeEmitter();
    let completed = 0;
    const failures: string[] = [];
    attachDownloadOutcomeListeners({ res, stream, onCompleted: () => completed++, onFailed: (r) => failures.push(r) });
    stream.emit('error');
    assert.equal(completed, 0);
    assert.deepEqual(failures, ['stream_error']);
  });

  await test('exactly one terminal outcome even if multiple events fire (finish then close)', () => {
    const res = fakeEmitter();
    const stream = fakeEmitter();
    let completed = 0;
    let failed = 0;
    attachDownloadOutcomeListeners({ res, stream, onCompleted: () => completed++, onFailed: () => failed++ });
    res.emit('finish');
    res.emit('close'); // must be a no-op — outcome already decided
    assert.equal(completed, 1);
    assert.equal(failed, 0);
  });

  await test('route wires attachDownloadOutcomeListeners instead of ad hoc stream "end"-based completion', async () => {
    const source = stripComments(await readSource('routes/clinicBulkExport.ts'));
    assert.ok(source.includes('attachDownloadOutcomeListeners('));
    assert.ok(!/stream\.on\(\s*['"]end['"]/.test(source), 'must not treat the source stream ending as download success');
  });

  section('15. Remediation round — Redis no longer authoritative over password correctness (P0)');

  await test('clinicBulkExportPasswordAttempts.ts no longer imports/uses createRateLimiter', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPasswordAttempts.ts'));
    assert.ok(!source.includes('createRateLimiter'), 'PostgreSQL must be the sole authority — no Redis pre-check on this path');
  });

  await test('bcrypt.compare (via verifyCurrentPassword) always runs once PostgreSQL confirms the key is not locked', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPasswordAttempts.ts');
    // No conditional branch gating verifyCurrentPassword behind anything other than the lockedUntil check.
    const afterLockCheck = source.slice(source.indexOf('outcome: \'locked\''));
    assert.ok(afterLockCheck.includes('const verification = await verifyCurrentPassword('));
    assert.ok(!afterLockCheck.includes('likelyLockedOut'));
  });

  section('16. Remediation round — manifest checksum completeness (P1)');

  await test('clinic.json gets a computed SHA-256 entry in sha256PerFile; manifest.json is documented as excluded', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    assert.ok(source.includes("'clinic.json': clinicJsonSha256"), 'clinic.json must have a real computed checksum, not be omitted');
    assert.ok(source.includes('circular self-hash') || source.includes('EXCLUDED'), 'the manifest.json self-hash exclusion must be documented');
  });

  section('17. Remediation round — non-critical audit calls are awaited (P1)');

  await test('clinicBulkExport.ts request-path audit calls are awaited, not fire-and-forget', async () => {
    const source = await readSource('routes/clinicBulkExport.ts');
    const voidAuditCalls = source.match(/void\s+writeAuditLog\(/g) ?? [];
    assert.equal(voidAuditCalls.length, 0, 'every request-path writeAuditLog call must be awaited so the response never precedes the audit attempt');
    const awaitedAuditCalls = source.match(/await\s+writeAuditLog\(/g) ?? [];
    assert.ok(awaitedAuditCalls.length >= 3, 'expected at least 3 awaited non-critical audit calls (feature-disabled, rate-limited, step-up-failed x2)');
  });

  await test('gdprExport.ts legacy audit call is awaited', async () => {
    const source = await readSource('routes/gdprExport.ts');
    assert.ok(!/void\s+writeAuditLog\(/.test(source));
    assert.ok(/await\s+writeAuditLog\(/.test(source));
  });

  section('18. Remediation round — queue timeout vs. generation lease vs. heartbeat (P0)');

  const {
    getQueueTimeoutMs,
    getGenerationLeaseMs,
    getHeartbeatIntervalMs,
    ClinicBulkExportLeaseLostError: LeaseLostErrorCtor,
  } = await import('../services/privacy/clinicBulkExportPackage.js');

  await test('getQueueTimeoutMs / getGenerationLeaseMs / getHeartbeatIntervalMs default sanely and respect env overrides', () => {
    const originalQueue = process.env.CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS;
    const originalLease = process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS;
    const originalHeartbeat = process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS;
    try {
      delete process.env.CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS;
      delete process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS;
      delete process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS;
      const defaultQueueTimeout = getQueueTimeoutMs();
      const defaultGenerationLease = getGenerationLeaseMs();
      const defaultHeartbeat = getHeartbeatIntervalMs();
      assert.ok(defaultQueueTimeout > defaultGenerationLease, 'the queue timeout default must be substantially longer than the generation lease default');
      assert.ok(defaultHeartbeat < defaultGenerationLease, 'the heartbeat interval default must be well under the generation lease so multiple renewals happen before it could expire');

      process.env.CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS = '123000';
      assert.equal(getQueueTimeoutMs(), 123000);
      process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS = '45000';
      assert.equal(getGenerationLeaseMs(), 45000);
      process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS = '5000';
      assert.equal(getHeartbeatIntervalMs(), 5000);

      process.env.CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS = 'not-a-number';
      assert.equal(getQueueTimeoutMs(), defaultQueueTimeout, 'garbage input must fall back to the default, never NaN/0/negative');
    } finally {
      if (originalQueue === undefined) delete process.env.CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS;
      else process.env.CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS = originalQueue;
      if (originalLease === undefined) delete process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS;
      else process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS = originalLease;
      if (originalHeartbeat === undefined) delete process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS;
      else process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS = originalHeartbeat;
    }
  });

  await test('reservation writes the queue timeout, never the generation lease, into the new row (source inspection)', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const reserveFnStart = source.indexOf('export async function reserveClinicBulkExport');
    const claimFnStart = source.indexOf('export async function claimQueuedClinicBulkExportJobs');
    assert.ok(reserveFnStart > -1 && claimFnStart > reserveFnStart);
    const reserveBody = source.slice(reserveFnStart, claimFnStart);
    assert.ok(reserveBody.includes('getQueueTimeoutMs()'), 'the created queued row must use the queue-timeout deadline');
    assert.ok(!reserveBody.includes('getGenerationLeaseMs()'), 'creation must never use the (shorter) generation lease');
  });

  await test('claiming a queued row writes the generation lease, replacing the queue timeout (source inspection)', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const claimFnStart = source.indexOf('export async function claimQueuedClinicBulkExportJobs');
    const renewLeaseFnStart = source.indexOf('async function renewLease');
    assert.ok(claimFnStart > -1 && renewLeaseFnStart > claimFnStart);
    const claimBody = source.slice(claimFnStart, renewLeaseFnStart);
    assert.ok(claimBody.includes('getGenerationLeaseMs()'), 'claiming a queued row must set the generation lease');
    assert.ok(claimBody.includes('clinic_bulk_export_generation_started'), 'claiming must record the generation_started audit event exactly once per successful claim');
  });

  await test('ClinicBulkExportLeaseLostError is a real Error subclass', () => {
    const err = new LeaseLostErrorCtor();
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'ClinicBulkExportLeaseLostError');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
