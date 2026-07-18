/**
 * securityIncident.test.ts — KVKK-CRIT-003 security incident foundation tests.
 *
 * Unlike most of this repo's `*.test.ts` files (pure logic / source
 * inspection, no live database — see clinicBulkExport.test.ts's own header
 * for why), this file DOES talk to a real Postgres database for the
 * dedup/concurrency, lifecycle, detection-rule, and tenant-isolation
 * sections. `securitySignalService.ts`/`securityIncidentService.ts` call
 * the shared Prisma singleton directly with no injected client seam, so
 * meaningfully testing atomic upsert/race-safety/transactional behavior
 * without monkey-patching a real ESM named export requires a real database
 * connection (this repo's own convention — see
 * scripts/verify-clinic-bulk-export-lifecycle.ts for the same pattern used
 * for KVKK-HIGH-004). It uses whatever `DATABASE_URL` is configured (the
 * same local dev/smoke Postgres the rest of the suite assumes is
 * migrated) and cleans up every row it creates in a `finally` block, scoped
 * by a per-run random marker so concurrent runs never collide.
 *
 * Run with: tsx src/tests/securityIncident.test.ts
 * (also wired as `npm run test:security-incidents`)
 *
 * Covers:
 *   A. Sanitization (pure, no DB):
 *   1.  hashIp never returns/contains the raw IP; deterministic for same secret+input
 *   2.  hashIp differs for different secrets (never a fixed/predictable value)
 *   3.  hashAccountIdentifier normalizes (trim+lowercase) before hashing
 *   4.  sanitizeSecurityMetadata drops password/token/secret/cookie/body/rawPayload/
 *       accessToken/storageKey/filePath/exportPath keys entirely
 *   5.  sanitizeSecurityMetadata redacts email/phone-shaped substrings in allowed values
 *   6.  sanitizeSecurityMetadata bounds key count/nesting/size
 *   7.  fingerprintUserAgent is bounded (two inputs sharing the first 512 chars hash identically)
 *   8.  hashIp/hashAccountIdentifier throw when SECURITY_SIGNAL_IP_HASH_SECRET is
 *       unset in production (fail-closed), and recordSecuritySignal swallows that
 *       (never breaks the caller)
 *
 *   B. Deduplication/concurrency (real DB):
 *   9.  Concurrent identical signals create exactly one SecurityIncident row
 *   10. occurrenceCount is accurate after N concurrent upserts
 *   11. firstDetectedAt stays stable across repeated upserts
 *   12. lastDetectedAt advances on each upsert
 *   13. Severity escalates monotonically under concurrent different-severity upserts
 *   14. A closed incident's future occurrence spawns a NEW incident, not a silent reopen
 *
 *   C. Lifecycle (real DB):
 *   15. Valid transition (open -> acknowledged) succeeds and writes an activity row
 *   16. Invalid transition (open -> contained) is rejected
 *   17. contain/resolve/false-positive/reopen reject an empty summary/note
 *   18. Deleted Platform Admin does not destroy incident/activity history (SetNull)
 *   19. Platform routes require authenticatePlatformAdmin (source inspection)
 *
 *   D. Detection rules (real DB):
 *   20. Auth failure below threshold creates no incident; at threshold, one is created
 *   21. evaluateAuthLoginFailureSignal returns synchronously (never blocks the caller)
 *   22. Repeated cross-tenant denial of ONE resource stays medium; MULTIPLE resources escalate to high
 *   23. A single accidental cross-tenant denial creates no incident
 *   24. Export step-up lockout creates an incident immediately (not thresholded)
 *   25. Export token-replay signals are thresholded (no incident below threshold)
 *   26. No raw storage path/token ever appears in stored metadata for export signals
 *
 *   E. Tenant isolation (real DB):
 *   27. listIncidents organizationId filter returns only matching rows
 *   28. listIncidents clinicId filter returns only matching rows
 *
 *   F. API (source inspection):
 *   29. Pagination is capped at 100
 *   30. Filter validation uses the enum status/severity lists
 *   31. No raw err.message/err.stack is ever sent to the client
 *
 *   G. Migration — see docs/compliance/55-kvkk-security-incident-response-foundation.md
 *      Section 19 for the fresh-disposable-PostgreSQL verification performed
 *      this session (61 migrations applied cleanly, unique incidentKey +
 *      all documented indexes confirmed present, zero drift beyond
 *      pre-existing unrelated drift already on `main`).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import {
  hashIp,
  hashAccountIdentifier,
  sanitizeSecurityMetadata,
  sanitizeSecurityOperatorText,
  sanitizeRuleMetadata,
  AUTH_SIGNAL_METADATA_SCHEMA,
  CROSS_TENANT_SIGNAL_METADATA_SCHEMA,
  EXPORT_SIGNAL_METADATA_SCHEMA,
  INCIDENT_ACTIVITY_METADATA_SCHEMA,
  fingerprintUserAgent,
  recordSecuritySignal,
} from '../services/security/securitySignalService.js';
import {
  upsertIncidentFromSignal,
  buildIncidentKey,
  acknowledgeIncident,
  startInvestigation,
  containIncident,
  resolveIncident,
  markFalsePositive,
  reopenIncident,
  closeIncident,
  assignIncident,
  listIncidents,
  severityRank,
  INCIDENT_STATUSES,
} from '../services/security/securityIncidentService.js';
import {
  evaluateAuthLoginFailureSignal,
  evaluateCrossTenantDenialSignal,
  evaluateExportStepUpLockoutSignal,
  evaluateExportTokenReplaySignal,
} from '../services/security/securityDetectionRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Test harness (this repo's convention — no external framework) ───────────

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

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Test-run isolation ────────────────────────────────────────────────────

const RUN_ID = randomUUID();
const testOrgId = (suffix: string) => `test-org-${RUN_ID}-${suffix}`;
const testClinicId = (suffix: string) => `test-clinic-${RUN_ID}-${suffix}`;

const createdPlatformAdminIds: string[] = [];
const createdIncidentKeyPrefixes = new Set<string>();

process.env.SECURITY_SIGNAL_IP_HASH_SECRET = process.env.SECURITY_SIGNAL_IP_HASH_SECRET || 'test-secret-at-least-32-characters-long-ok';

async function createPlatformAdmin(label: string) {
  const admin = await prisma.platformAdmin.create({
    data: {
      email: `security-incident-test-${RUN_ID}-${label}@example.invalid`,
      passwordHash: 'not-a-real-hash',
      name: `Test Admin ${label}`,
    },
  });
  createdPlatformAdminIds.push(admin.id);
  return admin;
}

async function cleanup() {
  await prisma.securityIncidentActivity.deleteMany({ where: { incident: { organizationId: { contains: RUN_ID } } } }).catch(() => {});
  await prisma.securityIncident.deleteMany({ where: { organizationId: { contains: RUN_ID } } }).catch(() => {});
  await prisma.securitySignalEvent.deleteMany({ where: { organizationId: { contains: RUN_ID } } }).catch(() => {});
  // Test #8 (fail-closed production) records a signal with no organizationId
  // (it exercises the pre-org-scope hashing failure path) — sweep it by
  // its distinctive signalType instead.
  await prisma.securitySignalEvent.deleteMany({ where: { signalType: 'test_signal' } }).catch(() => {});
  for (const id of createdPlatformAdminIds) {
    await prisma.platformAdmin.delete({ where: { id } }).catch(() => {});
  }
}

// ── A. Sanitization (pure) ────────────────────────────────────────────────

async function runSanitizationTests() {
  section('A. Sanitization');

  await test('1. hashIp never returns/contains the raw IP; deterministic for same secret+input', () => {
    const raw = '203.0.113.42';
    const h1 = hashIp(raw);
    const h2 = hashIp(raw);
    assert.ok(h1);
    assert.notEqual(h1, raw);
    assert.ok(!h1!.includes(raw));
    assert.equal(h1, h2);
    assert.equal(h1!.length, 64); // sha256 hex
  });

  await test('2. hashIp differs for different secrets', () => {
    const raw = '203.0.113.42';
    const originalSecret = process.env.SECURITY_SIGNAL_IP_HASH_SECRET;
    const h1 = hashIp(raw);
    process.env.SECURITY_SIGNAL_IP_HASH_SECRET = 'a-different-test-secret-of-32-chars-min';
    const h2 = hashIp(raw);
    process.env.SECURITY_SIGNAL_IP_HASH_SECRET = originalSecret;
    assert.notEqual(h1, h2);
  });

  await test('3. hashAccountIdentifier normalizes (trim+lowercase) before hashing', () => {
    const h1 = hashAccountIdentifier('Doctor@Example.com');
    const h2 = hashAccountIdentifier('  doctor@example.com  ');
    assert.equal(h1, h2);
  });

  await test('4. sanitizeSecurityMetadata drops secret/credential/content-path keys entirely', () => {
    const out = sanitizeSecurityMetadata({
      password: 'hunter2',
      passwordHash: 'abc',
      token: 'xyz',
      secret: 'shh',
      authorization: 'Bearer abc',
      cookie: 'session=1',
      body: '{}',
      rawPayload: '{}',
      messageText: 'hello patient',
      accessToken: 'abc',
      storageKey: 'exports/x.zip',
      filePath: '/tmp/x',
      exportPath: '/tmp/y',
      safeField: 'kept',
    });
    assert.ok(out);
    assert.equal(Object.keys(out!).length, 1);
    assert.equal(out!.safeField, 'kept');
  });

  await test('5. sanitizeSecurityMetadata redacts email/phone-shaped substrings', () => {
    const out = sanitizeSecurityMetadata({ note: 'contact patient@example.com or 555-123-4567 for details' });
    assert.ok(out);
    const note = String(out!.note);
    assert.ok(!note.includes('patient@example.com'));
    assert.ok(!note.includes('555-123-4567'));
    assert.ok(note.includes('[redacted-email]'));
  });

  await test('6. sanitizeSecurityMetadata bounds key count/nesting/size', () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) many[`key${i}`] = 'x'.repeat(300);
    const out = sanitizeSecurityMetadata(many);
    assert.ok(out);
    assert.ok(Object.keys(out!).length <= 20);
    assert.ok(JSON.stringify(out).length <= 4000);

    const deep = { a: { b: { c: { d: 'too deep' } } } };
    const outDeep = sanitizeSecurityMetadata(deep);
    assert.ok(JSON.stringify(outDeep).includes('nested-value-omitted'));
  });

  await test('7. fingerprintUserAgent is bounded (shared 512-char prefix hashes identically)', () => {
    const prefix = 'Mozilla/5.0 '.repeat(50).slice(0, 512);
    const uaA = prefix + 'AAAAAAAA-tail-one';
    const uaB = prefix + 'BBBBBBBB-tail-two-different';
    assert.equal(fingerprintUserAgent(uaA), fingerprintUserAgent(uaB));
  });

  await test('8. fail-closed in production; recordSecuritySignal swallows the failure', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.SECURITY_SIGNAL_IP_HASH_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.SECURITY_SIGNAL_IP_HASH_SECRET;
    try {
      assert.throws(() => hashIp('203.0.113.1'));
      // recordSecuritySignal must never throw even though hashing fails closed.
      await assert.doesNotReject(() =>
        recordSecuritySignal({
          signalType: 'test_signal',
          category: 'test',
          severity: 'low',
          ruleKey: 'test.rule',
          dedupeDimension: 'test-dim',
          ipAddress: '203.0.113.1',
        }),
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.SECURITY_SIGNAL_IP_HASH_SECRET = originalSecret;
    }
  });
}

// ── B. Dedup/concurrency (real DB) ───────────────────────────────────────

async function runDedupTests() {
  section('B. Deduplication/concurrency');
  const orgId = testOrgId('dedup');
  const clinicId = testClinicId('dedup');
  createdIncidentKeyPrefixes.add(orgId);

  await test('9-10. Concurrent identical signals create exactly one incident with an accurate occurrenceCount', async () => {
    const input = {
      sourceRule: 'test.dedup.v1',
      sourceType: 'test',
      category: 'test_category',
      severity: 'medium' as const,
      organizationId: orgId,
      clinicId,
      affectedResourceType: 'test_resource',
      affectedResourceId: 'resource-1',
      title: 'Test dedup incident',
      summary: 'Concurrency test',
    };
    await Promise.all(Array.from({ length: 5 }, () => upsertIncidentFromSignal(input)));

    const key = buildIncidentKey(input);
    const rows = await prisma.securityIncident.findMany({ where: { incidentKey: key } });
    assert.equal(rows.length, 1, 'exactly one incident row must exist');
    assert.equal(rows[0].occurrenceCount, 5);
  });

  await test('11-12. firstDetectedAt stable, lastDetectedAt advances', async () => {
    const input = {
      sourceRule: 'test.dedup.v2',
      sourceType: 'test',
      category: 'test_category',
      severity: 'medium' as const,
      organizationId: orgId,
      clinicId,
      affectedResourceType: 'test_resource',
      affectedResourceId: 'resource-2',
      title: 'Test stability incident',
      summary: 'Stability test',
    };
    const first = await upsertIncidentFromSignal({ ...input, now: new Date('2026-01-01T00:00:00.000Z') });
    await sleep(5);
    const second = await upsertIncidentFromSignal({ ...input, now: new Date('2026-01-01T00:05:00.000Z') });

    assert.equal(first.incident.firstDetectedAt.toISOString(), second.incident.firstDetectedAt.toISOString());
    assert.ok(second.incident.lastDetectedAt.getTime() > first.incident.lastDetectedAt.getTime());
  });

  await test('13. Severity escalates monotonically under concurrent different-severity upserts, never downgrades', async () => {
    const base = {
      sourceRule: 'test.escalation.v1',
      sourceType: 'test',
      category: 'test_category',
      organizationId: orgId,
      clinicId,
      affectedResourceType: 'test_resource',
      affectedResourceId: 'resource-3',
      title: 'Escalation test',
      summary: 'Escalation test',
    };
    await upsertIncidentFromSignal({ ...base, severity: 'low' });
    await Promise.all([
      upsertIncidentFromSignal({ ...base, severity: 'high' }),
      upsertIncidentFromSignal({ ...base, severity: 'medium' }),
      upsertIncidentFromSignal({ ...base, severity: 'critical' }),
      upsertIncidentFromSignal({ ...base, severity: 'high' }),
    ]);

    const key = buildIncidentKey(base);
    const row = await prisma.securityIncident.findUniqueOrThrow({ where: { incidentKey: key } });
    assert.equal(row.severity, 'critical');
    assert.ok(severityRank(row.severity) >= severityRank('critical'));
  });

  await test('14. A closed incident spawns a NEW incident on the next occurrence, not a silent reopen', async () => {
    const base = {
      sourceRule: 'test.reopen.v1',
      sourceType: 'test',
      category: 'test_category',
      severity: 'medium' as const,
      organizationId: orgId,
      clinicId,
      affectedResourceType: 'test_resource',
      affectedResourceId: 'resource-4',
      title: 'Reopen test',
      summary: 'Reopen test',
    };
    const { incident: original } = await upsertIncidentFromSignal(base);
    const admin = await createPlatformAdmin('reopen');
    await acknowledgeIncident({ incidentId: original.id, actorPlatformAdminId: admin.id });
    await startInvestigation({ incidentId: original.id, actorPlatformAdminId: admin.id });
    await resolveIncident({ incidentId: original.id, actorPlatformAdminId: admin.id, resolutionSummary: 'fixed' });
    await closeIncident({ incidentId: original.id, actorPlatformAdminId: admin.id });

    const { incident: recurrence, created } = await upsertIncidentFromSignal(base);
    assert.equal(created, true);
    assert.notEqual(recurrence.id, original.id);

    const stillClosed = await prisma.securityIncident.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(stillClosed.status, 'closed');
    assert.equal(stillClosed.occurrenceCount, 1, 'the terminal incident must not silently absorb the new occurrence');

    const metadata = recurrence.metadata as Record<string, unknown> | null;
    assert.equal(metadata?.reopenedFromIncidentId, original.id);
  });
}

// ── C. Lifecycle (real DB) ────────────────────────────────────────────────

async function runLifecycleTests() {
  section('C. Lifecycle');
  const orgId = testOrgId('lifecycle');

  await test('15. Valid transition (open -> acknowledged) succeeds and writes an activity row', async () => {
    const admin = await createPlatformAdmin('lifecycle-1');
    const { incident } = await upsertIncidentFromSignal({
      sourceRule: 'test.lifecycle.v1', sourceType: 'test', category: 'test_category', severity: 'medium',
      organizationId: orgId, affectedResourceType: 'r', affectedResourceId: 'r1', title: 't', summary: 's',
    });

    const result = await acknowledgeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.incident.status, 'acknowledged');

    const activity = await prisma.securityIncidentActivity.findFirst({ where: { incidentId: incident.id, action: 'acknowledged' } });
    assert.ok(activity);
    assert.equal(activity!.actorPlatformAdminId, admin.id);
    assert.equal(activity!.previousStatus, 'open');
    assert.equal(activity!.newStatus, 'acknowledged');
  });

  await test('16. Invalid transition (open -> contained) is rejected', async () => {
    const admin = await createPlatformAdmin('lifecycle-2');
    const { incident } = await upsertIncidentFromSignal({
      sourceRule: 'test.lifecycle.v2', sourceType: 'test', category: 'test_category', severity: 'medium',
      organizationId: orgId, affectedResourceType: 'r', affectedResourceId: 'r2', title: 't', summary: 's',
    });

    const result = await containIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id, containmentSummary: 'contained' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'invalid_transition');
  });

  await test('17. contain/resolve/false-positive/reopen reject an empty summary/note', async () => {
    const admin = await createPlatformAdmin('lifecycle-3');
    const fakeId = randomUUID();
    const r1 = await containIncident({ incidentId: fakeId, actorPlatformAdminId: admin.id, containmentSummary: '   ' });
    const r2 = await resolveIncident({ incidentId: fakeId, actorPlatformAdminId: admin.id, resolutionSummary: '' });
    const r3 = await markFalsePositive({ incidentId: fakeId, actorPlatformAdminId: admin.id, note: '' });
    const r4 = await reopenIncident({ incidentId: fakeId, actorPlatformAdminId: admin.id, note: '  ' });
    for (const r of [r1, r2, r3, r4]) {
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error, 'summary_required');
    }
  });

  await test('18. Deleted Platform Admin does not destroy incident/activity history (SetNull)', async () => {
    const admin = await createPlatformAdmin('lifecycle-4');
    const { incident } = await upsertIncidentFromSignal({
      sourceRule: 'test.lifecycle.v3', sourceType: 'test', category: 'test_category', severity: 'medium',
      organizationId: orgId, affectedResourceType: 'r', affectedResourceId: 'r3', title: 'Deletable admin test', summary: 's',
    });
    await assignIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id, assigneePlatformAdminId: admin.id });
    await acknowledgeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id });

    await prisma.platformAdmin.delete({ where: { id: admin.id } });
    createdPlatformAdminIds.splice(createdPlatformAdminIds.indexOf(admin.id), 1);

    const reloaded = await prisma.securityIncident.findUniqueOrThrow({ where: { id: incident.id } });
    assert.equal(reloaded.title, 'Deletable admin test');
    assert.equal(reloaded.assignedToPlatformAdminId, null);
    assert.equal(reloaded.acknowledgedByPlatformAdminId, null);
    assert.equal(reloaded.status, 'acknowledged');

    const activity = await prisma.securityIncidentActivity.findFirst({ where: { incidentId: incident.id, action: 'acknowledged' } });
    assert.ok(activity, 'activity row must survive the actor being deleted');
    assert.equal(activity!.actorPlatformAdminId, null);
  });

  await test('19. Platform routes require authenticatePlatformAdmin (source inspection)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'platformSecurityIncidents.ts'), 'utf8');
    assert.ok(src.includes("router.use(authenticatePlatformAdmin"), 'every route in this file must sit behind authenticatePlatformAdmin');
    assert.ok(!/authorize\(\[/.test(src), 'this file must never use the clinic-user authorize() middleware');
  });
}

// ── D. Detection rules (real DB) ─────────────────────────────────────────

async function runDetectionRuleTests() {
  section('D. Detection rules');
  const orgId = testOrgId('rules');
  const clinicId = testClinicId('rules');

  await test('20. Auth failure below threshold creates no incident; at threshold, one is created', async () => {
    const original = process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD;
    process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD = '3';
    try {
      const account = `brute-force-${RUN_ID}@example.invalid`;
      const accountHash = hashAccountIdentifier(account)!;

      evaluateAuthLoginFailureSignal({ accountIdentifier: account, context: 'clinic', organizationId: orgId, clinicId, ip: '203.0.113.9' });
      await sleep(150);
      const belowThreshold = await prisma.securityIncident.findFirst({ where: { affectedResourceId: accountHash, sourceRule: 'auth.brute_force.v1' } });
      assert.equal(belowThreshold, null, 'a single failure must not create an incident');

      evaluateAuthLoginFailureSignal({ accountIdentifier: account, context: 'clinic', organizationId: orgId, clinicId, ip: '203.0.113.9' });
      evaluateAuthLoginFailureSignal({ accountIdentifier: account, context: 'clinic', organizationId: orgId, clinicId, ip: '203.0.113.9' });
      await sleep(200);
      const atThreshold = await prisma.securityIncident.findFirst({ where: { affectedResourceId: accountHash, sourceRule: 'auth.brute_force.v1' } });
      assert.ok(atThreshold, 'threshold-crossing failures must create an incident');
      assert.equal(atThreshold!.organizationId, orgId);
    } finally {
      process.env.SECURITY_ALERT_AUTH_FAILURE_THRESHOLD = original;
    }
  });

  await test('21. evaluateAuthLoginFailureSignal returns synchronously (never blocks the caller)', () => {
    const before = Date.now();
    const result = evaluateAuthLoginFailureSignal({ accountIdentifier: 'sync-test@example.invalid', context: 'clinic', organizationId: orgId });
    const elapsed = Date.now() - before;
    assert.equal(result, undefined);
    assert.ok(elapsed < 50, 'must return immediately, not await any DB work');
  });

  await test('22. Repeated cross-tenant denial: one resource stays medium, multiple resources escalate to high', async () => {
    const originalThreshold = process.env.SECURITY_ALERT_CROSS_TENANT_THRESHOLD;
    process.env.SECURITY_ALERT_CROSS_TENANT_THRESHOLD = '2';
    try {
      const actorSingle = randomUUID();
      for (let i = 0; i < 2; i++) {
        evaluateCrossTenantDenialSignal({
          actorUserId: actorSingle, actorOrganizationId: orgId, actorClinicId: clinicId,
          attemptedResourceType: 'clinic', attemptedResourceId: 'target-clinic-a', method: 'GET', routeTemplate: '/patients',
        });
      }
      await sleep(200);
      const actorHashSingle = hashAccountIdentifier(actorSingle)!;
      const singleResourceIncident = await prisma.securityIncident.findFirst({ where: { affectedResourceId: actorHashSingle, sourceRule: 'access.cross_tenant.v1' } });
      assert.ok(singleResourceIncident);
      assert.equal(singleResourceIncident!.severity, 'medium');

      const actorMulti = randomUUID();
      evaluateCrossTenantDenialSignal({ actorUserId: actorMulti, actorOrganizationId: orgId, actorClinicId: clinicId, attemptedResourceType: 'clinic', attemptedResourceId: 'target-clinic-b', method: 'GET', routeTemplate: '/patients' });
      evaluateCrossTenantDenialSignal({ actorUserId: actorMulti, actorOrganizationId: orgId, actorClinicId: clinicId, attemptedResourceType: 'clinic', attemptedResourceId: 'target-clinic-c', method: 'GET', routeTemplate: '/appointments' });
      await sleep(200);
      const actorHashMulti = hashAccountIdentifier(actorMulti)!;
      const multiResourceIncident = await prisma.securityIncident.findFirst({ where: { affectedResourceId: actorHashMulti, sourceRule: 'access.cross_tenant.v1' } });
      assert.ok(multiResourceIncident);
      assert.equal(multiResourceIncident!.severity, 'high');
    } finally {
      process.env.SECURITY_ALERT_CROSS_TENANT_THRESHOLD = originalThreshold;
    }
  });

  await test('23. A single accidental cross-tenant denial creates no incident', async () => {
    const actor = randomUUID();
    evaluateCrossTenantDenialSignal({ actorUserId: actor, actorOrganizationId: orgId, actorClinicId: clinicId, attemptedResourceType: 'clinic', attemptedResourceId: 'target-clinic-lonely', method: 'GET', routeTemplate: '/patients' });
    await sleep(150);
    const actorHash = hashAccountIdentifier(actor)!;
    const incident = await prisma.securityIncident.findFirst({ where: { affectedResourceId: actorHash, sourceRule: 'access.cross_tenant.v1' } });
    assert.equal(incident, null);
  });

  await test('24. Export step-up lockout creates an incident immediately (not thresholded)', async () => {
    const actorUserId = randomUUID();
    evaluateExportStepUpLockoutSignal({ organizationId: orgId, clinicId, actorUserId });
    await sleep(150);
    const incident = await prisma.securityIncident.findFirst({ where: { sourceRule: 'export.step_up_lockout.v1', clinicId } });
    assert.ok(incident, 'a single lockout must be surfaced immediately');
  });

  await test('25. Export token-replay signals are thresholded', async () => {
    const originalThreshold = process.env.SECURITY_ALERT_EXPORT_REPLAY_THRESHOLD;
    process.env.SECURITY_ALERT_EXPORT_REPLAY_THRESHOLD = '3';
    try {
      const actorUserId = randomUUID();
      evaluateExportTokenReplaySignal({ organizationId: orgId, clinicId, actorUserId, reason: 'expired' });
      await sleep(150);
      const clinicHash = (await import('../services/security/securitySignalService.js')).hashResourceId(clinicId);
      const below = await prisma.securityIncident.findFirst({ where: { sourceRule: 'export.token_replay.v1', affectedResourceId: clinicHash, organizationId: orgId } });
      assert.equal(below, null);

      evaluateExportTokenReplaySignal({ organizationId: orgId, clinicId, actorUserId, reason: 'expired' });
      evaluateExportTokenReplaySignal({ organizationId: orgId, clinicId, actorUserId, reason: 'already_downloaded' });
      await sleep(200);
      const atThreshold = await prisma.securityIncident.findFirst({ where: { sourceRule: 'export.token_replay.v1', affectedResourceId: clinicHash, organizationId: orgId } });
      assert.ok(atThreshold);
    } finally {
      process.env.SECURITY_ALERT_EXPORT_REPLAY_THRESHOLD = originalThreshold;
    }
  });

  await test('26. No raw storage path/token ever appears in stored signal/incident metadata', async () => {
    const rows = await prisma.securitySignalEvent.findMany({ where: { organizationId: orgId }, take: 200 });
    for (const row of rows) {
      const json = JSON.stringify(row.safeMetadata ?? {});
      assert.ok(!/exports\//i.test(json), 'no storage-key-shaped path in signal metadata');
      assert.ok(!json.toLowerCase().includes('token'), 'no token-shaped field in signal metadata');
    }
    const incidents = await prisma.securityIncident.findMany({ where: { organizationId: orgId }, take: 200 });
    for (const incident of incidents) {
      const json = JSON.stringify(incident.metadata ?? {});
      assert.ok(!/exports\//i.test(json));
      assert.ok(!json.toLowerCase().includes('token'));
    }
  });
}

// ── E. Tenant isolation (real DB) ─────────────────────────────────────────

async function runTenantIsolationTests() {
  section('E. Tenant isolation');
  const orgA = testOrgId('tenant-a');
  const orgB = testOrgId('tenant-b');
  const clinicA = testClinicId('tenant-a');
  const clinicB = testClinicId('tenant-b');

  await upsertIncidentFromSignal({ sourceRule: 'test.tenant.v1', sourceType: 'test', category: 'test_category', severity: 'low', organizationId: orgA, clinicId: clinicA, affectedResourceType: 'r', affectedResourceId: 'a', title: 'org A incident', summary: 's' });
  await upsertIncidentFromSignal({ sourceRule: 'test.tenant.v2', sourceType: 'test', category: 'test_category', severity: 'low', organizationId: orgB, clinicId: clinicB, affectedResourceType: 'r', affectedResourceId: 'b', title: 'org B incident', summary: 's' });

  await test('27. listIncidents organizationId filter returns only matching rows', async () => {
    const result = await listIncidents({ organizationId: orgA }, 1, 25);
    assert.ok(result.data.every((i) => i.organizationId === orgA));
    assert.ok(result.data.some((i) => i.title === 'org A incident'));
    assert.ok(!result.data.some((i) => i.title === 'org B incident'));
  });

  await test('28. listIncidents clinicId filter returns only matching rows', async () => {
    const result = await listIncidents({ clinicId: clinicB }, 1, 25);
    assert.ok(result.data.every((i) => i.clinicId === clinicB));
    assert.ok(result.data.some((i) => i.title === 'org B incident'));
  });
}

// ── F. API (source inspection) ────────────────────────────────────────────

async function runApiSourceTests() {
  section('F. API');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'platformSecurityIncidents.ts'), 'utf8');

  await test('29. Pagination is capped at 100', () => {
    assert.ok(/MAX_PAGE_SIZE\s*=\s*100/.test(src));
    assert.ok(/Math\.min\(MAX_PAGE_SIZE/.test(src));
  });

  await test('30. Filter validation uses the shared enum status/severity lists', () => {
    assert.ok(src.includes('z.enum(INCIDENT_STATUSES)'));
    assert.ok(src.includes('z.enum(INCIDENT_SEVERITIES)'));
  });

  await test('31. No raw err.message/err.stack is ever sent to the client', () => {
    const jsonCalls = src.match(/res\.status\(\d+\)\.json\(\{[^)]*\}\)/g) ?? [];
    for (const call of jsonCalls) {
      assert.ok(!call.includes('err.message'), `response must never include err.message: ${call}`);
      assert.ok(!call.includes('err.stack'), `response must never include err.stack: ${call}`);
    }
  });
}

// ── G. Migration — see docs/compliance/55-...md Section 19 ───────────────

async function runMigrationSanityTests() {
  section('G. Migration (schema sanity only — full disposable-Postgres verification is documented separately)');

  await test('32. INCIDENT_STATUSES matches the documented transition graph vocabulary', () => {
    assert.deepEqual(
      [...INCIDENT_STATUSES].sort(),
      ['acknowledged', 'closed', 'contained', 'false_positive', 'investigating', 'open', 'resolved'].sort(),
    );
  });

  await test('33. incidentKey is enforced unique at the DB level', async () => {
    const key = `test-unique-${RUN_ID}`;
    await prisma.securityIncident.create({
      data: {
        incidentKey: key, category: 'test', severity: 'low', status: 'open',
        title: 't', summary: 's', firstDetectedAt: new Date(), lastDetectedAt: new Date(),
        sourceType: 'test', sourceRule: 'test.unique.v1',
      },
    });
    await assert.rejects(() =>
      prisma.securityIncident.create({
        data: {
          incidentKey: key, category: 'test', severity: 'low', status: 'open',
          title: 't2', summary: 's2', firstDetectedAt: new Date(), lastDetectedAt: new Date(),
          sourceType: 'test', sourceRule: 'test.unique.v1',
        },
      }),
    );
    await prisma.securityIncident.deleteMany({ where: { incidentKey: key } });
  });
}

// ── H. Concurrency-safe lifecycle (CAS) (real DB) ─────────────────────────

async function runLifecycleConcurrencyTests() {
  section('H. Concurrency-safe lifecycle (CAS)');
  const orgId = testOrgId('lifecycle-race');

  async function freshIncident(resourceId: string) {
    const { incident } = await upsertIncidentFromSignal({
      sourceRule: 'test.race.v1', sourceType: 'test', category: 'test_category', severity: 'medium',
      organizationId: orgId, affectedResourceType: 'r', affectedResourceId: resourceId, title: 't', summary: 's',
    });
    return incident;
  }

  await test('34. Two concurrent acknowledge requests: exactly one succeeds, exactly one acknowledged activity, loser gets concurrent_transition', async () => {
    const admin = await createPlatformAdmin('race-ack');
    const incident = await freshIncident('race-ack');

    const results = await Promise.all([
      acknowledgeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id }),
      acknowledgeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id }),
    ]);

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    assert.equal(winners.length, 1, 'exactly one concurrent acknowledge must win');
    assert.equal(losers.length, 1);
    assert.equal((losers[0] as { ok: false; error: string }).error, 'concurrent_transition');

    const activities = await prisma.securityIncidentActivity.findMany({ where: { incidentId: incident.id, action: 'acknowledged' } });
    assert.equal(activities.length, 1, 'exactly one acknowledged activity must exist');

    const final = await prisma.securityIncident.findUniqueOrThrow({ where: { id: incident.id } });
    assert.equal(final.status, 'acknowledged');
  });

  await test('35. Concurrent contain and resolve from investigating: only one wins, no contradictory activity pair, final status matches the winner', async () => {
    const admin = await createPlatformAdmin('race-contain-resolve');
    const incident = await freshIncident('race-contain-resolve');
    await acknowledgeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id });
    await startInvestigation({ incidentId: incident.id, actorPlatformAdminId: admin.id });

    const [containResult, resolveResult] = await Promise.all([
      containIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id, containmentSummary: 'contained the issue' }),
      resolveIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id, resolutionSummary: 'resolved the issue' }),
    ]);

    const results = [containResult, resolveResult];
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    assert.equal(winners.length, 1, 'exactly one of contain/resolve must win the race');
    assert.equal((losers[0] as { ok: false; error: string }).error, 'concurrent_transition');

    const containedActivities = await prisma.securityIncidentActivity.findMany({ where: { incidentId: incident.id, action: 'contained' } });
    const resolvedActivities = await prisma.securityIncidentActivity.findMany({ where: { incidentId: incident.id, action: 'resolved' } });
    assert.equal(containedActivities.length + resolvedActivities.length, 1, 'no contradictory contain+resolve activity pair');

    const final = await prisma.securityIncident.findUniqueOrThrow({ where: { id: incident.id } });
    assert.ok(final.status === 'contained' || final.status === 'resolved');
    if (containResult.ok) assert.equal(final.status, 'contained');
    if (resolveResult.ok) assert.equal(final.status, 'resolved');
  });

  await test('36. Concurrent close and investigate from resolved: only one wins, no stale overwrite', async () => {
    const admin = await createPlatformAdmin('race-close-investigate');
    const incident = await freshIncident('race-close-investigate');
    await acknowledgeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id });
    await startInvestigation({ incidentId: incident.id, actorPlatformAdminId: admin.id });
    await resolveIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id, resolutionSummary: 'fix applied' });

    const [closeResult, investigateResult] = await Promise.all([
      closeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id }),
      startInvestigation({ incidentId: incident.id, actorPlatformAdminId: admin.id }),
    ]);

    const results = [closeResult, investigateResult];
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    assert.equal(winners.length, 1);
    assert.equal((losers[0] as { ok: false; error: string }).error, 'concurrent_transition');

    const final = await prisma.securityIncident.findUniqueOrThrow({ where: { id: incident.id } });
    if (closeResult.ok) assert.equal(final.status, 'closed');
    if (investigateResult.ok) assert.equal(final.status, 'investigating');
  });

  await test('37. The race loser never creates an activity row, even in a 3-way race', async () => {
    const admin = await createPlatformAdmin('race-loser-activity');
    const incident = await freshIncident('race-loser-activity');

    await Promise.all([
      acknowledgeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id }),
      acknowledgeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id }),
      acknowledgeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id }),
    ]);

    const activities = await prisma.securityIncidentActivity.findMany({ where: { incidentId: incident.id, action: 'acknowledged' } });
    assert.equal(activities.length, 1, 'only the single winner of a 3-way race may write an activity row');
  });
}

// ── I. Atomic created-activity under concurrency (stress) (real DB) ──────

async function runCreatedActivityStressTests() {
  section('I. Atomic created-activity under concurrency (stress)');
  const orgId = testOrgId('stress');
  const clinicId = testClinicId('stress');

  async function stress20(resourceIdSuffix: string) {
    const affectedResourceId = `stress-resource-${resourceIdSuffix}`;
    const severityCycle = ['low', 'medium', 'high', 'critical'] as const;

    const calls = Array.from({ length: 20 }, (_, i) =>
      upsertIncidentFromSignal({
        sourceRule: 'test.stress.v1',
        sourceType: 'test',
        category: 'test_category',
        severity: severityCycle[i % severityCycle.length],
        organizationId: orgId,
        clinicId,
        affectedResourceType: 'test_resource',
        affectedResourceId,
        title: 'Stress incident',
        summary: 'Stress test',
      }),
    );

    const results = await Promise.allSettled(calls);
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(rejected.length, 0, `no unhandled rejection: ${rejected.map((r) => (r as PromiseRejectedResult).reason).join('; ')}`);

    const fulfilled = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof upsertIncidentFromSignal>>>).value);
    assert.equal(fulfilled.filter((r) => r.created).length, 1, 'exactly one caller must be the creator');

    const key = buildIncidentKey({
      sourceRule: 'test.stress.v1', organizationId: orgId, clinicId, affectedResourceType: 'test_resource', affectedResourceId,
    });
    const rows = await prisma.securityIncident.findMany({ where: { incidentKey: key } });
    assert.equal(rows.length, 1, 'exactly one SecurityIncident row');
    const row = rows[0];
    assert.equal(row.occurrenceCount, 20, 'occurrenceCount must be exactly 20');
    assert.equal(row.severity, 'critical', 'final severity must equal the highest submitted severity');
    assert.ok(row.lastDetectedAt.getTime() >= row.firstDetectedAt.getTime(), 'lastDetectedAt must be at or after firstDetectedAt');

    const createdActivities = await prisma.securityIncidentActivity.findMany({ where: { incidentId: row.id, action: 'created' } });
    assert.equal(createdActivities.length, 1, 'exactly one created activity');
  }

  await test('38. 20 concurrent identical signals (run 1): exactly one row, one created activity, occurrenceCount 20, correct severity/timestamps', async () => {
    await stress20('run1');
  });

  await test('39. 20 concurrent identical signals (run 2, independent incident): same invariants hold again', async () => {
    await stress20('run2');
  });

  await test('40. 20 concurrent occurrences after a closed incident: exactly one new recurrence incident, one created activity, occurrenceCount 20', async () => {
    const admin = await createPlatformAdmin('stress-recurrence');
    const base = {
      sourceRule: 'test.stress.recurrence.v1',
      sourceType: 'test',
      category: 'test_category',
      severity: 'medium' as const,
      organizationId: orgId,
      clinicId,
      affectedResourceType: 'test_resource',
      affectedResourceId: 'stress-recurrence',
      title: 'Recurrence stress incident',
      summary: 'Recurrence stress test',
    };
    const { incident: original } = await upsertIncidentFromSignal(base);
    await acknowledgeIncident({ incidentId: original.id, actorPlatformAdminId: admin.id });
    await startInvestigation({ incidentId: original.id, actorPlatformAdminId: admin.id });
    await resolveIncident({ incidentId: original.id, actorPlatformAdminId: admin.id, resolutionSummary: 'fixed before recurrence stress' });
    await closeIncident({ incidentId: original.id, actorPlatformAdminId: admin.id });

    const calls = Array.from({ length: 20 }, () => upsertIncidentFromSignal(base));
    const results = await Promise.allSettled(calls);
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(rejected.length, 0, 'no unhandled rejection during recurrence stress');

    const fulfilled = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof upsertIncidentFromSignal>>>).value);
    assert.equal(fulfilled.filter((r) => r.created).length, 1, 'exactly one recurrence incident must be created');
    fulfilled.forEach((r) => assert.notEqual(r.incident.id, original.id, 'the recurrence must never be the same row as the terminal incident'));

    const recurrenceId = fulfilled.find((r) => r.created)!.incident.id;
    const recurrenceRow = await prisma.securityIncident.findUniqueOrThrow({ where: { id: recurrenceId } });
    assert.equal(recurrenceRow.occurrenceCount, 20);

    const createdActivities = await prisma.securityIncidentActivity.findMany({ where: { incidentId: recurrenceId, action: 'created' } });
    assert.equal(createdActivities.length, 1);

    const stillOriginal = await prisma.securityIncident.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(stillOriginal.status, 'closed');
    assert.equal(stillOriginal.occurrenceCount, 1, 'the terminal incident must not absorb any of the 20 new occurrences');
  });
}

// ── J. Platform-Admin operator-text sanitization ──────────────────────────

async function runOperatorTextSanitizationTests() {
  section('J. Platform-Admin operator-text sanitization');

  await test('41. Raw email is never stored — redacted to a marker', () => {
    const out = sanitizeSecurityOperatorText('Contained after contacting patient@example.com about the incident.');
    assert.ok(out);
    assert.ok(!out!.includes('patient@example.com'));
    assert.ok(out!.includes('[redacted-email]'));
  });

  await test('42. Raw phone number is never stored — redacted to a marker', () => {
    const out = sanitizeSecurityOperatorText('Called the patient at 555-123-4567 to confirm.');
    assert.ok(out);
    assert.ok(!out!.includes('555-123-4567'));
    assert.ok(out!.includes('[redacted-number]'));
  });

  await test('43. A bearer token in the text rejects the whole field', () => {
    const out = sanitizeSecurityOperatorText('Rotated credentials, old value was Bearer abcdefgh12345678');
    assert.equal(out, null);
  });

  await test('44. Password-like content is rejected', () => {
    assert.equal(sanitizeSecurityOperatorText('Reset password: hunter2ForNow'), null);
    assert.equal(sanitizeSecurityOperatorText('pwd=SuperSecret123'), null);
  });

  await test('45. Control characters are removed', () => {
    const withControlChars =
      'Contained' + String.fromCharCode(0) + ' the' + String.fromCharCode(7) + ' issue' + String.fromCharCode(31) + ' cleanly';
    const out = sanitizeSecurityOperatorText(withControlChars);
    assert.ok(out);
    const hasControlChar = Array.from(out!).some((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return (code <= 0x1f && code !== 0x09 && code !== 0x0a) || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    });
    assert.ok(!hasControlChar, 'no control characters must survive sanitization');
    assert.ok(out!.includes('Contained'));
  });

  await test('46. Oversized input is bounded', () => {
    const out = sanitizeSecurityOperatorText('safe content '.repeat(2000));
    assert.ok(out);
    assert.ok(out!.length <= 2000);
  });

  await test('47. A fully unsafe required summary is rejected end-to-end by containIncident', async () => {
    const admin = await createPlatformAdmin('sanitize-e2e');
    const { incident } = await upsertIncidentFromSignal({
      sourceRule: 'test.sanitize.v1', sourceType: 'test', category: 'test_category', severity: 'medium',
      organizationId: testOrgId('sanitize'), affectedResourceType: 'r', affectedResourceId: 'sanitize-1', title: 't', summary: 's',
    });
    await acknowledgeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id });
    await startInvestigation({ incidentId: incident.id, actorPlatformAdminId: admin.id });

    const result = await containIncident({
      incidentId: incident.id,
      actorPlatformAdminId: admin.id,
      containmentSummary: 'Authorization: Bearer abcdefgh12345678',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'summary_required');

    const reloaded = await prisma.securityIncident.findUniqueOrThrow({ where: { id: incident.id } });
    assert.equal(reloaded.containmentSummary, null, 'the unsafe raw text must never reach the row');
  });

  await test('48. Raw email/phone values never persist in an incident or activity row after a safe-but-mixed summary', async () => {
    const admin = await createPlatformAdmin('sanitize-e2e-2');
    const { incident } = await upsertIncidentFromSignal({
      sourceRule: 'test.sanitize.v2', sourceType: 'test', category: 'test_category', severity: 'medium',
      organizationId: testOrgId('sanitize2'), affectedResourceType: 'r', affectedResourceId: 'sanitize-2', title: 't', summary: 's',
    });
    await acknowledgeIncident({ incidentId: incident.id, actorPlatformAdminId: admin.id });
    await startInvestigation({ incidentId: incident.id, actorPlatformAdminId: admin.id });

    const result = await containIncident({
      incidentId: incident.id,
      actorPlatformAdminId: admin.id,
      containmentSummary: 'Reached out to patient@example.com at 555-987-6543 and rotated the account; contained the scope.',
    });
    assert.equal(result.ok, true);

    const reloaded = await prisma.securityIncident.findUniqueOrThrow({ where: { id: incident.id } });
    assert.ok(reloaded.containmentSummary);
    assert.ok(!reloaded.containmentSummary!.includes('patient@example.com'));
    assert.ok(!reloaded.containmentSummary!.includes('555-987-6543'));

    const activity = await prisma.securityIncidentActivity.findFirst({ where: { incidentId: incident.id, action: 'contained' } });
    assert.ok(activity?.note);
    assert.ok(!activity!.note!.includes('patient@example.com'));
    assert.ok(!activity!.note!.includes('555-987-6543'));
  });
}

// ── K. Explicit per-rule metadata allowlists ──────────────────────────────

async function runMetadataAllowlistTests() {
  section('K. Explicit per-rule metadata allowlists');

  await test('49. An unknown innocent-looking key is not stored (auth schema)', () => {
    const out = sanitizeRuleMetadata(AUTH_SIGNAL_METADATA_SCHEMA, {
      context: 'clinic',
      debugContext: 'this should never survive',
    });
    assert.ok(out);
    assert.ok(!('debugContext' in out!));
    assert.equal(out!.context, 'clinic');
  });

  await test('50. A nested arbitrary object is not stored', () => {
    const out = sanitizeRuleMetadata(CROSS_TENANT_SIGNAL_METADATA_SCHEMA, {
      method: 'GET',
      routeTemplate: { nested: { arbitrary: 'object' } } as unknown as string,
    });
    assert.equal(out, null, 'a defined field with the wrong (object) type must drop the whole object');
  });

  await test('51. A supported rule retains only its documented keys', () => {
    const out = sanitizeRuleMetadata(EXPORT_SIGNAL_METADATA_SCHEMA, {
      reason: 'expired',
      failureCode: 'TEMP_STORAGE_UNSAFE',
      occurrenceCountAtDetection: 3,
      distinctClinicCount: 2,
      windowMinutes: 60,
      unexpectedExtraField: 'should be dropped',
    });
    assert.ok(out);
    assert.deepEqual(
      Object.keys(out!).sort(),
      ['distinctClinicCount', 'failureCode', 'occurrenceCountAtDetection', 'reason', 'windowMinutes'].sort(),
    );
  });

  await test('52. Blocked key names are still removed as defense-in-depth', () => {
    const out = sanitizeSecurityMetadata({ newSeverity: 'high', token: 'should-be-dropped' });
    assert.ok(out);
    assert.ok(!('token' in out!));
  });

  await test('53. An oversized field value never survives the per-rule allowlist pass', () => {
    const out = sanitizeRuleMetadata(AUTH_SIGNAL_METADATA_SCHEMA, { context: 'x'.repeat(10000) });
    assert.equal(out, null, 'a field exceeding its documented max length is rejected, never silently truncated and stored');
  });

  await test('54. Incident-activity metadata schema accepts only its documented fields', () => {
    const out = sanitizeRuleMetadata(INCIDENT_ACTIVITY_METADATA_SCHEMA, {
      newSeverity: 'critical',
      reopenedFromIncidentId: 'incident-123',
      assignedToPlatformAdminId: null,
      extraneous: 'nope',
    });
    assert.ok(out);
    assert.deepEqual(Object.keys(out!).sort(), ['assignedToPlatformAdminId', 'newSeverity', 'reopenedFromIncidentId'].sort());
    assert.equal(out!.assignedToPlatformAdminId, null);
  });
}

// ── Run ────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await runSanitizationTests();
    await runDedupTests();
    await runLifecycleTests();
    await runDetectionRuleTests();
    await runTenantIsolationTests();
    await runApiSourceTests();
    await runMigrationSanityTests();
    await runLifecycleConcurrencyTests();
    await runCreatedActivityStressTests();
    await runOperatorTextSanitizationTests();
    await runMetadataAllowlistTests();
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
