/**
 * storageDeletionEvidence.test.ts — F4-3 regression suite for the physical
 * storage-deletion safety boundary.
 *
 * Two halves:
 *
 *  1. BEHAVIOURAL — drives services/storageObjectDeletion.ts against real
 *     disposable files under a fixture-only upload prefix (never a real
 *     patient attachment or imaging object), with the Prisma auditLog /
 *     operationalEvent delegates stubbed so evidence can be inspected without
 *     a database. Covers: successful deletion produces evidence, retry is
 *     idempotent, a storage failure retains recoverable evidence, tenant A
 *     cannot delete tenant B's object, an unverifiable key fails closed, and
 *     no sensitive value reaches evidence or the process log.
 *
 *  2. STRUCTURAL — source scans proving the properties a behavioural test
 *     cannot observe: that no retention-driven or review-driven physical
 *     deletion path exists at all (deletion stays blocked while the legal
 *     retention policy is undecided), and that every remaining physical-delete
 *     call site derives object identity from a tenant-scoped persisted record
 *     rather than from the request.
 *
 * Run with: cd server && npx tsx src/tests/storageDeletionEvidence.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import prisma from '../db.js';
import {
  classifyStorageKey,
  deleteStoredObjectWithEvidence,
  isReconciliationSafe,
  isTerminalSuccess,
} from '../services/storageObjectDeletion.js';

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

// ── Disposable fixture storage ─────────────────────────────────────────────
// fileStorage.ts resolves non-absolute keys under `${process.cwd()}/uploads`.
// Every fixture clinic id below carries an unmistakable, unique test prefix so
// nothing here can ever collide with — let alone delete — a real clinic's
// objects. The whole tree is removed in the finally block at the end.
const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const FIXTURE_RUN = `f4-3-fixture-${randomUUID()}`;
const CLINIC_A = `${FIXTURE_RUN}-a`;
const CLINIC_B = `${FIXTURE_RUN}-b`;
const ORG_ID = `${FIXTURE_RUN}-org`;

function writeFixtureObject(clinicId: string, name: string): string {
  const key = `${clinicId}/${name}`;
  const abs = path.join(UPLOAD_ROOT, clinicId, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'fixture-bytes');
  return key;
}

function fixtureExists(key: string): boolean {
  return fs.existsSync(path.join(UPLOAD_ROOT, key));
}

/**
 * A directory sitting at the key's path: a genuine, provider-independent unlink
 * failure whose target is still provably present afterwards — the real
 * "delete threw AND the object still exists" case, not a stubbed one.
 */
function writeUndeletableFixture(clinicId: string): string {
  const key = `${clinicId}/${randomUUID()}-undeletable`;
  fs.mkdirSync(path.join(UPLOAD_ROOT, key), { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_ROOT, key, 'child.bin'), 'x');
  return key;
}

// ── Evidence capture ───────────────────────────────────────────────────────
interface CapturedRow { [k: string]: any }
let audits: CapturedRow[] = [];
let events: CapturedRow[] = [];

/**
 * Injected persistence failure (F4-3-R1).
 *
 * The durability invariant cannot be proved by reading the source — the whole
 * defect it closes was that a write which *looks* durable silently wasn't. So
 * the failure is injected at the Prisma delegate, the same layer a real
 * outage/constraint violation would fail at, and the observable result of the
 * public function is asserted.
 */
const evidenceFailure = { audit: false, event: false };

function installEvidenceCapture() {
  (prisma as any).auditLog = {
    create: async ({ data }: { data: CapturedRow }) => {
      if (evidenceFailure.audit) throw new Error('injected audit persistence failure');
      audits.push(data);
      return data;
    },
  };
  (prisma as any).operationalEvent = {
    create: async ({ data }: { data: CapturedRow }) => {
      if (evidenceFailure.event) throw new Error('injected operational-event persistence failure');
      events.push(data);
      return data;
    },
  };
}

function resetEvidence() {
  audits = [];
  events = [];
  evidenceFailure.audit = false;
  evidenceFailure.event = false;
}

/** Fail BOTH writers — the exact review scenario: nothing durable survives. */
function failAllEvidencePersistence() {
  evidenceFailure.audit = true;
  evidenceFailure.event = true;
}

type ConsoleMethod = 'log' | 'info' | 'error' | 'warn' | 'debug';
const CONSOLE_METHODS: ConsoleMethod[] = ['log', 'info', 'error', 'warn', 'debug'];

function captureConsole() {
  const calls: unknown[][] = [];
  const originals = CONSOLE_METHODS.map(m => [m, console[m]] as const);
  for (const m of CONSOLE_METHODS) {
    console[m] = ((...args: unknown[]) => { calls.push(args); }) as typeof console.log;
  }
  return {
    calls,
    restore: () => { for (const [m, original] of originals) console[m] = original; },
  };
}

function baseRequest(overrides: Record<string, unknown>) {
  return {
    organizationId: ORG_ID,
    clinicId: CLINIC_A,
    entityType: 'patient_attachment',
    entityId: `attachment-${randomUUID()}`,
    source: 'record_delete' as const,
    actorUserId: 'user-fixture',
    actorRole: 'CLINIC_MANAGER',
    ipAddress: '203.0.113.10',
    userAgent: 'fixture-agent',
    ...overrides,
  } as Parameters<typeof deleteStoredObjectWithEvidence>[0];
}

// Built programmatically rather than embedded as literals: a raw control
// character or backslash run inside a source file is invisible in review and
// silently mangled by editors/formatters.
const CONTROL_CHAR = String.fromCharCode(1);
const UNC_PATH = ['', '', 'fileserver', 'share', 'x.bin'].join('\\');
const TRAVERSAL_KEY = '../../etc/passwd';
const DRIVE_RELATIVE_KEY = 'C:relative';

function readSrc(relative: string): string {
  return fs.readFileSync(path.resolve(import.meta.dirname, relative), 'utf8');
}

/**
 * Drops comment lines before a call-site scan. Both files under test *discuss*
 * deleteFile in prose (attachments.ts documents that its DELETE route was once
 * the only deleteFile call site), and a naive substring scan would report those
 * sentences as live call sites — a false positive that would then be "fixed" by
 * deleting accurate documentation. Line-based rather than a block-comment
 * parser, so a block-comment terminator appearing inside a string literal
 * cannot desynchronise it.
 */
function codeLines(src: string): string[] {
  return src.split('\n').filter((line) => {
    const t = line.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  });
}

function callsFunction(src: string, fnName: string): boolean {
  const pattern = new RegExp(`\\b${fnName}\\s*\\(`);
  return codeLines(src).some((line) => pattern.test(line));
}

async function main() {
  installEvidenceCapture();

  // ═══════════════════════════════════════════════════════════════════════
  section('1. Successful deletion of a disposable fixture object produces durable evidence');

  await test('a tenant-scoped fixture object is removed and one success evidence row is written', async () => {
    resetEvidence();
    const key = writeFixtureObject(CLINIC_A, `${randomUUID()}.bin`);
    assert.ok(fixtureExists(key), 'fixture object must exist before the deletion');

    const result = await deleteStoredObjectWithEvidence(baseRequest({ storageKey: key, entityId: 'attachment-success' }));

    assert.equal(result.outcome, 'deleted');
    assert.equal(result.keyForm, 'tenant_scoped');
    assert.equal(fixtureExists(key), false, 'the physical object must actually be gone');
    assert.equal(audits.length, 1, 'exactly one audit evidence row must be written');
    assert.equal(events.length, 0, 'a success must not raise an operational error event');
  });

  await test('the evidence row carries every field the F4-3 contract requires', () => {
    const row = audits[0]!;
    assert.equal(row.action, 'storage_object_deleted', 'stable action code');
    assert.equal(row.organizationId, ORG_ID, 'tenant/organization');
    assert.equal(row.clinicId, CLINIC_A, 'owning clinic');
    assert.equal(row.entityType, 'patient_attachment', 'record type');
    assert.equal(row.entityId, 'attachment-success', 'record identifier');
    assert.equal(row.actorUserId, 'user-fixture', 'actor');
    assert.equal(row.actorRole, 'CLINIC_MANAGER', 'actor role');
    const meta = row.metadata as Record<string, unknown>;
    assert.equal(meta.outcome, 'deleted', 'outcome');
    assert.equal(meta.source, 'record_delete', 'system source of the deletion');
    assert.ok(typeof meta.storageKey === 'string' && meta.storageKey.length > 0, 'object identifier');
    assert.ok(typeof meta.requestedAt === 'string', 'requestedAt');
    assert.ok(typeof meta.executedAt === 'string', 'executedAt');
    assert.ok(!('failureCode' in meta), 'no failure reason on a success');
    assert.ok(
      Date.parse(meta.executedAt as string) >= Date.parse(meta.requestedAt as string),
      'executedAt must not precede requestedAt',
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  section('2. Retry is idempotent — already deleted is a terminal success, never a failure loop');

  await test('deleting an already-absent object returns a terminal success and raises no error event', async () => {
    resetEvidence();
    const key = writeFixtureObject(CLINIC_A, `${randomUUID()}.bin`);

    const first = await deleteStoredObjectWithEvidence(baseRequest({ storageKey: key, entityId: 'attachment-retry' }));
    const second = await deleteStoredObjectWithEvidence(baseRequest({ storageKey: key, entityId: 'attachment-retry' }));
    const third = await deleteStoredObjectWithEvidence(baseRequest({ storageKey: key, entityId: 'attachment-retry' }));

    for (const [label, r] of [['first', first], ['second', second], ['third', third]] as const) {
      assert.ok(isTerminalSuccess(r.outcome), `${label} attempt must be a terminal success, got ${r.outcome}`);
    }
    assert.equal(events.length, 0, 'a repeated delete of a gone object must never escalate as an error');
    assert.equal(audits.length, 3, 'every attempt is still evidenced — idempotent does not mean silent');
    for (const row of audits) {
      assert.equal(row.action, 'storage_object_deleted', 'every retry must record a success action');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  section('3. A storage failure retains recoverable state and escalates — it is never swallowed');

  await test('an undeletable object yields outcome=failed with a stable failure code', async () => {
    resetEvidence();
    // A directory at the key's path is a genuine, provider-independent
    // unlink failure whose target is still provably present afterwards —
    // exactly the "delete threw AND the object still exists" case.
    const key = `${CLINIC_A}/${randomUUID()}-undeletable`;
    fs.mkdirSync(path.join(UPLOAD_ROOT, key), { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_ROOT, key, 'child.bin'), 'x');

    const { restore } = captureConsole();
    let result;
    try {
      result = await deleteStoredObjectWithEvidence(baseRequest({ storageKey: key, entityId: 'attachment-failed' }));
    } finally {
      restore();
    }

    assert.equal(result.outcome, 'failed');
    assert.equal(result.failureCode, 'STORAGE_DELETE_FAILED');
    assert.ok(fixtureExists(key), 'the object must still be present — that is the point of reporting failure');
  });

  await test('the failure evidence still names the object, so the leak stays reconcilable after the DB row is gone', () => {
    assert.equal(audits.length, 1, 'the failed attempt must be evidenced');
    const row = audits[0]!;
    assert.equal(row.action, 'storage_object_delete_failed', 'failures get their own stable action code');
    const meta = row.metadata as Record<string, unknown>;
    assert.equal(meta.outcome, 'failed');
    assert.equal(meta.failureCode, 'STORAGE_DELETE_FAILED', 'failure reason is recorded');
    assert.ok(
      typeof meta.storageKey === 'string' && meta.storageKey.includes(CLINIC_A),
      'the storage key must survive in evidence — the deleted DB row was its only other home',
    );
  });

  await test('a failed physical deletion is escalated as an operator-visible error event', () => {
    assert.equal(events.length, 1, 'exactly one operational event for the failed deletion');
    const ev = events[0]!;
    assert.equal(ev.severity, 'error', 'a possibly-undeleted health-data object is not an info-level condition');
    assert.equal(ev.source, 'system');
    assert.equal(ev.organizationId, ORG_ID);
    assert.equal(ev.clinicId, CLINIC_A);
    const meta = ev.metadata as Record<string, unknown>;
    assert.equal(meta.entityType, 'patient_attachment');
    assert.equal(meta.entityId, 'attachment-failed');
    assert.equal(meta.failureCode, 'STORAGE_DELETE_FAILED');
  });

  // ═══════════════════════════════════════════════════════════════════════
  section('4. Tenant isolation — clinic A can never delete clinic B\'s object');

  await test('a key belonging to another clinic is refused and clinic B\'s object survives untouched', async () => {
    resetEvidence();
    const victimKey = writeFixtureObject(CLINIC_B, `${randomUUID()}.bin`);
    assert.ok(fixtureExists(victimKey));

    const result = await deleteStoredObjectWithEvidence(
      baseRequest({ clinicId: CLINIC_A, storageKey: victimKey, entityId: 'attachment-cross-tenant' }),
    );

    assert.equal(result.outcome, 'rejected_tenant_mismatch');
    assert.equal(result.failureCode, 'STORAGE_KEY_TENANT_MISMATCH');
    assert.ok(fixtureExists(victimKey), 'the other clinic\'s object must NOT have been deleted');
    assert.equal(isTerminalSuccess(result.outcome), false, 'a refusal must never read as a completed deletion');
  });

  await test('the cross-tenant refusal is evidenced and escalated, not silently ignored', () => {
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.action, 'storage_object_delete_failed');
    assert.equal((audits[0]!.metadata as Record<string, unknown>).outcome, 'rejected_tenant_mismatch');
    assert.equal(events.length, 1);
    assert.equal(events[0]!.severity, 'error');
  });

  await test('classifyStorageKey only accepts a key prefixed by the owning clinic', () => {
    assert.equal(classifyStorageKey(`${CLINIC_A}/x.bin`, CLINIC_A), 'tenant_scoped');
    assert.equal(classifyStorageKey(`${CLINIC_B}/x.bin`, CLINIC_A), 'unrecognized');
    // A prefix that merely starts with the clinic id must not pass — the
    // separator is part of the check, so `clinic-1-evil/` cannot borrow
    // `clinic-1`'s authority.
    assert.equal(classifyStorageKey('clinic-1-evil/x.bin', 'clinic-1'), 'unrecognized');
    assert.equal(classifyStorageKey('exports/clinic-1/x.zip', 'clinic-1'), 'unrecognized');
  });

  // ═══════════════════════════════════════════════════════════════════════
  section('5. Unverifiable object identity fails closed — unknown is never treated as deletable');

  await test('empty, traversal and UNC keys are all refused without deleting anything', async () => {
    for (const badKey of ['', TRAVERSAL_KEY, `${CLINIC_A}/../${CLINIC_B}/x.bin`, UNC_PATH, DRIVE_RELATIVE_KEY]) {
      resetEvidence();
      const result = await deleteStoredObjectWithEvidence(
        baseRequest({ storageKey: badKey, entityId: 'attachment-unsafe' }),
      );
      assert.ok(
        result.outcome === 'rejected_unsafe_key' || result.outcome === 'rejected_tenant_mismatch',
        `key ${JSON.stringify(badKey)} must be refused, got ${result.outcome}`,
      );
      assert.equal(isTerminalSuccess(result.outcome), false);
      assert.equal(audits.length, 1, 'even a refusal is evidenced');
    }
  });

  await test('a control character in the key is refused rather than passed to the storage layer', async () => {
    resetEvidence();
    const result = await deleteStoredObjectWithEvidence(
      baseRequest({ storageKey: `${CLINIC_A}/na${CONTROL_CHAR}me.bin`, entityId: 'attachment-ctrl' }),
    );
    assert.equal(result.outcome, 'rejected_unsafe_key');
    assert.equal(result.failureCode, 'STORAGE_KEY_UNSAFE');
  });

  await test('a UNC path naming another host is refused, never acted on', async () => {
    resetEvidence();
    const result = await deleteStoredObjectWithEvidence(
      baseRequest({ storageKey: UNC_PATH, entityId: 'attachment-unc' }),
    );
    assert.equal(result.outcome, 'rejected_unsafe_key');
    assert.equal(result.failureCode, 'STORAGE_KEY_UNSAFE');
  });

  // ═══════════════════════════════════════════════════════════════════════
  section('6. Sensitive values never reach evidence or the process log');

  await test('a legacy absolute path that embeds a patient name is recorded as a digest, never verbatim', async () => {
    resetEvidence();
    const SENSITIVE = '/var/lib/noramedi/uploads/Ayse_Yilmaz_12345678901_panoramik.pdf';
    const { calls, restore } = captureConsole();
    let result;
    try {
      result = await deleteStoredObjectWithEvidence(
        baseRequest({ storageKey: SENSITIVE, entityId: 'attachment-legacy' }),
      );
    } finally {
      restore();
    }

    assert.equal(result.keyForm, 'legacy_absolute', 'a legacy absolute path is still actionable, but labelled');
    const serializedEvidence = JSON.stringify({ audits, events });
    assert.ok(!serializedEvidence.includes('Ayse_Yilmaz'), 'a patient name must never be persisted to prove a deletion');
    assert.ok(!serializedEvidence.includes('12345678901'), 'a TCKN-shaped value must never be persisted');
    assert.ok(!serializedEvidence.includes(SENSITIVE), 'the raw legacy path must never be persisted');
    const digest = createHash('sha256').update(SENSITIVE).digest('hex');
    assert.ok(serializedEvidence.includes(digest), 'a digest must be recorded so the object stays correlatable');

    const serializedLogs = JSON.stringify(calls);
    assert.ok(!serializedLogs.includes('Ayse_Yilmaz'), 'a patient name must never reach the process log either');
    assert.ok(!serializedLogs.includes('12345678901'), 'a TCKN-shaped value must never reach the process log');
  });

  await test('a legacy absolute path is never upgraded to "already absent" — absence there is unverifiable', async () => {
    resetEvidence();
    const missingLegacy = path.join(UPLOAD_ROOT, FIXTURE_RUN, 'definitely-not-here.bin');
    const { restore } = captureConsole();
    let result;
    try {
      result = await deleteStoredObjectWithEvidence(
        baseRequest({ storageKey: missingLegacy, entityId: 'attachment-legacy-missing' }),
      );
    } finally {
      restore();
    }
    // Local unlink swallows ENOENT, so this particular call succeeds; the
    // contract being pinned is that the legacy branch never *fabricates*
    // already_absent out of a raised error.
    assert.ok(
      result.outcome === 'deleted' || result.outcome === 'failed',
      `legacy path outcome must be deleted or failed, never already_absent — got ${result.outcome}`,
    );
    assert.equal(result.keyForm, 'legacy_absolute');
  });

  await test('the evidence description is fixed text and never interpolates row content', () => {
    const src = readSrc('../services/storageObjectDeletion.ts');
    const descriptions = [...src.matchAll(/description:\s*(.+)/g)].map(m => m[1]!);
    assert.ok(descriptions.length > 0, 'the module must write a description');
    for (const d of descriptions) {
      assert.ok(!/originalName|fileName|firstName|lastName|patientName/.test(d), `description must not carry row content: ${d}`);
    }
    assert.ok(!/originalName|fileName\b/.test(src), 'the module must never read a file name at all');
  });

  // ═══════════════════════════════════════════════════════════════════════
  section('7. Durability invariant (F4-3-R1) — an unevidenced orphan is never reported as tracked');

  await test('7.1 storage delete succeeds + evidence writer succeeds -> deleted, evidence persisted', async () => {
    resetEvidence();
    const key = writeFixtureObject(CLINIC_A, `${randomUUID()}.bin`);

    const result = await deleteStoredObjectWithEvidence(
      baseRequest({ storageKey: key, entityId: 'attachment-inv-ok' }),
    );

    assert.equal(result.outcome, 'deleted');
    assert.equal(result.storageOutcome, 'deleted');
    assert.equal(result.evidence, 'persisted');
    assert.equal(isReconciliationSafe(result), true, 'invariant A holds — the bytes are provably gone');
    assert.equal(fixtureExists(key), false);
    assert.equal(audits.length, 1, 'the success is durably evidenced');
  });

  await test('7.2 storage delete fails + durable evidence succeeds -> a reconcilable, tracked failure', async () => {
    resetEvidence();
    const key = writeUndeletableFixture(CLINIC_A);

    const { restore } = captureConsole();
    let result;
    try {
      result = await deleteStoredObjectWithEvidence(
        baseRequest({ storageKey: key, entityId: 'attachment-inv-tracked' }),
      );
    } finally {
      restore();
    }

    assert.equal(result.outcome, 'failed', 'the tracked-failure value is still reported when evidence committed');
    assert.equal(result.storageOutcome, 'failed');
    assert.equal(result.evidence, 'persisted');
    assert.equal(isReconciliationSafe(result), true, 'invariant B holds — a durable record names the object');
    assert.ok(fixtureExists(key), 'the object is still there — that is what makes evidence necessary');
    assert.equal(audits.length, 1, 'exactly one durable evidence row');
    const meta = audits[0]!.metadata as Record<string, unknown>;
    assert.equal(
      meta.storageKey, key,
      'the committed record must carry the object reference — it is the only remaining copy',
    );
  });

  await test('7.3 storage delete fails + evidence persistence fails -> NOT reported as a tracked failure', async () => {
    resetEvidence();
    const key = writeUndeletableFixture(CLINIC_A);
    failAllEvidencePersistence();

    const { calls, restore } = captureConsole();
    let result;
    try {
      result = await deleteStoredObjectWithEvidence(
        baseRequest({ storageKey: key, entityId: 'attachment-inv-unevidenced' }),
      );
    } finally {
      restore();
    }

    // The exact defect the architecture review found: this used to return
    // `failed`, which reads as "leak tracked" when nothing was tracked at all.
    assert.notEqual(result.outcome, 'failed', 'an unevidenced orphan must not masquerade as a tracked failure');
    assert.equal(result.outcome, 'evidence_persistence_failed');
    assert.equal(result.storageOutcome, 'failed', 'the storage-side truth stays visible');
    assert.equal(result.evidence, 'persistence_failed');
    assert.equal(isReconciliationSafe(result), false, 'neither invariant A nor B holds');
    assert.equal(isTerminalSuccess(result.outcome), false, 'and it is certainly not a success');
    assert.ok(fixtureExists(key), 'the object still exists');
    assert.equal(audits.length, 0, 'nothing was persisted — that is the premise of this test');
    assert.equal(events.length, 0, 'the secondary writer failed too, as in the reviewed scenario');

    // Loud escalation is the last line of defence when both DB writers are down.
    const logged = JSON.stringify(calls);
    assert.ok(logged.includes('UNEVIDENCED ORPHAN RISK'), 'the condition must be escalated, not returned quietly');
    assert.ok(logged.includes(key), 'the escalation must still name the object so it can be reconciled by hand');
  });

  await test('7.4 an evidence-write failure on a SUCCESSFUL deletion is not an orphan (invariant A alone suffices)', async () => {
    resetEvidence();
    const key = writeFixtureObject(CLINIC_A, `${randomUUID()}.bin`);
    failAllEvidencePersistence();

    const { calls, restore } = captureConsole();
    let result;
    try {
      result = await deleteStoredObjectWithEvidence(
        baseRequest({ storageKey: key, entityId: 'attachment-inv-success-noevidence' }),
      );
    } finally {
      restore();
    }

    assert.equal(result.outcome, 'deleted', 'the bytes are gone; there is nothing left to reconcile');
    assert.equal(result.evidence, 'persistence_failed', 'the evidence gap is still reported honestly');
    assert.equal(isReconciliationSafe(result), true);
    assert.equal(fixtureExists(key), false);
    assert.ok(
      !JSON.stringify(calls).includes('UNEVIDENCED ORPHAN RISK'),
      'no false orphan alarm when nothing leaked — a noisy invariant gets ignored',
    );
  });

  await test('7.5 tenant-mismatch refusal + evidence persistence failure -> still refused, and surfaced', async () => {
    resetEvidence();
    const victim = writeFixtureObject(CLINIC_B, `${randomUUID()}.bin`);
    failAllEvidencePersistence();

    const { calls, restore } = captureConsole();
    let result;
    try {
      result = await deleteStoredObjectWithEvidence(
        baseRequest({ storageKey: victim, entityId: 'attachment-inv-crosstenant' }),
      );
    } finally {
      restore();
    }

    assert.ok(fixtureExists(victim), 'clinic B\'s object must survive — a broken audit log never widens a deletion');
    assert.equal(result.storageOutcome, 'rejected_tenant_mismatch', 'the refusal itself is unchanged');
    assert.equal(result.failureCode, 'STORAGE_KEY_TENANT_MISMATCH');
    assert.equal(result.outcome, 'evidence_persistence_failed', 'but an unrecorded refusal is not a quiet one');
    assert.equal(isReconciliationSafe(result), false);
    assert.ok(JSON.stringify(calls).includes('UNEVIDENCED ORPHAN RISK'), 'the unrecorded refusal is escalated');
  });

  await test('7.6 upload-rollback failure + evidence persistence failure cannot disappear silently', async () => {
    resetEvidence();
    const key = writeUndeletableFixture(CLINIC_A);
    failAllEvidencePersistence();

    const { calls, restore } = captureConsole();
    let result;
    try {
      result = await deleteStoredObjectWithEvidence(
        baseRequest({ storageKey: key, entityId: 'attachment-inv-rollback', source: 'upload_rollback' }),
      );
    } finally {
      restore();
    }

    // This is the worst case in the codebase: a rollback orphan has no DB row
    // at all, so if the evidence write is also lost nothing anywhere refers to
    // the object.
    assert.equal(result.outcome, 'evidence_persistence_failed');
    assert.equal(isReconciliationSafe(result), false);
    const logged = JSON.stringify(calls);
    assert.ok(logged.includes('UNEVIDENCED ORPHAN RISK'));
    assert.ok(logged.includes('upload_rollback'), 'the escalation records which path created the orphan');
    assert.ok(logged.includes(key), 'and names the object');
  });

  await test('7.7 no PHI or raw legacy path leaks through the new escalation path', async () => {
    resetEvidence();
    const SENSITIVE_LEGACY = '/var/lib/noramedi/uploads/Ayse_Yilmaz_12345678901_panoramik.pdf';
    failAllEvidencePersistence();

    const { calls, restore } = captureConsole();
    let result;
    try {
      result = await deleteStoredObjectWithEvidence(
        baseRequest({ storageKey: SENSITIVE_LEGACY, entityId: 'attachment-inv-legacy-phi' }),
      );
    } finally {
      restore();
    }

    assert.equal(result.keyForm, 'legacy_absolute');
    const logged = JSON.stringify(calls);
    assert.ok(!logged.includes('Ayse_Yilmaz'), 'a patient name must never reach the log, escalation included');
    assert.ok(!logged.includes('12345678901'), 'a TCKN-shaped value must never reach the log');
    assert.ok(!logged.includes(SENSITIVE_LEGACY), 'the raw legacy path must never reach the log');
    assert.ok(!logged.includes('panoramik.pdf'), 'nor the file name alone');
    if (!isReconciliationSafe(result)) {
      const digest = createHash('sha256').update(SENSITIVE_LEGACY).digest('hex');
      assert.ok(logged.includes(digest), 'the escalation still carries a correlatable digest instead');
    }
  });

  await test('7.8 evidence persistence failure never throws into the caller flow', async () => {
    resetEvidence();
    const key = writeUndeletableFixture(CLINIC_A);
    failAllEvidencePersistence();

    const { restore } = captureConsole();
    try {
      // A throw here would abort the route AFTER the DB row was already
      // deleted, converting a reportable partial state into a 500 with no
      // response contract at all.
      await assert.doesNotReject(() =>
        deleteStoredObjectWithEvidence(
          baseRequest({ storageKey: key, entityId: 'attachment-inv-nothrow' }),
        ),
      );
    } finally {
      restore();
    }
  });

  await test('7.9 the authoritative evidence write uses the non-swallowing audit writer', () => {
    const src = readSrc('../services/storageObjectDeletion.ts');
    assert.ok(
      callsFunction(src, 'writeAuditLogInTx'),
      'evidence must go through writeAuditLogInTx — the repository\'s non-swallowing audit writer',
    );
    assert.ok(
      !callsFunction(src, 'writeAuditLog'),
      'writeAuditLog swallows its own persistence errors and cannot back a durability claim',
    );
    // recordOperationalEvent stays, but only as secondary alerting.
    assert.ok(
      callsFunction(src, 'recordOperationalEvent'),
      'operational alerting is retained alongside the authoritative write',
    );
    const auditIdx = src.indexOf('persistDeletionEvidence({');
    const eventIdx = src.indexOf('recordOperationalEvent({');
    assert.ok(auditIdx > 0 && eventIdx > auditIdx,
      'the authoritative write must be attempted before the best-effort one, never derived from it');
  });

  await test('7.10 both delete routes refuse to report success when the invariant is violated', () => {
    for (const file of ['../routes/attachments.ts', '../routes/labOrders.ts']) {
      const src = readSrc(file);
      assert.ok(callsFunction(src, 'isReconciliationSafe'), `${file} must branch on the durability invariant`);
      const guardIdx = src.indexOf('if (!isReconciliationSafe(storageDeletion))');
      assert.ok(guardIdx > 0, `${file} must guard its success response on the deletion result`);
      const successIdx = src.indexOf('res.json({ success: true, storageDeletion:');
      assert.ok(successIdx > guardIdx, `${file} must evaluate the guard BEFORE returning success`);
      const guardBlock = src.slice(guardIdx, successIdx);
      assert.ok(guardBlock.includes('status(500)'), `${file} must not answer 200 for an unevidenced orphan`);
      assert.ok(guardBlock.includes('recordDeleted: true'), `${file} must state the partial state truthfully`);
      assert.ok(
        !/storageKey|filePath|originalName/.test(guardBlock),
        `${file} must not expose storage internals or file names in the error body`,
      );
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  section('8. No retention-driven or review-driven physical deletion path exists (deletion stays blocked)');

  await test('the deletion-review path is dry-run only — no live execute endpoint exists', () => {
    const src = readSrc('../routes/patientPrivacy.ts');
    assert.ok(
      !src.includes("'/patients/:id/privacy/deletion-review/execute'"),
      'a live deletion-review execute endpoint must not exist without an approved legal/KVKK retention policy',
    );
    assert.ok(
      src.includes("'/patients/:id/privacy/deletion-review'"),
      'the dry-run deletion-review inventory must still be served',
    );
  });

  await test('the deletion-review inventory and orphan inspection never delete anything', () => {
    for (const rel of ['../services/privacy/deletionReviewInventory.ts', '../services/privacy/orphanFileInspection.ts']) {
      const src = readSrc(rel);
      assert.ok(!callsFunction(src, 'deleteFile'), `${rel} must never call deleteFile`);
      assert.ok(!callsFunction(src, 'deleteStoredObjectWithEvidence'), `${rel} must never physically delete`);
      assert.ok(!codeLines(src).some((l) => /patientAttachment\.delete(Many)?\s*\(/.test(l)), `${rel} must never delete DB rows`);
    }
  });

  await test('the data-retention policy and its cleanup job perform no physical file deletion', () => {
    for (const rel of ['../services/privacy/dataRetentionPolicy.ts', '../jobs/dataRetentionCleanupJob.ts']) {
      const src = readSrc(rel);
      assert.ok(!callsFunction(src, 'deleteFile'), `${rel} must never call deleteFile — retention periods are undecided`);
      assert.ok(!callsFunction(src, 'deleteStoredObjectWithEvidence'), `${rel} must never physically delete an object`);
    }
  });

  await test('no background job physically deletes a patient attachment or imaging object', () => {
    const jobsDir = path.resolve(import.meta.dirname, '../jobs');
    const offenders: string[] = [];
    for (const file of fs.readdirSync(jobsDir).filter(f => f.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(jobsDir, file), 'utf8');
      if (/patientAttachment|imagingImage|labOrderAttachment/.test(src) && callsFunction(src, 'deleteFile')) {
        offenders.push(file);
      }
    }
    assert.deepEqual(offenders, [], 'no scheduled job may physically delete clinical objects on a timer');
  });

  // ═══════════════════════════════════════════════════════════════════════
  section('9. Every physical-delete call site derives object identity from a tenant-scoped record');

  await test('attachments.ts and labOrders.ts no longer call deleteFile directly', () => {
    for (const rel of ['../routes/attachments.ts', '../routes/labOrders.ts']) {
      const src = readSrc(rel);
      assert.ok(!callsFunction(src, 'deleteFile'), `${rel} must route physical deletion through the evidence contract`);
      assert.ok(
        src.includes("from '../services/storageObjectDeletion.js'"),
        `${rel} must import the shared storage-deletion contract`,
      );
    }
  });

  await test('the storage key always comes from the persisted row, never from the request', () => {
    for (const rel of ['../routes/attachments.ts', '../routes/labOrders.ts']) {
      const src = readSrc(rel);
      for (const call of [...src.matchAll(/deleteStoredObjectWithEvidence\(\{([\s\S]*?)\n\s*\}\)/g)]) {
        const body = call[1]!;
        const keyLine = body.split('\n').find(l => l.trim().startsWith('storageKey'));
        assert.ok(keyLine, `${rel}: every deletion call must pass a storageKey`);
        assert.ok(
          /attachment\.filePath|storageKey,$/.test(keyLine!.trim()),
          `${rel}: storageKey must be the persisted row value or the server-built upload key, got: ${keyLine!.trim()}`,
        );
        assert.ok(
          !/req\.(body|query|params)/.test(keyLine!),
          `${rel}: a request-supplied object key must never be deleted`,
        );
        const clinicLine = body.split('\n').find(l => l.trim().startsWith('clinicId'));
        assert.ok(clinicLine, `${rel}: every deletion call must pass an owning clinicId`);
        assert.ok(
          !/req\.user!?\.clinicId/.test(clinicLine!),
          `${rel}: ownership must come from the resolved record, not the acting user's default clinic`,
        );
      }
    }
  });

  await test('the lab-order attachment DB delete is scoped by its owner, not by bare id', () => {
    const src = readSrc('../routes/labOrders.ts');
    const idx = src.indexOf('labOrderAttachment.deleteMany(');
    assert.ok(idx > -1, 'the lab-order attachment delete must use a conditional deleteMany');
    const call = src.slice(idx, src.indexOf('});', idx));
    assert.ok(call.includes('labWorkOrderId: id'), 'the delete must stay bound to its work order');
    assert.ok(call.includes('clinicId: order.clinicId'), 'the delete must stay bound to the order\'s own clinic');
    assert.ok(
      !src.includes('labOrderAttachment.delete({ where: { id: attId } })'),
      'the unscoped id-only delete must be gone',
    );
    // R-079 (closed): the legal-hold gate is part of the SAME statement, so it
    // cannot be separated from the write and turned back into a read-then-delete.
    assert.ok(
      call.includes('legalHold: false'),
      'the lab-order attachment delete must carry the atomic legal-hold gate (R-079)',
    );
  });

  await test('the lab-order attachment legal-hold gate precedes any physical storage deletion', () => {
    const src = readSrc('../routes/labOrders.ts');
    const deleteManyIdx = src.indexOf('labOrderAttachment.deleteMany(');
    const countCheckIdx = src.indexOf('removed.count === 0', deleteManyIdx);
    const physicalIdx = src.indexOf('deleteStoredObjectWithEvidence({', deleteManyIdx);
    assert.ok(countCheckIdx > -1, 'the route must branch on the deleteMany affected-row count');
    assert.ok(physicalIdx > -1, 'the authorized path must still remove the physical object');
    assert.ok(
      countCheckIdx < physicalIdx,
      'the zero-count (blocked) branch must be resolved before any physical storage deletion',
    );
    const blockedBranch = src.slice(countCheckIdx, physicalIdx);
    assert.ok(
      !blockedBranch.includes('deleteStoredObjectWithEvidence('),
      'the blocked branch must never call the storage-deletion contract — no evidence may claim an attempt that did not happen',
    );
    assert.ok(
      blockedBranch.includes("'lab_order_attachment_delete_blocked_legal_hold'"),
      'the refusal must be audited under a stable, descriptive action code',
    );
  });

  await test('the patient-attachment legal-hold gate is still the atomic authorization decision', () => {
    const src = readSrc('../routes/attachments.ts');
    const idx = src.indexOf('prisma.patientAttachment.deleteMany(');
    assert.ok(idx > -1, 'the atomic gate must still exist');
    const call = src.slice(idx, src.indexOf('});', idx));
    assert.ok(call.includes('legalHold: false'), 'the legal-hold gate must remain part of the delete statement');
    // The physical deletion must come after that gate, never before it.
    assert.ok(
      src.indexOf('deleteStoredObjectWithEvidence({', idx) > idx,
      'physical deletion must follow the legal-hold-gated DB delete',
    );
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Remove every fixture directory this run created. Only ever paths under
    // uploads/ whose name carries this run's unique fixture prefix.
    for (const dir of [CLINIC_A, CLINIC_B, FIXTURE_RUN]) {
      fs.rmSync(path.join(UPLOAD_ROOT, dir), { recursive: true, force: true });
    }
  });
