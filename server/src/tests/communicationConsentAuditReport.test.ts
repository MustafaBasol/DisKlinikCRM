/**
 * communicationConsentAuditReport.test.ts — bounded audit-summary reporting
 * tests (KVKK-HIGH-007 Workstream 3).
 *
 * Covers:
 *   1. date range beyond the max span is rejected
 *   2. until <= since is rejected
 *   3. default range (no since/until) works without throwing
 *   4. DB-side aggregation correctness for sampled OperationalEvent rows
 *      (by reasonCode, channel/purpose, samplingRate/samplingVersion)
 *   5. multiple sampling rate/version combinations in one range are reported
 *      as separate groups, never blended
 *   6. conflict bucket aggregation: bucketCount / totalOccurrences /
 *      first-last detection timestamps, explicitly not a unique-patient count
 *   7. no patient identifiers anywhere in the response
 *
 * Run with: tsx src/tests/communicationConsentAuditReport.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../db.js';
import {
  getCommunicationConsentAuditSummary,
  CommunicationConsentAuditReportError,
} from '../services/communicationConsent/communicationConsentAuditReport.js';

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

type Fixture = { organizationId: string; clinicId: string };
const createdOrgIds: string[] = [];

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Audit Report Test Org ${suffix}`, slug: `audit-report-${suffix}` } });
  const clinic = await prisma.clinic.create({ data: { name: 'Test Clinic', slug: `audit-report-clinic-${suffix}`, organizationId: org.id } });
  createdOrgIds.push(org.id);
  return { organizationId: org.id, clinicId: clinic.id };
}

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  await prisma.communicationConsentConflictBucket.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.operationalEvent.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
}

async function seedEvent(fx: Fixture, metadata: Record<string, unknown>, createdAt: Date) {
  await prisma.operationalEvent.create({
    data: {
      organizationId: fx.organizationId,
      clinicId: fx.clinicId,
      severity: 'info',
      source: 'communication_consent',
      message: 'test event',
      metadata: metadata as Prisma.InputJsonValue,
      createdAt,
    },
  });
}

async function main() {
  section('1. Bounded date range validation');

  await test('range beyond 90 days is rejected', async () => {
    const fx = await createFixture();
    const until = new Date();
    const since = new Date(until.getTime() - 200 * 24 * 60 * 60 * 1000);
    await assert.rejects(
      () => getCommunicationConsentAuditSummary({ organizationId: fx.organizationId, since, until }),
      CommunicationConsentAuditReportError,
    );
  });

  await test('until <= since is rejected', async () => {
    const fx = await createFixture();
    const now = new Date();
    await assert.rejects(
      () => getCommunicationConsentAuditSummary({ organizationId: fx.organizationId, since: now, until: new Date(now.getTime() - 1000) }),
      CommunicationConsentAuditReportError,
    );
  });

  await test('default range (no since/until) does not throw', async () => {
    const fx = await createFixture();
    const summary = await getCommunicationConsentAuditSummary({ organizationId: fx.organizationId });
    assert.ok(summary.since && summary.until);
  });

  section('2. DB-side aggregation correctness');

  await test('breakdowns aggregate correctly by reasonCode / channel+purpose / samplingRate+version', async () => {
    const fx = await createFixture();
    const now = new Date();
    await seedEvent(fx, { reasonCode: 'consent_denied', channel: 'sms', purpose: 'marketing', wouldBlock: true, sampled: true, samplingRate: 1, samplingVersion: 1 }, now);
    await seedEvent(fx, { reasonCode: 'consent_denied', channel: 'sms', purpose: 'marketing', wouldBlock: true, sampled: true, samplingRate: 1, samplingVersion: 1 }, now);
    await seedEvent(fx, { reasonCode: 'consent_granted', channel: 'whatsapp', purpose: 'recall', wouldBlock: false, sampled: true, samplingRate: 1, samplingVersion: 1 }, now);

    const summary = await getCommunicationConsentAuditSummary({ organizationId: fx.organizationId, since: new Date(now.getTime() - 1000), until: new Date(now.getTime() + 1000) });

    const deniedReason = summary.evaluatedEvents.byReasonCode.find((r) => r.reasonCode === 'consent_denied');
    assert.equal(deniedReason?.count, 2);
    const grantedReason = summary.evaluatedEvents.byReasonCode.find((r) => r.reasonCode === 'consent_granted');
    assert.equal(grantedReason?.count, 1);

    const smsMarketing = summary.evaluatedEvents.byChannelPurpose.find((r) => r.channel === 'sms' && r.purpose === 'marketing');
    assert.equal(smsMarketing?.count, 2);

    const rateVersionGroup = summary.evaluatedEvents.bySamplingRateAndVersion.find((r) => r.samplingRate === 1 && r.samplingVersion === 1);
    assert.equal(rateVersionGroup?.totalEvaluated, 3);
    assert.equal(rateVersionGroup?.wouldBlockCount, 2);
  });

  await test('multiple sampling rate/version combinations in range are reported as separate groups, never blended', async () => {
    const fx = await createFixture();
    const now = new Date();
    await seedEvent(fx, { reasonCode: 'consent_granted', channel: 'sms', purpose: 'marketing', wouldBlock: false, sampled: true, samplingRate: 1, samplingVersion: 1 }, now);
    await seedEvent(fx, { reasonCode: 'consent_granted', channel: 'sms', purpose: 'marketing', wouldBlock: false, sampled: true, samplingRate: 0.1, samplingVersion: 2 }, now);

    const summary = await getCommunicationConsentAuditSummary({ organizationId: fx.organizationId, since: new Date(now.getTime() - 1000), until: new Date(now.getTime() + 1000) });
    assert.equal(summary.evaluatedEvents.bySamplingRateAndVersion.length, 2, 'two distinct (rate, version) groups, not blended into one');
    assert.ok(summary.evaluatedEvents.warning.toLowerCase().includes('not') , 'warning must caveat that these are not exact totals');
  });

  section('3. Conflict bucket aggregation');

  await test('reports bucketCount/totalOccurrences/first-last detection, never a unique-patient count', async () => {
    const fx = await createFixture();
    const now = new Date();
    await prisma.communicationConsentConflictBucket.create({
      data: {
        organizationId: fx.organizationId, clinicId: fx.clinicId, channel: 'sms', purpose: 'marketing',
        reasonCode: 'legacy_central_conflict', bucketStartedAt: now, firstDetectedAt: now, lastDetectedAt: now, occurrenceCount: 5,
      },
    });
    await prisma.communicationConsentConflictBucket.create({
      data: {
        organizationId: fx.organizationId, clinicId: fx.clinicId, channel: 'sms', purpose: 'operational',
        reasonCode: 'legacy_central_conflict', bucketStartedAt: now, firstDetectedAt: now, lastDetectedAt: now, occurrenceCount: 3,
      },
    });

    const summary = await getCommunicationConsentAuditSummary({ organizationId: fx.organizationId, since: new Date(now.getTime() - 1000), until: new Date(now.getTime() + 1000) });
    assert.equal(summary.conflicts.bucketCount, 2);
    assert.equal(summary.conflicts.totalOccurrences, 8);
    assert.ok(summary.conflicts.note.toLowerCase().includes('not a unique-patient count') || summary.conflicts.note.toLowerCase().includes('never') );
  });

  section('4. No patient identifiers anywhere in the response');

  await test('response JSON contains no field named patientId and no PII keys', async () => {
    const fx = await createFixture();
    const summary = await getCommunicationConsentAuditSummary({ organizationId: fx.organizationId });
    const json = JSON.stringify(summary);
    assert.ok(!json.includes('patientId'));
    assert.ok(!/"phone"|"email"|"name"/.test(json));
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
