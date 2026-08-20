/**
 * migrationR10WritePathDb.test.ts — F3-DATA-MIG-TODAY-001-R10
 *
 * DB-BACKED write-path proofs for the three things R10 added. Requires
 * DATABASE_URL to point at a DISPOSABLE Postgres — it creates and deletes real
 * rows. Registered under `server:test:disposable-db`, never under
 * `server:test:non-disposable`.
 *
 * R9 and earlier proved execution semantics (idempotency, batching, tenancy).
 * What is unproven until a real executor writes to a real database is that the
 * NEW destinations land in the NEW tables with the NEW columns:
 *
 *   1. DISTRICT IS A SEPARATE SCALAR. `patient.district` writes Patient.district
 *      and `patient.city` writes Patient.city, in the same run, without either
 *      overwriting the other. City is the province (il); district is the ilce.
 *
 *   2. SECONDARY PHONES ARE CHILD ROWS, NEVER THE PRIMARY. A home/work column
 *      produces a PatientContactPoint of that type, provenance-stamped
 *      'legacy_migration'. `Patient.phone` only ever carries the value of the
 *      column mapped to `patient.phone` — and stays NULL when there is none,
 *      even while secondaries are written. NO PatientEmergencyContact is ever
 *      fabricated: routing a patient's own second number into an emergency
 *      contact would invent a named third party and a legal decision-maker.
 *
 *   3. PRESERVATION IS INDEPENDENTLY MULTI-USED. N source columns mapped to
 *      `legacy.preservedSourceValue` produce N distinguishable
 *      MigrationPreservedSourceValue rows, each tagged with its own byte-exact
 *      `sourceColumn`, never merged or composed. Values are stored exactly as
 *      the parser projected them, and sensitivity FAILS CLOSED to RESTRICTED
 *      for anything the shared classifier does not positively call low-risk.
 *
 * Every fixture is SYNTHETIC. No real patient data, and no value from the
 * first-customer workbook, appears anywhere in this file. Vendor HEADER names
 * (EVTELEFONU, ISTELEFONU, ILCE, SUBEDOSYANO, ANNEADI, ACIKLAMA) are schema,
 * not data, and are used deliberately so the sensitivity classifier is
 * exercised on the header shapes it will actually meet.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../../db.js';
import { buildBiff8Fixture, type FixtureSheet } from '../helpers/biff8Fixture.js';
import { parseSourceWorkbook } from '../../services/migration/parser/canonicalParser.js';
import { executeMigrationRun } from '../../services/migration/executor.js';
import { classifyColumnSensitivity } from '../../services/migration/mapping/columnPreview.js';
import { SOURCE_SYSTEM_DEFAULT } from '../../services/migration/contracts.js';
import type { ResolvedMapping } from '../../services/migration/rowBuilder.js';

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
// Synthetic source workbook
// ---------------------------------------------------------------------------

const HEADERS = [
  'HASTA_ID',
  'ADI',
  'SOYADI',
  'CEPTELEFONU',
  'EVTELEFONU',
  'ISTELEFONU',
  'IL',
  'ILCE',
  'SUBEDOSYANO',
  'ANNEADI',
  'ACIKLAMA',
  'SERBESTALAN1',
] as const;

type Header = (typeof HEADERS)[number];
type SourceRow = Record<Header, string | null>;

const HEADER_INDEX: ReadonlyMap<Header, number> = new Map(
  HEADERS.map((header, index) => [header, index] as const),
);

function sourceRow(values: Partial<SourceRow>): SourceRow {
  const row = {} as SourceRow;
  for (const header of HEADERS) row[header] = values[header] ?? null;
  return row;
}

function buildWorkbookBuffer(rows: SourceRow[]): Buffer {
  const sheet: FixtureSheet = {
    name: 'Sayfa1',
    rows: [
      HEADERS.map((h) => ({ v: h as string })),
      ...rows.map((row) => HEADERS.map((h) => ({ v: row[h] }))),
    ],
  };
  return buildBiff8Fixture([sheet]);
}

// ---------------------------------------------------------------------------
// Mappings — hand-built, not engine-suggested
// ---------------------------------------------------------------------------

/**
 * These suites assert on the EXECUTOR, so the mapping is stated explicitly
 * rather than taken from the suggestion engine. If the engine's proposals
 * change, these proofs must not silently start testing a different mapping.
 */
type MappingSpec = Partial<Record<Header, readonly [destination: string, transform: string]>>;

const DEFAULT_SPEC: MappingSpec = {
  HASTA_ID: ['provenance.sourceId', 'provenance_source_id'],
  ADI: ['patient.firstName', 'trim'],
  SOYADI: ['patient.lastName', 'trim'],
  CEPTELEFONU: ['patient.phone', 'phone_tr'],
  EVTELEFONU: ['patient.contactPoint.home', 'phone_tr'],
  ISTELEFONU: ['patient.contactPoint.work', 'phone_tr'],
  IL: ['patient.city', 'trim'],
  ILCE: ['patient.district', 'trim'],
  SUBEDOSYANO: ['legacy.preservedSourceValue', 'preserve_source_value'],
  ANNEADI: ['legacy.preservedSourceValue', 'preserve_source_value'],
  ACIKLAMA: ['legacy.preservedSourceValue', 'preserve_source_value'],
  SERBESTALAN1: ['legacy.preservedSourceValue', 'preserve_source_value'],
};

function buildMappings(spec: MappingSpec = DEFAULT_SPEC): ResolvedMapping[] {
  return HEADERS.map((header, index) => {
    const entry = spec[header];
    return entry
      ? {
          sourceField: header,
          sourceIndex: index,
          destinationField: entry[0],
          transform: entry[1],
          composeOrder: null,
          state: 'AUTO_CONFIDENT',
        }
      : {
          sourceField: header,
          sourceIndex: index,
          destinationField: null,
          transform: null,
          composeOrder: null,
          state: 'IGNORE',
        };
  });
}

/** The mapping spec minus one column, for "this destination is not mapped at all". */
function specWithout(...omitted: Header[]): MappingSpec {
  const next: MappingSpec = { ...DEFAULT_SPEC };
  for (const header of omitted) delete next[header];
  return next;
}

// ---------------------------------------------------------------------------
// Tenant fixtures
// ---------------------------------------------------------------------------

const createdOrgIds: string[] = [];

async function makeTenant(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const plan = await prisma.plan.create({
    data: {
      name: `r10-test-${label}-${suffix}`,
      displayName: `R10 Test ${label}`,
      maxUsers: 100,
      maxPatients: 100000,
      monthlyPrice: 0,
      features: {},
    },
  });
  const organization = await prisma.organization.create({
    data: { name: `R10Org-${label}-${suffix}`, slug: `r10-${label}-${suffix}`, planId: plan.id },
  });
  const clinic = await prisma.clinic.create({
    data: {
      name: `R10Clinic-${label}-${suffix}`,
      slug: `r10c-${label}-${suffix}`,
      organizationId: organization.id,
      maxPatients: 100000,
    },
  });
  createdOrgIds.push(organization.id);
  return { organizationId: organization.id, clinicId: clinic.id };
}

async function makeSiblingClinic(organizationId: string, label: string) {
  const suffix = randomUUID().slice(0, 8);
  const clinic = await prisma.clinic.create({
    data: {
      name: `R10Clinic-${label}-${suffix}`,
      slug: `r10c-${label}-${suffix}`,
      organizationId,
      maxPatients: 100000,
    },
  });
  return clinic.id;
}

async function cleanupTenants() {
  for (const organizationId of createdOrgIds) {
    // Order matters: children before parents.
    await prisma.migrationPreservedSourceValue.deleteMany({ where: { organizationId } });
    await prisma.patientContactPoint.deleteMany({ where: { organizationId } });
    await prisma.patientEmergencyContact.deleteMany({ where: { organizationId } });
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
// Run construction + execution
// ---------------------------------------------------------------------------

interface PreparedRun {
  run: { id: string; organizationId: string; clinicId: string; batchSize: number };
  workbook: Awaited<ReturnType<typeof parseSourceWorkbook>>;
  mappings: ResolvedMapping[];
}

async function prepareRun(
  tenant: { organizationId: string; clinicId: string },
  rows: SourceRow[],
  spec: MappingSpec = DEFAULT_SPEC,
): Promise<PreparedRun> {
  const workbook = await parseSourceWorkbook(buildWorkbookBuffer(rows), 'xls');
  const run = await prisma.migrationRun.create({
    data: {
      organizationId: tenant.organizationId,
      clinicId: tenant.clinicId,
      sourceSystem: SOURCE_SYSTEM_DEFAULT,
      status: 'READY',
      batchSize: 50,
      totalSourceRows: workbook.rows.length,
      headerColumnCount: workbook.headers.length,
    },
  });
  return { run, workbook, mappings: buildMappings(spec) };
}

function executeInput(prepared: PreparedRun) {
  return {
    runId: prepared.run.id,
    organizationId: prepared.run.organizationId,
    clinicId: prepared.run.clinicId,
    sourceSystem: SOURCE_SYSTEM_DEFAULT,
    batchSize: prepared.run.batchSize,
    workbook: prepared.workbook,
    mappings: prepared.mappings,
    practitionerMap: new Map<string, string | null>(),
    actorPlatformAdminId: null,
  };
}

/** Prepare + execute in one step, asserting the run completed cleanly. */
async function runFixture(
  tenant: { organizationId: string; clinicId: string },
  rows: SourceRow[],
  spec: MappingSpec = DEFAULT_SPEC,
) {
  const prepared = await prepareRun(tenant, rows, spec);
  const result = await executeMigrationRun(executeInput(prepared));
  assert.equal(result.status, 'COMPLETED', 'fixture run must complete');
  assert.equal(result.failedRows, 0, 'fixture run must have no failed rows');
  return { ...prepared, result };
}

/** The parser's projection of one source cell — the byte-exact input to a transform. */
function projectedCell(
  workbook: Awaited<ReturnType<typeof parseSourceWorkbook>>,
  rowOffset: number,
  header: Header,
): string {
  const index = HEADER_INDEX.get(header)!;
  return workbook.rows[rowOffset]!.cells[index]?.text ?? '';
}

async function patientBySourceId(organizationId: string, sourceId: string) {
  const record = await prisma.migrationRecord.findFirst({
    where: { organizationId, sourceSystem: SOURCE_SYSTEM_DEFAULT, sourceEntity: 'patient', sourceId },
    select: { destinationId: true },
  });
  assert.ok(record?.destinationId, `no provenance record for source id ${sourceId}`);
  const patient = await prisma.patient.findUnique({ where: { id: record.destinationId } });
  assert.ok(patient, `no patient for source id ${sourceId}`);
  return patient;
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
    // =====================================================================
    section('1. Patient.district — a separate address scalar, not a city variant');

    await test('a column mapped to patient.district writes Patient.district', async () => {
      const tenant = await makeTenant('district');
      const { organizationId } = tenant;
      await runFixture(tenant, [
        sourceRow({ HASTA_ID: 'R10-D-1', ADI: 'Sentetik', SOYADI: 'Ilce', IL: 'Anadolu', ILCE: 'Merkez' }),
      ]);

      const patient = await patientBySourceId(organizationId, 'R10-D-1');
      assert.equal(patient.district, 'Merkez', 'the ILCE column must land on Patient.district');
    });

    await test('city and district are written independently and never overwrite each other', async () => {
      const tenant = await makeTenant('district-pair');
      const { organizationId } = tenant;
      await runFixture(tenant, [
        sourceRow({
          HASTA_ID: 'R10-D-2',
          ADI: 'Sentetik',
          SOYADI: 'Adres',
          IL: 'SentetikIl',
          ILCE: 'SentetikIlce',
        }),
        sourceRow({
          HASTA_ID: 'R10-D-3',
          ADI: 'Sentetik',
          SOYADI: 'Adres',
          IL: 'IkinciIl',
          ILCE: 'IkinciIlce',
        }),
      ]);

      const first = await patientBySourceId(organizationId, 'R10-D-2');
      const second = await patientBySourceId(organizationId, 'R10-D-3');

      assert.equal(first.city, 'SentetikIl', 'the IL column must land on Patient.city');
      assert.equal(first.district, 'SentetikIlce', 'the ILCE column must land on Patient.district');
      assert.notEqual(first.city, first.district, 'the two administrative levels must stay distinct');
      assert.equal(second.city, 'IkinciIl');
      assert.equal(second.district, 'IkinciIlce');

      assert.equal(
        await prisma.patient.count({ where: { organizationId, city: { in: ['SentetikIlce', 'IkinciIlce'] } } }),
        0,
        'a district value must never end up in city',
      );
      assert.equal(
        await prisma.patient.count({ where: { organizationId, district: { in: ['SentetikIl', 'IkinciIl'] } } }),
        0,
        'a city value must never end up in district',
      );
    });

    await test('an empty ILCE cell leaves Patient.district null while city still lands', async () => {
      const tenant = await makeTenant('district-empty');
      const { organizationId } = tenant;
      await runFixture(tenant, [
        sourceRow({ HASTA_ID: 'R10-D-4', ADI: 'Sentetik', SOYADI: 'Bos', IL: 'YalnizIl', ILCE: null }),
      ]);

      const patient = await patientBySourceId(organizationId, 'R10-D-4');
      assert.equal(patient.district, null, 'an absent district is null, never an empty string');
      assert.equal(patient.city, 'YalnizIl', 'the sibling scalar is unaffected');
    });

    // =====================================================================
    section('2. PatientContactPoint — secondary phones as child rows');

    await test('home and work columns each produce exactly one contact point of the right type', async () => {
      const tenant = await makeTenant('cp-types');
      const { organizationId, clinicId } = tenant;
      await runFixture(tenant, [
        sourceRow({
          HASTA_ID: 'R10-C-1',
          ADI: 'Sentetik',
          SOYADI: 'Telefon',
          CEPTELEFONU: '05320000001',
          EVTELEFONU: '02120000002',
          ISTELEFONU: '02160000003',
        }),
      ]);

      const patient = await patientBySourceId(organizationId, 'R10-C-1');
      const points = await prisma.patientContactPoint.findMany({
        where: { patientId: patient.id },
        orderBy: { contactType: 'asc' },
      });

      assert.equal(points.length, 2, 'exactly two secondary contact points, one per mapped column');
      assert.deepEqual(
        points.map((p) => p.contactType),
        ['home', 'work'],
        'contactType is derived from the destination key, not guessed',
      );

      const home = points.find((p) => p.contactType === 'home')!;
      const work = points.find((p) => p.contactType === 'work')!;
      assert.equal(home.value, '+902120000002', 'the home column value, phone_tr-normalized');
      assert.equal(work.value, '+902160000003', 'the work column value, phone_tr-normalized');

      for (const point of points) {
        assert.equal(point.clinicId, clinicId, 'every contact point carries the run clinic');
        assert.equal(point.organizationId, organizationId, 'every contact point carries the run organization');
      }
    });

    await test("source is 'legacy_migration', never the 'staff' schema default", async () => {
      const tenant = await makeTenant('cp-source');
      const { organizationId } = tenant;
      await runFixture(tenant, [
        sourceRow({
          HASTA_ID: 'R10-C-2',
          ADI: 'Sentetik',
          SOYADI: 'Kaynak',
          EVTELEFONU: '02120000004',
          ISTELEFONU: '02160000005',
        }),
      ]);

      const patient = await patientBySourceId(organizationId, 'R10-C-2');
      const points = await prisma.patientContactPoint.findMany({ where: { patientId: patient.id } });
      assert.equal(points.length, 2);
      for (const point of points) {
        assert.equal(
          point.source,
          'legacy_migration',
          'an imported number must never claim to be staff-entered',
        );
      }
      assert.equal(
        await prisma.patientContactPoint.count({ where: { organizationId, source: 'staff' } }),
        0,
        'no migrated contact point may carry the staff default',
      );
    });

    await test('normalizedValue is a digits-only projection of value', async () => {
      const tenant = await makeTenant('cp-normalized');
      const { organizationId } = tenant;
      await runFixture(tenant, [
        sourceRow({
          HASTA_ID: 'R10-C-3',
          ADI: 'Sentetik',
          SOYADI: 'Normal',
          EVTELEFONU: '0212 000 00 06',
        }),
      ]);

      const patient = await patientBySourceId(organizationId, 'R10-C-3');
      const point = await prisma.patientContactPoint.findFirstOrThrow({ where: { patientId: patient.id } });
      assert.equal(point.value, '+902120000006');
      assert.equal(point.normalizedValue, '902120000006');
      assert.match(point.normalizedValue!, /^\d+$/, 'normalizedValue holds digits and nothing else');
      assert.equal(
        point.normalizedValue,
        point.value.replace(/\D/g, ''),
        'normalizedValue is exactly the digits of value',
      );
    });

    await test(
      'THE CRITICAL INVARIANT: Patient.phone is the primary column value and never a secondary one',
      async () => {
        const tenant = await makeTenant('cp-primary');
        const { organizationId } = tenant;
        const { workbook } = await runFixture(tenant, [
          sourceRow({
            HASTA_ID: 'R10-C-4',
            ADI: 'Sentetik',
            SOYADI: 'Birincil',
            CEPTELEFONU: '05320000007',
            EVTELEFONU: '02120000008',
            ISTELEFONU: '02160000009',
          }),
        ]);

        const patient = await patientBySourceId(organizationId, 'R10-C-4');

        // Derived from the PRIMARY source cell, not from a literal typed twice:
        // if the executor ever sourced Patient.phone from a secondary column,
        // this expectation would still be built from CEPTELEFONU and would fail.
        const primaryDigits = projectedCell(workbook, 0, 'CEPTELEFONU').replace(/\D/g, '');
        assert.equal(
          patient.phone,
          `+90${primaryDigits.replace(/^0/, '')}`,
          'Patient.phone must be exactly the value of the column mapped to patient.phone',
        );

        const secondaryValues = (
          await prisma.patientContactPoint.findMany({
            where: { patientId: patient.id },
            select: { value: true, normalizedValue: true },
          })
        ).flatMap((p) => [p.value, p.normalizedValue]);
        assert.equal(secondaryValues.length, 4, 'both secondaries were written');
        assert.ok(
          !secondaryValues.includes(patient.phone),
          'Patient.phone must never hold a secondary contact-point value',
        );

        for (const header of ['EVTELEFONU', 'ISTELEFONU'] as const) {
          const digits = projectedCell(workbook, 0, header).replace(/\D/g, '');
          assert.notEqual(
            patient.phone,
            `+90${digits.replace(/^0/, '')}`,
            `Patient.phone must not be derived from ${header}`,
          );
        }
      },
    );

    await test(
      'an empty primary cell leaves Patient.phone null even though secondaries are written',
      async () => {
        const tenant = await makeTenant('cp-empty-primary');
        const { organizationId } = tenant;
        await runFixture(tenant, [
          sourceRow({
            HASTA_ID: 'R10-C-5',
            ADI: 'Sentetik',
            SOYADI: 'BosBirincil',
            CEPTELEFONU: null,
            EVTELEFONU: '02120000010',
            ISTELEFONU: '02160000011',
          }),
        ]);

        const patient = await patientBySourceId(organizationId, 'R10-C-5');
        assert.equal(
          patient.phone,
          null,
          'a missing primary number is NULL — a secondary must never be promoted to fill it',
        );
        assert.equal(
          await prisma.patientContactPoint.count({ where: { patientId: patient.id } }),
          2,
          'the secondaries were still written',
        );
      },
    );

    await test(
      'a run with NO patient.phone mapping at all leaves Patient.phone null for every row',
      async () => {
        const tenant = await makeTenant('cp-no-primary-mapping');
        const { organizationId } = tenant;
        await runFixture(
          tenant,
          [
            sourceRow({
              HASTA_ID: 'R10-C-6',
              ADI: 'Sentetik',
              SOYADI: 'Haritasiz',
              CEPTELEFONU: '05320000012',
              EVTELEFONU: '02120000013',
            }),
          ],
          specWithout('CEPTELEFONU'),
        );

        const patient = await patientBySourceId(organizationId, 'R10-C-6');
        assert.equal(
          patient.phone,
          null,
          'with no column mapped to patient.phone the primary stays null, secondaries notwithstanding',
        );
        const points = await prisma.patientContactPoint.findMany({ where: { patientId: patient.id } });
        assert.equal(points.length, 1);
        assert.equal(points[0]!.contactType, 'home');
        assert.equal(
          await prisma.patient.count({ where: { organizationId, phone: { not: null } } }),
          0,
          'no patient in this run may carry any phone at all',
        );
      },
    );

    await test('an empty secondary cell produces NO contact point row', async () => {
      const tenant = await makeTenant('cp-empty-secondary');
      const { organizationId } = tenant;
      await runFixture(tenant, [
        sourceRow({
          HASTA_ID: 'R10-C-7',
          ADI: 'Sentetik',
          SOYADI: 'Yok',
          CEPTELEFONU: '05320000014',
          EVTELEFONU: null,
          ISTELEFONU: null,
        }),
        sourceRow({
          HASTA_ID: 'R10-C-8',
          ADI: 'Sentetik',
          SOYADI: 'Yarim',
          CEPTELEFONU: '05320000015',
          EVTELEFONU: '02120000016',
          ISTELEFONU: null,
        }),
      ]);

      const noSecondaries = await patientBySourceId(organizationId, 'R10-C-7');
      const oneSecondary = await patientBySourceId(organizationId, 'R10-C-8');

      assert.equal(
        await prisma.patientContactPoint.count({ where: { patientId: noSecondaries.id } }),
        0,
        'absence is not a phone number — no empty-valued row may be written',
      );
      const written = await prisma.patientContactPoint.findMany({ where: { patientId: oneSecondary.id } });
      assert.equal(written.length, 1, 'only the populated column produces a row');
      assert.equal(written[0]!.contactType, 'home');
      assert.equal(
        await prisma.patientContactPoint.count({ where: { organizationId, value: '' } }),
        0,
        'no contact point may carry an empty value',
      );
    });

    await test('NO PatientEmergencyContact row is created by any part of the R10 write path', async () => {
      const tenant = await makeTenant('cp-no-emergency');
      const { organizationId, clinicId } = tenant;
      const before = await prisma.patientEmergencyContact.count({ where: { organizationId } });
      assert.equal(before, 0, 'fixture precondition: the tenant starts with no emergency contacts');

      await runFixture(tenant, [
        sourceRow({
          HASTA_ID: 'R10-C-9',
          ADI: 'Sentetik',
          SOYADI: 'Acil',
          CEPTELEFONU: '05320000017',
          EVTELEFONU: '02120000018',
          ISTELEFONU: '02160000019',
          ANNEADI: 'SentetikAnne',
        }),
      ]);

      assert.equal(
        await prisma.patientEmergencyContact.count({ where: { organizationId } }),
        0,
        'a secondary number must never be turned into a named third-party emergency contact',
      );
      assert.equal(
        await prisma.patientEmergencyContact.count({ where: { clinicId } }),
        0,
        'and none may appear scoped to the run clinic either',
      );
      // The run really did write the secondaries it was supposed to — otherwise
      // the assertion above would pass vacuously.
      assert.equal(
        await prisma.patientContactPoint.count({ where: { organizationId } }),
        2,
        'guard against a vacuous pass: the secondaries were in fact written',
      );
    });

    // =====================================================================
    section('3. MigrationPreservedSourceValue — controlled legacy preservation');

    await test(
      'two different columns mapped to legacy.preservedSourceValue produce TWO separate rows',
      async () => {
        const tenant = await makeTenant('pres-multi');
        const { organizationId } = tenant;
        const { run } = await runFixture(tenant, [
          sourceRow({
            HASTA_ID: 'R10-P-1',
            ADI: 'Sentetik',
            SOYADI: 'Koruma',
            SUBEDOSYANO: 'SB-0001',
            ANNEADI: 'SentetikAnne',
          }),
        ]);

        const patient = await patientBySourceId(organizationId, 'R10-P-1');
        const preserved = await prisma.migrationPreservedSourceValue.findMany({
          where: { patientId: patient.id },
          orderBy: { sourceColumn: 'asc' },
        });

        assert.equal(preserved.length, 2, 'each accepted column keeps its own row — never merged');
        assert.deepEqual(
          preserved.map((p) => p.sourceColumn),
          ['ANNEADI', 'SUBEDOSYANO'],
          'each row is tagged with its own byte-exact vendor column name',
        );
        assert.deepEqual(
          preserved.map((p) => p.value),
          ['SentetikAnne', 'SB-0001'],
          'each row keeps its own column value — never composed into one string',
        );
        for (const row of preserved) {
          assert.ok(
            !row.value.includes('SentetikAnne') || !row.value.includes('SB-0001'),
            'no preserved row may contain both columns composed together',
          );
          assert.equal(row.migrationRunId, run.id, 'each row names the run that wrote it');
          assert.equal(row.sourceSystem, SOURCE_SYSTEM_DEFAULT, 'each row names the vendor system');
          assert.equal(row.valueType, 'string');
          assert.equal(row.semanticClass, 'LEGACY_NO_CANONICAL_DESTINATION');
          assert.ok(row.importedAt instanceof Date, 'importedAt is stamped');
        }
      },
    );

    await test('sourceRowNumber is populated and matches the source workbook row', async () => {
      const tenant = await makeTenant('pres-rownum');
      const { organizationId } = tenant;
      const { workbook } = await runFixture(tenant, [
        sourceRow({ HASTA_ID: 'R10-P-2', ADI: 'Sentetik', SOYADI: 'Satir', SUBEDOSYANO: 'SB-0002' }),
        sourceRow({ HASTA_ID: 'R10-P-3', ADI: 'Sentetik', SOYADI: 'Satir', SUBEDOSYANO: 'SB-0003' }),
      ]);

      const first = await patientBySourceId(organizationId, 'R10-P-2');
      const second = await patientBySourceId(organizationId, 'R10-P-3');
      const firstRow = await prisma.migrationPreservedSourceValue.findFirstOrThrow({
        where: { patientId: first.id },
      });
      const secondRow = await prisma.migrationPreservedSourceValue.findFirstOrThrow({
        where: { patientId: second.id },
      });

      assert.equal(firstRow.sourceRowNumber, workbook.rows[0]!.rowNumber);
      assert.equal(secondRow.sourceRowNumber, workbook.rows[1]!.rowNumber);
      assert.notEqual(
        firstRow.sourceRowNumber,
        secondRow.sourceRowNumber,
        'two source rows must be distinguishable by their preserved provenance',
      );
      assert.ok(
        typeof firstRow.sourceRowNumber === 'number' && firstRow.sourceRowNumber > 0,
        'sourceRowNumber is a populated 1-based row number, never null',
      );
    });

    await test('the preserved value is stored VERBATIM as the parser projected it', async () => {
      const tenant = await makeTenant('pres-verbatim');
      const { organizationId } = tenant;
      // Mixed case, an internal double space and punctuation: none of it may be
      // folded, collapsed or reformatted by preserve_source_value.
      const rawValue = '  sB-Ref  0042 / kAyIt-X  ';
      const { workbook } = await runFixture(tenant, [
        sourceRow({ HASTA_ID: 'R10-P-4', ADI: 'Sentetik', SOYADI: 'Aynen', SUBEDOSYANO: rawValue }),
      ]);

      const patient = await patientBySourceId(organizationId, 'R10-P-4');
      const row = await prisma.migrationPreservedSourceValue.findFirstOrThrow({
        where: { patientId: patient.id, sourceColumn: 'SUBEDOSYANO' },
      });

      const projected = projectedCell(workbook, 0, 'SUBEDOSYANO');
      assert.equal(
        row.value,
        projected,
        'the stored value must be exactly what the parser projected for that cell',
      );
      assert.equal(row.value, 'sB-Ref  0042 / kAyIt-X', 'pinned: the projected cell text');
      assert.notEqual(row.value, row.value.toUpperCase(), 'case must not be folded up');
      assert.notEqual(row.value, row.value.toLowerCase(), 'case must not be folded down');
      assert.ok(row.value.includes('  0042'), 'internal whitespace must not be collapsed');
    });

    await test('an empty source cell produces NO preserved row', async () => {
      const tenant = await makeTenant('pres-empty');
      const { organizationId } = tenant;
      const { run } = await runFixture(tenant, [
        sourceRow({
          HASTA_ID: 'R10-P-5',
          ADI: 'Sentetik',
          SOYADI: 'Bos',
          SUBEDOSYANO: 'SB-0005',
          ANNEADI: null,
          ACIKLAMA: null,
          SERBESTALAN1: null,
        }),
      ]);

      const patient = await patientBySourceId(organizationId, 'R10-P-5');
      const preserved = await prisma.migrationPreservedSourceValue.findMany({
        where: { patientId: patient.id },
      });
      assert.equal(preserved.length, 1, 'only the populated column preserves anything');
      assert.equal(preserved[0]!.sourceColumn, 'SUBEDOSYANO');
      assert.equal(
        await prisma.migrationPreservedSourceValue.count({ where: { migrationRunId: run.id, value: '' } }),
        0,
        'an absent value is not evidence that the old system held one',
      );
    });

    await test(
      'sensitivity FAILS CLOSED: a freetext-shaped header and an over-long value are RESTRICTED',
      async () => {
        const tenant = await makeTenant('pres-sensitivity');
        const { organizationId } = tenant;
        const longValue = `LEGACY-${'X'.repeat(90)}`;
        await runFixture(tenant, [
          sourceRow({
            HASTA_ID: 'R10-P-6',
            ADI: 'Sentetik',
            SOYADI: 'Hassasiyet',
            SUBEDOSYANO: 'SB-0006',
            ACIKLAMA: 'sentetik serbest metin',
            SERBESTALAN1: longValue,
          }),
        ]);

        const patient = await patientBySourceId(organizationId, 'R10-P-6');
        const bySourceColumn = new Map(
          (
            await prisma.migrationPreservedSourceValue.findMany({ where: { patientId: patient.id } })
          ).map((row) => [row.sourceColumn, row]),
        );
        assert.equal(bySourceColumn.size, 3, 'all three columns preserved a value');

        const neutral = bySourceColumn.get('SUBEDOSYANO')!;
        const freetextHeader = bySourceColumn.get('ACIKLAMA')!;
        const longCell = bySourceColumn.get('SERBESTALAN1')!;

        assert.equal(
          neutral.sensitivity,
          'NORMAL',
          'only a column the shared classifier positively calls low-risk is released to bulk export',
        );
        assert.equal(
          freetextHeader.sensitivity,
          'RESTRICTED',
          'a freetext-shaped header (ACIKLAMA) must fail closed',
        );
        assert.equal(
          longCell.sensitivity,
          'RESTRICTED',
          'a value long enough to read as free text must fail closed',
        );

        // Tie the expectations to the SHARED classifier rather than a private
        // keyword list, so the two cannot drift apart unnoticed.
        assert.equal(
          classifyColumnSensitivity('SUBEDOSYANO', undefined, neutral.value.length),
          'low',
          "the shared classifier is why SUBEDOSYANO is NORMAL",
        );
        assert.notEqual(
          classifyColumnSensitivity('ACIKLAMA', undefined, freetextHeader.value.length),
          'low',
          'the shared classifier is why ACIKLAMA is RESTRICTED',
        );
        assert.notEqual(
          classifyColumnSensitivity('SERBESTALAN1', undefined, longCell.value.length),
          'low',
          'the shared classifier is why the long value is RESTRICTED',
        );
      },
    );

    await test(
      'the same column can be NORMAL on one row and RESTRICTED on another — sensitivity is per value',
      async () => {
        const tenant = await makeTenant('pres-per-value');
        const { organizationId } = tenant;
        await runFixture(tenant, [
          sourceRow({ HASTA_ID: 'R10-P-7', ADI: 'Sentetik', SOYADI: 'Kisa', SERBESTALAN1: 'K-12' }),
          sourceRow({
            HASTA_ID: 'R10-P-8',
            ADI: 'Sentetik',
            SOYADI: 'Uzun',
            SERBESTALAN1: `LEGACY-${'Y'.repeat(90)}`,
          }),
        ]);

        const shortPatient = await patientBySourceId(organizationId, 'R10-P-7');
        const longPatient = await patientBySourceId(organizationId, 'R10-P-8');
        const shortRow = await prisma.migrationPreservedSourceValue.findFirstOrThrow({
          where: { patientId: shortPatient.id, sourceColumn: 'SERBESTALAN1' },
        });
        const longRow = await prisma.migrationPreservedSourceValue.findFirstOrThrow({
          where: { patientId: longPatient.id, sourceColumn: 'SERBESTALAN1' },
        });

        assert.equal(shortRow.sensitivity, 'NORMAL');
        assert.equal(longRow.sensitivity, 'RESTRICTED');
      },
    );

    await test('every preserved row carries the run clinicId and organizationId', async () => {
      const tenant = await makeTenant('pres-tenant');
      const { organizationId, clinicId } = tenant;
      const { run } = await runFixture(tenant, [
        sourceRow({
          HASTA_ID: 'R10-P-9',
          ADI: 'Sentetik',
          SOYADI: 'Kiracı',
          SUBEDOSYANO: 'SB-0009',
          ANNEADI: 'SentetikAnne',
        }),
      ]);

      const rows = await prisma.migrationPreservedSourceValue.findMany({
        where: { migrationRunId: run.id },
      });
      assert.equal(rows.length, 2);
      for (const row of rows) {
        assert.equal(row.organizationId, organizationId);
        assert.equal(row.clinicId, clinicId);
      }
    });

    // =====================================================================
    section('4. Idempotency — a rerun duplicates nothing');

    await test('a second run over the identical source adds no contact points and no preserved values', async () => {
      const tenant = await makeTenant('rerun-new');
      const { organizationId } = tenant;
      const rows = [
        sourceRow({
          HASTA_ID: 'R10-I-1',
          ADI: 'Sentetik',
          SOYADI: 'Tekrar',
          CEPTELEFONU: '05320000020',
          EVTELEFONU: '02120000021',
          ISTELEFONU: '02160000022',
          ILCE: 'TekrarIlce',
          SUBEDOSYANO: 'SB-1001',
          ANNEADI: 'SentetikAnne',
        }),
        sourceRow({
          HASTA_ID: 'R10-I-2',
          ADI: 'Sentetik',
          SOYADI: 'Tekrar',
          CEPTELEFONU: '05320000023',
          EVTELEFONU: '02120000024',
          ILCE: 'TekrarIlce',
          SUBEDOSYANO: 'SB-1002',
        }),
      ];

      const first = await runFixture(tenant, rows);
      assert.equal(first.result.createdRows, 2);

      const contactPointsAfterFirst = await prisma.patientContactPoint.count({ where: { organizationId } });
      const preservedAfterFirst = await prisma.migrationPreservedSourceValue.count({
        where: { organizationId },
      });
      assert.equal(contactPointsAfterFirst, 3, '2 + 1 secondary numbers');
      assert.equal(preservedAfterFirst, 3, '2 + 1 preserved columns');

      const prepared = await prepareRun(tenant, rows);
      const second = await executeMigrationRun(executeInput(prepared));
      assert.equal(second.status, 'COMPLETED');
      assert.equal(second.createdRows, 0, 'the rerun creates no patients');
      assert.equal(second.matchedRows, 2, 'every row matches existing provenance');

      assert.equal(
        await prisma.patientContactPoint.count({ where: { organizationId } }),
        contactPointsAfterFirst,
        'NO DUPLICATE CONTACT POINTS',
      );
      assert.equal(
        await prisma.migrationPreservedSourceValue.count({ where: { organizationId } }),
        preservedAfterFirst,
        'NO DUPLICATE PRESERVED VALUES',
      );
      assert.equal(
        await prisma.migrationPreservedSourceValue.count({ where: { migrationRunId: prepared.run.id } }),
        0,
        'the second run writes no evidence of its own for rows it merely matched',
      );
    });

    await test(
      're-attempting the SAME run’s batch adds no contact points and no preserved values',
      async () => {
        const tenant = await makeTenant('rerun-same');
        const { organizationId } = tenant;
        const rows = [
          sourceRow({
            HASTA_ID: 'R10-I-3',
            ADI: 'Sentetik',
            SOYADI: 'AyniKosu',
            CEPTELEFONU: '05320000025',
            EVTELEFONU: '02120000026',
            ISTELEFONU: '02160000027',
            SUBEDOSYANO: 'SB-1003',
            ANNEADI: 'SentetikAnne',
          }),
        ];

        const prepared = await prepareRun(tenant, rows);
        const first = await executeMigrationRun(executeInput(prepared));
        assert.equal(first.status, 'COMPLETED');
        assert.equal(first.createdRows, 1);

        const contactPointsBefore = await prisma.patientContactPoint.count({ where: { organizationId } });
        const preservedBefore = await prisma.migrationPreservedSourceValue.count({
          where: { migrationRunId: prepared.run.id },
        });
        assert.equal(contactPointsBefore, 2);
        assert.equal(preservedBefore, 2);

        // Force the identical batch to be attempted a second time under the
        // SAME run id — the state a resume after an infrastructure failure
        // lands in, and the only path on which the unique constraints and
        // `skipDuplicates` are load-bearing.
        await prisma.migrationRunBatch.updateMany({
          where: { runId: prepared.run.id },
          data: { status: 'FAILED', errorCode: 'INTERNAL_ERROR' },
        });
        await prisma.migrationRun.update({
          where: { id: prepared.run.id },
          data: { status: 'PARTIAL_FAILURE' },
        });

        const second = await executeMigrationRun(executeInput(prepared));
        assert.equal(second.createdRows, 0, 'the re-attempt creates no patient');
        assert.equal(second.matchedRows, 1, 'the re-attempt matches through provenance');

        assert.equal(
          await prisma.patientContactPoint.count({ where: { organizationId } }),
          contactPointsBefore,
          'NO DUPLICATE CONTACT POINTS on a same-run re-attempt',
        );
        assert.equal(
          await prisma.migrationPreservedSourceValue.count({
            where: { migrationRunId: prepared.run.id },
          }),
          preservedBefore,
          'NO DUPLICATE PRESERVED VALUES on a same-run re-attempt',
        );
      },
    );

    // =====================================================================
    section('5. Tenant isolation — a run targeted at clinic B writes only clinic B ids');

    await test('nothing R10 writes may land in a sibling clinic or another organization', async () => {
      const tenantA = await makeTenant('iso-a');
      const clinicB = await makeSiblingClinic(tenantA.organizationId, 'iso-b');
      const otherTenant = await makeTenant('iso-other');

      // Clinic A gets its own run first, so clinic A ids genuinely exist on
      // R10 rows and "no clinic A ids" cannot pass because nothing was written.
      await runFixture(tenantA, [
        sourceRow({
          HASTA_ID: 'R10-T-1',
          ADI: 'Sentetik',
          SOYADI: 'SubeA',
          EVTELEFONU: '02120000030',
          SUBEDOSYANO: 'SB-2001',
        }),
      ]);
      assert.equal(
        await prisma.patientContactPoint.count({ where: { clinicId: tenantA.clinicId } }),
        1,
        'guard against a vacuous pass: clinic A really does hold an R10 row',
      );

      const runB = await runFixture(
        { organizationId: tenantA.organizationId, clinicId: clinicB },
        [
          sourceRow({
            HASTA_ID: 'R10-T-2',
            ADI: 'Sentetik',
            SOYADI: 'SubeB',
            EVTELEFONU: '02120000031',
            ISTELEFONU: '02160000032',
            ILCE: 'SubeBIlce',
            SUBEDOSYANO: 'SB-2002',
            ANNEADI: 'SentetikAnne',
          }),
        ],
      );

      const pointsB = await prisma.patientContactPoint.findMany({
        where: { organizationId: tenantA.organizationId, clinicId: clinicB },
      });
      const preservedB = await prisma.migrationPreservedSourceValue.findMany({
        where: { migrationRunId: runB.run.id },
      });
      assert.equal(pointsB.length, 2, "clinic B's run wrote its own contact points");
      assert.equal(preservedB.length, 2, "clinic B's run wrote its own preserved values");

      for (const row of [...pointsB, ...preservedB]) {
        assert.equal(row.clinicId, clinicB, 'every row carries the TARGET clinic');
        assert.notEqual(row.clinicId, tenantA.clinicId, "clinic A's id may never appear on clinic B's rows");
        assert.equal(row.organizationId, tenantA.organizationId);
      }

      assert.equal(
        await prisma.patientContactPoint.count({ where: { clinicId: tenantA.clinicId } }),
        1,
        "clinic B's run must not add anything to the sibling branch",
      );
      assert.equal(
        await prisma.migrationPreservedSourceValue.count({
          where: { migrationRunId: runB.run.id, clinicId: tenantA.clinicId },
        }),
        0,
        "clinic B's evidence may never be stamped with clinic A",
      );
      assert.equal(
        await prisma.patientContactPoint.count({ where: { organizationId: otherTenant.organizationId } }),
        0,
        'and nothing may cross the organization boundary at all',
      );
      assert.equal(
        await prisma.migrationPreservedSourceValue.count({
          where: { organizationId: otherTenant.organizationId },
        }),
        0,
        'and no evidence may cross the organization boundary either',
      );

      const patientB = await patientBySourceId(tenantA.organizationId, 'R10-T-2');
      assert.equal(patientB.clinicId, clinicB);
      assert.equal(patientB.district, 'SubeBIlce', 'the district scalar is tenant-scoped like every other');
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
