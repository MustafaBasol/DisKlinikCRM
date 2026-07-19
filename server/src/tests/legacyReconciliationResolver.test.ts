/**
 * legacyReconciliationResolver.test.ts — KVKK-HIGH-007 legacy/central
 * dual-gate reconciliation tests.
 *
 * Covers:
 *   A. Full mode matrix: reconciliationEnabled {off,on} × enforcementMode
 *      {disabled,audit,enforce} — reconciliation OFF is byte-identical to the
 *      pre-existing two-step behavior across every enforcement mode; ON
 *      applies the documented precedence (restrictive signals always act
 *      once reconciliation is on; the one permissive override needs enforce
 *      too).
 *   B. Hard-veto precedence without a conflict.
 *   C. legacy_central_conflict: fails closed, never resolved automatically in
 *      either direction, clears once the central row is explicitly
 *      withdrawn/denied.
 *   D. Conflict bucket: database-backed atomic aggregation, not process-local
 *      — 20 parallel identical detections produce exactly one bucket row with
 *      occurrenceCount===20; different dimensions produce separate buckets;
 *      no patient identifier ever appears on a stored row.
 *   E. Policy-exception branch: always allowed once scope is valid, across
 *      every reconciliation/enforcement combination; scope invalidity still
 *      always blocks; never reachable for marketing/campaign.
 *   F. Deterministic sampling: distributed per evaluation (not all-or-none
 *      per clinic/channel/purpose/hour), stable for the same key+bucket,
 *      fails safe on invalid config, no identifier in the persisted decision.
 *
 * Run with: tsx src/tests/legacyReconciliationResolver.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import {
  resolveCommunicationConsent,
  type LegacyGateSignal,
} from '../services/communicationConsent/legacyReconciliationResolver.js';
import { setCommunicationPreference } from '../services/communicationConsent/communicationConsentAdmin.js';
import { computeDeterministicSamplingDecision } from '../services/communicationConsent/communicationConsentAuditLogging.js';

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

type Fixture = { organizationId: string; clinicId: string; patientId: string };
const createdOrgIds: string[] = [];

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: { name: `Resolver Test Org ${suffix}`, slug: `resolver-${suffix}` },
  });
  const clinic = await prisma.clinic.create({
    data: { name: 'Test Clinic', slug: `resolver-clinic-${suffix}`, organizationId: org.id },
  });
  const patient = await prisma.patient.create({
    data: { firstName: 'Test', lastName: 'Patient', clinicId: clinic.id, organizationId: org.id, phone: '+905551112233' },
  });
  createdOrgIds.push(org.id);
  return { organizationId: org.id, clinicId: clinic.id, patientId: patient.id };
}

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  await prisma.communicationConsentConflictBucket.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientCommunicationConsentEvent.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientCommunicationPreference.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function grant(fx: Fixture, channel: string, purpose: string) {
  await setCommunicationPreference({
    organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
    channel, purpose, action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
    notes: 'Test evidence.',
  });
}
async function deny(fx: Fixture, channel: string, purpose: string) {
  await setCommunicationPreference({
    organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
    channel, purpose, action: 'deny', source: 'staff', evidenceType: 'verbal_staff_record',
  });
}
async function withdraw(fx: Fixture, channel: string, purpose: string) {
  await setCommunicationPreference({
    organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
    channel, purpose, action: 'withdraw', source: 'staff', evidenceType: 'verbal_staff_record',
  });
}

const DISABLED = { COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: undefined, COMMUNICATION_CONSENT_ENFORCEMENT_MODE: undefined };
const AUDIT = { COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'audit' };
const ENFORCE = { COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'enforce' };
const RECON_ON = { COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED: 'true' };
const RECON_OFF = { COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED: undefined };

async function main() {
  section('A. Mode matrix — reconciliation OFF is byte-identical across all enforcement modes');

  await test('OFF+disabled: legacy allows, central granted (irrelevant) → allowed via legacy', async () => {
    const fx = await createFixture();
    await grant(fx, 'sms', 'marketing');
    await withEnv({ ...RECON_OFF, ...DISABLED }, async () => {
      const legacy: LegacyGateSignal = { allowed: true, hardVeto: false, reasonCode: 'legacy_ok' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.equal(r.finalAllowed, true);
      assert.equal(r.reconciliationEnabled, false);
      assert.equal(r.enforcementMode, 'disabled');
      assert.equal(r.centralDecision, null, 'disabled+reconciliation-off never computes central at all');
    });
  });

  await test('OFF+disabled: legacy blocks, central granted (irrelevant) → blocked (current production bug, preserved unchanged)', async () => {
    const fx = await createFixture();
    await grant(fx, 'sms', 'marketing');
    await withEnv({ ...RECON_OFF, ...DISABLED }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: false, reasonCode: 'missing_marketing_consent' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.equal(r.finalAllowed, false);
      assert.equal(r.finalReasonCode, 'missing_marketing_consent');
    });
  });

  await test('OFF+enforce: legacy allows, central denied → blocked (central enforce still applies independently, as today)', async () => {
    const fx = await createFixture();
    await deny(fx, 'sms', 'marketing');
    await withEnv({ ...RECON_OFF, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: true, hardVeto: false, reasonCode: 'legacy_ok' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.equal(r.finalAllowed, false);
      assert.equal(r.finalReasonCode, 'consent_denied');
    });
  });

  await test('OFF+audit: legacy blocks, central granted → still blocked (audit never lets central override legacy off-flag behavior)', async () => {
    const fx = await createFixture();
    await grant(fx, 'sms', 'marketing');
    await withEnv({ ...RECON_OFF, ...AUDIT }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: false, reasonCode: 'missing_marketing_consent' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.equal(r.finalAllowed, false, 'reconciliation off: central grant has zero effect regardless of mode');
    });
  });

  section('A2. Mode matrix — reconciliation ON');

  await test('ON+disabled: central granted overrides legacy false → OBSERVED ONLY, not yet applied (finalAllowed still legacy)', async () => {
    const fx = await createFixture();
    await grant(fx, 'sms', 'marketing');
    await withEnv({ ...RECON_ON, ...DISABLED }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: false, reasonCode: 'missing_marketing_consent' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.equal(r.finalAllowed, false, 'permissive override requires enforce mode too, not just reconciliation');
      assert.equal(r.finalReasonCode, 'missing_marketing_consent');
      assert.equal(r.centralDecision?.effectiveStatus, 'granted', 'central is computed even though enforcement is disabled');
    });
  });

  await test('ON+audit: central granted overrides legacy false → still observed only, real send unaffected', async () => {
    const fx = await createFixture();
    await grant(fx, 'sms', 'marketing');
    await withEnv({ ...RECON_ON, ...AUDIT }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: false, reasonCode: 'missing_marketing_consent' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.equal(r.finalAllowed, false);
    });
  });

  await test('ON+enforce: central granted overrides legacy false → ALLOWED (the one real behavior change, double-gated)', async () => {
    const fx = await createFixture();
    await grant(fx, 'sms', 'marketing');
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: false, reasonCode: 'missing_marketing_consent' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.equal(r.finalAllowed, true);
      assert.equal(r.finalReasonCode, 'consent_granted');
    });
  });

  await test('ON+disabled: central denied overrides legacy true → BLOCKED immediately (restrictive signals act as soon as reconciliation is on)', async () => {
    const fx = await createFixture();
    await deny(fx, 'sms', 'marketing');
    await withEnv({ ...RECON_ON, ...DISABLED }, async () => {
      const legacy: LegacyGateSignal = { allowed: true, hardVeto: false, reasonCode: 'legacy_ok' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.equal(r.finalAllowed, false);
      assert.equal(r.finalReasonCode, 'consent_denied');
    });
  });

  await test('ON+enforce: central unknown + legacy true → falls back to legacy (allowed) even in enforce mode', async () => {
    const fx = await createFixture();
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: true, hardVeto: false, reasonCode: 'legacy_ok' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'operational' });
      assert.equal(r.finalAllowed, true, 'central-unknown fallback to legacy must hold even in enforce, to avoid nuking pre-reconciliation communications');
      assert.equal(r.finalReasonCode, 'legacy_ok');
    });
  });

  await test('ON+enforce: central unknown + legacy false → blocked (unchanged)', async () => {
    const fx = await createFixture();
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: false, reasonCode: 'missing_communication_consent' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'operational' });
      assert.equal(r.finalAllowed, false);
    });
  });

  section('B. Hard-veto precedence (no conflict)');

  await test('ON+enforce: hard veto + central unknown → blocked by veto, not a conflict', async () => {
    const fx = await createFixture();
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: true, reasonCode: 'sms_opt_out' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.equal(r.finalAllowed, false);
      assert.equal(r.finalReasonCode, 'sms_opt_out');
      assert.equal(r.conflict, false);
    });
  });

  await test('ON+enforce: hard veto + central denied → blocked by veto, not a conflict', async () => {
    const fx = await createFixture();
    await deny(fx, 'sms', 'marketing');
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: true, reasonCode: 'sms_opt_out' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.equal(r.finalAllowed, false);
      assert.equal(r.conflict, false);
    });
  });

  section('C. legacy_central_conflict — never silently resolved in either direction');

  await test('ON (any enforcementMode): hard veto + central granted → conflict, fails closed', async () => {
    const fx = await createFixture();
    await grant(fx, 'sms', 'marketing');
    await withEnv({ ...RECON_ON, ...DISABLED }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: true, reasonCode: 'sms_opt_out' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.equal(r.finalAllowed, false, 'conflict always fails closed, even with enforcementMode disabled');
      assert.equal(r.conflict, true);
      assert.equal(r.finalReasonCode, 'legacy_central_conflict');
    });
  });

  await test('conflict is recorded in CommunicationConsentConflictBucket (first detection, no patient identifier)', async () => {
    const fx = await createFixture();
    await grant(fx, 'sms', 'marketing');
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: true, reasonCode: 'sms_opt_out' };
      await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      const buckets = await prisma.communicationConsentConflictBucket.findMany({ where: { organizationId: fx.organizationId } });
      assert.equal(buckets.length, 1);
      assert.equal(buckets[0]!.occurrenceCount, 1);
      assert.equal(buckets[0]!.reasonCode, 'legacy_central_conflict');
      const keys = Object.keys(buckets[0]!);
      assert.ok(!keys.some((k) => k.toLowerCase().includes('patient')), 'no patient identifier field exists on the conflict bucket row');
    });
  });

  await test('repeated conflict detections in the same hour increment occurrenceCount, not a new row', async () => {
    const fx = await createFixture();
    await grant(fx, 'sms', 'campaign');
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: true, reasonCode: 'sms_opt_out' };
      const args = { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'campaign' };
      await resolveCommunicationConsent(legacy, args);
      await resolveCommunicationConsent(legacy, args);
      await resolveCommunicationConsent(legacy, args);
      const buckets = await prisma.communicationConsentConflictBucket.findMany({
        where: { organizationId: fx.organizationId, purpose: 'campaign' },
      });
      assert.equal(buckets.length, 1, 'still exactly one bucket row');
      assert.equal(buckets[0]!.occurrenceCount, 3);
    });
  });

  await test('conflict clears once the central grant is explicitly withdrawn (accepting the restrictive legacy signal)', async () => {
    const fx = await createFixture();
    await grant(fx, 'whatsapp', 'recall');
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: true, reasonCode: 'sms_opt_out' };
      const args = { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'whatsapp', purpose: 'recall' };
      const before = await resolveCommunicationConsent(legacy, args);
      assert.equal(before.conflict, true);

      await withdraw(fx, 'whatsapp', 'recall');

      const after = await resolveCommunicationConsent(legacy, args);
      assert.equal(after.conflict, false, 'no longer a conflict once central is no longer granted');
      assert.equal(after.finalAllowed, false, 'still restrictive — withdrawing accepts the legacy signal, it does not grant');
      assert.equal(after.finalReasonCode, 'sms_opt_out');
    });
  });

  section('D. Conflict bucket concurrency — database-backed, not process-local');

  await test('20 parallel identical conflict detections create exactly one bucket with occurrenceCount===20', async () => {
    const fx = await createFixture();
    await grant(fx, 'sms', 'operational');
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: true, reasonCode: 'sms_opt_out' };
      const args = { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'operational' };
      await Promise.all(Array.from({ length: 20 }, () => resolveCommunicationConsent(legacy, args)));
      const buckets = await prisma.communicationConsentConflictBucket.findMany({
        where: { organizationId: fx.organizationId, purpose: 'operational' },
      });
      assert.equal(buckets.length, 1, 'concurrent detections never create duplicate rows — atomic upsert');
      assert.equal(buckets[0]!.occurrenceCount, 20);
    });
  });

  await test('different channel/purpose combinations create separate buckets', async () => {
    const fx = await createFixture();
    await grant(fx, 'sms', 'marketing');
    await grant(fx, 'sms', 'operational');
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: true, reasonCode: 'sms_opt_out' };
      await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'operational' });
      const buckets = await prisma.communicationConsentConflictBucket.findMany({ where: { organizationId: fx.organizationId } });
      assert.equal(buckets.length, 2);
    });
  });

  section('E. Policy-exception branch — named, not an accidental fallback');

  for (const purpose of ['transactional', 'legal_notice', 'security_notice']) {
    await test(`ON+enforce: ${purpose} always allowed even with a legacy-blocking signal (scope valid)`, async () => {
      const fx = await createFixture();
      await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
        const legacy: LegacyGateSignal = { allowed: false, hardVeto: false, reasonCode: 'missing_communication_consent' };
        const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose });
        assert.equal(r.finalAllowed, true);
        assert.equal(r.conflict, false);
      });
    });
  }

  await test('ON+enforce: policy exception does NOT bypass scope — missing patient still blocks', async () => {
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: true, hardVeto: false, reasonCode: 'legacy_ok' };
      const r = await resolveCommunicationConsent(legacy, {
        organizationId: randomUUID(), clinicId: randomUUID(), patientId: randomUUID(), channel: 'sms', purpose: 'transactional',
      });
      assert.equal(r.finalAllowed, false);
      assert.equal(r.finalReasonCode, 'patient_missing');
    });
  });

  await test('marketing/campaign never reach the not_required exception branch', async () => {
    const fx = await createFixture();
    await withEnv({ ...RECON_ON, ...ENFORCE }, async () => {
      const legacy: LegacyGateSignal = { allowed: false, hardVeto: false, reasonCode: 'missing_marketing_consent' };
      const r = await resolveCommunicationConsent(legacy, { organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId, channel: 'sms', purpose: 'marketing' });
      assert.notEqual(r.centralDecision?.effectiveStatus, 'not_required');
      assert.equal(r.finalAllowed, false, 'marketing with no evidence is denied, never treated as an exception');
    });
  });

  section('F. Deterministic sampling');

  await test('same key + same hour bucket → same decision every time', () => {
    const now = new Date('2026-01-01T10:15:00Z');
    const input = { organizationId: 'org1', clinicId: 'clinic1', channel: 'sms', purpose: 'marketing', stableEventKey: 'patient-abc', now, salt: 'test-salt', sampleRate: 0.5 };
    const first = computeDeterministicSamplingDecision(input);
    const second = computeDeterministicSamplingDecision(input);
    assert.equal(first, second);
  });

  await test('same clinic/channel/purpose/hour but different patients can produce different decisions (distributed, not all-or-none)', () => {
    const now = new Date('2026-01-01T10:15:00Z');
    const base = { organizationId: 'org1', clinicId: 'clinic1', channel: 'sms', purpose: 'marketing', now, salt: 'test-salt', sampleRate: 0.5 };
    const decisions = Array.from({ length: 50 }, (_, i) =>
      computeDeterministicSamplingDecision({ ...base, stableEventKey: `patient-${i}` }));
    const trueCount = decisions.filter(Boolean).length;
    assert.ok(trueCount > 0 && trueCount < 50, `expected a mix of true/false across patients at rate 0.5, got ${trueCount}/50 true — all-or-none would mean the key isn't per-evaluation`);
  });

  await test('rate 0 never samples, rate 1 always samples', () => {
    const now = new Date('2026-01-01T10:15:00Z');
    const base = { organizationId: 'org1', clinicId: 'clinic1', channel: 'sms', purpose: 'marketing', stableEventKey: 'p1', now, salt: 'salt' };
    assert.equal(computeDeterministicSamplingDecision({ ...base, sampleRate: 0 }), false);
    assert.equal(computeDeterministicSamplingDecision({ ...base, sampleRate: 1 }), true);
  });

  await test('different hour bucket can change the decision for the same key', () => {
    const base = { organizationId: 'org1', clinicId: 'clinic1', channel: 'sms', purpose: 'marketing', stableEventKey: 'patient-abc', salt: 'test-salt', sampleRate: 0.5 };
    const decisionsAcrossHours = Array.from({ length: 24 }, (_, h) =>
      computeDeterministicSamplingDecision({ ...base, now: new Date(Date.UTC(2026, 0, 1, h)) }));
    const distinctValues = new Set(decisionsAcrossHours);
    assert.ok(distinctValues.size === 2, 'expected both true and false across 24 distinct hour buckets at rate 0.5');
  });

  section('F2. maybeRecordCommunicationConsentAuditEvent — fail-safe config, no PII');

  await test('audit logging disabled by default → no event even with valid rate/salt', async () => {
    const fx = await createFixture();
    await withEnv({
      COMMUNICATION_CONSENT_AUDIT_LOGGING_ENABLED: undefined,
      COMMUNICATION_CONSENT_AUDIT_LOG_SAMPLE_RATE: '1',
      COMMUNICATION_CONSENT_AUDIT_SAMPLE_SALT: 'salt',
      ...ENFORCE,
    }, async () => {
      const before = await prisma.operationalEvent.count({ where: { organizationId: fx.organizationId, source: 'communication_consent' } });
      const { maybeRecordCommunicationConsentAuditEvent } = await import('../services/communicationConsent/communicationConsentAuditLogging.js');
      await maybeRecordCommunicationConsentAuditEvent({
        organizationId: fx.organizationId, clinicId: fx.clinicId, channel: 'sms', purpose: 'marketing',
        reasonCode: 'consent_granted', enforcementMode: 'enforce', evaluatedAllowed: true, wouldBlock: false,
        stableEventKey: fx.patientId,
      });
      const after = await prisma.operationalEvent.count({ where: { organizationId: fx.organizationId, source: 'communication_consent' } });
      assert.equal(after, before);
    });
  });

  await test('audit logging enabled but sample rate unset → fails safe to no event', async () => {
    const fx = await createFixture();
    await withEnv({
      COMMUNICATION_CONSENT_AUDIT_LOGGING_ENABLED: 'true',
      COMMUNICATION_CONSENT_AUDIT_LOG_SAMPLE_RATE: undefined,
      COMMUNICATION_CONSENT_AUDIT_SAMPLE_SALT: 'salt',
    }, async () => {
      const { maybeRecordCommunicationConsentAuditEvent } = await import('../services/communicationConsent/communicationConsentAuditLogging.js');
      await maybeRecordCommunicationConsentAuditEvent({
        organizationId: fx.organizationId, clinicId: fx.clinicId, channel: 'sms', purpose: 'marketing',
        reasonCode: 'consent_granted', enforcementMode: 'enforce', evaluatedAllowed: true, wouldBlock: false,
        stableEventKey: fx.patientId,
      });
      const count = await prisma.operationalEvent.count({ where: { organizationId: fx.organizationId, source: 'communication_consent' } });
      assert.equal(count, 0);
    });
  });

  await test('audit logging enabled with rate=1 and salt set → logs, metadata has no patientId/PII', async () => {
    const fx = await createFixture();
    await withEnv({
      COMMUNICATION_CONSENT_AUDIT_LOGGING_ENABLED: 'true',
      COMMUNICATION_CONSENT_AUDIT_LOG_SAMPLE_RATE: '1',
      COMMUNICATION_CONSENT_AUDIT_SAMPLE_SALT: 'salt',
    }, async () => {
      const { maybeRecordCommunicationConsentAuditEvent } = await import('../services/communicationConsent/communicationConsentAuditLogging.js');
      await maybeRecordCommunicationConsentAuditEvent({
        organizationId: fx.organizationId, clinicId: fx.clinicId, channel: 'sms', purpose: 'marketing',
        reasonCode: 'consent_granted', enforcementMode: 'enforce', evaluatedAllowed: true, wouldBlock: false,
        stableEventKey: fx.patientId,
      });
      const events = await prisma.operationalEvent.findMany({ where: { organizationId: fx.organizationId, source: 'communication_consent' } });
      assert.equal(events.length, 1);
      const metadata = events[0]!.metadata as Record<string, unknown>;
      assert.ok(!('patientId' in metadata) && !('stableEventKey' in metadata), 'no patient identifier in persisted metadata');
      assert.equal(metadata.sampled, true);
      assert.equal(metadata.samplingRate, 1);
      assert.ok(typeof metadata.samplingVersion === 'number');
    });
  });

  await cleanup();
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
