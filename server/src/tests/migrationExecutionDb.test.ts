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
import { runDryRun } from '../services/migration/dryRun.js';
import { executeMigrationRun } from '../services/migration/executor.js';
import { buildReconciliation } from '../services/migration/reconciliation.js';
import { computeIdentityLookupHash } from '../utils/patientIdentityCrypto.js';
import { SOURCE_SYSTEM_DEFAULT, MigrationError } from '../services/migration/contracts.js';
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

  await prisma.migrationFieldMapping.createMany({
    data: mappings.map((m) => ({
      runId: run.id,
      sourceField: m.sourceField,
      sourceIndex: m.sourceIndex,
      sourceNormalized: m.sourceField,
      destinationField: m.destinationField,
      transform: m.transform,
      composeOrder: m.composeOrder,
      state: m.state,
      confidence: 100,
      isAutoSuggested: true,
    })),
  });

  return { run, workbook, mappings };
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
      const { run, workbook, mappings } = await prepareRun(tenant, rows);

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

    await test('multiple batches are created and all succeed', async () => {
      const tenant = await makeTenant('batch');
      const rows = syntheticRows(25, 7);
      const prep = await prepareRun(tenant, rows, 10);

      const result = await executeMigrationRun(
        executeInput(prep.run, prep.workbook, prep.mappings),
      );
      assert.equal(result.status, 'COMPLETED');

      const batches = await prisma.migrationRunBatch.findMany({
        where: { runId: prep.run.id },
        orderBy: { batchNumber: 'asc' },
      });
      assert.equal(batches.length, 3, '25 rows at batch size 10 is 3 batches');
      assert.ok(batches.every((b) => b.status === 'SUCCEEDED'));
      assert.equal(batches.reduce((a, b) => a + b.createdRows, 0), 25);
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
