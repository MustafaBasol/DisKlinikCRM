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
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

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

  section('19. Remediation round — durable planned-artifact lifecycle, no post-upload orphans (P0)');

  await test('the deterministic storageKey is persisted on the row via a guarded update BEFORE the upload call, not after', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const genFnStart = source.indexOf('export async function generateClinicBulkExport');
    const cleanupFnStart = source.indexOf('export async function cleanupExpiredClinicBulkExportArchives');
    assert.ok(genFnStart > -1 && cleanupFnStart > genFnStart);
    const genBody = source.slice(genFnStart, cleanupFnStart);

    const plannedUpdateIndex = genBody.indexOf('data: { storageKey }');
    const doUploadCallIndex = genBody.indexOf('await doUpload(storageKey');
    assert.ok(plannedUpdateIndex > -1, 'must persist the planned storageKey via its own guarded update');
    assert.ok(doUploadCallIndex > -1, 'must still call doUpload with the same storageKey');
    assert.ok(plannedUpdateIndex < doUploadCallIndex, 'the planned-key persist must happen strictly before the upload call');

    const plannedUpdateBlockStart = genBody.lastIndexOf('updateMany(', plannedUpdateIndex);
    const plannedUpdateBlock = genBody.slice(plannedUpdateBlockStart, plannedUpdateIndex + 40);
    assert.ok(plannedUpdateBlock.includes("status: 'generating'"), 'the planned-key guarded update must require status=generating');
    assert.ok(plannedUpdateBlock.includes('leaseExpiresAt'), 'the planned-key guarded update must require a still-valid lease');
  });

  await test('a failed planned-key persist never uploads and fails with the stable LEASE_LOST code, not a partial artifact', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const genFnStart = source.indexOf('export async function generateClinicBulkExport');
    const plannedKeyResultIndex = source.indexOf('plannedKeyResult.count === 0', genFnStart);
    const doUploadCallIndex = source.indexOf('await doUpload(storageKey', genFnStart);
    assert.ok(plannedKeyResultIndex > -1 && doUploadCallIndex > -1);
    assert.ok(plannedKeyResultIndex < doUploadCallIndex, 'the planned-key failure check must be resolved before ever reaching the upload call');
    const checkBlock = source.slice(plannedKeyResultIndex, plannedKeyResultIndex + 200);
    assert.ok(checkBlock.includes('throw new ClinicBulkExportLeaseLostError()'), 'a failed planned-key persist must throw, never fall through to doUpload');
  });

  await test('every post-planned-key failure path throws instead of ad hoc deleteFile-then-return, letting the catch block own cleanup uniformly', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const genFnStart = source.indexOf('export async function generateClinicBulkExport');
    const catchStart = source.indexOf('} catch (err) {', genFnStart);
    assert.ok(genFnStart > -1 && catchStart > genFnStart);
    const tryBody = source.slice(genFnStart, catchStart);
    assert.ok(!/await deleteFile\(storageKey\)/.test(tryBody), 'the try block must not ad hoc delete the artifact itself — the catch block does it uniformly via attemptArtifactDeletion');
  });

  await test('the catch block awaits attemptArtifactDeletion so no failure path can return before orphan cleanup is attempted', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const genFnStart = source.indexOf('export async function generateClinicBulkExport');
    const catchStart = source.indexOf('} catch (err) {', genFnStart);
    const finallyStart = source.indexOf('} finally {', catchStart);
    assert.ok(catchStart > -1 && finallyStart > catchStart);
    const catchBody = source.slice(catchStart, finallyStart);
    assert.ok(catchBody.includes('await attemptArtifactDeletion(jobId)'), 'the catch block must await an immediate orphan-artifact cleanup attempt, not fire-and-forget');
  });

  await test('attemptArtifactDeletion is gated on status !== "ready", not solely status === "expired" — covers failed/orphaned generating rows too', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const fnStart = source.indexOf('export async function attemptArtifactDeletion');
    assert.ok(fnStart > -1);
    const fnBody = source.slice(fnStart, fnStart + 800);
    assert.ok(fnBody.includes("row.status === 'ready'"), 'must gate on the downloadable status directly, never assume expired is the only eligible status');
    assert.ok(!/row\.status !== 'expired'/.test(fnBody), 'must not remain hard-gated to only the expired status');
  });

  await test('generateClinicBulkExport accepts a test-only hook fired immediately before the planned-key persist, never used by the production worker call site', async () => {
    const packageSource = await readSource('services/privacy/clinicBulkExportPackage.ts');
    assert.ok(packageSource.includes('beforePlannedKeyPersistForTest?: () => Promise<void>'));
    const workerSource = stripComments(await readSource('jobs/clinicBulkExportWorker.ts'));
    assert.ok(!workerSource.includes('beforePlannedKeyPersistForTest'), 'the production worker must never pass the test-only hook');
  });

  await test('deleteStorageObjectIdempotent treats a missing storage object as a successful delete, not a retry-forever failure', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const fnStart = source.indexOf('async function deleteStorageObjectIdempotent');
    assert.ok(fnStart > -1);
    const fnBody = source.slice(fnStart, fnStart + 700);
    assert.ok(fnBody.includes('fileExists('), 'must check whether the object still exists after a delete error');
    assert.ok(fnBody.includes('if (!stillExists) return true'), 'a confirmed-missing object must be treated as already deleted (idempotent success)');
  });

  await test('cleanup retries artifact deletion for BOTH expired and failed terminal rows carrying a storageKey', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const fnStart = source.indexOf('export async function cleanupExpiredClinicBulkExportArchives');
    assert.ok(fnStart > -1);
    const fnBody = source.slice(fnStart, fnStart + 3500);
    assert.ok(fnBody.includes("status: { in: ['expired', 'failed'] }"), 'must sweep both terminal statuses for retryable storage deletion, not just expired');
  });

  await test('attemptArtifactDeletion / cleanupExpiredClinicBulkExportArchives accept a test-only deleteForTest override never used by the production cleanup job', async () => {
    const packageSource = await readSource('services/privacy/clinicBulkExportPackage.ts');
    assert.ok(packageSource.includes('deleteForTest?: typeof deleteFile'), 'must expose the same test-only-override pattern already used by uploadForTest/writeStartedAuditForTest');
    const cleanupJobSource = stripComments(await readSource('jobs/clinicBulkExportCleanupJob.ts'));
    assert.ok(!cleanupJobSource.includes('deleteForTest'), 'the production cleanup job must never pass the test-only override');
  });

  section('20. Remediation round — transactional, exactly-once generation_started audit (P1)');

  await test('claimSingleQueuedJobWithAudit wraps the claim update, job read, and audit write in one prisma.$transaction', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const fnStart = source.indexOf('async function claimSingleQueuedJobWithAudit');
    const claimFnStart = source.indexOf('export async function claimQueuedClinicBulkExportJobs');
    assert.ok(fnStart > -1 && claimFnStart > -1);
    const fnBody = source.slice(fnStart, fnStart + 1500);
    assert.ok(fnBody.includes('prisma.$transaction(async (tx'), 'the claim + audit must share one transaction');
    assert.ok(fnBody.includes("status: 'queued'") , 'the guarded claim update must still require status=queued inside the transaction');
    assert.ok(fnBody.includes('writeStartedAudit(tx,'), 'the audit write must use the SAME transaction client as the claim');
    assert.ok(fnBody.includes('if (claim.count === 0) return false'), 'losing the claim race must return false with no audit write and no side effects');
  });

  await test('claimQueuedClinicBulkExportJobs isolates one candidate\'s transaction failure from the rest of the tick', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const fnStart = source.indexOf('export async function claimQueuedClinicBulkExportJobs');
    const fnEnd = source.indexOf('async function claimSingleQueuedJobWithAudit');
    assert.ok(fnStart > -1 && fnEnd > fnStart);
    const fnBody = source.slice(fnStart, fnEnd);
    assert.ok(fnBody.includes('try {') && fnBody.includes('catch (err) {'), 'the per-candidate claim call must be individually try/caught so one rollback does not abort the whole tick');
  });

  await test('claimQueuedClinicBulkExportJobs accepts a test-only audit override never used by the production worker call site', async () => {
    const packageSource = await readSource('services/privacy/clinicBulkExportPackage.ts');
    assert.ok(packageSource.includes('writeStartedAuditForTest?: typeof writeAuditLogInTx'), 'must expose the same test-only-override pattern already used by uploadForTest');
    const workerSource = stripComments(await readSource('jobs/clinicBulkExportWorker.ts'));
    assert.ok(!workerSource.includes('writeStartedAuditForTest'), 'the production worker must never pass the test-only override');
  });

  section('21. Crash-safety remediation — private export temp directory (P0)');

  await test('ensureExportTempDir creates the directory with mode 0700 (POSIX only) and getExportTempDir/buildExportTempFilePath/parseExportTempFileName are consistent', async () => {
    const { ensureExportTempDir, getExportTempDir, buildExportTempFilePath, parseExportTempFileName } =
      await import('../services/fileStorage.js');
    const dir = await ensureExportTempDir();
    assert.equal(dir, getExportTempDir());
    if (process.platform !== 'win32') {
      const stat = await fs.stat(dir);
      assert.equal(stat.mode & 0o777, 0o700, `temp dir must be mode 0700, got ${(stat.mode & 0o777).toString(8)}`);
    }

    const jobId = '11111111-1111-1111-1111-111111111111';
    const tempPath = buildExportTempFilePath(jobId);
    assert.ok(tempPath.startsWith(dir), 'the temp file path must live inside the dedicated private temp directory');
    const fileName = tempPath.slice(dir.length + 1);
    const parsed = parseExportTempFileName(fileName);
    assert.ok(parsed, 'the generated file name must itself be recognized by the naming pattern parser');
    assert.equal(parsed!.jobId, jobId);

    assert.equal(parseExportTempFileName('not-a-recognized-file.zip'), null, 'an unrelated file name must never be recognized');
    assert.equal(
      parseExportTempFileName(`clinic-bulk-export-${jobId}.zip`),
      null,
      'the OLD (pre-remediation) shared-os-tmpdir naming scheme must no longer be recognized',
    );
  });

  await test('buildExportTempFilePath produces a fresh, unique path on every call for the same job id (random suffix)', async () => {
    const { buildExportTempFilePath } = await import('../services/fileStorage.js');
    const jobId = '22222222-2222-2222-2222-222222222222';
    const a = buildExportTempFilePath(jobId);
    const b = buildExportTempFilePath(jobId);
    assert.notEqual(a, b, 'two calls for the same job id must never collide');
  });

  await test('generateClinicBulkExport creates its temp ZIP inside the private export temp dir with mode 0600 and flags "wx"', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const genFnStart = source.indexOf('export async function generateClinicBulkExport');
    const catchStart = source.indexOf('} catch (err) {', genFnStart);
    const genBody = source.slice(genFnStart, catchStart);
    assert.ok(genBody.includes('await ensureExportTempDir()'), 'must ensure the private temp directory exists before writing to it');
    assert.ok(genBody.includes('tempFilePath = buildExportTempFilePath(jobId)'), 'must use the dedicated private temp-path builder, never a raw os.tmpdir() path');
    assert.ok(
      /createWriteStream\(tempFilePath, \{ mode: 0o600, flags: 'wx' \}\)/.test(genBody),
      'the temp ZIP write stream must request mode 0600 and exclusive-create (wx)',
    );
  });

  section('22. Crash-safety remediation — local-mode temp/partial/final files are mode 0600 (P0)');

  await test('saveFileFromPath (local mode, same-filesystem rename path) produces a final artifact with mode 0600', async () => {
    const { saveFileFromPath, deleteFile } = await import('../services/fileStorage.js');
    const tempPath = path.join(os.tmpdir(), `clinic-bulk-export-unit-test-${Date.now()}.zip`);
    await fs.writeFile(tempPath, Buffer.from('dummy export bytes'), { mode: 0o600 });
    const key = `exports/unit-test-clinic-${Date.now()}/perm-test.zip`;
    await saveFileFromPath(key, tempPath, 'application/zip');
    try {
      if (process.platform !== 'win32') {
        const localPath = path.resolve(process.cwd(), 'uploads', key);
        const stat = fsSync.statSync(localPath);
        assert.equal(stat.mode & 0o777, 0o600, `final local artifact must be mode 0600, got ${(stat.mode & 0o777).toString(8)}`);
      }
    } finally {
      await deleteFile(key);
    }
  });

  await test("saveFileFromPath's cross-device (EXDEV) streamed-copy fallback explicitly requests mode 0600 and exclusive-create (source inspection — a real EXDEV cannot be forced portably in a unit test)", async () => {
    const source = await readSource('services/fileStorage.ts');
    const fallbackStart = source.indexOf('Cross-device (EXDEV)');
    assert.ok(fallbackStart > -1);
    const fallbackBlock = source.slice(fallbackStart, fallbackStart + 1100);
    assert.ok(fallbackBlock.includes('mode: 0o600'), 'the streamed-copy fallback destination stream must explicitly request mode 0600');
    assert.ok(fallbackBlock.includes("flags: 'wx'"), 'the streamed-copy fallback must also use exclusive create');
    assert.ok(fallbackBlock.includes("chmod(partialPath, 0o600)"), 'must also re-assert 0600 on the partial file before promoting it, regardless of which code path produced it');
  });

  await test('cleanupStaleLocalExportPartialFiles is a no-op under S3/remote storage', async () => {
    const source = await readSource('services/fileStorage.ts');
    const fnStart = source.indexOf('export async function cleanupStaleLocalExportPartialFiles');
    const fnBody = source.slice(fnStart, fnStart + 600);
    assert.ok(fnBody.includes('if (isRemoteStorageEnabled()) return 0;'), 'must be a no-op under S3/remote storage — see the AbortIncompleteMultipartUpload bucket-lifecycle-rule requirement in the compliance doc instead');
  });

  await test('a fresh recognized partial file is never deleted regardless of DB state (age gate runs before any DB lookup)', async () => {
    const { cleanupStaleLocalExportPartialFiles } = await import('../services/fileStorage.js');
    const clinicId = `unit-test-partial-fresh-${Date.now()}`;
    const clinicDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicId);
    await fs.mkdir(clinicDir, { recursive: true });
    const jobId = crypto.randomUUID();
    const freshPartial = path.join(clinicDir, `${jobId}.zip.partial-${crypto.randomUUID()}`);
    await fs.writeFile(freshPartial, Buffer.from('fresh'));
    // Deliberately never called — a fresh file must never even reach the DB lookup.
    const findArchiveForTest = async (): Promise<never> => {
      throw new Error('must not be called for a file younger than maxAgeMs');
    };

    const deleted = await cleanupStaleLocalExportPartialFiles(30 * 60 * 1000, new Date(), findArchiveForTest as any);
    assert.equal(deleted, 0);
    assert.ok(fsSync.existsSync(freshPartial), 'the fresh partial file must be left alone');

    await fs.unlink(freshPartial).catch(() => {});
    await fs.rmdir(clinicDir).catch(() => {});
  });

  await test('an old recognized partial file is deleted once the archive row confirms it is not actively generating', async () => {
    const { cleanupStaleLocalExportPartialFiles } = await import('../services/fileStorage.js');
    const clinicId = `unit-test-partial-old-${Date.now()}`;
    const clinicDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicId);
    await fs.mkdir(clinicDir, { recursive: true });
    const jobId = crypto.randomUUID();
    const oldPartial = path.join(clinicDir, `${jobId}.zip.partial-${crypto.randomUUID()}`);
    await fs.writeFile(oldPartial, Buffer.from('old'));
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await fs.utimes(oldPartial, past, past);

    const deleted = await cleanupStaleLocalExportPartialFiles(30 * 60 * 1000, new Date(), async (id) => {
      assert.equal(id, jobId, 'must derive the job id from the recognized filename, not guess it');
      return { clinicId, status: 'failed', leaseExpiresAt: null }; // no longer active — provably safe to delete
    });
    assert.equal(deleted, 1);
    assert.ok(!fsSync.existsSync(oldPartial), 'the old, confirmed-inactive partial file must actually be gone from disk');

    await fs.rmdir(clinicDir).catch(() => {});
  });

  await test('an old recognized partial file for a row still actively generating with an unexpired lease is NEVER deleted (P1 — protects a legitimately slow cross-device copy)', async () => {
    const { cleanupStaleLocalExportPartialFiles } = await import('../services/fileStorage.js');
    const clinicId = `unit-test-partial-active-${Date.now()}`;
    const clinicDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicId);
    await fs.mkdir(clinicDir, { recursive: true });
    const jobId = crypto.randomUUID();
    const activePartial = path.join(clinicDir, `${jobId}.zip.partial-${crypto.randomUUID()}`);
    await fs.writeFile(activePartial, Buffer.from('still being copied'));
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await fs.utimes(activePartial, past, past); // old by age alone — must still be protected

    const deleted = await cleanupStaleLocalExportPartialFiles(1000, new Date(), async () => ({
      clinicId,
      status: 'generating',
      leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // unexpired
    }));
    assert.equal(deleted, 0, 'a live, actively-generating job\'s partial file must never be counted as deleted');
    assert.ok(fsSync.existsSync(activePartial), 'the partial file must still exist — the DB shows it as actively generating with an unexpired lease');

    await fs.unlink(activePartial).catch(() => {});
    await fs.rmdir(clinicDir).catch(() => {});
  });

  await test('a DB lookup failure fails closed — the candidate is skipped, never deleted, and never counted', async () => {
    const { cleanupStaleLocalExportPartialFiles } = await import('../services/fileStorage.js');
    const clinicId = `unit-test-partial-dbfail-${Date.now()}`;
    const clinicDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicId);
    await fs.mkdir(clinicDir, { recursive: true });
    const jobId = crypto.randomUUID();
    const filePath = path.join(clinicDir, `${jobId}.zip.partial-${crypto.randomUUID()}`);
    await fs.writeFile(filePath, Buffer.from('old, but DB is unreachable'));
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await fs.utimes(filePath, past, past);

    const deleted = await cleanupStaleLocalExportPartialFiles(1000, new Date(), async () => {
      throw new Error('simulated DB connection failure');
    });
    assert.equal(deleted, 0, 'a DB lookup failure must never authorize deletion');
    assert.ok(fsSync.existsSync(filePath), 'the file must still exist on disk — fail-closed, not fail-open');

    await fs.unlink(filePath).catch(() => {});
    await fs.rmdir(clinicDir).catch(() => {});
  });

  await test('a recognized-filename-shaped file whose clinicId does not match its containing directory is skipped, never deleted', async () => {
    const { cleanupStaleLocalExportPartialFiles } = await import('../services/fileStorage.js');
    const clinicId = `unit-test-partial-mismatch-${Date.now()}`;
    const clinicDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicId);
    await fs.mkdir(clinicDir, { recursive: true });
    const jobId = crypto.randomUUID();
    const filePath = path.join(clinicDir, `${jobId}.zip.partial-${crypto.randomUUID()}`);
    await fs.writeFile(filePath, Buffer.from('clinicId mismatch'));
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await fs.utimes(filePath, past, past);

    const deleted = await cleanupStaleLocalExportPartialFiles(1000, new Date(), async () => ({
      clinicId: `some-other-clinic-${Date.now()}`, // does NOT match clinicId (the containing directory)
      status: 'failed',
      leaseExpiresAt: null,
    }));
    assert.equal(deleted, 0, 'a clinicId/jobId mismatch must never be treated as confirmed-safe-to-delete');
    assert.ok(fsSync.existsSync(filePath));

    await fs.unlink(filePath).catch(() => {});
    await fs.rmdir(clinicDir).catch(() => {});
  });

  await test('an unrecognized filename shape (no valid uuid-jobId prefix) is never touched, even if old', async () => {
    const { cleanupStaleLocalExportPartialFiles } = await import('../services/fileStorage.js');
    const clinicId = `unit-test-partial-unrecognized-${Date.now()}`;
    const clinicDir = path.resolve(process.cwd(), 'uploads', 'exports', clinicId);
    await fs.mkdir(clinicDir, { recursive: true });
    const oddPartial = path.join(clinicDir, `not-a-uuid.zip.partial-${crypto.randomUUID()}`);
    await fs.writeFile(oddPartial, Buffer.from('unrecognized shape'));
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await fs.utimes(oddPartial, past, past);

    const deleted = await cleanupStaleLocalExportPartialFiles(1000, new Date(), async (): Promise<never> => {
      throw new Error('must never be called for a filename this sweep does not recognize');
    });
    assert.equal(deleted, 0);
    assert.ok(fsSync.existsSync(oddPartial), 'an unrecognized filename must never be touched');

    await fs.unlink(oddPartial).catch(() => {});
    await fs.rmdir(clinicDir).catch(() => {});
  });

  await test('the production cleanup job never passes the test-only findArchiveForTest override', async () => {
    const source = stripComments(await readSource('jobs/clinicBulkExportCleanupJob.ts'));
    assert.ok(!source.includes('findArchiveForTest'), 'the production cleanup job must never pass the test-only DB-lookup override');
  });

  await test('cleanupStaleLocalExportPartialFiles only counts a candidate as deleted once its unlink actually succeeds', async () => {
    const source = stripComments(await readSource('services/fileStorage.ts'));
    const fnStart = source.indexOf('export async function cleanupStaleLocalExportPartialFiles');
    assert.ok(fnStart > -1);
    const fnBody = source.slice(fnStart, fnStart + 3000);
    const unlinkTryIndex = fnBody.indexOf('await fs.promises.unlink(filePath);');
    const deletedIncrementIndex = fnBody.indexOf('deleted++;');
    assert.ok(unlinkTryIndex > -1 && deletedIncrementIndex > unlinkTryIndex, 'deleted++ must come strictly after the unlink call, inside the same try block, never before/independent of it');
  });

  section('23. Byte-ceiling remediation — post-finalize ZIP structural integrity validator (P0)');

  async function buildTinyValidZip(): Promise<{ tempPath: string; size: number }> {
    const archiverModule = (await import('archiver')).default;
    const tempPath = path.join(os.tmpdir(), `zip-integrity-unit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
    await new Promise<void>((resolve, reject) => {
      const archive = archiverModule('zip', { zlib: { level: 9 } });
      const writeStream = fsSync.createWriteStream(tempPath);
      writeStream.on('close', () => resolve());
      writeStream.on('error', reject);
      archive.on('error', reject);
      archive.pipe(writeStream);
      archive.append(Buffer.from('{}'), { name: 'manifest.json' });
      archive.append(Buffer.from('{}'), { name: 'clinic.json' });
      void archive.finalize();
    });
    const stat = await fs.stat(tempPath);
    return { tempPath, size: stat.size };
  }

  await test('validateZipStructuralIntegrity accepts a real, valid small ZIP whose entries exactly match the expected list', async () => {
    const { validateZipStructuralIntegrity } = await import('../services/privacy/clinicBulkExportPackage.js');
    const { tempPath, size } = await buildTinyValidZip();
    try {
      await validateZipStructuralIntegrity(tempPath, size, ['manifest.json', 'clinic.json']);
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  });

  await test('validateZipStructuralIntegrity rejects a mismatched expected-entry list (a name the real ZIP does not contain)', async () => {
    const { validateZipStructuralIntegrity, ClinicBulkExportZipIntegrityError } = await import(
      '../services/privacy/clinicBulkExportPackage.js'
    );
    const { tempPath, size } = await buildTinyValidZip();
    try {
      await assert.rejects(
        validateZipStructuralIntegrity(tempPath, size, ['manifest.json', 'clinic.json', 'missing-entity.ndjson']),
        ClinicBulkExportZipIntegrityError,
      );
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  });

  await test('validateZipStructuralIntegrity rejects a truncated/corrupted file with no locatable EOCD record', async () => {
    const { validateZipStructuralIntegrity, ClinicBulkExportZipIntegrityError } = await import(
      '../services/privacy/clinicBulkExportPackage.js'
    );
    const { tempPath, size } = await buildTinyValidZip();
    try {
      const full = await fs.readFile(tempPath);
      const truncated = full.subarray(0, Math.max(0, full.length - 30));
      await fs.writeFile(tempPath, truncated);
      await assert.rejects(
        validateZipStructuralIntegrity(tempPath, truncated.length, ['manifest.json', 'clinic.json']),
        ClinicBulkExportZipIntegrityError,
      );
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  });

  await test('generateClinicBulkExport re-checks the byte ceiling against the REAL final file size and validates ZIP structure, strictly after finalize/writeFinished and strictly before the planned-key persist', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const genFnStart = source.indexOf('export async function generateClinicBulkExport');
    const writeFinishedAwaitIndex = source.indexOf('await writeFinished;', genFnStart);
    const finalStatIndex = source.indexOf('finalStat.size > maxBytes', genFnStart);
    const validateCallIndex = source.indexOf('await validateZipStructuralIntegrity(', genFnStart);
    const plannedKeyIndex = source.indexOf('const storageKey = buildExportStorageKey', genFnStart);
    assert.ok(writeFinishedAwaitIndex > -1 && finalStatIndex > -1 && validateCallIndex > -1 && plannedKeyIndex > -1);
    assert.ok(
      writeFinishedAwaitIndex < finalStatIndex && finalStatIndex < validateCallIndex && validateCallIndex < plannedKeyIndex,
      'ordering must be: finalize/writeFinished -> real-file-size byte-ceiling re-check -> ZIP structural validation -> planned-key persist',
    );
  });

  section('24. Feature-flag remediation — the flag/allowlist is a real GENERATION kill switch, not just a creation gate (P0)');

  await test('claimQueuedClinicBulkExportJobs checks isClinicBulkExportEnabledForOrganization before ever attempting to claim a candidate', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const fnStart = source.indexOf('export async function claimQueuedClinicBulkExportJobs');
    const fnEnd = source.indexOf('async function failQueuedJobAsFeatureDisabled');
    assert.ok(fnStart > -1 && fnEnd > fnStart);
    const fnBody = source.slice(fnStart, fnEnd);
    assert.ok(fnBody.includes('isClinicBulkExportEnabledForOrganization(candidate.organizationId)'));
    assert.ok(fnBody.includes('failQueuedJobAsFeatureDisabled(candidate)'));
  });

  await test('failQueuedJobAsFeatureDisabled is guarded on status="queued" and records a generation_failed audit with FEATURE_DISABLED and no patient data', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const fnStart = source.indexOf('async function failQueuedJobAsFeatureDisabled');
    assert.ok(fnStart > -1);
    const fnBody = source.slice(fnStart, fnStart + 1200);
    assert.ok(fnBody.includes("status: 'queued'"), 'must never touch a row a concurrent replica already claimed');
    assert.ok(fnBody.includes("failureCode: 'FEATURE_DISABLED'"));
    assert.ok(fnBody.includes("action: 'clinic_bulk_export_generation_failed'"));
    assert.ok(!/restrictedNote|purpose:/.test(fnBody), 'the audit metadata must never include patient/clinic-specific content');
  });

  await test('generateClinicBulkExport re-checks the flag/allowlist at exactly three checkpoints: generation start, before the planned-key persist/upload, and before the ready transition', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const genFnStart = source.indexOf('export async function generateClinicBulkExport');
    const catchStart = source.indexOf('} catch (err) {', genFnStart);
    const genBody = source.slice(genFnStart, catchStart);

    const occurrences = genBody.split('assertClinicBulkExportGenerationAllowed(job.organizationId)').length - 1;
    assert.equal(occurrences, 3, 'must re-check exactly 3 times: generation start, before planned-key persist/upload, before the ready transition');

    const firstCheckIndex = genBody.indexOf('assertClinicBulkExportGenerationAllowed');
    const plannedKeyIndex = genBody.indexOf('const storageKey = buildExportStorageKey');
    const doUploadIndex = genBody.indexOf('await doUpload(storageKey');
    const readyUpdateIndex = genBody.indexOf("data: { status: 'ready'");
    assert.ok(firstCheckIndex > -1 && firstCheckIndex < plannedKeyIndex, 'the first re-check must sit before the planned-key computation');

    const secondCheckIndex = genBody.indexOf('assertClinicBulkExportGenerationAllowed', plannedKeyIndex);
    assert.ok(
      secondCheckIndex > plannedKeyIndex && secondCheckIndex < doUploadIndex,
      'the second re-check must sit between the planned-key computation and the upload call',
    );

    const thirdCheckIndex = genBody.lastIndexOf('assertClinicBulkExportGenerationAllowed', readyUpdateIndex);
    assert.ok(
      thirdCheckIndex > doUploadIndex && thirdCheckIndex < readyUpdateIndex,
      'the third re-check must sit strictly between the upload call and the ready transition',
    );
  });

  await test('ClinicBulkExportFeatureDisabledError maps to the stable FEATURE_DISABLED failure code in generateClinicBulkExport\'s catch block, funneling through the same cleanup as every other failure', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const genFnStart = source.indexOf('export async function generateClinicBulkExport');
    const catchStart = source.indexOf('} catch (err) {', genFnStart);
    const finallyStart = source.indexOf('} finally {', catchStart);
    const catchBody = source.slice(catchStart, finallyStart);
    assert.ok(catchBody.includes('ClinicBulkExportFeatureDisabledError') && catchBody.includes("'FEATURE_DISABLED'"));
    assert.ok(catchBody.includes('await attemptArtifactDeletion(jobId)'), 'must still funnel through the SAME awaited orphan-cleanup as every other failure path');
  });

  await test('ClinicBulkExportFeatureDisabledError / ClinicBulkExportZipIntegrityError are real Error subclasses', async () => {
    const { ClinicBulkExportFeatureDisabledError, ClinicBulkExportZipIntegrityError } = await import(
      '../services/privacy/clinicBulkExportPackage.js'
    );
    assert.ok(new ClinicBulkExportFeatureDisabledError() instanceof Error);
    assert.ok(new ClinicBulkExportZipIntegrityError() instanceof Error);
  });

  section('25. Cleanup-ordering remediation — expire -> sweep-abandoned -> delete-artifacts in ONE pass (P1)');

  await test('cleanupExpiredClinicBulkExportArchives runs the abandoned-lease sweep BEFORE the artifact-deletion retry query', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const fnStart = source.indexOf('export async function cleanupExpiredClinicBulkExportArchives');
    assert.ok(fnStart > -1);
    const sweepIndex = source.indexOf("data: { status: 'failed', failureCode: 'LEASE_EXPIRED' }", fnStart);
    const deletionQueryIndex = source.indexOf('const needingDeletion = await prisma.clinicBulkExportArchive.findMany', fnStart);
    assert.ok(sweepIndex > -1 && deletionQueryIndex > -1);
    assert.ok(
      sweepIndex < deletionQueryIndex,
      'the abandoned-lease sweep must run before the artifact-deletion retry query so a row swept THIS tick is eligible for deletion in the SAME call',
    );
  });

  section('26. Async-selection remediation — the epoch guard also applies to finally-block state clearing (P1)');

  await test("handleCreate's and handleDownload's finally blocks only clear their own loading flag when the request is still current — never unconditionally", async () => {
    const source = stripComments(await readSource('../../src/components/settings/ClinicBulkExportSection.tsx'));
    const handleCreateStart = source.indexOf('const handleCreate = useCallback');
    const handleDownloadStart = source.indexOf('const handleDownload = useCallback');
    const handleStartNewStart = source.indexOf('const handleStartNew = useCallback');
    assert.ok(handleCreateStart > -1 && handleDownloadStart > handleCreateStart && handleStartNewStart > handleDownloadStart);

    const handleCreateBody = source.slice(handleCreateStart, handleDownloadStart);
    assert.ok(
      handleCreateBody.includes('if (isStillCurrentSelection(requestClinicId, requestEpoch)) setSubmitting(false)'),
      "handleCreate's finally block must guard setSubmitting(false) behind the epoch check",
    );
    assert.ok(
      !/finally\s*\{\s*setSubmitting\(false\);\s*\}/.test(handleCreateBody),
      'must never unconditionally call setSubmitting(false) in the finally block',
    );

    const handleDownloadBody = source.slice(handleDownloadStart, handleStartNewStart);
    assert.ok(
      handleDownloadBody.includes('if (isStillCurrentSelection(requestClinicId, requestEpoch)) setDownloading(false)'),
      "handleDownload's finally block must guard setDownloading(false) behind the epoch check",
    );
    assert.ok(
      !/finally\s*\{\s*setDownloading\(false\);\s*\}/.test(handleDownloadBody),
      'must never unconditionally call setDownloading(false) in the finally block',
    );
  });

  section('27. Crash-safety remediation — process-local stale-temp sweep, worker wiring (P0)');

  await test('sweepStaleClinicBulkExportTempFiles gates deletion on BOTH file age and DB status/lease, and only ever considers recognized file names', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const fnStart = source.indexOf('export async function sweepStaleClinicBulkExportTempFiles');
    assert.ok(fnStart > -1);
    const fnBody = source.slice(fnStart, fnStart + 2500);
    assert.ok(fnBody.includes('parseExportTempFileName(name)'), 'must only ever consider recognized file names');
    assert.ok(fnBody.includes('now.getTime() - stat.mtimeMs < maxAgeMs'), 'must gate on file age');
    assert.ok(
      fnBody.includes("row?.status === 'generating'") && fnBody.includes('leaseExpiresAt'),
      "must gate on the DB row's live generating status/lease, never age alone",
    );
    assert.ok(fnBody.includes('continue; // never delete the temp file of an actively generating job'));
  });

  await test('clinicBulkExportWorker.ts runs the stale-temp sweep at startup AND on every tick, never letting a sweep failure abort the tick', async () => {
    const source = stripComments(await readSource('jobs/clinicBulkExportWorker.ts'));
    assert.ok(source.includes('sweepStaleClinicBulkExportTempFiles'), 'the worker must import/use the sweep');
    const startFnStart = source.indexOf('export function startClinicBulkExportWorker');
    const startFnEnd = source.indexOf('/**\n * Stops only this worker');
    const startFnBody = source.slice(startFnStart, startFnEnd > -1 ? startFnEnd : startFnStart + 2000);
    assert.ok(startFnBody.includes('runStaleTempSweep()'), 'must run the sweep at startup');
    const tickFnStart = source.indexOf('async function runTick');
    const tickFnEnd = source.indexOf('export function startClinicBulkExportWorker');
    const tickFnBody = source.slice(tickFnStart, tickFnEnd);
    assert.ok(tickFnBody.includes('runStaleTempSweep()'), 'must run the sweep on every tick, not only at startup');
    const sweepFnStart = source.indexOf('async function runStaleTempSweep');
    const sweepFnBody = source.slice(sweepFnStart, sweepFnStart + 600);
    assert.ok(sweepFnBody.includes('try {') && sweepFnBody.includes('catch (err)'), 'the sweep call itself must never let a failure propagate and abort claim/generation in the same tick');
  });

  await test('clinicBulkExportCleanupJob.ts sweeps stale local .partial-* export artifacts on every run', async () => {
    const source = stripComments(await readSource('jobs/clinicBulkExportCleanupJob.ts'));
    assert.ok(source.includes('cleanupStaleLocalExportPartialFiles'));
  });

  section('28. Final review round — fail-closed private temp-directory verification (P0)');

  await test('ensureExportTempDir creates a fresh directory with mode 0700 when none exists', async () => {
    const { ensureExportTempDir, getExportTempDir } = await import('../services/fileStorage.js');
    const dir = getExportTempDir();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    const result = await ensureExportTempDir();
    assert.equal(result, dir);
    if (process.platform !== 'win32') {
      const stat = await fs.lstat(dir);
      assert.ok(stat.isDirectory());
      assert.equal(stat.mode & 0o777, 0o700, `freshly created temp dir must be mode 0700, got ${(stat.mode & 0o777).toString(8)}`);
    }
  });

  await test('ensureExportTempDir accepts an existing, already-safe directory unchanged', async () => {
    const { ensureExportTempDir, getExportTempDir } = await import('../services/fileStorage.js');
    const dir = getExportTempDir();
    await assert.doesNotReject(ensureExportTempDir());
    if (process.platform !== 'win32') {
      const stat = await fs.lstat(dir);
      assert.equal(stat.mode & 0o777, 0o700);
    }
  });

  await test('ensureExportTempDir corrects a pre-existing directory with an unsafe (0777) mode back to 0700', async () => {
    if (process.platform === 'win32') {
      console.log('    (skipped on win32 — POSIX chmod semantics do not apply; verified for real in the Linux container run)');
      return;
    }
    const { ensureExportTempDir, getExportTempDir } = await import('../services/fileStorage.js');
    const dir = getExportTempDir();
    await fs.chmod(dir, 0o777);
    await ensureExportTempDir();
    const stat = await fs.lstat(dir);
    assert.equal(stat.mode & 0o777, 0o700, `must correct an unsafe pre-existing mode back to 0700, got ${(stat.mode & 0o777).toString(8)}`);
  });

  await test('ensureExportTempDir fails closed when chmod fails (test-only injected chmod failure — never a swallowed error)', async () => {
    const { ensureExportTempDir, ExportTempStorageUnsafeError } = await import('../services/fileStorage.js');
    await assert.rejects(
      ensureExportTempDir(async () => {
        throw new Error('simulated chmod failure');
      }),
      ExportTempStorageUnsafeError,
    );
  });

  await test('ensureExportTempDir rejects a pre-existing symbolic link at the fixed temp path', async () => {
    if (process.platform === 'win32') {
      console.log('    (skipped on win32 — creating a directory symlink requires elevated privileges; verified for real in the Linux container run)');
      return;
    }
    const { ensureExportTempDir, getExportTempDir, ExportTempStorageUnsafeError } = await import('../services/fileStorage.js');
    const dir = getExportTempDir();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    const decoyTarget = path.join(os.tmpdir(), `decoy-export-tmp-target-${Date.now()}`);
    await fs.mkdir(decoyTarget, { recursive: true });
    try {
      await fs.symlink(decoyTarget, dir, 'dir');
      await assert.rejects(ensureExportTempDir(), ExportTempStorageUnsafeError);
    } finally {
      await fs.unlink(dir).catch(() => {});
      await fs.rm(decoyTarget, { recursive: true, force: true }).catch(() => {});
    }
    await ensureExportTempDir(); // restore a real, safe directory for any subsequent test
  });

  await test('ensureExportTempDir rejects a pre-existing regular file at the fixed temp path', async () => {
    const { ensureExportTempDir, getExportTempDir, ExportTempStorageUnsafeError } = await import('../services/fileStorage.js');
    const dir = getExportTempDir();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    await fs.writeFile(dir, 'not a directory');
    try {
      await assert.rejects(ensureExportTempDir(), ExportTempStorageUnsafeError);
    } finally {
      await fs.unlink(dir).catch(() => {});
    }
    await ensureExportTempDir(); // restore a real, safe directory for any subsequent test
  });

  await test('ensureExportTempDir uses lstat (never stat) so a symlink target is inspected as itself, not silently followed', async () => {
    const source = await readSource('services/fileStorage.ts');
    const fnStart = source.indexOf('export async function ensureExportTempDir');
    assert.ok(fnStart > -1);
    const fnBody = source.slice(fnStart, fnStart + 1600);
    assert.ok(!/[^.]\bfs\.promises\.stat\(/.test(fnBody), 'must never call fs.promises.stat on the temp dir path (only lstat)');
    assert.ok((fnBody.match(/fs\.promises\.lstat\(/g) ?? []).length >= 2, 'must lstat both the pre-existing path and the final state after mkdir/chmod');
  });

  await test('generation funnels a temp-storage-unsafe failure through the ordinary catch-block cleanup, never creating a ZIP/storageKey/upload', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const genFnStart = source.indexOf('export async function generateClinicBulkExport');
    const ensureCallIndex = source.indexOf('await ensureExportTempDir()', genFnStart);
    const tempPathAssignIndex = source.indexOf('tempFilePath = buildExportTempFilePath(jobId)', genFnStart);
    assert.ok(ensureCallIndex > -1 && tempPathAssignIndex > ensureCallIndex, 'ensureExportTempDir() must be awaited strictly before any temp file path is even computed, so a thrown ExportTempStorageUnsafeError leaves tempFilePath null (nothing to unlink) and never reaches archiver/upload');
  });

  section('29. Final review round — worker-shutdown cancels in-flight generation (P0)');

  await test('failActiveGenerationForWorkerShutdown is guarded on status="generating", records a generation_failed audit with WORKER_SHUTDOWN, and never calls attemptArtifactDeletion itself (reuses the existing in-flight cleanup path instead)', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const fnStart = source.indexOf('export async function failActiveGenerationForWorkerShutdown');
    assert.ok(fnStart > -1);
    const fnBody = source.slice(fnStart, fnStart + 1600);
    assert.ok(fnBody.includes("status: 'generating'"), 'the guarded status transition must require status=generating, so it can never clobber a different terminal state');
    assert.ok(fnBody.includes("data: { status: 'failed', failureCode: 'WORKER_SHUTDOWN' }"));
    assert.ok(fnBody.includes("action: 'clinic_bulk_export_generation_failed'"));
    assert.ok(fnBody.includes("failureCode: 'WORKER_SHUTDOWN'"));
    assert.ok(!fnBody.includes('attemptArtifactDeletion'), 'must not duplicate artifact cleanup — the in-flight generateClinicBulkExport call\'s own existing catch block owns that once it observes the lease loss');
    assert.ok(!/restrictedNote|purpose:/.test(fnBody), 'the audit metadata must never include patient/clinic-specific content');
  });

  await test('ClinicBulkExportArchive is never resurrected by re-running the shutdown cancellation: a second call is a guaranteed no-op (count 0)', async () => {
    const source = await readSource('services/privacy/clinicBulkExportPackage.ts');
    const fnStart = source.indexOf('export async function failActiveGenerationForWorkerShutdown');
    const fnBody = source.slice(fnStart, fnStart + 1600);
    assert.ok(fnBody.includes('if (result.count === 0) return;'), 'a second/racing call that loses the guarded update must return early with no further side effects');
  });

  await test('clinicBulkExportWorker.ts tracks claimed job ids synchronously (no intervening await) before generation starts', async () => {
    const source = stripComments(await readSource('jobs/clinicBulkExportWorker.ts'));
    const tickFnStart = source.indexOf('async function runTick');
    const tickFnEnd = source.indexOf('export function startClinicBulkExportWorker');
    const tickBody = source.slice(tickFnStart, tickFnEnd);
    assert.ok(tickBody.includes('activeGenerationJobIds.add(jobId)'), 'claimed ids must be tracked in the active-generation set');
    const trackIndex = tickBody.indexOf('activeGenerationJobIds.add(jobId)');
    const generateCallIndex = tickBody.indexOf('generateClinicBulkExport(jobId)');
    assert.ok(trackIndex > -1 && generateCallIndex > trackIndex, 'tracking must happen strictly before generateClinicBulkExport is ever called');
    assert.ok(tickBody.includes('activeGenerationJobIds.delete(jobId)'), 'a settled job (success or failure) must be untracked so it is never cancelled twice');
  });

  await test('runTick fails newly-claimed jobs as WORKER_SHUTDOWN instead of starting generation when shutdown began while claiming was in flight', async () => {
    const source = stripComments(await readSource('jobs/clinicBulkExportWorker.ts'));
    const tickFnStart = source.indexOf('async function runTick');
    const tickFnEnd = source.indexOf('export function startClinicBulkExportWorker');
    const tickBody = source.slice(tickFnStart, tickFnEnd);
    const claimIndex = tickBody.indexOf('claimQueuedClinicBulkExportJobs(concurrency)');
    const shutdownCheckIndex = tickBody.indexOf('if (shuttingDown) {', claimIndex);
    assert.ok(claimIndex > -1 && shutdownCheckIndex > claimIndex, 'the post-claim shuttingDown re-check must occur strictly after the claim call');
    const guardBlockEnd = tickBody.indexOf('return;', shutdownCheckIndex);
    assert.ok(guardBlockEnd > shutdownCheckIndex);
    const guardBlock = tickBody.slice(shutdownCheckIndex, guardBlockEnd);
    assert.ok(guardBlock.includes('failActiveGenerationForWorkerShutdown'), 'newly-claimed rows must be failed the same stable way, never handed to generateClinicBulkExport');
    assert.ok(!guardBlock.includes('generateClinicBulkExport('), 'generation must never be started once shuttingDown is observed post-claim');
  });

  await test('stopClinicBulkExportWorker is idempotent (repeated calls return the same promise) and is exported for SIGTERM/SIGINT', async () => {
    const source = await readSource('jobs/clinicBulkExportWorker.ts');
    assert.ok(source.includes("process.once('SIGTERM', stopClinicBulkExportWorker)"));
    assert.ok(source.includes("process.once('SIGINT', stopClinicBulkExportWorker)"));
    const fnStart = source.indexOf('export function stopClinicBulkExportWorker');
    const fnBody = source.slice(fnStart, fnStart + 700);
    assert.ok(fnBody.includes('if (shutdownPromise) return shutdownPromise;'), 'a repeated call must return the SAME in-flight/settled promise, never re-run cancellation');
  });

  await test('stopClinicBulkExportWorker before start does not throw and resolves cleanly', async () => {
    const { stopClinicBulkExportWorker, isClinicBulkExportWorkerTickRunning } = await import('../jobs/clinicBulkExportWorker.js');
    let result: Promise<void>;
    assert.doesNotThrow(() => {
      result = stopClinicBulkExportWorker();
    });
    await assert.doesNotReject(result!);
    assert.equal(isClinicBulkExportWorkerTickRunning(), false);
  });

  await test('trackActiveGenerationJobForTest is a test-only hook, never used by any production call site', async () => {
    const source = await readSource('jobs/clinicBulkExportWorker.ts');
    assert.ok(source.includes('export function trackActiveGenerationJobForTest'));
    const productionSource = stripComments(source).replace(/export function trackActiveGenerationJobForTest[\s\S]*$/, '');
    assert.ok(!productionSource.includes('trackActiveGenerationJobForTest('), 'must never be called by production code — only exported for tests to call directly');
  });

  section('30. Final review round — cleanup observability corrections (P1)');

  await test('sweepStaleClinicBulkExportTempFiles only counts a candidate as deleted once its unlink actually succeeds, and logs a stable code on unlink failure', async () => {
    const source = stripComments(await readSource('services/privacy/clinicBulkExportPackage.ts'));
    const fnStart = source.indexOf('export async function sweepStaleClinicBulkExportTempFiles');
    assert.ok(fnStart > -1);
    const fnBody = source.slice(fnStart, fnStart + 3000);
    const unlinkTryIndex = fnBody.indexOf('await fs.promises.unlink(filePath);');
    const deletedIncrementIndex = fnBody.indexOf('deleted++;');
    assert.ok(unlinkTryIndex > -1 && deletedIncrementIndex > unlinkTryIndex, 'deleted++ must come strictly after a real (non-swallowed) unlink call');
    assert.ok(fnBody.includes("stale-temp sweep: unlink failed"), 'an unlink failure must be logged with a stable message/code, never silently swallowed');
    assert.ok(!/fs\.promises\.unlink\(filePath\)\.catch\(\(\) => \{\}\);\s*\n\s*deleted\+\+/.test(fnBody), 'must never increment deleted from a swallowed (fire-and-forget) unlink call');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
