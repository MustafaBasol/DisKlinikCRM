/**
 * communicationPreferenceBackfill.test.ts — KVKK-HIGH-007 legacy backfill
 * script tests (src/scripts/backfillCommunicationPreferences.ts).
 *
 * Runs the script as a real child process (dry-run and --execute) against
 * the disposable test database so DATABASE_URL/process.argv/process.exit
 * behavior in the script is exercised exactly as it would be from the CLI.
 *
 * Covers:
 *   1. dry-run makes no database changes
 *   2. --execute creates withdrawn rows only for smsOptOut patients
 *   3. --execute never creates a row for a patient without smsOptOut
 *   4. no purpose is ever set to 'granted' by the backfill (no silent grant)
 *   5. policy-exception purposes (transactional/legal_notice/security_notice) get no row
 *   6. re-running --execute is idempotent (no duplicate rows, existing rows untouched)
 *   7. immutable history event is written alongside each created preference row
 *
 * Run with: tsx src/tests/communicationPreferenceBackfill.test.ts
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from '../db.js';
import { COMMUNICATION_PURPOSES, POLICY_EXCEPTION_PURPOSES } from '../services/communicationConsent/taxonomy.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const SCRIPT_PATH = path.resolve(__dirname, '../scripts/backfillCommunicationPreferences.ts');

async function runBackfill(execute: boolean): Promise<string> {
  // Fixed, internally-controlled arguments only (script path + a static
  // flag) — never interpolates external input, so a quoted shell string is
  // safe here and avoids the Windows `spawn EINVAL`/`ENOENT` quirks that
  // execFile() hits with .cmd shims (npx) both with and without shell:true.
  const command = `npx tsx "${SCRIPT_PATH}"${execute ? ' --execute' : ''}`;
  const { stdout } = await execAsync(command, {
    cwd: path.resolve(__dirname, '../..'),
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

const createdOrgIds: string[] = [];

async function createFixture(): Promise<{ organizationId: string; clinicId: string; optedOutPatientId: string; normalPatientId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: { name: `Backfill Test Org ${suffix}`, slug: `backfill-${suffix}` },
  });
  const clinic = await prisma.clinic.create({
    data: { name: 'Backfill Clinic', slug: `backfill-clinic-${suffix}`, organizationId: org.id },
  });
  const optedOut = await prisma.patient.create({
    data: {
      firstName: 'OptedOut', lastName: 'Patient', clinicId: clinic.id, organizationId: org.id,
      phone: '+905551110000', smsOptOut: true, smsOptOutAt: new Date(),
    },
  });
  const normal = await prisma.patient.create({
    data: { firstName: 'Normal', lastName: 'Patient', clinicId: clinic.id, organizationId: org.id, phone: '+905551110001' },
  });
  createdOrgIds.push(org.id);
  return { organizationId: org.id, clinicId: clinic.id, optedOutPatientId: optedOut.id, normalPatientId: normal.id };
}

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  await prisma.patientCommunicationConsentEvent.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientCommunicationPreference.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
}

const NON_EXCEPTION_PURPOSES = COMMUNICATION_PURPOSES.filter(
  (p) => !(POLICY_EXCEPTION_PURPOSES as readonly string[]).includes(p),
);

async function main() {
  const fx = await createFixture();

  try {
    await test('1. dry-run makes no database changes', async () => {
      const stdout = await runBackfill(false);
      assert.match(stdout, /DRY-RUN/);
      const rows = await prisma.patientCommunicationPreference.findMany({ where: { patientId: fx.optedOutPatientId } });
      assert.equal(rows.length, 0);
    });

    await test('2. --execute creates withdrawn rows only for smsOptOut patients', async () => {
      await runBackfill(true);
      const rows = await prisma.patientCommunicationPreference.findMany({
        where: { patientId: fx.optedOutPatientId, clinicId: fx.clinicId, channel: 'sms' },
      });
      assert.equal(rows.length, NON_EXCEPTION_PURPOSES.length);
      assert.ok(rows.every((r) => r.status === 'withdrawn'));
      assert.ok(rows.every((r) => r.source === 'legacy'));
    });

    await test('3. --execute never creates a row for a patient without smsOptOut', async () => {
      const rows = await prisma.patientCommunicationPreference.findMany({ where: { patientId: fx.normalPatientId } });
      assert.equal(rows.length, 0);
    });

    await test("4. no purpose is ever set to 'granted' by the backfill (no silent grant)", async () => {
      const granted = await prisma.patientCommunicationPreference.count({
        where: { organizationId: fx.organizationId, status: 'granted' },
      });
      assert.equal(granted, 0);
    });

    await test('5. policy-exception purposes get no row', async () => {
      const rows = await prisma.patientCommunicationPreference.findMany({
        where: { patientId: fx.optedOutPatientId, purpose: { in: [...POLICY_EXCEPTION_PURPOSES] } },
      });
      assert.equal(rows.length, 0);
    });

    await test('6. re-running --execute is idempotent', async () => {
      const before = await prisma.patientCommunicationPreference.count({ where: { patientId: fx.optedOutPatientId } });
      const stdout = await runBackfill(true);
      assert.match(stdout, /Skipped/);
      const after = await prisma.patientCommunicationPreference.count({ where: { patientId: fx.optedOutPatientId } });
      assert.equal(after, before, 're-running must not create duplicate rows');
    });

    await test('7. immutable history event is written alongside each created preference row', async () => {
      const events = await prisma.patientCommunicationConsentEvent.findMany({
        where: { patientId: fx.optedOutPatientId, clinicId: fx.clinicId, channel: 'sms' },
      });
      assert.equal(events.length, NON_EXCEPTION_PURPOSES.length);
      assert.ok(events.every((e) => e.newStatus === 'withdrawn' && e.previousStatus === null));
    });
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
