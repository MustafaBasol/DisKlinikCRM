/**
 * migrationExecutionDb.test.ts — F3-DATA-MIG-TODAY-001
 *
 * DB-BACKED execution proofs. Requires DATABASE_URL to point at a DISPOSABLE
 * Postgres — it creates and deletes real rows. Registered under
 * `server:test:disposable-db`, never under `server:test:non-disposable`.
 *
 * These are the claims that cannot honestly be proved without a database,
 * because each one is a property of real transactions and real unique indexes:
 *
 *   1. DRY RUN WRITES NOTHING. Patient and PatientIdentityDocument counts are
 *      identical before and after a dry run over a dirty-data fixture.
 *   2. IDEMPOTENT RERUN. Executing the same source twice creates patients once.
 *      The second run MATCHES via the tenant-scoped provenance unique index.
 *   3. BATCH FAILURE IS CONTAINED. A failure in batch N leaves batches 1..N-1
 *      committed, and a retry completes the run without duplicating anything.
 *   4. TENANT SCOPING IS REAL. The same vendor source id under two different
 *      organizations produces two independent patients and does not collide on
 *      the provenance unique key.
 *   5. IDENTITY IS TENANT-BOUND AND QUARANTINED. The same TC in two orgs yields
 *      different lookup hashes; invalid/duplicate/ambiguous values write no
 *      identity row at all while the patient still imports.
 *   6. CONCURRENCY. Two simultaneous execute attempts: exactly one acquires
 *      the lock, the other is rejected with EXECUTION_ALREADY_RUNNING.
 *   7. RECONCILIATION BALANCES against the database, not against counters.
 *
 * Every fixture is SYNTHETIC. No real patient data, and no value from the
 * first-customer workbook, appears anywhere in this file.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import { buildBiff8Fixture, type FixtureSheet } from './helpers/biff8Fixture.js';
import { parseSourceWorkbook, profileColumns } from '../services/migration/parser/canonicalParser.js';
import { suggestMappings } from '../services/migration/mapping/mappingEngine.js';
import { runDryRun, assertExecutable } from '../services/migration/dryRun.js';
import {
  executeMigrationRun,
  markFailedBatchesForRetry,
  recomputeRunCounters,
  resumeMigrationRun,
  MIN_BATCH_SIZE as MIN_PRODUCTION_BATCH_SIZE,
} from '../services/migration/executor.js';
import { buildReconciliation } from '../services/migration/reconciliation.js';
import {
  findClinicPractitioner,
  listClinicPractitioners,
} from '../utils/relationGuards.js';
import { computeIdentityLookupHash } from '../utils/patientIdentityCrypto.js';
import { deleteSourceFile, storeSourceFile } from '../services/migration/sourceFileStore.js';
import { buildExecuteInput } from '../routes/platformMigration.js';
import { SOURCE_SYSTEM_DEFAULT, MigrationError, type DryRunSummary } from '../services/migration/contracts.js';
import type { ResolvedMapping } from '../services/migration/rowBuilder.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${(err as Error)?.stack ?? err}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Fixture construction — synthetic only
// ---------------------------------------------------------------------------

/** Compute a checksum-valid synthetic TCKN from a 9-digit stem. */
function synthTckn(stem: string): string {
  assert.equal(stem.length, 9);
  const d = stem.split('').map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const d10 = (odd * 7 - even + 100) % 10;
  const d11 = (d.reduce((a, b) => a + b, 0) + d10) % 10;
  return stem + String(d10) + String(d11);
}

const HEADERS = ['HASTA_ID', 'ADI', 'SOYADI', 'CEPTELEFONU', 'TCNO', 'CINSIYET', 'DOSYANO'];

interface SyntheticRow {
  hastaId: string;
  ad: string;
  soyad: string;
  phone: string;
  tckn: string;
  cinsiyet: string;
  dosyano: string;
}

function buildWorkbookBuffer(rows: SyntheticRow[]): Buffer {
  const sheet: FixtureSheet = {
    name: 'Sayfa1',
    rows: [
      HEADERS.map((h) => ({ v: h })),
      ...rows.map((r) => [
        { v: r.hastaId },
        { v: r.ad },
        { v: r.soyad },
        { v: r.phone },
        { v: r.tckn },
        { v: r.cinsiyet },
        { v: r.dosyano },
      ]),
    ],
  };
  return buildBiff8Fixture([sheet]);
}

function syntheticRows(count: number, seed = 1): SyntheticRow[] {
  const rows: SyntheticRow[] = [];
  for (let i = 0; i < count; i++) {
    const n = seed * 1000 + i;
    rows.push({
      hastaId: `SRC-${n}`,
      ad: `Sentetik${n}`,
      soyad: `Kayit${n}`,
      phone: `053200${String(n).padStart(5, '0')}`,
      tckn: synthTckn(String(100000000 + n).slice(0, 9)),
      cinsiyet: i % 2 === 0 ? 'E' : 'K',
      dosyano: String(9000 + n),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Tenant fixtures
// ---------------------------------------------------------------------------

const createdOrgIds: string[] = [];

async function makeTenant(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const plan = await prisma.plan.create({
    data: {
      name: `mig-test-${label}-${suffix}`,
      displayName: `Migration Test ${label}`,
      maxUsers: 100,
      maxPatients: 100000,
      monthlyPrice: 0,
      features: {},
    },
  });
  const organization = await prisma.organization.create({
    data: { name: `MigTestOrg-${label}-${suffix}`, slug: `mig-${label}-${suffix}`, planId: plan.id },
  });
  const clinic = await prisma.clinic.create({
    data: {
      name: `MigTestClinic-${label}-${suffix}`,
      slug: `migc-${label}-${suffix}`,
      organizationId: organization.id,
      maxPatients: 100000,
    },
  });
  createdOrgIds.push(organization.id);
  return { organizationId: organization.id, clinicId: clinic.id, planId: plan.id };
}

/**
 * A user carrying an explicit branch-scoped UserClinic assignment — the
 * repository's accepted multi-branch access model. `role` is the CLINIC role,
 * which is what practitioner eligibility is decided on.
 */
async function makeUser(
  organizationId: string,
  clinicId: string,
  role: string,
  label: string,
) {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      organizationId,
      clinicId,
      email: `mig-${label}-${suffix}@example.invalid`,
      passwordHash: 'not-a-real-hash',
      firstName: `Test${label}`,
      lastName: `User${suffix}`,
      role,
      isActive: true,
    },
  });
  await prisma.userClinic.create({
    data: { userId: user.id, clinicId, role, isActive: true },
  });
  return user;
}

const makePractitioner = (organizationId: string, clinicId: string, label: string) =>
  makeUser(organizationId, clinicId, 'DENTIST', label);

async function cleanupTenants() {
  for (const organizationId of createdOrgIds) {
    // Order matters: children before parents.
    await prisma.migrationRowOutcome.deleteMany({ where: { run: { organizationId } } });
    await prisma.migrationRunBatch.deleteMany({ where: { run: { organizationId } } });
    await prisma.migrationFieldMapping.deleteMany({ where: { run: { organizationId } } });
    await prisma.migrationRecord.deleteMany({ where: { organizationId } });
    await prisma.migrationReferenceMap.deleteMany({ where: { organizationId } });
    await prisma.patientIdentityDocument.deleteMany({ where: { organizationId } });
    await prisma.migrationRun.deleteMany({ where: { organizationId } });
    await prisma.patient.deleteMany({ where: { organizationId } });
    await prisma.userClinic.deleteMany({ where: { user: { organizationId } } });
    await prisma.user.deleteMany({ where: { organizationId } });
    await prisma.clinic.deleteMany({ where: { organizationId } });
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { planId: true },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    if (org?.planId) await prisma.plan.deleteMany({ where: { id: org.planId } });
  }
  createdOrgIds.length = 0;
}

// ---------------------------------------------------------------------------
// Run construction
// ---------------------------------------------------------------------------

/**
 * Stand-in Platform Admin id for fixtures that model "an operator already
 * settled this mapping". A plain constant, never a real admin: the
 * data-loss gate only asks WHETHER a decider was recorded, never who.
 */
const FIXTURE_OPERATOR_ID = 'fixture-platform-admin';

async function prepareRun(
  tenant: { organizationId: string; clinicId: string },
  rows: SyntheticRow[],
  batchSize = 500,
) {
  const buffer = buildWorkbookBuffer(rows);
  const workbook = await parseSourceWorkbook(buffer, 'xls');
  const profiles = profileColumns(workbook);
  const suggestions = suggestMappings(workbook.headers, profiles, {
    sourceSystem: SOURCE_SYSTEM_DEFAULT,
  });

  const run = await prisma.migrationRun.create({
    data: {
      organizationId: tenant.organizationId,
      clinicId: tenant.clinicId,
      sourceSystem: SOURCE_SYSTEM_DEFAULT,
      status: 'READY',
      batchSize,
      totalSourceRows: workbook.rows.length,
      headerColumnCount: workbook.headers.length,
    },
  });

  const mappings: ResolvedMapping[] = suggestions.map((s) => ({
    sourceField: s.sourceField,
    sourceIndex: s.sourceIndex,
    destinationField: s.destinationField,
    transform: s.transform,
    composeOrder: s.composeOrder,
    // Everything the engine proposed confidently is treated as resolved; the
    // mapping UI is not under test here.
    state: s.destinationField ? 'AUTO_CONFIDENT' : 'IGNORE',
  }));

  /*
   * F3-DATA-MIG-TODAY-001-R9. Two things this fixture now has to be honest
   * about, because the data-loss gate reads both.
   *
   * `sourceProfile` carries the MEASURED fill count. Without it every column
   * reads as UNMEASURED, which the gate treats as fail-closed — correctly, but
   * it would make every fixture here non-executable for the wrong reason.
   *
   * The IGNORE rows are stamped as OPERATOR-CONFIRMED, which is what these
   * fixtures have always meant ("the mapping UI is not under test here" =
   * assume a competent operator already settled it). Before R9 that assumption
   * was invisible; now it has to be written down, because an unconfirmed
   * exclusion of a populated column is exactly what stops a run. The gate's
   * own suite proves the negative case.
   */
  const profileByIndex = new Map(profiles.map((p) => [p.index, p]));
  const decidedAt = new Date();

  await prisma.migrationFieldMapping.createMany({
    data: mappings.map((m) => {
      const operatorDecided = m.state === 'IGNORE';
      return {
        runId: run.id,
        sourceField: m.sourceField,
        sourceIndex: m.sourceIndex,
        sourceNormalized: m.sourceField,
        destinationField: m.destinationField,
        transform: m.transform,
        composeOrder: m.composeOrder,
        state: m.state,
        confidence: 100,
        sourceProfile: (profileByIndex.get(m.sourceIndex) ?? null) as never,
        isAutoSuggested: !operatorDecided,
        decidedByPlatformAdminId: operatorDecided ? FIXTURE_OPERATOR_ID : null,
        decidedAt: operatorDecided ? decidedAt : null,
      };
    }),
  });

  const gateRecords = await prisma.migrationFieldMapping.findMany({
    where: { runId: run.id },
    orderBy: { sourceIndex: 'asc' },
  });

  return { run, workbook, mappings, gateRecords };
}

function executeInput(
  run: { id: string; organizationId: string; clinicId: string; batchSize: number },
  workbook: Awaited<ReturnType<typeof parseSourceWorkbook>>,
  mappings: ResolvedMapping[],
) {
  return {
    runId: run.id,
    organizationId: run.organizationId,
    clinicId: run.clinicId,
    sourceSystem: SOURCE_SYSTEM_DEFAULT,
    batchSize: run.batchSize,
    workbook,
    mappings,
    practitionerMap: new Map<string, string | null>(),
    actorPlatformAdminId: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      'DATABASE_URL is required. This suite creates and deletes real rows and must ' +
        'only ever be pointed at a DISPOSABLE Postgres.',
    );
    process.exit(1);
  }

  try {
    // ---------------------------------------------------------------------
    section('1. Dry run performs ZERO domain writes');

    await test('patient and identity counts are unchanged by a dry run', async () => {
      const tenant = await makeTenant('dry');
      const rows = syntheticRows(25);
      const { run, workbook, mappings, gateRecords } = await prepareRun(tenant, rows);

      const before = {
        patients: await prisma.patient.count({ where: { organizationId: tenant.organizationId } }),
        identities: await prisma.patientIdentityDocument.count({
          where: { organizationId: tenant.organizationId },
        }),
      };

      const summary = await runDryRun({
        runId: run.id,
        organizationId: tenant.organizationId,
        clinicId: tenant.clinicId,
        sourceSystem: SOURCE_SYSTEM_DEFAULT,
        workbook,
        mappings,
        unresolvedReferenceValues: new Set(),
        legalBlockedFields: [],
        unresolvedMappingCount: 0,
        gateRecords,
      });

      const after = {
        patients: await prisma.patient.count({ where: { organizationId: tenant.organizationId } }),
        identities: await prisma.patientIdentityDocument.count({
          where: { organizationId: tenant.organizationId },
        }),
      };

      assert.deepEqual(after, before, 'a dry run must not create or modify any domain row');
      assert.equal(summary.expectedCreateCount, 25);
      assert.equal(summary.expectedReuseCount, 0);
      assert.equal(
        await prisma.migrationRecord.count({ where: { organizationId: tenant.organizationId } }),
        0,
        'a dry run must not write provenance either',
      );
    });

    // ---------------------------------------------------------------------
    // F3-DATA-MIG-TODAY-001-UI-002 — Objective A: a legally-excluded column
    // is a DECIDED, non-writing state (same tier as IGNORE at the mapping
    // layer — validateMapping.ts NON_WRITING_DECIDED_STATES) and must not by
    // itself make an otherwise-clean run non-executable.
    section('1b. Legal-policy exclusions do not block an otherwise-clean run');

    await test('legalBlockedFields > 0 does not suppress executable when there are no other blockers', async () => {
      const tenant = await makeTenant('legal');
      const rows = syntheticRows(5, 3);
      const { run, workbook, mappings, gateRecords } = await prepareRun(tenant, rows);

      const summary = await runDryRun({
        runId: run.id,
        organizationId: tenant.organizationId,
        clinicId: tenant.clinicId,
        sourceSystem: SOURCE_SYSTEM_DEFAULT,
        workbook,
        mappings,
        unresolvedReferenceValues: new Set(),
        legalBlockedFields: ['ONEMLINOT', 'KONTROLNOTU'],
        unresolvedMappingCount: 0,
        gateRecords,
      });

      assert.equal(summary.legalBlockers, 2, 'the count stays visible');
      assert.deepEqual(
        summary.legalExclusions.map((b) => b.fieldName).sort(),
        ['KONTROLNOTU', 'ONEMLINOT'],
        'each excluded field is named in legalExclusions',
      );
      assert.ok(
        summary.blockers.every((b) => b.code !== 'LEGAL_BLOCKED'),
        'a legal exclusion must never appear in the executable-gating blockers list',
      );
      assert.equal(summary.executable, true, 'a legal exclusion alone must not block an otherwise-executable run');
    });

    await test('a real blocker (unresolved mapping) still suppresses executable even alongside a legal exclusion', async () => {
      const tenant = await makeTenant('legal2');
      const rows = syntheticRows(5, 4);
      const { run, workbook, mappings, gateRecords } = await prepareRun(tenant, rows);

      const summary = await runDryRun({
        runId: run.id,
        organizationId: tenant.organizationId,
        clinicId: tenant.clinicId,
        sourceSystem: SOURCE_SYSTEM_DEFAULT,
        workbook,
        mappings,
        unresolvedReferenceValues: new Set(),
        legalBlockedFields: ['ONEMLINOT'],
        unresolvedMappingCount: 1,
        gateRecords,
      });

      assert.equal(summary.legalBlockers, 1);
      assert.equal(summary.executable, false, 'a genuine unresolved-mapping blocker must still gate execution');
      assert.ok(summary.blockers.some((b) => b.code === 'MAPPING_REQUIRED'));
    });

    // ---------------------------------------------------------------------
    // F3-DATA-MIG-TODAY-001-R9 — the first-customer data-loss gate, proved
    // against real persisted rows rather than in-memory fixtures. The unit
    // proofs live in migrationDataLossGate.test.ts; what needs a database is
    // that the ROUND TRIP carries the evidence: the analyze-shaped row really
    // does read as "system proposed", the save-shaped row really does read as
    // "operator confirmed", and `executable` really does follow.
    section('1c. A system-recommended exclusion of a populated column blocks Execute');

    await test('an unconfirmed IGNORE on a column carrying data makes the run non-executable', async () => {
      const tenant = await makeTenant('gate');
      const rows = syntheticRows(6, 5);
      const { run, workbook, mappings } = await prepareRun(tenant, rows);

      // Model exactly what the ANALYZE route writes: a matrix-driven exclusion,
      // proposed by the system, decided by nobody. DOSYANO is used because it
      // is populated in the fixture and is not a required destination.
      await prisma.migrationFieldMapping.updateMany({
        where: { runId: run.id, sourceField: 'DOSYANO' },
        data: {
          state: 'IGNORE',
          destinationField: null,
          transform: null,
          isAutoSuggested: true,
          decidedByPlatformAdminId: null,
          decidedAt: null,
        },
      });
      const proposed = await prisma.migrationFieldMapping.findMany({
        where: { runId: run.id },
        orderBy: { sourceIndex: 'asc' },
      });
      const withoutDosyano = mappings.filter((m) => m.sourceField !== 'DOSYANO');

      const blockedSummary = await runDryRun({
        runId: run.id,
        organizationId: tenant.organizationId,
        clinicId: tenant.clinicId,
        sourceSystem: SOURCE_SYSTEM_DEFAULT,
        workbook,
        mappings: withoutDosyano,
        unresolvedReferenceValues: new Set(),
        legalBlockedFields: [],
        unresolvedMappingCount: 0,
        gateRecords: proposed,
      });

      assert.equal(blockedSummary.executable, false, 'a populated column nobody decided to drop must stop the run');
      assert.equal(blockedSummary.dataLossGate?.satisfied, false);
      assert.deepEqual(blockedSummary.dataLossGate?.unconfirmedExclusionFields, ['DOSYANO']);
      assert.ok(
        blockedSummary.blockers.some(
          (b) => b.code === 'MAPPING_EXCLUSION_NOT_CONFIRMED' && b.fieldName === 'DOSYANO',
        ),
        'the operator must be told WHICH column, not just that something is wrong',
      );
      // Execute refuses. It refuses on the BLOCKER count, which is reached
      // first — the gate having suppressed `executable` is what produced that
      // count, so this is the gate doing its job through the normal path.
      assert.throws(
        () => assertExecutable(blockedSummary),
        /blocker\(s\) remain/,
        'Execute itself must refuse',
      );

      // ...and the gate is ALSO an independent check, not just an input to
      // `executable`. A summary claiming to be clean while the gate says
      // otherwise is still refused, so a future change to the blocker wiring
      // cannot quietly reopen the hole.
      assert.throws(
        () => assertExecutable({ ...blockedSummary, blockers: [], executable: true }),
        /unaccounted for/,
        'an unsatisfied gate must refuse on its own, independently of `executable`',
      );

      // Now the operator opens the mapping screen and saves that column as
      // ignored — the stamp the PUT /mappings route applies.
      await prisma.migrationFieldMapping.updateMany({
        where: { runId: run.id, sourceField: 'DOSYANO' },
        data: {
          isAutoSuggested: false,
          decidedByPlatformAdminId: FIXTURE_OPERATOR_ID,
          decidedAt: new Date(),
        },
      });
      const confirmed = await prisma.migrationFieldMapping.findMany({
        where: { runId: run.id },
        orderBy: { sourceIndex: 'asc' },
      });

      const clearedSummary = await runDryRun({
        runId: run.id,
        organizationId: tenant.organizationId,
        clinicId: tenant.clinicId,
        sourceSystem: SOURCE_SYSTEM_DEFAULT,
        workbook,
        mappings: withoutDosyano,
        unresolvedReferenceValues: new Set(),
        legalBlockedFields: [],
        unresolvedMappingCount: 0,
        gateRecords: confirmed,
      });

      assert.equal(clearedSummary.dataLossGate?.satisfied, true);
      assert.equal(clearedSummary.dataLossGate?.operatorConfirmedExcluded, 1);
      assert.deepEqual(clearedSummary.dataLossGate?.unconfirmedExclusionFields, []);
      assert.equal(clearedSummary.executable, true, 'a confirmed exclusion clears the gate');
      assert.doesNotThrow(() => assertExecutable(clearedSummary));
    });

    await test('a dry-run summary persisted before the gate existed is NOT executable', () => {
      /*
       * `dryRunSummary` is a Json column read back from an earlier request. A
       * run that reached DRY_RUN_COMPLETE before this release carries
       * `executable: true` computed WITHOUT the data-loss gate. Trusting that
       * stale verdict would let precisely the runs this task exists to stop
       * walk through on the strength of an old answer to a different question.
       */
      const legacy = {
        blockers: [],
        executable: true,
      } as unknown as DryRunSummary;
      assert.throws(() => assertExecutable(legacy), /Run the dry run again/);
    });

    // ---------------------------------------------------------------------
    section('2. Execution is idempotent through provenance');

    await test('rerunning the same source creates patients once and MATCHES the second time', async () => {
      const tenant = await makeTenant('idem');
      const rows = syntheticRows(30, 2);

      const first = await prepareRun(tenant, rows);
      const r1 = await executeMigrationRun(
        executeInput(first.run, first.workbook, first.mappings),
      );
      assert.equal(r1.status, 'COMPLETED');
      assert.equal(r1.createdRows, 30);
      assert.equal(r1.matchedRows, 0);

      const afterFirst = await prisma.patient.count({
        where: { organizationId: tenant.organizationId },
      });
      assert.equal(afterFirst, 30);

      // A brand-new run over the identical source.
      const second = await prepareRun(tenant, rows);
      const r2 = await executeMigrationRun(
        executeInput(second.run, second.workbook, second.mappings),
      );
      assert.equal(r2.status, 'COMPLETED');
      assert.equal(r2.createdRows, 0, 'the rerun must create nothing');
      assert.equal(r2.matchedRows, 30, 'every row must match existing provenance');

      const afterSecond = await prisma.patient.count({
        where: { organizationId: tenant.organizationId },
      });
      assert.equal(afterSecond, 30, 'NO DUPLICATE PATIENTS');

      assert.equal(
        await prisma.migrationRecord.count({ where: { organizationId: tenant.organizationId } }),
        30,
        'provenance stays one row per source record',
      );
    });

    await test('shared phone numbers never merge two patients', async () => {
      const tenant = await makeTenant('phone');
      const rows = syntheticRows(4, 3);
      // A family sharing one phone — the product supports this and the
      // migration must not treat it as a duplicate.
      for (const row of rows) row.phone = '05320000001';

      const prep = await prepareRun(tenant, rows);
      const result = await executeMigrationRun(
        executeInput(prep.run, prep.workbook, prep.mappings),
      );
      assert.equal(result.createdRows, 4, 'four distinct patients share one phone');
      assert.equal(
        await prisma.patient.count({ where: { organizationId: tenant.organizationId } }),
        4,
      );
    });

    // ---------------------------------------------------------------------
    section('3. Tenant scoping — the same source id in two organizations');

    await test('identical HASTA_ID under two orgs yields two independent patients', async () => {
      const orgA = await makeTenant('tenantA');
      const orgB = await makeTenant('tenantB');
      const rows = syntheticRows(5, 4);

      const a = await prepareRun(orgA, rows);
      await executeMigrationRun(executeInput(a.run, a.workbook, a.mappings));

      const b = await prepareRun(orgB, rows);
      const rb = await executeMigrationRun(executeInput(b.run, b.workbook, b.mappings));

      assert.equal(rb.createdRows, 5, 'org B must create its own patients, not match org A');
      assert.equal(await prisma.patient.count({ where: { organizationId: orgA.organizationId } }), 5);
      assert.equal(await prisma.patient.count({ where: { organizationId: orgB.organizationId } }), 5);

      // The provenance unique key is tenant-scoped, so both rows coexist.
      const shared = await prisma.migrationRecord.findMany({
        where: { sourceId: rows[0]!.hastaId, sourceEntity: 'patient' },
        select: { organizationId: true },
      });
      assert.equal(shared.length, 2, 'the same vendor id must exist once per organization');
    });

    await test('the same TC under two orgs produces DIFFERENT lookup hashes', async () => {
      const orgA = createdOrgIds[createdOrgIds.length - 2]!;
      const orgB = createdOrgIds[createdOrgIds.length - 1]!;
      const tckn = synthTckn('123456789');
      const hashA = computeIdentityLookupHash(orgA, 'TCKN', tckn);
      const hashB = computeIdentityLookupHash(orgB, 'TCKN', tckn);
      assert.notEqual(hashA, hashB, 'the lookup token must be tenant-bound');
      assert.equal(computeIdentityLookupHash(orgA, 'TCKN', tckn), hashA, 'and stable within an org');
    });

    // ---------------------------------------------------------------------
    section('4. Identity quarantine — invalid values never become verified');

    await test('an invalid TC imports the patient but writes no identity row', async () => {
      const tenant = await makeTenant('ident');
      const rows = syntheticRows(3, 5);
      rows[0]!.tckn = '12345678901'; // checksum failure
      rows[1]!.tckn = ''; // absent
      // rows[2] keeps a valid synthetic value

      const prep = await prepareRun(tenant, rows);
      const result = await executeMigrationRun(
        executeInput(prep.run, prep.workbook, prep.mappings),
      );

      assert.equal(result.createdRows, 3, 'all three patients import');
      const identities = await prisma.patientIdentityDocument.count({
        where: { organizationId: tenant.organizationId },
      });
      assert.equal(identities, 1, 'only the checksum-valid value is persisted');

      const outcomes = await prisma.migrationRowOutcome.findMany({
        where: { runId: prep.run.id },
        orderBy: { sourceRowNumber: 'asc' },
        select: { identityClassification: true, identityWritten: true },
      });
      assert.equal(outcomes[0]!.identityClassification, 'INVALID_LEGACY');
      assert.equal(outcomes[0]!.identityWritten, false);
      assert.equal(outcomes[1]!.identityClassification, 'ABSENT');
      assert.equal(outcomes[2]!.identityClassification, 'VALID');
      assert.equal(outcomes[2]!.identityWritten, true);
    });

    await test('a duplicated source TC quarantines BOTH rows, never auto-merging', async () => {
      const tenant = await makeTenant('dupident');
      const rows = syntheticRows(2, 6);
      rows[1]!.tckn = rows[0]!.tckn;

      const prep = await prepareRun(tenant, rows);
      await executeMigrationRun(executeInput(prep.run, prep.workbook, prep.mappings));

      assert.equal(
        await prisma.patientIdentityDocument.count({
          where: { organizationId: tenant.organizationId },
        }),
        0,
        'neither duplicate may be written as a verified identity',
      );
      assert.equal(
        await prisma.patient.count({ where: { organizationId: tenant.organizationId } }),
        2,
        'both patients still import',
      );
    });

    // ---------------------------------------------------------------------
    section('5. Batching, failure containment and resume');

    // NOTE the batch size. clampBatchSize enforces a production FLOOR of 50, so
    // a test asking for 10 silently gets 50 and one batch. Exercising the real
    // batching path therefore means 120 rows at the smallest size production
    // will actually honour, not a size the product clamps away.
    await test('multiple batches are created and all succeed', async () => {
      const tenant = await makeTenant('batch');
      const rows = syntheticRows(120, 7);
      const prep = await prepareRun(tenant, rows, MIN_PRODUCTION_BATCH_SIZE);

      const result = await executeMigrationRun(
        executeInput(prep.run, prep.workbook, prep.mappings),
      );
      assert.equal(result.status, 'COMPLETED');

      const batches = await prisma.migrationRunBatch.findMany({
        where: { runId: prep.run.id },
        orderBy: { batchNumber: 'asc' },
      });
      assert.equal(batches.length, 3, '120 rows at batch size 50 is 3 batches');
      assert.ok(batches.every((b) => b.status === 'SUCCEEDED'));
      assert.equal(batches.reduce((a, b) => a + b.createdRows, 0), 120);
    });

    await test('a run that already committed batches is not re-done on resume', async () => {
      const tenant = await makeTenant('resume');
      const rows = syntheticRows(20, 8);
      const prep = await prepareRun(tenant, rows, 10);

      await executeMigrationRun(executeInput(prep.run, prep.workbook, prep.mappings));
      const afterFirst = await prisma.patient.count({
        where: { organizationId: tenant.organizationId },
      });
      assert.equal(afterFirst, 20);

      // Re-entering execution over a COMPLETED run must be refused by the lock
      // predicate rather than silently re-importing.
      await assert.rejects(
        () => executeMigrationRun(executeInput(prep.run, prep.workbook, prep.mappings)),
        (err: unknown) => err instanceof MigrationError,
        'a completed run must not be executable again',
      );
      assert.equal(
        await prisma.patient.count({ where: { organizationId: tenant.organizationId } }),
        20,
        'no duplication from the refused attempt',
      );
    });

    // ---------------------------------------------------------------------
    section('6. Concurrency — exactly one executor wins');

    await test('two simultaneous execute attempts: one runs, one is rejected', async () => {
      const tenant = await makeTenant('conc');
      const rows = syntheticRows(40, 9);
      const prep = await prepareRun(tenant, rows, 5);
      const input = executeInput(prep.run, prep.workbook, prep.mappings);

      const results = await Promise.allSettled([
        executeMigrationRun(input),
        executeMigrationRun(input),
      ]);

      const rejected = results.filter((r) => r.status === 'rejected');
      assert.equal(rejected.length, 1, 'exactly one attempt must be rejected');
      const reason = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(reason instanceof MigrationError);
      assert.equal((reason as MigrationError).code, 'EXECUTION_ALREADY_RUNNING');

      assert.equal(
        await prisma.patient.count({ where: { organizationId: tenant.organizationId } }),
        40,
        'the winning executor imported each row exactly once',
      );
    });

    // ---------------------------------------------------------------------
    section('7. Reconciliation balances against the database');

    await test('created + reused + skipped + failed + manualReview + blocked === eligible', async () => {
      const tenant = await makeTenant('recon');
      const rows = syntheticRows(15, 10);
      const prep = await prepareRun(tenant, rows, 5);

      const before = await prisma.patient.count({
        where: {
          organizationId: tenant.organizationId,
          deletedAt: null,
          patientStatus: { not: 'archived' },
        },
      });

      await executeMigrationRun(executeInput(prep.run, prep.workbook, prep.mappings));

      const report = await buildReconciliation({
        runId: prep.run.id,
        organizationId: tenant.organizationId,
        clinicId: tenant.clinicId,
        sourceSystem: SOURCE_SYSTEM_DEFAULT,
        destinationCountBefore: before,
        eligibleTotal: 15,
        sourceTotal: 15,
      });

      assert.equal(report.balanced, true, report.imbalanceDetail ?? 'reconciliation must balance');
      assert.equal(report.created, 15);
      assert.equal(report.provenanceResolves, true);
      assert.equal(report.tenantScopeClean, true, 'no row may land outside the target tenant');
      assert.equal(report.destinationCountDelta, 15);
      assert.equal(report.provenanceRows, 15);
    });

    // ---------------------------------------------------------------------
    section('8. Migration writes land ONLY in the target tenant');

    await test('every created patient carries the run\'s organizationId and clinicId', async () => {
      const tenant = await makeTenant('scope');
      const rows = syntheticRows(10, 11);
      const prep = await prepareRun(tenant, rows);
      await executeMigrationRun(executeInput(prep.run, prep.workbook, prep.mappings));

      const records = await prisma.migrationRecord.findMany({
        where: { createdByRunId: prep.run.id },
        select: { destinationId: true },
      });
      const outside = await prisma.patient.count({
        where: {
          id: { in: records.map((r) => r.destinationId) },
          NOT: { AND: [{ organizationId: tenant.organizationId }, { clinicId: tenant.clinicId }] },
        },
      });
      assert.equal(outside, 0, 'zero rows outside the target (organizationId, clinicId)');
    });

    // ═════════════════════════════════════════════════════════════════════
    // R1 — the three architecture blockers
    // ═════════════════════════════════════════════════════════════════════

    // ---------------------------------------------------------------------
    section("9. R1/BLOCKER-1 — primaryClinicId is the run's target clinic");

    await test('imported patients carry clinicId AND primaryClinicId = run.clinicId', async () => {
      const tenant = await makeTenant('primaryclinic');
      const prep = await prepareRun(tenant, syntheticRows(12, 21));
      await executeMigrationRun(executeInput(prep.run, prep.workbook, prep.mappings));

      const patients = await prisma.patient.findMany({
        where: { organizationId: tenant.organizationId },
        select: { id: true, clinicId: true, primaryClinicId: true },
      });
      assert.equal(patients.length, 12);
      for (const p of patients) {
        assert.equal(p.clinicId, tenant.clinicId, 'clinicId must be the run target');
        assert.equal(
          p.primaryClinicId,
          tenant.clinicId,
          'primaryClinicId must be the run target, not null',
        );
      }

      // The point of the fix: organization patient metrics filter on
      // primaryClinicId, so a null would make every imported patient invisible
      // there. Proved with the query those metrics actually run.
      const visibleToOrgMetrics = await prisma.patient.count({
        where: { primaryClinicId: tenant.clinicId, deletedAt: null },
      });
      assert.equal(visibleToOrgMetrics, 12, 'every imported patient must be visible to org metrics');
    });

    await test('a source branch column (SUBE_ID) cannot change clinicId or primaryClinicId', async () => {
      const tenant = await makeTenant('subeid');
      // A SIBLING clinic in the same organization. The workbook names it in a
      // branch column, which must be ignored entirely.
      const sibling = await prisma.clinic.create({
        data: {
          name: `Sibling-${randomUUID().slice(0, 8)}`,
          slug: `sib-${randomUUID().slice(0, 8)}`,
          organizationId: tenant.organizationId,
          maxPatients: 100000,
        },
      });

      const rows = syntheticRows(8, 22);
      const sheet: FixtureSheet = {
        name: 'Sayfa1',
        rows: [
          [...HEADERS, 'SUBE_ID'].map((h) => ({ v: h })),
          ...rows.map((r) => [
            { v: r.hastaId },
            { v: r.ad },
            { v: r.soyad },
            { v: r.phone },
            { v: r.tckn },
            { v: r.cinsiyet },
            { v: r.dosyano },
            { v: sibling.id },
          ]),
        ],
      };
      const workbook = await parseSourceWorkbook(buildBiff8Fixture([sheet]), 'xls');
      const profiles = profileColumns(workbook);
      const suggestions = suggestMappings(workbook.headers, profiles, {
        sourceSystem: SOURCE_SYSTEM_DEFAULT,
      });

      // No mapping the engine can produce may address a clinic-identity field.
      for (const s of suggestions) {
        assert.notEqual(s.destinationField, 'patient.clinicId');
        assert.notEqual(s.destinationField, 'patient.primaryClinicId');
      }

      const run = await prisma.migrationRun.create({
        data: {
          organizationId: tenant.organizationId,
          clinicId: tenant.clinicId,
          sourceSystem: SOURCE_SYSTEM_DEFAULT,
          status: 'READY',
          batchSize: 500,
          totalSourceRows: workbook.rows.length,
          headerColumnCount: workbook.headers.length,
        },
      });
      const mappings: ResolvedMapping[] = suggestions.map((s) => ({
        sourceField: s.sourceField,
        sourceIndex: s.sourceIndex,
        destinationField: s.destinationField,
        transform: s.transform,
        composeOrder: s.composeOrder,
        state: s.destinationField ? 'AUTO_CONFIDENT' : 'IGNORE',
      }));
      await executeMigrationRun(executeInput(run, workbook, mappings));

      const patients = await prisma.patient.findMany({
        where: { organizationId: tenant.organizationId },
        select: { clinicId: true, primaryClinicId: true },
      });
      assert.equal(patients.length, 8);
      for (const p of patients) {
        assert.equal(p.clinicId, tenant.clinicId);
        assert.equal(p.primaryClinicId, tenant.clinicId);
      }

      // Cross-clinic target mismatch is impossible: nothing landed in the
      // sibling branch the workbook named.
      assert.equal(
        await prisma.patient.count({
          where: {
            organizationId: tenant.organizationId,
            OR: [{ clinicId: sibling.id }, { primaryClinicId: sibling.id }],
          },
        }),
        0,
        'the source branch column must never redirect a row to a sibling clinic',
      );
    });

    // ---------------------------------------------------------------------
    section('10. R1/BLOCKER-2 — practitioner reference map is clinic-safe');

    await test("clinic A's mapping cannot be silently reused by clinic B", async () => {
      const tenant = await makeTenant('refmapa');
      const clinicB = await prisma.clinic.create({
        data: {
          name: `B-${randomUUID().slice(0, 8)}`,
          slug: `bb-${randomUUID().slice(0, 8)}`,
          organizationId: tenant.organizationId,
          maxPatients: 100000,
        },
      });
      const userA = await makePractitioner(tenant.organizationId, tenant.clinicId, 'a');
      const userB = await makePractitioner(tenant.organizationId, clinicB.id, 'b');

      const SOURCE_LABEL = 'Dr Ayse';

      // The SAME source label, approved in clinic A only.
      await prisma.migrationReferenceMap.create({
        data: {
          organizationId: tenant.organizationId,
          clinicId: tenant.clinicId,
          sourceSystem: SOURCE_SYSTEM_DEFAULT,
          entityType: 'practitioner',
          sourceValue: SOURCE_LABEL,
          destinationId: userA.id,
          status: 'MAPPED_APPROVED',
        },
      });

      // A clinic-B-scoped read must NOT see clinic A's approval.
      const seenByB = await prisma.migrationReferenceMap.findMany({
        where: {
          organizationId: tenant.organizationId,
          clinicId: clinicB.id,
          sourceSystem: SOURCE_SYSTEM_DEFAULT,
          entityType: 'practitioner',
        },
      });
      assert.equal(seenByB.length, 0, "clinic B must not inherit clinic A's mapping");

      // The same label may be mapped INDEPENDENTLY in the sibling clinic — the
      // unique key must permit it rather than collide.
      await prisma.migrationReferenceMap.create({
        data: {
          organizationId: tenant.organizationId,
          clinicId: clinicB.id,
          sourceSystem: SOURCE_SYSTEM_DEFAULT,
          entityType: 'practitioner',
          sourceValue: SOURCE_LABEL,
          destinationId: userB.id,
          status: 'MAPPED_APPROVED',
        },
      });

      const resolvedForA = await prisma.migrationReferenceMap.findFirst({
        where: { clinicId: tenant.clinicId, sourceValue: SOURCE_LABEL },
        select: { destinationId: true },
      });
      const resolvedForB = await prisma.migrationReferenceMap.findFirst({
        where: { clinicId: clinicB.id, sourceValue: SOURCE_LABEL },
        select: { destinationId: true },
      });
      assert.equal(resolvedForA?.destinationId, userA.id);
      assert.equal(resolvedForB?.destinationId, userB.id);
      assert.notEqual(
        resolvedForA?.destinationId,
        resolvedForB?.destinationId,
        'the same source label must be able to mean two different people',
      );
    });

    await test('the reference-map unique key still collides WITHIN one clinic', async () => {
      const tenant = await makeTenant('refmapdup');
      await prisma.migrationReferenceMap.create({
        data: {
          organizationId: tenant.organizationId,
          clinicId: tenant.clinicId,
          sourceSystem: SOURCE_SYSTEM_DEFAULT,
          entityType: 'practitioner',
          sourceValue: 'Dr Tek',
          status: 'UNMAPPED',
        },
      });
      await assert.rejects(
        () =>
          prisma.migrationReferenceMap.create({
            data: {
              organizationId: tenant.organizationId,
              clinicId: tenant.clinicId,
              sourceSystem: SOURCE_SYSTEM_DEFAULT,
              entityType: 'practitioner',
              sourceValue: 'Dr Tek',
              status: 'UNMAPPED',
            },
          }),
        'one source label may resolve only once per clinic',
      );
    });

    await test('practitioner eligibility is enforced for the TARGET clinic', async () => {
      const tenant = await makeTenant('practelig');
      const other = await prisma.clinic.create({
        data: {
          name: `Other-${randomUUID().slice(0, 8)}`,
          slug: `oth-${randomUUID().slice(0, 8)}`,
          organizationId: tenant.organizationId,
          maxPatients: 100000,
        },
      });

      const valid = await makePractitioner(tenant.organizationId, tenant.clinicId, 'ok');
      const otherClinicDentist = await makePractitioner(tenant.organizationId, other.id, 'other');
      const receptionist = await makeUser(
        tenant.organizationId,
        tenant.clinicId,
        'RECEPTIONIST',
        'rec',
      );
      const inactive = await makePractitioner(tenant.organizationId, tenant.clinicId, 'inactive');
      await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });

      // A valid practitioner for the target clinic succeeds.
      assert.ok(
        await findClinicPractitioner(valid.id, tenant.clinicId),
        'a dentist assigned to the target clinic must be accepted',
      );

      // A user without target-clinic access is rejected.
      assert.equal(
        await findClinicPractitioner(otherClinicDentist.id, tenant.clinicId),
        null,
        "a sibling clinic's dentist has no access to the target clinic",
      );

      // A non-practitioner is rejected even though they belong to the clinic.
      assert.equal(
        await findClinicPractitioner(receptionist.id, tenant.clinicId),
        null,
        'a receptionist is not a practitioner',
      );

      // A deactivated user is rejected.
      assert.equal(
        await findClinicPractitioner(inactive.id, tenant.clinicId),
        null,
        'a deactivated user is not selectable',
      );

      // The candidate LIST offered to the operator is exactly the eligible set.
      const candidates = await listClinicPractitioners(tenant.clinicId);
      const ids = candidates.map((c) => c.id);
      assert.ok(ids.includes(valid.id));
      assert.ok(!ids.includes(otherClinicDentist.id), 'no sibling-clinic user may be offered');
      assert.ok(!ids.includes(receptionist.id), 'no non-practitioner may be offered');
      assert.ok(!ids.includes(inactive.id), 'no deactivated user may be offered');
    });

    // ---------------------------------------------------------------------
    section('11. R1/BLOCKER-3 — retry leaves trustworthy progress counters');

    await test(
      'batch1 ok / batch2 infra-fails / batch3 ok, then batch2 retried: counters balance',
      async () => {
        const tenant = await makeTenant('retrycount');
        const rows = syntheticRows(150, 77);
        const prep = await prepareRun(tenant, rows, MIN_PRODUCTION_BATCH_SIZE);

        // A GENUINE infrastructure failure confined to batch 2. A database
        // trigger raises on one row in rows 51..100, aborting that batch's
        // transaction exactly as a real outage would — the batch rolls back
        // whole, writing no patients and no row-outcome ledger entries.
        const doomedFirstName = `Sentetik${77 * 1000 + 60}`;
        await prisma.$executeRawUnsafe(
          `CREATE OR REPLACE FUNCTION mig_test_fail_batch2() RETURNS trigger AS $fn$ ` +
            `BEGIN IF NEW."firstName" = '${doomedFirstName}' THEN ` +
            `RAISE EXCEPTION 'simulated infrastructure failure'; END IF; RETURN NEW; END; ` +
            `$fn$ LANGUAGE plpgsql;`,
        );
        await prisma.$executeRawUnsafe(
          `CREATE TRIGGER mig_test_fail_batch2_trg BEFORE INSERT ON "Patient" ` +
            `FOR EACH ROW EXECUTE FUNCTION mig_test_fail_batch2();`,
        );

        let firstPass;
        try {
          firstPass = await executeMigrationRun(
            executeInput(prep.run, prep.workbook, prep.mappings),
          );
        } finally {
          await prisma.$executeRawUnsafe(
            'DROP TRIGGER IF EXISTS mig_test_fail_batch2_trg ON "Patient";',
          );
          await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS mig_test_fail_batch2();');
        }

        assert.equal(firstPass.status, 'PARTIAL_FAILURE', 'batch 2 must fail the run');

        const batchesAfterFailure = await prisma.migrationRunBatch.findMany({
          where: { runId: prep.run.id },
          orderBy: { batchNumber: 'asc' },
        });
        assert.equal(batchesAfterFailure.length, 3);
        assert.deepEqual(
          batchesAfterFailure.map((b) => b.status),
          ['SUCCEEDED', 'FAILED', 'SUCCEEDED'],
          'batches 1 and 3 commit; only batch 2 fails',
        );

        // Batch 2 rolled back WHOLE: 100 patients, and no ledger rows for it.
        assert.equal(
          await prisma.patient.count({ where: { organizationId: tenant.organizationId } }),
          100,
          'a failed batch writes no patients',
        );
        assert.equal(
          await prisma.migrationRowOutcome.count({
            where: { runId: prep.run.id, batchNumber: 2 },
          }),
          0,
          'a rolled-back batch leaves no row-outcome ledger entries',
        );

        const failedRun = await prisma.migrationRun.findUniqueOrThrow({
          where: { id: prep.run.id },
        });
        assert.equal(failedRun.createdRows, 100, 'createdRows while batch 2 is failed');
        assert.equal(failedRun.failedRows, 50, "the rolled-back batch's rows are reported failed");
        assert.equal(failedRun.processedRows, 150, 'processedRows while batch 2 is failed');

        // ---- the retry ----
        assert.equal(await markFailedBatchesForRetry(prep.run.id), 1);
        const retried = await resumeMigrationRun(
          executeInput(prep.run, prep.workbook, prep.mappings),
        );
        assert.equal(retried.status, 'COMPLETED');

        // ---- THE CLAIM: no row is both a historical failure and a success ----
        const finalRun = await prisma.migrationRun.findUniqueOrThrow({
          where: { id: prep.run.id },
        });
        assert.equal(finalRun.processedRows, 150, 'processedRows');
        assert.equal(finalRun.createdRows, 150, 'createdRows');
        assert.equal(finalRun.matchedRows, 0, 'matchedRows');
        assert.equal(
          finalRun.failedRows,
          0,
          'the retried batch must NOT still be counted as historically failed',
        );
        assert.equal(finalRun.skippedRows, 0, 'skippedRows');
        assert.equal(
          finalRun.processedRows,
          finalRun.createdRows + finalRun.matchedRows + finalRun.skippedRows + finalRun.failedRows,
          'processed must equal the disjoint outcome buckets',
        );

        // warningRows is a projection of the ledger, not an accumulator.
        const ledgerWarningRows = (
          await prisma.migrationRowOutcome.findMany({
            where: { runId: prep.run.id },
            select: { warnings: true },
          })
        ).filter((o) => Array.isArray(o.warnings) && o.warnings.length > 0).length;
        assert.equal(finalRun.warningRows, ledgerWarningRows, 'warningRows');

        // Batch statuses and the durable ledger.
        const finalBatches = await prisma.migrationRunBatch.findMany({
          where: { runId: prep.run.id },
          orderBy: { batchNumber: 'asc' },
        });
        assert.deepEqual(
          finalBatches.map((b) => b.status),
          ['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED'],
          'every batch ends SUCCEEDED after the retry',
        );
        assert.equal(
          finalBatches.find((b) => b.batchNumber === 2)?.retryCount,
          1,
          'the retried batch records exactly one retry',
        );
        assert.equal(
          await prisma.migrationRowOutcome.count({ where: { runId: prep.run.id } }),
          150,
          'exactly one ledger row per source row — no duplicates from the retry',
        );
        assert.equal(
          await prisma.patient.count({ where: { organizationId: tenant.organizationId } }),
          150,
          'the retry creates the missing 50 and duplicates nothing',
        );

        // Reconciliation must balance against the database.
        const report = await buildReconciliation({
          runId: prep.run.id,
          organizationId: tenant.organizationId,
          clinicId: tenant.clinicId,
          sourceSystem: SOURCE_SYSTEM_DEFAULT,
          destinationCountBefore: 0,
          eligibleTotal: 150,
          sourceTotal: 150,
        });
        assert.equal(report.balanced, true, report.imbalanceDetail ?? 'reconciliation must balance');
        assert.equal(report.created, 150);
        assert.equal(report.failed, 0);
        assert.equal(report.provenanceResolves, true);
        assert.equal(report.tenantScopeClean, true);
        assert.equal(report.batchTotals.succeeded, 3);
        assert.equal(report.batchTotals.failed, 0);

        // The projection is idempotent: recomputing changes nothing.
        const recomputed = await recomputeRunCounters(prep.run.id);
        assert.equal(recomputed.processedRows, 150);
        assert.equal(recomputed.createdRows, 150);
        assert.equal(recomputed.failedRows, 0);
      },
    );

    // ---------------------------------------------------------------------
    section('12. R2/BLOCKER — the EXECUTION input is clinic-scoped');

    await test(
      "a run targeted to clinic B can never load or write clinic A's practitioner mapping",
      async () => {
        // Organization O with two branches. `makeTenant` gives us clinic A;
        // clinic B is its sibling under the SAME organization, which is the
        // only configuration in which the defect could fire.
        const tenant = await makeTenant('execrefscope');
        const clinicA = tenant.clinicId;
        const clinicB = await prisma.clinic.create({
          data: {
            name: `ExecB-${randomUUID().slice(0, 8)}`,
            slug: `execb-${randomUUID().slice(0, 8)}`,
            organizationId: tenant.organizationId,
            maxPatients: 100000,
          },
        });

        const dentistA = await makePractitioner(tenant.organizationId, clinicA, 'execa');
        const dentistB = await makePractitioner(tenant.organizationId, clinicB.id, 'execb');

        // The SAME source label, approved INDEPENDENTLY in both branches to two
        // different people. That is legitimate data, not corruption: “Dr Ayşe”
        // at branch A and “Dr Ayşe” at branch B are different clinicians, which
        // is exactly why execution must not resolve the label organization-wide.
        const SOURCE_LABEL = 'Dr Ayşe';
        // A second label that exists ONLY in clinic A. It is what makes the
        // assertions below order-independent: a Map keyed by sourceValue
        // collapses the duplicated label to one entry whichever row the
        // database happens to return last, but it cannot collapse two
        // DIFFERENT labels. An unscoped read therefore yields a map of size 2
        // no matter the row order, and `size === 1` becomes a real detector
        // rather than an accident of physical row ordering.
        const CLINIC_A_ONLY_LABEL = 'Dr Kemal';
        await prisma.migrationReferenceMap.createMany({
          data: [
            {
              organizationId: tenant.organizationId,
              clinicId: clinicB.id,
              sourceSystem: SOURCE_SYSTEM_DEFAULT,
              entityType: 'practitioner',
              sourceValue: SOURCE_LABEL,
              destinationId: dentistB.id,
              status: 'MAPPED_APPROVED',
            },
            {
              organizationId: tenant.organizationId,
              clinicId: clinicA,
              sourceSystem: SOURCE_SYSTEM_DEFAULT,
              entityType: 'practitioner',
              sourceValue: SOURCE_LABEL,
              destinationId: dentistA.id,
              status: 'MAPPED_APPROVED',
            },
            {
              organizationId: tenant.organizationId,
              clinicId: clinicA,
              sourceSystem: SOURCE_SYSTEM_DEFAULT,
              entityType: 'practitioner',
              sourceValue: CLINIC_A_ONLY_LABEL,
              destinationId: dentistA.id,
              status: 'MAPPED_APPROVED',
            },
          ],
        });

        // NEGATIVE CONTROL. The pre-fix query shape (organization + source
        // system + entity type, WITHOUT clinicId) really does return both
        // branches' rows, so the assertions below fail on the old code rather
        // than pass vacuously. Everything asserted here is order-independent:
        // the row order a seq scan returns is not a contract, and the earlier
        // version of this test passed against the DEFECT precisely because a
        // Map keyed by sourceValue silently kept whichever duplicate came last.
        const orgWideRows = await prisma.migrationReferenceMap.findMany({
          where: {
            organizationId: tenant.organizationId,
            sourceSystem: SOURCE_SYSTEM_DEFAULT,
            entityType: 'practitioner',
            status: { in: ['MAPPED_APPROVED', 'MAPPED_IGNORED'] },
          },
        });
        assert.equal(
          orgWideRows.length,
          3,
          'the unscoped query shape must be shown to return BOTH branches',
        );
        // The duplicated label really is ambiguous org-wide: two rows, two
        // different destinations. Which one an unscoped Map keeps is undefined,
        // which is exactly the defect — a patient attributed to whichever
        // clinician the database happened to return last.
        const orgWideForLabel = orgWideRows.filter((r) => r.sourceValue === SOURCE_LABEL);
        assert.equal(orgWideForLabel.length, 2);
        assert.equal(
          new Set(orgWideForLabel.map((r) => r.destinationId)).size,
          2,
          'the two branches must resolve the same label to two different people',
        );
        assert.equal(
          new Set(orgWideRows.map((r) => r.sourceValue)).size,
          2,
          'the unscoped shape would build a TWO-entry practitioner map, whatever the row order',
        );
        assert.ok(
          orgWideRows.some((r) => r.destinationId === dentistA.id),
          "the unscoped shape would put clinic A's dentist inside the execution map",
        );

        // A workbook whose practitioner column carries that label on every row.
        const rows = syntheticRows(6, 41);
        const sheet: FixtureSheet = {
          name: 'Sayfa1',
          rows: [
            [...HEADERS, 'HASTADOKTOR'].map((h) => ({ v: h })),
            ...rows.map((r) => [
              { v: r.hastaId },
              { v: r.ad },
              { v: r.soyad },
              { v: r.phone },
              { v: r.tckn },
              { v: r.cinsiyet },
              { v: r.dosyano },
              { v: SOURCE_LABEL },
            ]),
          ],
        };
        const buffer = buildBiff8Fixture([sheet]);
        const workbook = await parseSourceWorkbook(buffer, 'xls');
        const suggestions = suggestMappings(workbook.headers, profileColumns(workbook), {
          sourceSystem: SOURCE_SYSTEM_DEFAULT,
        });
        assert.ok(
          suggestions.some((s) => s.destinationField === 'patient.primaryPractitionerId'),
          'the fixture must actually exercise the practitioner reference path',
        );

        // The run TARGETS CLINIC B.
        const run = await prisma.migrationRun.create({
          data: {
            organizationId: tenant.organizationId,
            clinicId: clinicB.id,
            sourceSystem: SOURCE_SYSTEM_DEFAULT,
            status: 'READY',
            batchSize: 500,
            totalSourceRows: workbook.rows.length,
            headerColumnCount: workbook.headers.length,
            sourceFileFormat: 'xls',
            sheetIndex: 0,
          },
        });
        await prisma.migrationFieldMapping.createMany({
          data: suggestions.map((s) => ({
            runId: run.id,
            sourceField: s.sourceField,
            sourceIndex: s.sourceIndex,
            sourceNormalized: s.sourceField,
            destinationField: s.destinationField,
            transform: s.transform,
            composeOrder: s.composeOrder,
            state: s.destinationField ? 'AUTO_CONFIDENT' : 'IGNORE',
            confidence: 100,
            isAutoSuggested: true,
          })),
        });

        // The REAL execution input is built by the route helper reading the
        // REAL stored source file — not by this file's local `executeInput`
        // shim, which would prove nothing about the production query.
        const stored = await storeSourceFile(run.id, buffer);
        await prisma.migrationRun.update({
          where: { id: run.id },
          data: { sourceFileStoredPath: stored.storedPath },
        });

        try {
          const persisted = await prisma.migrationRun.findUniqueOrThrow({ where: { id: run.id } });
          const input = await buildExecuteInput(persisted, null);

          // ---- the execution INPUT is branch-isolated ---------------------
          assert.equal(input.clinicId, clinicB.id, 'the execution input must target clinic B');
          assert.equal(
            input.practitionerMap.size,
            1,
            "exactly ONE reference row may be loaded: clinic B's",
          );
          assert.deepEqual(
            [...input.practitionerMap.keys()],
            [SOURCE_LABEL],
            "clinic A's own label must not even appear as a key",
          );
          assert.equal(
            input.practitionerMap.get(SOURCE_LABEL),
            dentistB.id,
            "the source label must resolve to clinic B's dentist",
          );
          assert.ok(
            ![...input.practitionerMap.values()].includes(dentistA.id),
            "clinic A's dentist must be unreachable from the execution input",
          );

          // ---- and the WRITE PATH honours it ------------------------------
          const result = await executeMigrationRun(input);
          assert.equal(result.status, 'COMPLETED');
          assert.equal(result.createdRows, 6);
          assert.equal(result.failedRows, 0, 'no row may be blocked as an unresolved reference');

          const patients = await prisma.patient.findMany({
            where: { organizationId: tenant.organizationId },
            select: { clinicId: true, primaryClinicId: true, primaryPractitionerId: true },
          });
          assert.equal(patients.length, 6);
          for (const p of patients) {
            assert.equal(
              p.primaryPractitionerId,
              dentistB.id,
              "every imported patient must be attributed to clinic B's dentist",
            );
            assert.equal(p.clinicId, clinicB.id, 'clinicId must be the run target clinic B');
            assert.equal(
              p.primaryClinicId,
              clinicB.id,
              'primaryClinicId must be the run target clinic B',
            );
          }

          assert.equal(
            await prisma.patient.count({
              where: {
                organizationId: tenant.organizationId,
                primaryPractitionerId: dentistA.id,
              },
            }),
            0,
            "clinic A's dentist may never be selected by an execution targeted at clinic B",
          );
          assert.equal(
            await prisma.patient.count({
              where: {
                organizationId: tenant.organizationId,
                OR: [{ clinicId: clinicA }, { primaryClinicId: clinicA }],
              },
            }),
            0,
            'nothing may land in the sibling branch',
          );
        } finally {
          await deleteSourceFile(stored.storedPath).catch(() => undefined);
        }
      },
    );
  } finally {
    await cleanupTenants().catch((err) => {
      console.error('cleanup failed:', (err as Error).message);
    });
    await prisma.$disconnect();
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
  if (failed > 0) {
    console.error(`\n${failed} test başarısız oldu.`);
    process.exit(1);
  }
  console.log('\nTüm testler geçti.');
}

await main();
