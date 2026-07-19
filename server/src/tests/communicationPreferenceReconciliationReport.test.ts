/**
 * communicationPreferenceReconciliationReport.test.ts — KVKK-HIGH-007 --report
 * mode tests for backfillCommunicationPreferences.ts (a sibling file, not an
 * extension of communicationPreferenceBackfill.test.ts, to keep that
 * well-tested existing suite completely untouched).
 *
 * Spawns the real script as a child process (matching
 * communicationPreferenceBackfill.test.ts's own established pattern — the
 * script owns its own PrismaClient/pool and runs main() at import time, so it
 * cannot be imported directly into a test process).
 *
 * Because the report scans ALL patients (not scoped to one organization),
 * assertions here read the per-clinic (`byClinic`) breakdown for this test's
 * own fixture clinic rather than the global totals, so they remain correct
 * regardless of what other data exists in the shared disposable database.
 *
 * Covers:
 *   1. --report never writes to the database (dry-run-equivalent, regardless of --execute)
 *   2. legacy_opt_out_vs_central_granted conflict category populates correctly
 *   3. legacy_false_or_default_vs_central_unknown is ambiguous, not a denial/agreement claim
 *   4. legacy_yes_without_evidence flags legacy true with no evidenced grant
 *   5. already_reconciled recognizes a prior backfill run
 *   6. channel_consent_log_summary reports real ChannelConsentLog aggregates
 *   7. --report=path.json writes the report file
 *   8. no PII (patient id/name/phone) anywhere in report output
 *   9. idempotent (running twice produces the same category counts for the same fixture)
 *
 * Run with: tsx src/tests/communicationPreferenceReconciliationReport.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, unlinkSync } from 'node:fs';
import prisma from '../db.js';
import { setCommunicationPreference } from '../services/communicationConsent/communicationConsentAdmin.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, '../scripts/backfillCommunicationPreferences.ts');

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

async function runReport(reportArg: string): Promise<{ stdout: string; report: any }> {
  const outPath = path.resolve(__dirname, `../../.tmp-reconciliation-report-${randomUUID().slice(0, 8)}.json`);
  const command = `npx tsx "${SCRIPT_PATH}" --report=${reportArg === 'file' ? `"${outPath}"` : ''}`.trimEnd();
  const { stdout } = await execAsync(command, {
    cwd: path.resolve(__dirname, '../..'),
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (reportArg === 'file') {
    const report = JSON.parse(readFileSync(outPath, 'utf8'));
    unlinkSync(outPath);
    return { stdout, report };
  }
  const jsonStart = stdout.indexOf('=== Legacy/Central Reconciliation Report');
  const afterHeader = stdout.slice(jsonStart).split('\n').slice(1).join('\n');
  const braceStart = afterHeader.indexOf('{');
  const report = JSON.parse(afterHeader.slice(braceStart));
  return { stdout, report };
}

type Fixture = { organizationId: string; clinicId: string };
const createdOrgIds: string[] = [];

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Reconciliation Report Test Org ${suffix}`, slug: `recon-report-${suffix}` } });
  const clinic = await prisma.clinic.create({ data: { name: 'Test Clinic', slug: `recon-report-clinic-${suffix}`, organizationId: org.id } });
  createdOrgIds.push(org.id);
  return { organizationId: org.id, clinicId: clinic.id };
}

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  await prisma.patientCommunicationConsentEvent.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientCommunicationPreference.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channelConsentLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
}

function emptyCounts() {
  return { legacy_opt_out_vs_central_granted: 0, legacy_false_or_default_vs_central_unknown: 0, legacy_yes_without_evidence: 0, already_reconciled: 0 };
}

async function main() {
  section('--report mode');

  await test('1. --report never writes to the database', async () => {
    const fx = await createFixture();
    await prisma.patient.create({ data: { firstName: 'A', lastName: 'B', clinicId: fx.clinicId, organizationId: fx.organizationId, phone: '+905550000001', smsOptOut: true } });
    const before = await prisma.patientCommunicationPreference.count({ where: { organizationId: fx.organizationId } });
    await runReport('stdout');
    const after = await prisma.patientCommunicationPreference.count({ where: { organizationId: fx.organizationId } });
    assert.equal(before, 0);
    assert.equal(after, 0, '--report must never write, regardless of any other flag');
  });

  await test('2. legacy_opt_out_vs_central_granted: smsOptOut=true + central sms row granted', async () => {
    const fx = await createFixture();
    const patient = await prisma.patient.create({ data: { firstName: 'C', lastName: 'D', clinicId: fx.clinicId, organizationId: fx.organizationId, phone: '+905550000002', smsOptOut: true } });
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: patient.id,
      channel: 'sms', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record', notes: 'x',
    });
    const { report } = await runReport('stdout');
    const byClinic = report.byClinic[fx.clinicId] ?? emptyCounts();
    assert.equal(byClinic.legacy_opt_out_vs_central_granted, 1);
  });

  await test('3. legacy_false_or_default_vs_central_unknown: both booleans false, no central row', async () => {
    const fx = await createFixture();
    await prisma.patient.create({ data: { firstName: 'E', lastName: 'F', clinicId: fx.clinicId, organizationId: fx.organizationId, phone: '+905550000003' } });
    const { report } = await runReport('stdout');
    const byClinic = report.byClinic[fx.clinicId] ?? emptyCounts();
    assert.equal(byClinic.legacy_false_or_default_vs_central_unknown, 1);
    const note = report.notes.join(' ').toLowerCase();
    assert.ok(note.includes('ambiguous'), 'must be documented as ambiguous, never as an explicit denial or agreement');
  });

  await test('4. legacy_yes_without_evidence: communicationConsent=true, no evidenced central granted row', async () => {
    const fx = await createFixture();
    await prisma.patient.create({ data: { firstName: 'G', lastName: 'H', clinicId: fx.clinicId, organizationId: fx.organizationId, phone: '+905550000004', communicationConsent: true } });
    const { report } = await runReport('stdout');
    const byClinic = report.byClinic[fx.clinicId] ?? emptyCounts();
    assert.equal(byClinic.legacy_yes_without_evidence, 1);
  });

  await test('5. already_reconciled: prior backfill run recognized, not double-flagged as a conflict', async () => {
    const fx = await createFixture();
    await prisma.patient.create({ data: { firstName: 'I', lastName: 'J', clinicId: fx.clinicId, organizationId: fx.organizationId, phone: '+905550000005', smsOptOut: true } });
    await execAsync(`npx tsx "${SCRIPT_PATH}" --execute`, { cwd: path.resolve(__dirname, '../..'), env: process.env, maxBuffer: 20 * 1024 * 1024 });
    const { report } = await runReport('stdout');
    const byClinic = report.byClinic[fx.clinicId] ?? emptyCounts();
    assert.equal(byClinic.already_reconciled, 1);
    assert.equal(byClinic.legacy_opt_out_vs_central_granted, 0, 'a withdrawn row from the standard backfill is not a conflict');
  });

  await test('6. channel_consent_log_summary reports real ChannelConsentLog aggregates for this clinic', async () => {
    const fx = await createFixture();
    await prisma.channelConsentLog.create({
      data: {
        organizationId: fx.organizationId, clinicId: fx.clinicId, channel: 'whatsapp', contactIdentifier: '+905550000006',
        consentStatus: 'accepted', consentTextVersion: 'v1', consentTextSnapshot: 'snapshot', privacyUrl: 'https://example.invalid/privacy',
      },
    });
    const { report } = await runReport('stdout');
    const entry = report.channelConsentLogSummary.find((r: any) => r.clinicId === fx.clinicId && r.channel === 'whatsapp' && r.consentStatus === 'accepted');
    assert.equal(entry?.count, 1);
  });

  await test('7. --report=path.json writes the report file', async () => {
    const fx = await createFixture();
    await prisma.patient.create({ data: { firstName: 'K', lastName: 'L', clinicId: fx.clinicId, organizationId: fx.organizationId, phone: '+905550000007' } });
    const { report } = await runReport('file');
    assert.ok(report.generatedAt);
    assert.ok(typeof report.patientsInspected === 'number');
  });

  await test('8. no PII anywhere in report output', async () => {
    const fx = await createFixture();
    await prisma.patient.create({ data: { firstName: 'SecretName', lastName: 'Patient', clinicId: fx.clinicId, organizationId: fx.organizationId, phone: '+905559998888' } });
    const { stdout, report } = await runReport('stdout');
    const json = JSON.stringify(report);
    assert.ok(!json.includes('SecretName'));
    assert.ok(!json.includes('+905559998888'));
    assert.ok(!stdout.includes('+905559998888'));
  });

  await test('9. idempotent — running twice produces the same category counts for the same fixture', async () => {
    const fx = await createFixture();
    await prisma.patient.create({ data: { firstName: 'M', lastName: 'N', clinicId: fx.clinicId, organizationId: fx.organizationId, phone: '+905550000009', smsOptOut: true } });
    const first = await runReport('stdout');
    const second = await runReport('stdout');
    assert.deepEqual(first.report.byClinic[fx.clinicId], second.report.byClinic[fx.clinicId]);
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
