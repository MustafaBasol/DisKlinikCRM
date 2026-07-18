/**
 * communicationConsent.test.ts — KVKK-HIGH-007 communication preference &
 * consent management tests.
 *
 * Covers:
 *   Model/transaction (real disposable Postgres):
 *   1.  exactly one current row per patient/clinic/channel/purpose
 *   2.  immutable history preserved across multiple transitions
 *   3.  simultaneous grant/withdraw race resolves to exactly one row
 *   4.  event count is exact after a race (both attempts recorded)
 *   5.  no duplicate effective rows (DB unique constraint enforced)
 *   6.  a rejected mutation (evidence_required) writes nothing (no partial state)
 *
 *   Decision service:
 *   7.  marketing granted → allowed
 *   8.  marketing unknown (no row) → denied
 *   9.  marketing withdrawn → denied
 *   10. transactional is always allowed (policy exception, no row needed)
 *   11. legal_notice / security_notice are always allowed (policy exceptions)
 *   12. clinic scope mismatch → denied
 *   13. missing patient → denied
 *   14a-d. scope validation runs BEFORE the policy-exception branch: missing
 *       patient / wrong org / wrong clinic + a policy-exception purpose are
 *       still denied; a real PatientClinic link still resolves to allowed
 *   14. unsupported purpose → denied
 *   15. disabled mode: always allowed, never touches the DB
 *   16. audit mode: evaluates the real decision but never blocks
 *   17. enforce mode: blocks a denied decision
 *   18. withdrawing consent after an earlier "granted" evaluation blocks the next evaluation
 *   19. repeated evaluation while denied is idempotent (retry does not bypass block)
 *
 *   SMS send-time integration:
 *   20. enforce mode blocks an SMS send and never calls the provider
 *   21. a blocked send is recorded with status 'blocked_by_consent'
 *   22. disabled mode (default) never blocks sends the legacy gate already allowed
 *
 *   Admin service validation:
 *   23. invalid channel is rejected
 *   24. invalid purpose is rejected
 *   25. policy-exception purposes reject explicit preference writes
 *   26. grant without evidenceType is rejected (evidence_required)
 *   27. cross-clinic patient is rejected (scope_denied)
 *   28. bulk update applies independent items and reports per-item errors
 *
 *   Evidence sanitization:
 *   29. secret-like note content is rejected outright
 *   30. email/phone-like content is redacted, not merely accepted
 *   31. overlong note input is bounded
 *
 *   F. Concurrency / revision-authoritative ordering (Blocker 3, real disposable
 *   Postgres, run twice): 20 concurrent mixed grant/deny/withdraw calls against
 *   an existing key and against a brand-new key — exactly one current row,
 *   contiguous gap-free revisions, event[n].previousStatus === event[n-1].newStatus
 *   ordered by revision (never createdAt), current revision === final event
 *   revision, no unhandled rejection.
 *
 *   G. Timestamp policy (Blocker 4): withdrawn→granted clears withdrawnAt;
 *   granted→denied nulls both grantedAt/withdrawnAt; withdrawn→unknown (reset)
 *   clears both; grant→withdraw→grant preserves the original grantedAt across
 *   the withdrawal and refreshes it on re-grant; history events retain their
 *   evidence even after a later transition clears the current row's timestamps.
 *
 *   H. Notice-version / evidence matrix (Blocker 5): grant from each digital
 *   source requires noticeVersion; staff-sourced grant requires a source
 *   description (notes); deny/withdraw never require either, regardless of
 *   source; raw notice text is never stored, only the noticeVersion reference.
 *
 *   I. WhatsApp send-time integration (Blocker 2, real DB-backed evolution_api
 *   connection + EvolutionWhatsAppProvider.prototype.sendMessage spy, for all 4
 *   public dispatchers): enforce+missing org/patient/purpose → blocked
 *   (COMMUNICATION_CONSENT_CONTEXT_REQUIRED), provider never called; audit/
 *   disabled+missing context → provider called; fully-supplied granted →
 *   provider called; fully-supplied denied+enforce → blocked
 *   (BLOCKED_BY_CONSENT), provider never called.
 *
 * Run with: tsx src/tests/communicationConsent.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres — no external test framework.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import {
  evaluateCommunicationPermission,
  assertCommunicationPermission,
} from '../services/communicationConsent/communicationConsentPolicy.js';
import {
  setCommunicationPreference,
  bulkSetCommunicationPreferences,
  CommunicationConsentAdminError,
} from '../services/communicationConsent/communicationConsentAdmin.js';
import { sanitizeConsentNote } from '../services/communicationConsent/consentEvidenceSanitizer.js';
import { sendClinicSms, type SmsSendDeps } from '../services/sms/smsService.js';
import {
  sendProactiveWhatsAppMessage,
  sendNoShowRecoveryWhatsApp,
  sendAppointmentConfirmationWhatsApp,
  sendPostTreatmentWhatsApp,
  OUTBOUND_ERRORS,
} from '../services/whatsapp/whatsappOutboundMessaging.js';
import { EvolutionWhatsAppProvider } from '../services/whatsapp/EvolutionWhatsAppProvider.js';
import type { SendMessageResult } from '../services/whatsapp/WhatsAppProvider.js';

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

type Fixture = {
  organizationId: string;
  clinicId: string;
  otherClinicId: string;
  patientId: string;
};

const createdOrgIds: string[] = [];

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: { name: `KVKK-HIGH-007 Test Org ${suffix}`, slug: `kvkk007-${suffix}` },
  });
  const clinic = await prisma.clinic.create({
    data: { name: 'Test Clinic', slug: `clinic-${suffix}`, organizationId: org.id },
  });
  const otherClinic = await prisma.clinic.create({
    data: { name: 'Other Clinic', slug: `other-clinic-${suffix}`, organizationId: org.id },
  });
  const patient = await prisma.patient.create({
    data: {
      firstName: 'Test',
      lastName: 'Patient',
      clinicId: clinic.id,
      organizationId: org.id,
      phone: '+905551112233',
    },
  });
  createdOrgIds.push(org.id);
  return { organizationId: org.id, clinicId: clinic.id, otherClinicId: otherClinic.id, patientId: patient.id };
}

/** Fixture + a real, active evolution_api WhatsAppConnection assigned as the clinic's default. */
async function createWhatsAppFixture(): Promise<Fixture> {
  const fx = await createFixture();
  const suffix = randomUUID().slice(0, 8);
  const connection = await prisma.whatsAppConnection.create({
    data: {
      organizationId: fx.organizationId,
      name: `Test WA Connection ${suffix}`,
      provider: 'evolution_api',
      status: 'connected',
      evolutionApiUrl: 'http://evo.invalid',
      evolutionInstanceName: `test-instance-${suffix}`,
      evolutionApiKeyEncrypted: 'raw-key',
      isActive: true,
    },
  });
  await prisma.clinicWhatsAppConnection.create({
    data: {
      organizationId: fx.organizationId,
      clinicId: fx.clinicId,
      whatsappConnectionId: connection.id,
      isDefault: true,
    },
  });
  return fx;
}

/**
 * Patches EvolutionWhatsAppProvider.prototype.sendMessage to a spy for the
 * duration of one test — a class-prototype patch, not an ESM export
 * rebinding, so it works regardless of module export bindings. Always
 * restore via the returned function (in a finally block).
 */
function spyOnEvolutionSendMessage(impl: () => Promise<SendMessageResult>): { calls: () => number; restore: () => void } {
  const original = EvolutionWhatsAppProvider.prototype.sendMessage;
  let callCount = 0;
  EvolutionWhatsAppProvider.prototype.sendMessage = (async () => {
    callCount++;
    return impl();
  }) as typeof EvolutionWhatsAppProvider.prototype.sendMessage;
  return {
    calls: () => callCount,
    restore: () => {
      EvolutionWhatsAppProvider.prototype.sendMessage = original;
    },
  };
}

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  await prisma.patientCommunicationConsentEvent.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientCommunicationPreference.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.smsMessage.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientClinic.deleteMany({ where: { clinic: { organizationId: { in: createdOrgIds } } } });
  await prisma.clinicWhatsAppConnection.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.whatsAppConnection.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
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

// ── A. Model / transaction tests ───────────────────────────────────────────────

async function runModelTests() {
  section('A. Model / transaction tests');

  await test('1. exactly one current row per patient/clinic/channel/purpose', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      notes: 'Patient verbally confirmed marketing SMS opt-in at check-in.',
    });
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing', action: 'withdraw', source: 'staff', evidenceType: 'verbal_staff_record',
    });
    const rows = await prisma.patientCommunicationPreference.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'marketing' },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'withdrawn');
  });

  await test('2. immutable history preserved across multiple transitions', async () => {
    const fx = await createFixture();
    for (const action of ['grant', 'withdraw', 'grant', 'deny'] as const) {
      await setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'whatsapp', purpose: 'recall', action, source: 'staff', evidenceType: 'verbal_staff_record',
        notes: 'Patient verbal statement recorded by front-desk staff.',
      });
    }
    const events = await prisma.patientCommunicationConsentEvent.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'whatsapp', purpose: 'recall' },
      orderBy: { revision: 'asc' },
    });
    assert.equal(events.length, 4);
    assert.deepEqual(events.map((e) => e.newStatus), ['granted', 'withdrawn', 'granted', 'denied']);
    assert.deepEqual(events.map((e) => e.revision), [1, 2, 3, 4]);
    assert.equal(events[1].previousStatus, 'granted');
    assert.equal(events[3].previousStatus, 'granted');
  });

  await test('3. simultaneous grant/withdraw race resolves to exactly one row, revision-consistent', async () => {
    const fx = await createFixture();
    const [a, b] = await Promise.allSettled([
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'email', purpose: 'campaign', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
        notes: 'Patient verbal statement recorded by front-desk staff.',
      }),
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'email', purpose: 'campaign', action: 'withdraw', source: 'staff', evidenceType: 'verbal_staff_record',
      }),
    ]);
    assert.equal(a.status, 'fulfilled');
    assert.equal(b.status, 'fulfilled');

    const rows = await prisma.patientCommunicationPreference.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'email', purpose: 'campaign' },
    });
    assert.equal(rows.length, 1, 'exactly one current row must survive the race');
    assert.ok(['granted', 'withdrawn'].includes(rows[0].status), 'final state must be one of the two attempted transitions');
    assert.equal(rows[0].revision, 2, 'the lock-serialized advisory-lock race must still produce contiguous revisions (1 then 2)');

    const events = await prisma.patientCommunicationConsentEvent.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'email', purpose: 'campaign' },
      orderBy: { revision: 'asc' },
    });
    assert.deepEqual(events.map((e) => e.revision), [1, 2]);
    assert.equal(events[0].previousStatus, null, 'first revision must reflect the real pre-race state (no row existed)');
    assert.equal(events[1].previousStatus, events[0].newStatus, 'event chain must be internally consistent');
    assert.equal(rows[0].revision, events[events.length - 1].revision, 'current preference revision must equal the final event revision');
  });

  await test('4. event count is exact after a race (both attempts recorded), previousStatus chain is authoritative', async () => {
    const fx = await createFixture();
    await Promise.allSettled([
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'sms', purpose: 'survey', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
        notes: 'Patient verbal statement recorded by front-desk staff.',
      }),
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'sms', purpose: 'survey', action: 'deny', source: 'staff', evidenceType: 'verbal_staff_record',
      }),
    ]);
    const events = await prisma.patientCommunicationConsentEvent.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'survey' },
      orderBy: { revision: 'asc' },
    });
    assert.equal(events.length, 2, 'both attempted transitions must be recorded as immutable history');
    assert.deepEqual(events.map((e) => e.revision), [1, 2], 'revisions must be contiguous with no duplicates or gaps');
    assert.equal(events[1].previousStatus, events[0].newStatus, 'event[n].previousStatus must equal event[n-1].newStatus');
  });

  await test('5. no duplicate effective rows (DB unique constraint enforced)', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'whatsapp', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      notes: 'Patient verbal statement recorded by front-desk staff.',
    });
    await assert.rejects(
      prisma.patientCommunicationPreference.create({
        data: {
          organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
          channel: 'whatsapp', purpose: 'marketing', status: 'unknown', source: 'staff',
        },
      }),
      /Unique constraint/,
    );
  });

  await test('6. a rejected mutation (evidence_required) writes nothing', async () => {
    const fx = await createFixture();
    await assert.rejects(
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'sms', purpose: 'recall', action: 'grant', source: 'staff', // no evidenceType
      }),
      (err: unknown) => err instanceof CommunicationConsentAdminError && err.code === 'evidence_required',
    );
    const rows = await prisma.patientCommunicationPreference.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'recall' },
    });
    assert.equal(rows.length, 0, 'a rejected mutation must leave no partial state');
  });
}

// ── B. Decision service tests ──────────────────────────────────────────────────

async function runDecisionServiceTests() {
  section('B. Decision service tests');

  await test('7. marketing granted → allowed', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      notes: 'Patient verbal statement recorded by front-desk staff.',
    });
    const decision = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing',
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reasonCode, 'consent_granted');
  });

  await test('8. marketing unknown (no row) → denied', async () => {
    const fx = await createFixture();
    const decision = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing',
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reasonCode, 'consent_unknown');
  });

  await test('9. marketing withdrawn → denied', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'email', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'portal_click',
      notes: 'Patient verbal statement recorded by front-desk staff.',
    });
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'email', purpose: 'marketing', action: 'withdraw', source: 'email_unsubscribe', evidenceType: 'inbound_reply',
    });
    const decision = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'email', purpose: 'marketing',
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reasonCode, 'consent_withdrawn');
  });

  await test('10. transactional is always allowed (policy exception, no row needed)', async () => {
    const fx = await createFixture();
    const decision = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'transactional',
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reasonCode, 'transactional_exception');
  });

  await test('11. legal_notice / security_notice are always allowed', async () => {
    const fx = await createFixture();
    const legal = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'email', purpose: 'legal_notice',
    });
    const security = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'security_notice',
    });
    assert.equal(legal.reasonCode, 'legal_notice_exception');
    assert.equal(security.reasonCode, 'security_notice_exception');
    assert.equal(legal.allowed, true);
    assert.equal(security.allowed, true);
  });

  await test('12. clinic scope mismatch → denied', async () => {
    const fx = await createFixture();
    const decision = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.otherClinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing',
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reasonCode, 'clinic_scope_mismatch');
  });

  await test('13. missing patient → denied', async () => {
    const fx = await createFixture();
    const decision = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: randomUUID(),
      channel: 'sms', purpose: 'marketing',
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reasonCode, 'patient_missing');
  });

  await test('14a. nonexistent patient + transactional → denied patient_missing (scope before exception)', async () => {
    const fx = await createFixture();
    const decision = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: randomUUID(),
      channel: 'sms', purpose: 'transactional',
    });
    assert.equal(decision.allowed, false, 'a missing patient must never receive an allowed decision, even for a policy-exception purpose');
    assert.equal(decision.reasonCode, 'patient_missing');
  });

  await test('14b. wrong organization + transactional → denied clinic_scope_mismatch (scope before exception)', async () => {
    const fx = await createFixture();
    const decision = await evaluateCommunicationPermission({
      organizationId: randomUUID(), clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'transactional',
    });
    assert.equal(decision.allowed, false, 'a cross-organization identifier must never receive an allowed decision, even for a policy-exception purpose');
    assert.equal(decision.reasonCode, 'clinic_scope_mismatch');
  });

  await test('14c. wrong clinic + legal_notice → denied clinic_scope_mismatch (scope before exception)', async () => {
    const fx = await createFixture();
    const decision = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.otherClinicId, patientId: fx.patientId,
      channel: 'email', purpose: 'legal_notice',
    });
    assert.equal(decision.allowed, false, 'an unlinked cross-clinic identifier must never receive an allowed decision, even for a policy-exception purpose');
    assert.equal(decision.reasonCode, 'clinic_scope_mismatch');
  });

  await test('14d. valid PatientClinic-linked clinic + security_notice → allowed explicit exception', async () => {
    const fx = await createFixture();
    await prisma.patientClinic.create({ data: { patientId: fx.patientId, clinicId: fx.otherClinicId } });
    const decision = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.otherClinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'security_notice',
    });
    assert.equal(decision.allowed, true, 'a real PatientClinic link must still resolve scope before the exception is applied');
    assert.equal(decision.reasonCode, 'security_notice_exception');
  });

  await test('14. unsupported purpose → denied', async () => {
    const fx = await createFixture();
    const decision = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'not_a_real_purpose',
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reasonCode, 'purpose_not_supported');
  });

  await test('15. disabled mode: always allowed, never touches the DB', async () => {
    await withEnv({ COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: undefined }, async () => {
      const result = await assertCommunicationPermission({
        organizationId: randomUUID(), clinicId: randomUUID(), patientId: randomUUID(),
        channel: 'sms', purpose: 'marketing',
      });
      assert.equal(result.allowed, true);
      assert.equal(result.blocked, false);
      assert.equal(result.enforcementMode, 'disabled');
      assert.equal(result.reasonCode, 'consent_enforcement_disabled');
    });
  });

  await test('16. audit mode: evaluates the real decision but never blocks', async () => {
    const fx = await createFixture();
    await withEnv(
      { COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'audit' },
      async () => {
        const result = await assertCommunicationPermission({
          organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
          channel: 'sms', purpose: 'marketing',
        });
        assert.equal(result.allowed, true, 'audit mode never blocks the caller');
        assert.equal(result.blocked, false);
        assert.equal(result.reasonCode, 'consent_unknown', 'the real decision is still surfaced for observability');
        assert.equal(result.enforcementMode, 'audit');
      },
    );
  });

  await test('17. enforce mode: blocks a denied decision', async () => {
    const fx = await createFixture();
    await withEnv(
      { COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'enforce' },
      async () => {
        const result = await assertCommunicationPermission({
          organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
          channel: 'sms', purpose: 'marketing',
        });
        assert.equal(result.allowed, false);
        assert.equal(result.blocked, true);
        assert.equal(result.reasonCode, 'consent_unknown');
      },
    );
  });

  await test('18. withdrawing consent after an earlier grant blocks the next evaluation', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'whatsapp', purpose: 'campaign', action: 'grant', source: 'staff', evidenceType: 'signed_form',
      notes: 'Patient verbal statement recorded by front-desk staff.',
    });
    const before = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'whatsapp', purpose: 'campaign',
    });
    assert.equal(before.allowed, true, 'sanity check: granted before withdrawal');

    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'whatsapp', purpose: 'campaign', action: 'withdraw', source: 'staff', evidenceType: 'verbal_staff_record',
    });
    const after = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'whatsapp', purpose: 'campaign',
    });
    assert.equal(after.allowed, false, 'a withdrawal recorded after an earlier grant must block the next evaluation — no caching of the old decision');
    assert.equal(after.reasonCode, 'consent_withdrawn');
  });

  await test('19. repeated evaluation while denied is idempotent (retry does not bypass block)', async () => {
    const fx = await createFixture();
    const first = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'campaign',
    });
    const second = await evaluateCommunicationPermission({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'campaign',
    });
    assert.equal(first.allowed, false);
    assert.equal(second.allowed, false);
    assert.equal(first.reasonCode, second.reasonCode);
  });
}

// ── C. SMS send-time integration tests ─────────────────────────────────────────

function buildFakeSmsDeps(overrides: Partial<SmsSendDeps> = {}): SmsSendDeps {
  let sendCalls = 0;
  const deps: SmsSendDeps = {
    getEntitlement: async () => ({ enabled: true, monthlyQuota: 1000, effective: { senderName: 'Test' } } as any),
    reserveQuota: async () => true,
    releaseQuota: async () => {},
    getProvider: () => ({
      key: 'mock_turkey',
      sendSms: async () => { sendCalls++; return { success: true, externalMessageId: 'mock-id' }; },
    }),
    getPlatformProvider: async () => null,
    resolveRouting: async () => ({ ok: true, providerKey: 'mock_turkey', config: null, senderName: null } as any),
    ...overrides,
  };
  (deps as any).__getSendCalls = () => sendCalls;
  return deps;
}

async function runSmsIntegrationTests() {
  section('C. SMS send-time integration tests');

  await test('20. enforce mode blocks an SMS send and never calls the provider', async () => {
    const fx = await createFixture();
    // Legacy gate allows (communicationConsent granted) but no central preference row exists → unknown → denied for 'marketing'.
    await prisma.patient.update({ where: { id: fx.patientId }, data: { communicationConsent: true, marketingConsent: true } });

    await withEnv(
      { COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'enforce' },
      async () => {
        let sendCalled = false;
        const deps = buildFakeSmsDeps({
          getProvider: () => ({
            key: 'mock_turkey',
            sendSms: async () => { sendCalled = true; return { success: true, externalMessageId: 'x' }; },
          }),
        });
        const result = await sendClinicSms(
          {
            organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
            purpose: 'marketing', body: 'Kampanya mesajı', phone: '+905551112233',
          },
          deps,
        );
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.code, 'blocked_by_consent');
        assert.equal(sendCalled, false, 'provider must never be called for a blocked send');
      },
    );
  });

  await test('21. a blocked send is recorded with status blocked_by_consent', async () => {
    const fx = await createFixture();
    await prisma.patient.update({ where: { id: fx.patientId }, data: { communicationConsent: true, marketingConsent: true } });

    await withEnv(
      { COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'enforce' },
      async () => {
        const result = await sendClinicSms(
          {
            organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
            purpose: 'marketing', body: 'Kampanya mesajı', phone: '+905551112233',
          },
          buildFakeSmsDeps(),
        );
        assert.equal(result.ok, false);
        if (!result.ok && result.messageId) {
          const row = await prisma.smsMessage.findUnique({ where: { id: result.messageId } });
          assert.equal(row?.status, 'blocked_by_consent');
        } else {
          assert.fail('expected a messageId on the blocked result');
        }
      },
    );
  });

  await test('22. disabled mode (default) never blocks sends the legacy gate already allowed', async () => {
    const fx = await createFixture();
    await prisma.patient.update({ where: { id: fx.patientId }, data: { communicationConsent: true, marketingConsent: true } });

    await withEnv({ COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: undefined }, async () => {
      let sendCalled = false;
      const deps = buildFakeSmsDeps({
        getProvider: () => ({
          key: 'mock_turkey',
          sendSms: async () => { sendCalled = true; return { success: true, externalMessageId: 'x' }; },
        }),
      });
      const result = await sendClinicSms(
        {
          organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
          purpose: 'marketing', body: 'Kampanya mesajı', phone: '+905551112233',
        },
        deps,
      );
      assert.equal(result.ok, true, 'no PatientCommunicationPreference row exists, but enforcement is disabled by default so the legacy gate alone decides');
      assert.equal(sendCalled, true);
    });
  });
}

// ── D. Admin service validation tests ──────────────────────────────────────────

async function runAdminValidationTests() {
  section('D. Admin service validation tests');

  await test('23. invalid channel is rejected', async () => {
    const fx = await createFixture();
    await assert.rejects(
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'carrier_pigeon', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'signed_form',
      }),
      (err: unknown) => err instanceof CommunicationConsentAdminError && err.code === 'invalid_channel',
    );
  });

  await test('24. invalid purpose is rejected', async () => {
    const fx = await createFixture();
    await assert.rejects(
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'sms', purpose: 'telepathy', action: 'grant', source: 'staff', evidenceType: 'signed_form',
      }),
      (err: unknown) => err instanceof CommunicationConsentAdminError && err.code === 'invalid_purpose',
    );
  });

  await test('25. policy-exception purposes reject explicit preference writes', async () => {
    const fx = await createFixture();
    await assert.rejects(
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'sms', purpose: 'transactional', action: 'grant', source: 'staff', evidenceType: 'signed_form',
      }),
      (err: unknown) => err instanceof CommunicationConsentAdminError && err.code === 'invalid_purpose',
    );
  });

  await test('26. grant without evidenceType is rejected (evidence_required)', async () => {
    const fx = await createFixture();
    await assert.rejects(
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'sms', purpose: 'marketing', action: 'grant', source: 'staff',
      }),
      (err: unknown) => err instanceof CommunicationConsentAdminError && err.code === 'evidence_required',
    );
  });

  await test('27. cross-clinic patient is rejected (scope_denied)', async () => {
    const fx = await createFixture();
    await assert.rejects(
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.otherClinicId, patientId: fx.patientId,
        channel: 'sms', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'signed_form',
      }),
      (err: unknown) => err instanceof CommunicationConsentAdminError && err.code === 'scope_denied',
    );
  });

  await test('28. bulk update applies independent items and reports per-item errors', async () => {
    const fx = await createFixture();
    const results = await bulkSetCommunicationPreferences(
      {
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        source: 'staff', evidenceType: 'signed_form',
        notes: 'Patient verbal statement recorded by front-desk staff.',
      },
      [
        { channel: 'sms', purpose: 'marketing', action: 'grant' },
        { channel: 'bogus_channel', purpose: 'marketing', action: 'grant' },
        { channel: 'whatsapp', purpose: 'campaign', action: 'deny' },
      ],
    );
    assert.equal(results.length, 3);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.equal(results[1].errorCode, 'invalid_channel');
    assert.equal(results[2].ok, true, 'a failed item must not roll back independent, valid items');
  });
}

// ── E. Evidence sanitization tests ─────────────────────────────────────────────

async function runSanitizationTests() {
  section('E. Evidence sanitization tests');

  await test('29. secret-like note content is rejected outright', () => {
    const result = sanitizeConsentNote('Patient called, staff used token: Bearer abcdef1234567890 to verify');
    assert.equal(result.ok, false);
  });

  await test('30. email/phone-like content is redacted, not merely accepted', () => {
    const result = sanitizeConsentNote('Reach patient at test@example.com or 0532 123 45 67 for confirmation');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(!result.note?.includes('test@example.com'));
      assert.ok(result.note?.includes('[redacted-email]'));
    }
  });

  await test('31. overlong note input is bounded', () => {
    const result = sanitizeConsentNote('a'.repeat(50000));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok((result.note?.length ?? 0) <= 1000);
    }
  });
}

// ── F. Concurrency / revision-authoritative ordering tests (Blocker 3) ─────────
//
// pg_advisory_xact_lock serializes concurrent setCommunicationPreference()
// calls for one patient+clinic+channel+purpose key; `revision` (not
// createdAt, which is only millisecond-precision and can tie) is the
// authoritative, gap-free, deterministic transition order.

const MIXED_ACTIONS = ['grant', 'deny', 'withdraw'] as const;

async function runConcurrencyMixedMutationsOnExistingKey(runLabel: string) {
  await test(`F. 20 concurrent mixed mutations on an existing key produce a contiguous revision chain (${runLabel})`, async () => {
    const fx = await createFixture();
    const seed = await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'recall', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      notes: 'Initial seed grant recorded by front-desk staff.',
    });
    assert.equal(seed.preference.revision, 1);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        setCommunicationPreference({
          organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
          channel: 'sms', purpose: 'recall',
          action: MIXED_ACTIONS[i % MIXED_ACTIONS.length],
          source: 'staff', evidenceType: 'verbal_staff_record',
          notes: 'Concurrent mutation recorded by front-desk staff.',
        }),
      ),
    );
    assert.equal(results.length, 20, 'no unhandled rejection — every call must resolve');

    const rows = await prisma.patientCommunicationPreference.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'recall' },
    });
    assert.equal(rows.length, 1, 'exactly one current preference row');

    const events = await prisma.patientCommunicationConsentEvent.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'recall' },
      orderBy: { revision: 'asc' },
    });
    assert.equal(events.length, 21, 'exactly 1 seed + 20 concurrent events, no duplicate/missing event');
    assert.deepEqual(
      events.map((e) => e.revision),
      Array.from({ length: 21 }, (_, i) => i + 1),
      'revisions must be contiguous with no duplicates or gaps',
    );
    assert.equal(events[0].previousStatus, null, 'first revision previousStatus matches the real initial state (no row existed)');
    for (let i = 1; i < events.length; i++) {
      assert.equal(
        events[i].previousStatus,
        events[i - 1].newStatus,
        `event[${i}].previousStatus must equal event[${i - 1}].newStatus`,
      );
    }
    assert.equal(rows[0].revision, events[events.length - 1].revision, 'current preference revision must equal the final event revision');
    assert.equal(rows[0].status, events[events.length - 1].newStatus, 'current status must equal the final event newStatus');
  });
}

async function runConcurrencyFirstCreation(runLabel: string) {
  await test(`F. 20 concurrent mixed mutations on a brand-new key produce a contiguous revision chain (${runLabel})`, async () => {
    const fx = await createFixture();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        setCommunicationPreference({
          organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
          channel: 'whatsapp', purpose: 'clinical_followup',
          action: MIXED_ACTIONS[i % MIXED_ACTIONS.length],
          source: 'staff', evidenceType: 'verbal_staff_record',
          notes: 'Concurrent first-creation mutation recorded by front-desk staff.',
        }),
      ),
    );
    assert.equal(results.length, 20, 'no unhandled rejection — every call must resolve');

    const rows = await prisma.patientCommunicationPreference.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'whatsapp', purpose: 'clinical_followup' },
    });
    assert.equal(rows.length, 1, 'exactly one current preference row, even for simultaneous first creation');

    const events = await prisma.patientCommunicationConsentEvent.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'whatsapp', purpose: 'clinical_followup' },
      orderBy: { revision: 'asc' },
    });
    assert.equal(events.length, 20);
    assert.deepEqual(events.map((e) => e.revision), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.equal(events[0].revision, 1);
    assert.equal(events[0].previousStatus, null, 'first-ever revision has no previous state');
    for (let i = 1; i < events.length; i++) {
      assert.equal(events[i].previousStatus, events[i - 1].newStatus);
    }
    assert.equal(rows[0].revision, events[events.length - 1].revision);
  });
}

async function runConcurrencyTests() {
  section('F. Concurrency / revision-authoritative ordering tests');
  // Required to run twice.
  await runConcurrencyMixedMutationsOnExistingKey('run 1');
  await runConcurrencyMixedMutationsOnExistingKey('run 2');
  await runConcurrencyFirstCreation('run 1');
  await runConcurrencyFirstCreation('run 2');
}

// ── G. Timestamp policy tests (Blocker 4) ───────────────────────────────────────

async function runTimestampPolicyTests() {
  section('G. Timestamp policy tests');

  await test('G1. withdrawn → granted clears withdrawnAt', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'recall', action: 'withdraw', source: 'staff', evidenceType: 'verbal_staff_record',
    });
    const afterWithdraw = await prisma.patientCommunicationPreference.findUnique({
      where: { patientId_clinicId_channel_purpose: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'recall' } },
    });
    assert.ok(afterWithdraw?.withdrawnAt, 'sanity check: withdrawnAt set after withdraw');

    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'recall', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      notes: 'Patient verbal statement recorded by front-desk staff.',
    });
    const afterGrant = await prisma.patientCommunicationPreference.findUnique({
      where: { patientId_clinicId_channel_purpose: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'recall' } },
    });
    assert.equal(afterGrant?.withdrawnAt, null, 'granting must clear a stale withdrawnAt');
    assert.ok(afterGrant?.grantedAt, 'granting must set grantedAt');
  });

  await test('G2. granted → denied does not retain misleading active-grant timestamps', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'email', purpose: 'clinical_followup', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      notes: 'Patient verbal statement recorded by front-desk staff.',
    });
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'email', purpose: 'clinical_followup', action: 'deny', source: 'staff', evidenceType: 'verbal_staff_record',
    });
    const row = await prisma.patientCommunicationPreference.findUnique({
      where: { patientId_clinicId_channel_purpose: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'email', purpose: 'clinical_followup' } },
    });
    assert.equal(row?.grantedAt, null, 'a denial must not retain a misleading active grantedAt');
    assert.equal(row?.withdrawnAt, null, 'a denial must not retain a stale withdrawnAt');
  });

  await test('G3. withdrawn → unknown (reset) clears withdrawnAt', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'appointment_followup', action: 'withdraw', source: 'staff', evidenceType: 'verbal_staff_record',
    });
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'appointment_followup', action: 'reset', source: 'staff',
    });
    const row = await prisma.patientCommunicationPreference.findUnique({
      where: { patientId_clinicId_channel_purpose: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'appointment_followup' } },
    });
    assert.equal(row?.status, 'unknown');
    assert.equal(row?.withdrawnAt, null, 'reset must clear a stale withdrawnAt');
    assert.equal(row?.grantedAt, null, 'reset must not leave a misleading active grantedAt');
  });

  await test('G4. grant → withdraw → grant produces coherent timestamps', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'whatsapp', purpose: 'operational', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      notes: 'First grant recorded by front-desk staff.',
    });
    const firstGrant = await prisma.patientCommunicationPreference.findUnique({
      where: { patientId_clinicId_channel_purpose: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'whatsapp', purpose: 'operational' } },
    });
    const firstGrantedAt = firstGrant?.grantedAt?.getTime();
    assert.ok(firstGrantedAt);
    assert.equal(firstGrant?.withdrawnAt, null);

    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'whatsapp', purpose: 'operational', action: 'withdraw', source: 'staff', evidenceType: 'verbal_staff_record',
    });
    const afterWithdraw = await prisma.patientCommunicationPreference.findUnique({
      where: { patientId_clinicId_channel_purpose: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'whatsapp', purpose: 'operational' } },
    });
    assert.ok(afterWithdraw?.withdrawnAt, 'withdrawnAt must be set');
    assert.equal(afterWithdraw?.grantedAt?.getTime(), firstGrantedAt, 'grantedAt is preserved as evidence of the original grant time across a withdrawal');

    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'whatsapp', purpose: 'operational', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      notes: 'Second grant recorded by front-desk staff.',
    });
    const secondGrant = await prisma.patientCommunicationPreference.findUnique({
      where: { patientId_clinicId_channel_purpose: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'whatsapp', purpose: 'operational' } },
    });
    assert.equal(secondGrant?.withdrawnAt, null, 'the re-grant must clear withdrawnAt');
    assert.ok(secondGrant?.grantedAt, 'the re-grant must set a fresh grantedAt');
  });

  await test('G5. history events retain evidence even where current-row timestamps are cleared', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'no_show_recovery', action: 'withdraw', source: 'staff', evidenceType: 'verbal_staff_record',
    });
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'no_show_recovery', action: 'reset', source: 'staff',
    });
    const row = await prisma.patientCommunicationPreference.findUnique({
      where: { patientId_clinicId_channel_purpose: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'no_show_recovery' } },
    });
    assert.equal(row?.withdrawnAt, null, 'sanity check: current-row withdrawnAt was cleared by the subsequent reset');

    const withdrawEvent = await prisma.patientCommunicationConsentEvent.findFirst({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'no_show_recovery', newStatus: 'withdrawn' },
    });
    assert.ok(withdrawEvent, 'the withdraw event itself must still exist');
    assert.equal(withdrawEvent?.newStatus, 'withdrawn', 'the historical event retains its evidence regardless of later current-row clearing');
    assert.ok(withdrawEvent?.createdAt, 'the historical event retains its timestamp');
  });
}

// ── H. Notice-version / evidence matrix tests (Blocker 5) ───────────────────────

async function runNoticeVersionEvidenceTests() {
  section('H. Notice-version / evidence matrix tests');

  const DIGITAL_SOURCES = ['patient_portal', 'public_booking', 'whatsapp', 'sms_keyword', 'email_unsubscribe'] as const;

  for (const src of DIGITAL_SOURCES) {
    await test(`H. grant from digital source "${src}" without noticeVersion is rejected`, async () => {
      const fx = await createFixture();
      await assert.rejects(
        setCommunicationPreference({
          organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
          channel: 'sms', purpose: 'marketing', action: 'grant', source: src, evidenceType: 'public_booking_checkbox',
        }),
        (err: unknown) => err instanceof CommunicationConsentAdminError && err.code === 'notice_version_required',
      );
    });

    await test(`H. grant from digital source "${src}" with noticeVersion succeeds`, async () => {
      const fx = await createFixture();
      const outcome = await setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'sms', purpose: 'marketing', action: 'grant', source: src, evidenceType: 'public_booking_checkbox',
        noticeVersion: 'v1.0',
      });
      assert.equal(outcome.preference.status, 'granted');
      assert.equal(outcome.preference.noticeVersion, 'v1.0');
    });
  }

  await test('H. staff grant without a source description (notes) is rejected', async () => {
    const fx = await createFixture();
    await assert.rejects(
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'sms', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      }),
      (err: unknown) => err instanceof CommunicationConsentAdminError && err.code === 'evidence_required',
    );
  });

  await test('H. staff grant with a source description (notes) succeeds', async () => {
    const fx = await createFixture();
    const outcome = await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      notes: 'Patient verbally confirmed marketing SMS opt-in during check-in call on this date.',
    });
    assert.equal(outcome.preference.status, 'granted');
  });

  await test('H. staff grant does NOT require noticeVersion', async () => {
    const fx = await createFixture();
    const outcome = await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'email', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      notes: 'Patient verbally confirmed marketing email opt-in during check-in call.',
    });
    assert.equal(outcome.preference.status, 'granted');
    assert.equal(outcome.preference.noticeVersion, null);
  });

  await test('H. deny from a digital source never requires noticeVersion', async () => {
    const fx = await createFixture();
    const outcome = await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing', action: 'deny', source: 'public_booking', evidenceType: 'public_booking_checkbox',
    });
    assert.equal(outcome.preference.status, 'denied');
  });

  await test('H. withdraw from a digital source never requires noticeVersion (opt-out is never blocked on paperwork)', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'email', purpose: 'marketing', action: 'grant', source: 'patient_portal', evidenceType: 'portal_click',
      noticeVersion: 'v1.0',
    });
    const outcome = await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'email', purpose: 'marketing', action: 'withdraw', source: 'email_unsubscribe', evidenceType: 'inbound_reply',
    });
    assert.equal(outcome.preference.status, 'withdrawn');
  });

  await test('H. withdraw from staff source never requires a source description', async () => {
    const fx = await createFixture();
    const outcome = await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing', action: 'withdraw', source: 'staff', evidenceType: 'verbal_staff_record',
    });
    assert.equal(outcome.preference.status, 'withdrawn');
  });

  await test('H. raw notice text is never stored — only noticeVersion', async () => {
    const fx = await createFixture();
    const outcome = await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing', action: 'grant', source: 'public_booking', evidenceType: 'public_booking_checkbox',
      noticeVersion: 'v2.3',
    });
    const event = await prisma.patientCommunicationConsentEvent.findFirst({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'marketing' },
    });
    assert.equal(outcome.preference.noticeVersion, 'v2.3');
    assert.equal(event?.noticeVersion, 'v2.3');
    // No field on either row ever holds the raw notice/KVKK text body — only
    // this short version/reference string. Nothing further to assert beyond
    // schema shape (no such field exists on either model).
  });
}

// ── I. WhatsApp send-time integration tests (Blocker 2) ─────────────────────────
//
// Every public dispatcher's mandatory consent-context enforcement, exercised
// against a real DB-backed evolution_api connection with
// EvolutionWhatsAppProvider.prototype.sendMessage patched to a spy — so
// "provider not called" / "provider called" is asserted directly, not merely
// inferred from a WA_NO_CONNECTION structural code.

type WhatsAppDispatcherCallArgs = {
  clinicId: string;
  phone: string;
  organizationId?: string;
  patientId?: string;
  consentPurpose?: string;
};

const WHATSAPP_DISPATCHERS: Array<{ name: string; send: (a: WhatsAppDispatcherCallArgs) => Promise<{ success: boolean; code?: string }> }> = [
  {
    name: 'sendProactiveWhatsAppMessage',
    send: (a) => sendProactiveWhatsAppMessage({
      clinicId: a.clinicId, phone: a.phone, text: 'hello', variables: {},
      organizationId: a.organizationId as any, patientId: a.patientId as any, consentPurpose: a.consentPurpose as any,
    }),
  },
  {
    name: 'sendNoShowRecoveryWhatsApp',
    send: (a) => sendNoShowRecoveryWhatsApp({
      clinicId: a.clinicId, phone: a.phone, evolutionPlainText: 'hello', variables: {},
      organizationId: a.organizationId as any, patientId: a.patientId as any, consentPurpose: a.consentPurpose as any,
    }),
  },
  {
    name: 'sendAppointmentConfirmationWhatsApp',
    send: (a) => sendAppointmentConfirmationWhatsApp({
      clinicId: a.clinicId, phone: a.phone, evolutionPlainText: 'hello', variables: {},
      organizationId: a.organizationId as any, patientId: a.patientId as any, consentPurpose: a.consentPurpose as any,
    }),
  },
  {
    name: 'sendPostTreatmentWhatsApp',
    send: (a) => sendPostTreatmentWhatsApp({
      clinicId: a.clinicId, phone: a.phone, evolutionPlainText: 'hello', variables: {},
      organizationId: a.organizationId as any, patientId: a.patientId as any, consentPurpose: a.consentPurpose as any,
    }),
  },
];

async function runWhatsAppIntegrationTests() {
  section('I. WhatsApp send-time integration tests (mandatory consent context)');

  for (const dispatcher of WHATSAPP_DISPATCHERS) {
    await test(`I. ${dispatcher.name}: enforce + missing organizationId → blocked, provider not called`, async () => {
      const fx = await createWhatsAppFixture();
      await withEnv({ COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'enforce' }, async () => {
        const spy = spyOnEvolutionSendMessage(async () => ({ success: true, externalMessageId: 'x' }));
        try {
          const result = await dispatcher.send({
            clinicId: fx.clinicId, phone: fx.patientId, patientId: fx.patientId, consentPurpose: 'appointment_reminder',
          });
          assert.equal(result.success, false);
          assert.equal(result.code, OUTBOUND_ERRORS.CONSENT_CONTEXT_REQUIRED);
          assert.equal(spy.calls(), 0, 'provider must never be called when consent context is missing under enforce mode');
        } finally {
          spy.restore();
        }
      });
    });

    await test(`I. ${dispatcher.name}: enforce + missing patientId → blocked, provider not called`, async () => {
      const fx = await createWhatsAppFixture();
      await withEnv({ COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'enforce' }, async () => {
        const spy = spyOnEvolutionSendMessage(async () => ({ success: true, externalMessageId: 'x' }));
        try {
          const result = await dispatcher.send({
            clinicId: fx.clinicId, phone: '+905551112233', organizationId: fx.organizationId, consentPurpose: 'appointment_reminder',
          });
          assert.equal(result.success, false);
          assert.equal(result.code, OUTBOUND_ERRORS.CONSENT_CONTEXT_REQUIRED);
          assert.equal(spy.calls(), 0);
        } finally {
          spy.restore();
        }
      });
    });

    await test(`I. ${dispatcher.name}: enforce + missing purpose → blocked, provider not called`, async () => {
      const fx = await createWhatsAppFixture();
      await withEnv({ COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'enforce' }, async () => {
        const spy = spyOnEvolutionSendMessage(async () => ({ success: true, externalMessageId: 'x' }));
        try {
          const result = await dispatcher.send({
            clinicId: fx.clinicId, phone: '+905551112233', organizationId: fx.organizationId, patientId: fx.patientId,
          });
          assert.equal(result.success, false);
          assert.equal(result.code, OUTBOUND_ERRORS.CONSENT_CONTEXT_REQUIRED);
          assert.equal(spy.calls(), 0);
        } finally {
          spy.restore();
        }
      });
    });

    await test(`I. ${dispatcher.name}: audit + missing context → provider called (never blocks)`, async () => {
      const fx = await createWhatsAppFixture();
      await withEnv({ COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'audit' }, async () => {
        const spy = spyOnEvolutionSendMessage(async () => ({ success: true, externalMessageId: 'x' }));
        try {
          const result = await dispatcher.send({ clinicId: fx.clinicId, phone: '+905551112233' });
          assert.equal(spy.calls(), 1, 'audit mode must never block on missing context — the provider is still called');
          assert.equal(result.success, true);
        } finally {
          spy.restore();
        }
      });
    });

    await test(`I. ${dispatcher.name}: disabled + missing context → provider called (legacy behavior)`, async () => {
      const fx = await createWhatsAppFixture();
      await withEnv({ COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: undefined }, async () => {
        const spy = spyOnEvolutionSendMessage(async () => ({ success: true, externalMessageId: 'x' }));
        try {
          const result = await dispatcher.send({ clinicId: fx.clinicId, phone: '+905551112233' });
          assert.equal(spy.calls(), 1, 'disabled mode is completely unchanged legacy behavior');
          assert.equal(result.success, true);
        } finally {
          spy.restore();
        }
      });
    });

    await test(`I. ${dispatcher.name}: fully supplied + granted → provider called`, async () => {
      const fx = await createWhatsAppFixture();
      await setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'whatsapp', purpose: 'appointment_reminder', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
        notes: 'Patient verbal statement recorded by front-desk staff.',
      });
      await withEnv({ COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'enforce' }, async () => {
        const spy = spyOnEvolutionSendMessage(async () => ({ success: true, externalMessageId: 'x' }));
        try {
          const result = await dispatcher.send({
            clinicId: fx.clinicId, phone: '+905551112233',
            organizationId: fx.organizationId, patientId: fx.patientId, consentPurpose: 'appointment_reminder',
          });
          assert.equal(spy.calls(), 1, 'a granted decision must reach the provider');
          assert.equal(result.success, true);
        } finally {
          spy.restore();
        }
      });
    });

    await test(`I. ${dispatcher.name}: fully supplied + denied + enforce → blocked, provider not called`, async () => {
      const fx = await createWhatsAppFixture();
      await setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'whatsapp', purpose: 'appointment_reminder', action: 'deny', source: 'staff', evidenceType: 'verbal_staff_record',
      });
      await withEnv({ COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true', COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'enforce' }, async () => {
        const spy = spyOnEvolutionSendMessage(async () => ({ success: true, externalMessageId: 'x' }));
        try {
          const result = await dispatcher.send({
            clinicId: fx.clinicId, phone: '+905551112233',
            organizationId: fx.organizationId, patientId: fx.patientId, consentPurpose: 'appointment_reminder',
          });
          assert.equal(result.success, false);
          assert.equal(result.code, OUTBOUND_ERRORS.BLOCKED_BY_CONSENT);
          assert.equal(spy.calls(), 0, 'a denied decision must never reach the provider');
        } finally {
          spy.restore();
        }
      });
    });
  }
}

// ── Run ────────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await runModelTests();
    await runDecisionServiceTests();
    await runSmsIntegrationTests();
    await runAdminValidationTests();
    await runSanitizationTests();
    await runConcurrencyTests();
    await runTimestampPolicyTests();
    await runNoticeVersionEvidenceTests();
    await runWhatsAppIntegrationTests();
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
