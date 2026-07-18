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

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  await prisma.patientCommunicationConsentEvent.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientCommunicationPreference.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.smsMessage.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
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
      });
    }
    const events = await prisma.patientCommunicationConsentEvent.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'whatsapp', purpose: 'recall' },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(events.length, 4);
    assert.deepEqual(events.map((e) => e.newStatus), ['granted', 'withdrawn', 'granted', 'denied']);
    assert.equal(events[1].previousStatus, 'granted');
    assert.equal(events[3].previousStatus, 'granted');
  });

  await test('3. simultaneous grant/withdraw race resolves to exactly one row', async () => {
    const fx = await createFixture();
    const [a, b] = await Promise.allSettled([
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'email', purpose: 'campaign', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
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
  });

  await test('4. event count is exact after a race (both attempts recorded)', async () => {
    const fx = await createFixture();
    await Promise.allSettled([
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'sms', purpose: 'survey', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      }),
      setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'sms', purpose: 'survey', action: 'deny', source: 'staff', evidenceType: 'verbal_staff_record',
      }),
    ]);
    const events = await prisma.patientCommunicationConsentEvent.findMany({
      where: { patientId: fx.patientId, clinicId: fx.clinicId, channel: 'sms', purpose: 'survey' },
    });
    assert.equal(events.length, 2, 'both attempted transitions must be recorded as immutable history');
  });

  await test('5. no duplicate effective rows (DB unique constraint enforced)', async () => {
    const fx = await createFixture();
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'whatsapp', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
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

// ── Run ────────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await runModelTests();
    await runDecisionServiceTests();
    await runSmsIntegrationTests();
    await runAdminValidationTests();
    await runSanitizationTests();
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
