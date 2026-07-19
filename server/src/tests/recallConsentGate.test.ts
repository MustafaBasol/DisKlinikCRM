/**
 * recallConsentGate.test.ts — KVKK-HIGH-007 legacy/central reconciliation
 * test for recall message drafting (recallCandidateService.ts), the second
 * legacy-gated sender wired to the shared resolver alongside SMS.
 *
 * Before this change, recall drafting only ever consulted
 * Patient.communicationConsent — an explicit central `granted` row had zero
 * effect. These tests prove: reconciliation-off preserves that exact legacy
 * behavior; reconciliation-on + enforce lets an explicit central grant draft
 * a message despite legacy communicationConsent=false; the per-clinic
 * respectCommunicationConsent escape hatch still bypasses the check entirely
 * when false, exactly as before.
 *
 * Run with: tsx src/tests/recallConsentGate.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import { prepareRecallMessageForCandidate } from '../services/recallCandidateService.js';
import { setCommunicationPreference } from '../services/communicationConsent/communicationConsentAdmin.js';

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

function section(title: string) { console.log(`\n${title}`); }

type Fixture = { organizationId: string; clinicId: string; patientId: string; userId: string };
const createdOrgIds: string[] = [];

async function createFixture(communicationConsent: boolean): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Recall Consent Test Org ${suffix}`, slug: `recall-consent-${suffix}` } });
  const clinic = await prisma.clinic.create({ data: { name: 'Test Clinic', slug: `recall-consent-clinic-${suffix}`, organizationId: org.id } });
  const patient = await prisma.patient.create({
    data: { firstName: 'Test', lastName: 'Patient', clinicId: clinic.id, organizationId: org.id, phone: '+905558887777', communicationConsent },
  });
  const user = await prisma.user.create({
    data: {
      clinicId: clinic.id, organizationId: org.id, firstName: 'Test', lastName: 'Staff',
      email: `staff-${suffix}@test.invalid`, role: 'OWNER', passwordHash: 'x', canAccessAllClinics: true,
    },
  });
  createdOrgIds.push(org.id);
  return { organizationId: org.id, clinicId: clinic.id, patientId: patient.id, userId: user.id };
}

async function createCandidate(fx: Fixture) {
  return prisma.recallCandidate.create({
    data: {
      clinicId: fx.clinicId, patientId: fx.patientId, recallType: 'ROUTINE_CHECKUP',
      sourceType: 'manual', sourceId: randomUUID(), dueAt: new Date(),
    },
  });
}

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  await prisma.recallAction.deleteMany({ where: { candidate: { clinic: { organizationId: { in: createdOrgIds } } } } });
  await prisma.activityLog.deleteMany({ where: { clinic: { organizationId: { in: createdOrgIds } } } });
  await prisma.sentMessage.deleteMany({ where: { clinic: { organizationId: { in: createdOrgIds } } } });
  await prisma.recallCandidate.deleteMany({ where: { clinic: { organizationId: { in: createdOrgIds } } } });
  await prisma.clinicRecallSetting.deleteMany({ where: { clinic: { organizationId: { in: createdOrgIds } } } });
  await prisma.patientCommunicationConsentEvent.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientCommunicationPreference.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
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

const RECON_OFF = { COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED: undefined };
const RECON_ON_ENFORCE = {
  COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED: 'true',
  COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED: 'true',
  COMMUNICATION_CONSENT_ENFORCEMENT_MODE: 'enforce',
};

async function main() {
  section('Recall drafting — legacy/central reconciliation');

  await test('reconciliation off: legacy communicationConsent=false → throws (unchanged production behavior)', async () => {
    const fx = await createFixture(false);
    const candidate = await createCandidate(fx);
    await withEnv(RECON_OFF, async () => {
      await assert.rejects(() => prepareRecallMessageForCandidate(candidate.id, fx.userId));
    });
  });

  await test('reconciliation on+enforce: explicit central grant drafts despite legacy communicationConsent=false', async () => {
    const fx = await createFixture(false);
    const candidate = await createCandidate(fx);
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'whatsapp', purpose: 'recall', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record', notes: 'x',
    });
    await withEnv(RECON_ON_ENFORCE, async () => {
      const message = await prepareRecallMessageForCandidate(candidate.id, fx.userId);
      assert.ok(message.id);
      assert.equal(message.channel, 'whatsapp');
    });
  });

  await test('reconciliation on+enforce: no central row, legacy communicationConsent=true → still drafts (unchanged fallback)', async () => {
    const fx = await createFixture(true);
    const candidate = await createCandidate(fx);
    await withEnv(RECON_ON_ENFORCE, async () => {
      const message = await prepareRecallMessageForCandidate(candidate.id, fx.userId);
      assert.ok(message.id);
    });
  });

  await test('respectCommunicationConsent=false bypasses the check entirely, regardless of reconciliation', async () => {
    const fx = await createFixture(false);
    await prisma.clinicRecallSetting.create({ data: { clinicId: fx.clinicId, respectCommunicationConsent: false } });
    const candidate = await createCandidate(fx);
    await withEnv(RECON_ON_ENFORCE, async () => {
      const message = await prepareRecallMessageForCandidate(candidate.id, fx.userId);
      assert.ok(message.id, 'escape hatch preserved exactly as before');
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
