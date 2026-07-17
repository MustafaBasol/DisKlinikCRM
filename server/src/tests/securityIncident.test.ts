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
  fingerprintUserAgent,
  recordSecuritySignal,
} from '../services/security/securitySignalService.js';
import {
  upsertIncidentFromSignal,
  buildIncidentKey,
  acknowledgeIncident,
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
    await (await import('../services/security/securityIncidentService.js')).startInvestigation({ incidentId: original.id, actorPlatformAdminId: admin.id });
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
