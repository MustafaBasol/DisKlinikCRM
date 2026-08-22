/**
 * tenantGuardUnit.test.ts — F3-2 Prisma guard enforcement core.
 *
 * Drives `guardOperationArgs()` directly with a fake port, so every guard mode
 * × every Prisma operation can be exercised without a PostgreSQL instance and
 * without waiting on CI Layer 3. The companion suite
 * `dbVerification/tenantGuardIsolation.test.ts` proves the same rules against a
 * real database and a real generated client; this one proves the DECISIONS, at
 * a granularity a database test cannot reach cheaply.
 *
 * WHAT A FAILURE HERE MEANS
 * -------------------------
 * Every assertion below is either "the guard added the predicate it must add"
 * or "the guard refused". There is no assertion of the form "the guard allowed
 * X" for a tenant-owned model without also checking the predicate, because a
 * guard that allows the right things for the wrong reason is a guard that will
 * allow the wrong things later.
 *
 * The model names are REAL entries from the F3-1 registry, chosen one per guard
 * mode, so a registry change that reclassifies them breaks this suite rather
 * than leaving it testing a fiction:
 *
 *   Patient                 AUTO_FILTER_DUAL_KEY
 *   Appointment             AUTO_FILTER_CLINIC_ID
 *   AuditLog                AUTO_FILTER_ORGANIZATION_ID  (with a NULLABLE clinicId — see §D)
 *   Clinic / Organization   AUTO_FILTER_ORGANIZATION_ID  (the tenant root special case)
 *   PaymentPlanInstallment  PARENT_OWNERSHIP_VALIDATION  (parent: PaymentPlan)
 *   Plan                    NO_TENANT_FILTER
 *   JobLock                 SYSTEM_CONTEXT_ONLY
 *   SecurityIncident        BLOCKED_PENDING_REVIEW
 *
 * DATABASE-FREE. The port is a fake; no Prisma client is constructed, no
 * DATABASE_URL is read, nothing connects.
 *
 * Run with: tsx src/tests/tenantGuardUnit.test.ts
 */

import assert from 'node:assert/strict';

import {
  GUARDED_MODEL_OPERATIONS,
  guardOperationArgs,
  mergeWhere,
  unclassifiedModelOperations,
  type TenantGuardPort,
} from '../tenancy/prismaTenantGuard.js';
import { TenantGuardError, type TenantGuardErrorCode } from '../tenancy/tenantGuardErrors.js';
import { runAsSystem, runAsTenant } from '../tenancy/tenantContext.js';
import { runWithAuditedRawSql } from '../tenancy/auditedRawSql.js';
import { TENANT_MODEL_CLASSIFICATION } from '../utils/tenantModelClassification.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── Fixture tenants ──────────────────────────────────────────────────────────

const ORG_A = 'org-A';
const ORG_B = 'org-B';
const A1 = 'clinic-A1';
const A2 = 'clinic-A2';
const B1 = 'clinic-B1';

const tenantA = {
  organizationId: ORG_A,
  clinicScope: { kind: 'EXPLICIT' as const, clinicIds: [A1, A2] },
  actor: { kind: 'USER' as const, id: 'user-a' },
};
const tenantASingleClinic = {
  ...tenantA,
  clinicScope: { kind: 'EXPLICIT' as const, clinicIds: [A1] },
};
const tenantAOrgWide = {
  organizationId: ORG_A,
  clinicScope: { kind: 'ORGANIZATION_WIDE' as const },
  actor: { kind: 'USER' as const, id: 'owner-a' },
};

// ── Fake port ────────────────────────────────────────────────────────────────
//
// Rows are keyed by `${Model}:${id}` and carry only ownership columns, which is
// all the guard ever asks for. `organizationClinics` backs the ORGANIZATION_WIDE
// resolution so its laziness and memoization can be observed.

interface FakePortState {
  rows: Map<string, Record<string, unknown>>;
  organizationClinics: Map<string, string[]>;
  relations: Map<string, Map<string, string>>;
  fields: Map<string, Set<string>>;
  clinicListCalls: number;
  selectCalls: Array<{ model: string; where: Record<string, unknown> }>;
}

function createFakePort(): { port: TenantGuardPort; state: FakePortState } {
  const state: FakePortState = {
    rows: new Map(),
    organizationClinics: new Map([
      [ORG_A, [A1, A2]],
      [ORG_B, [B1]],
    ]),
    // Only the relations the tests actually traverse. Everything else resolves
    // to undefined, i.e. "not a relation", which is the safe default here
    // because an unrecognised key on a write is simply not walked into.
    relations: new Map([
      ['Patient', new Map([['clinic', 'Clinic'], ['organization', 'Organization'], ['appointments', 'Appointment'], ['emergencyContacts', 'PatientEmergencyContact']])],
      ['Appointment', new Map([['clinic', 'Clinic'], ['patient', 'Patient']])],
      ['PaymentPlanInstallment', new Map([['plan', 'PaymentPlan']])],
      ['PaymentPlan', new Map([['clinic', 'Clinic']])],
      ['PatientEmergencyContact', new Map([['clinic', 'Clinic'], ['patient', 'Patient']])],
      ['AuditLog', new Map()],
      ['Clinic', new Map([['organization', 'Organization']])],
      ['Organization', new Map()],
      ['Plan', new Map()],
    ]),
    fields: new Map([
      ['Patient', new Set(['id', 'clinicId', 'organizationId', 'firstName'])],
      ['Appointment', new Set(['id', 'clinicId', 'patientId'])],
      ['PaymentPlan', new Set(['id', 'clinicId'])],
      ['PaymentPlanInstallment', new Set(['id', 'planId'])],
      ['PatientEmergencyContact', new Set(['id', 'clinicId', 'organizationId', 'patientId'])],
      ['AuditLog', new Set(['id', 'organizationId', 'clinicId'])],
      ['Clinic', new Set(['id', 'organizationId'])],
      ['Organization', new Set(['id'])],
      ['Plan', new Set(['id'])],
    ]),
    clinicListCalls: 0,
    selectCalls: [],
  };

  const port: TenantGuardPort = {
    async listOrganizationClinicIds(organizationId) {
      state.clinicListCalls += 1;
      return state.organizationClinics.get(organizationId) ?? [];
    },
    async selectByUnique(model, uniqueWhere, fields) {
      state.selectCalls.push({ model, where: uniqueWhere });
      const id = uniqueWhere.id;
      if (typeof id !== 'string') return null;
      const row = state.rows.get(`${model}:${id}`);
      if (!row) return null;
      const projected: Record<string, unknown> = {};
      for (const field of fields) projected[field] = row[field];
      return projected;
    },
    relationTarget(model, field) {
      return state.relations.get(model)?.get(field);
    },
    hasField(model, field) {
      return state.fields.get(model)?.has(field) === true;
    },
  };

  return { port, state };
}

function seed(state: FakePortState, model: string, id: string, columns: Record<string, unknown>) {
  state.rows.set(`${model}:${id}`, { id, ...columns });
}

// ── Assertion helpers ────────────────────────────────────────────────────────

async function expectRefusal(
  code: TenantGuardErrorCode,
  fn: () => Promise<unknown>,
): Promise<TenantGuardError> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof TenantGuardError, `expected TenantGuardError, got ${String(err)}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}: ${err.message}`);
    return err;
  }
  throw new Error(`expected refusal ${code}, but the operation was allowed`);
}

/** The clinic predicate the guard is expected to produce for tenant A. */
const CLINIC_IN_A = { in: [A1, A2] };

async function main() {
  // ── A. Taxonomy completeness ───────────────────────────────────────────────
  section('A. Operation taxonomy');

  await test('every Prisma model operation the client exposes is classified', () => {
    // Sourced from the generated client's own TypeMap operation set for a model.
    const clientOperations = [
      'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
      'create', 'createMany', 'createManyAndReturn',
      'delete', 'update', 'deleteMany', 'updateMany', 'updateManyAndReturn',
      'upsert', 'aggregate', 'groupBy', 'count',
    ];
    assert.deepEqual(unclassifiedModelOperations(clientOperations), []);
    assert.equal(GUARDED_MODEL_OPERATIONS.length, clientOperations.length);
  });

  await test('an operation with no rule is refused rather than passed through', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('UNSUPPORTED_OPERATION', () =>
        guardOperationArgs({ model: 'Patient', operation: 'findRaw', args: {}, port }),
      );
    });
  });

  await test('mergeWhere preserves the top-level unique key (findUnique would break otherwise)', () => {
    const merged = mergeWhere({ id: 'x' }, { clinicId: { in: [A1] } });
    assert.equal(merged.id, 'x', 'the unique key must stay at the top level');
    assert.deepEqual(merged.AND, [{ clinicId: { in: [A1] } }]);
  });

  await test('mergeWhere appends to an existing AND rather than replacing it', () => {
    const merged = mergeWhere({ AND: [{ a: 1 }] }, { b: 2 });
    assert.deepEqual(merged.AND, [{ a: 1 }, { b: 2 }]);
  });

  // ── B. Reads, every read operation ─────────────────────────────────────────
  section('B. Read isolation — every read operation is constrained');

  const READS = ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy'];

  await test('all 8 read operations on a DUAL_KEY model get both predicates', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      for (const operation of READS) {
        const out = (await guardOperationArgs({
          model: 'Patient',
          operation,
          args: { where: { firstName: 'Ada' } },
          port,
        })) as { where: Record<string, unknown> };
        assert.equal(out.where.firstName, 'Ada', `${operation}: caller predicate preserved`);
        assert.deepEqual(
          out.where.AND,
          [{ organizationId: ORG_A, clinicId: CLINIC_IN_A }],
          `${operation}: tenant predicate injected`,
        );
      }
    });
  });

  await test('a read with no where at all still gets the predicate', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const out = (await guardOperationArgs({ model: 'Patient', operation: 'findMany', args: {}, port })) as { where: Record<string, unknown> };
      assert.deepEqual(out.where, { organizationId: ORG_A, clinicId: CLINIC_IN_A });
    });
  });

  await test('a read with undefined args (Prisma allows bare count()) still gets the predicate', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const out = (await guardOperationArgs({ model: 'Patient', operation: 'count', args: undefined, port })) as { where: Record<string, unknown> };
      assert.deepEqual(out.where, { organizationId: ORG_A, clinicId: CLINIC_IN_A });
    });
  });

  await test('findUnique keeps its unique key at the top level and gains an AND', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const out = (await guardOperationArgs({
        model: 'Patient',
        operation: 'findUnique',
        args: { where: { id: 'p1' } },
        port,
      })) as { where: Record<string, unknown> };
      assert.equal(out.where.id, 'p1');
      assert.deepEqual(out.where.AND, [{ organizationId: ORG_A, clinicId: CLINIC_IN_A }]);
    });
  });

  await test('a clinicId-only model is constrained on clinicId alone (matching the registry, not a guess)', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const out = (await guardOperationArgs({ model: 'Appointment', operation: 'findMany', args: {}, port })) as { where: Record<string, unknown> };
      assert.deepEqual(out.where, { clinicId: CLINIC_IN_A });
    });
  });

  await test('an organization-scoped model is constrained on organizationId alone', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const out = (await guardOperationArgs({ model: 'AuditLog', operation: 'findMany', args: {}, port })) as { where: Record<string, unknown> };
      assert.deepEqual(out.where, { organizationId: ORG_A });
    });
  });

  await test('Organization itself is constrained on its own primary key', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const out = (await guardOperationArgs({ model: 'Organization', operation: 'findMany', args: {}, port })) as { where: Record<string, unknown> };
      assert.deepEqual(out.where, { id: ORG_A });
    });
  });

  await test('an empty clinic set produces a predicate that matches nothing, not one that matches everything', async () => {
    const { port } = createFakePort();
    await runAsTenant(
      { ...tenantA, clinicScope: { kind: 'EXPLICIT', clinicIds: [] } },
      async () => {
        const out = (await guardOperationArgs({ model: 'Appointment', operation: 'findMany', args: {}, port })) as { where: Record<string, unknown> };
        assert.deepEqual(out.where, { clinicId: { in: [] } });
      },
    );
  });

  // ── C. ORGANIZATION_WIDE resolution ────────────────────────────────────────
  section('C. Organization-wide contexts resolve their clinic set lazily and once');

  await test('an org-wide context resolves clinics only when a clinic-only model is touched', async () => {
    const { port, state } = createFakePort();
    await runAsTenant(tenantAOrgWide, async () => {
      await guardOperationArgs({ model: 'AuditLog', operation: 'findMany', args: {}, port });
      assert.equal(state.clinicListCalls, 0, 'an organization-scoped read must not cost a clinic lookup');
    });
  });

  await test('the resolved clinic set is memoized per context, not per call', async () => {
    const { port, state } = createFakePort();
    await runAsTenant(tenantAOrgWide, async () => {
      const first = (await guardOperationArgs({ model: 'Appointment', operation: 'findMany', args: {}, port })) as { where: Record<string, unknown> };
      const second = (await guardOperationArgs({ model: 'Appointment', operation: 'count', args: {}, port })) as { where: Record<string, unknown> };
      assert.deepEqual(first.where, { clinicId: { in: [A1, A2] } });
      assert.deepEqual(second.where, { clinicId: { in: [A1, A2] } });
      assert.equal(state.clinicListCalls, 1, 'two operations, one lookup');
    });
  });

  await test('two org-wide contexts do not share a memoized clinic set', async () => {
    const { port, state } = createFakePort();
    await runAsTenant(tenantAOrgWide, async () => {
      await guardOperationArgs({ model: 'Appointment', operation: 'findMany', args: {}, port });
    });
    await runAsTenant({ ...tenantAOrgWide, organizationId: ORG_B }, async () => {
      const out = (await guardOperationArgs({ model: 'Appointment', operation: 'findMany', args: {}, port })) as { where: Record<string, unknown> };
      assert.deepEqual(out.where, { clinicId: { in: [B1] } }, 'organization B must not inherit A’s clinics');
    });
    assert.equal(state.clinicListCalls, 2);
  });

  // ── D. Writes: ownership fields ────────────────────────────────────────────
  section('D. Write isolation');

  await test('create injects both ownership fields when the context names exactly one clinic', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      const out = (await guardOperationArgs({
        model: 'Patient',
        operation: 'create',
        args: { data: { firstName: 'Ada' } },
        port,
      })) as { data: Record<string, unknown> };
      assert.equal(out.data.organizationId, ORG_A);
      assert.equal(out.data.clinicId, A1);
      assert.equal(out.data.firstName, 'Ada');
    });
  });

  await test('create REFUSES to guess a clinic when the context covers several', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('AMBIGUOUS_TENANT_TARGET', () =>
        guardOperationArgs({ model: 'Patient', operation: 'create', args: { data: { firstName: 'Ada' } }, port }),
      );
    });
  });

  await test('create with ANOTHER tenant’s clinicId is refused', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'Patient', operation: 'create', args: { data: { firstName: 'Ada', clinicId: B1 } }, port }),
      );
    });
  });

  await test('create with ANOTHER tenant’s organizationId is refused', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'Patient', operation: 'create', args: { data: { firstName: 'Ada', organizationId: ORG_B, clinicId: A1 } }, port }),
      );
    });
  });

  await test('THE PAIRING ATTACK: A’s organizationId with B’s clinicId is refused', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({
          model: 'Patient',
          operation: 'create',
          args: { data: { firstName: 'Ada', organizationId: ORG_A, clinicId: B1 } },
          port,
        }),
      );
    });
  });

  await test('createMany validates every element, not just the first', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({
          model: 'Patient',
          operation: 'createMany',
          args: { data: [{ firstName: 'Ok', clinicId: A1 }, { firstName: 'Bad', clinicId: B1 }] },
          port,
        }),
      );
    });
  });

  await test('createManyAndReturn is guarded exactly like createMany', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const out = (await guardOperationArgs({
        model: 'Patient',
        operation: 'createManyAndReturn',
        args: { data: [{ firstName: 'Ada', clinicId: A1 }] },
        port,
      })) as { data: Array<Record<string, unknown>> };
      assert.equal(out.data[0].organizationId, ORG_A);
    });
  });

  await test('update constrains the where AND validates the data', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const out = (await guardOperationArgs({
        model: 'Patient',
        operation: 'update',
        args: { where: { id: 'p1' }, data: { firstName: 'New' } },
        port,
      })) as { where: Record<string, unknown>; data: Record<string, unknown> };
      assert.equal(out.where.id, 'p1');
      assert.deepEqual(out.where.AND, [{ organizationId: ORG_A, clinicId: CLINIC_IN_A }]);
      assert.equal(out.data.clinicId, undefined, 'update must not invent an ownership value');
    });
  });

  await test('an update that MOVES a row to another tenant is refused', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'Patient', operation: 'update', args: { where: { id: 'p1' }, data: { clinicId: B1 } }, port }),
      );
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'Patient', operation: 'update', args: { where: { id: 'p1' }, data: { clinicId: { set: B1 } } }, port }),
      );
    });
  });

  await test('moving a row BETWEEN the caller’s own clinics is allowed', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const out = (await guardOperationArgs({ model: 'Patient', operation: 'update', args: { where: { id: 'p1' }, data: { clinicId: A2 } }, port })) as { data: Record<string, unknown> };
      assert.equal(out.data.clinicId, A2);
    });
  });

  await test('an ownership field written with an operator the guard cannot evaluate is refused', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('UNSUPPORTED_WRITE_SHAPE', () =>
        guardOperationArgs({ model: 'Patient', operation: 'update', args: { where: { id: 'p1' }, data: { clinicId: { unknownOp: B1 } } }, port }),
      );
    });
  });

  await test('updateMany and updateManyAndReturn are constrained and validated', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      for (const operation of ['updateMany', 'updateManyAndReturn']) {
        const out = (await guardOperationArgs({ model: 'Patient', operation, args: { where: { firstName: 'Ada' }, data: { firstName: 'B' } }, port })) as { where: Record<string, unknown> };
        assert.deepEqual(out.where.AND, [{ organizationId: ORG_A, clinicId: CLINIC_IN_A }]);
        await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
          guardOperationArgs({ model: 'Patient', operation, args: { where: {}, data: { clinicId: B1 } }, port }),
        );
      }
    });
  });

  await test('delete and deleteMany are constrained', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const one = (await guardOperationArgs({ model: 'Patient', operation: 'delete', args: { where: { id: 'p1' } }, port })) as { where: Record<string, unknown> };
      assert.equal(one.where.id, 'p1');
      assert.deepEqual(one.where.AND, [{ organizationId: ORG_A, clinicId: CLINIC_IN_A }]);

      const many = (await guardOperationArgs({ model: 'Patient', operation: 'deleteMany', args: {}, port })) as { where: Record<string, unknown> };
      assert.deepEqual(many.where, { organizationId: ORG_A, clinicId: CLINIC_IN_A });
    });
  });

  await test('upsert constrains the where and validates BOTH branches', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      const out = (await guardOperationArgs({
        model: 'Patient',
        operation: 'upsert',
        args: { where: { id: 'p1' }, create: { firstName: 'Ada' }, update: { firstName: 'Ada2' } },
        port,
      })) as { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> };
      assert.equal(out.where.id, 'p1');
      assert.deepEqual(out.where.AND, [{ organizationId: ORG_A, clinicId: { in: [A1] } }]);
      assert.equal(out.create.clinicId, A1, 'the create branch is filled in');
      assert.equal(out.update.clinicId, undefined, 'the update branch invents nothing');

      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'Patient', operation: 'upsert', args: { where: { id: 'p1' }, create: { clinicId: B1 }, update: {} }, port }),
      );
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'Patient', operation: 'upsert', args: { where: { id: 'p1' }, create: { clinicId: A1 }, update: { clinicId: B1 } }, port }),
      );
    });
  });

  await test('a nullable ownership column may be written null, but never another tenant’s value', async () => {
    // AuditLog is organization-scoped with a NULLABLE clinicId: an org-level
    // audit row legitimately has none.
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const out = (await guardOperationArgs({ model: 'AuditLog', operation: 'create', args: { data: { clinicId: null } }, port })) as { data: Record<string, unknown> };
      assert.equal(out.data.organizationId, ORG_A);
      assert.equal(out.data.clinicId, null);

      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'AuditLog', operation: 'create', args: { data: { clinicId: B1 } }, port }),
      );
    });
  });

  await test('an organization-scoped create does not have a clinic id invented for it', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      const out = (await guardOperationArgs({ model: 'AuditLog', operation: 'create', args: { data: { action: 'x' } }, port })) as { data: Record<string, unknown> };
      assert.equal(out.data.organizationId, ORG_A);
      assert.ok(!('clinicId' in out.data), 'guard mode is organization-only; a clinic must not appear from nowhere');
    });
  });

  await test('creating a tenant root from tenant execution is refused', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'Organization', operation: 'create', args: { data: { name: 'New Co' } }, port }),
      );
    });
  });

  await test('rewriting the tenant root’s own id is refused', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'Organization', operation: 'update', args: { where: { id: ORG_A }, data: { id: ORG_B } }, port }),
      );
    });
  });

  await test('the guard never mutates the caller’s own args object', async () => {
    const { port } = createFakePort();
    const args = { data: { firstName: 'Ada' } };
    await runAsTenant(tenantASingleClinic, async () => {
      await guardOperationArgs({ model: 'Patient', operation: 'create', args, port });
    });
    assert.deepEqual(args, { data: { firstName: 'Ada' } }, 'Prisma reuses arg objects; mutating them is a latent bug');
  });

  // ── E. PARENT_SCOPED ───────────────────────────────────────────────────────
  section('E. Parent-scoped ownership');

  await test('a parent-scoped read is constrained through its declared owning relation', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      const out = (await guardOperationArgs({ model: 'PaymentPlanInstallment', operation: 'findMany', args: {}, port })) as { where: Record<string, unknown> };
      assert.deepEqual(out.where, { plan: { clinicId: CLINIC_IN_A } });
    });
  });

  await test('a parent-scoped create validates the parent row actually belongs to the caller', async () => {
    const { port, state } = createFakePort();
    seed(state, 'PaymentPlan', 'plan-A', { clinicId: A1 });
    seed(state, 'PaymentPlan', 'plan-B', { clinicId: B1 });

    await runAsTenant(tenantA, async () => {
      const ok = (await guardOperationArgs({ model: 'PaymentPlanInstallment', operation: 'create', args: { data: { planId: 'plan-A', amount: 10 } }, port })) as { data: Record<string, unknown> };
      assert.equal(ok.data.planId, 'plan-A');

      await expectRefusal('CROSS_TENANT_RELATION_REJECTED', () =>
        guardOperationArgs({ model: 'PaymentPlanInstallment', operation: 'create', args: { data: { planId: 'plan-B', amount: 10 } }, port }),
      );
    });
  });

  await test('a parent-scoped create pointing at a NON-EXISTENT parent is refused, not allowed', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('CROSS_TENANT_RELATION_REJECTED', () =>
        guardOperationArgs({ model: 'PaymentPlanInstallment', operation: 'create', args: { data: { planId: 'nope' } }, port }),
      );
    });
  });

  await test('a parent-scoped create with NO owner at all is refused', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('PARENT_OWNERSHIP_UNPROVABLE', () =>
        guardOperationArgs({ model: 'PaymentPlanInstallment', operation: 'create', args: { data: { amount: 10 } }, port }),
      );
    });
  });

  // ── F. Nested writes ───────────────────────────────────────────────────────
  section('F. Nested writes');

  await test('a nested create inherits the tenant fields', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      const out = (await guardOperationArgs({
        model: 'Patient',
        operation: 'create',
        args: { data: { firstName: 'Ada', emergencyContacts: { create: [{ name: 'Kin' }] } } },
        port,
      })) as { data: { emergencyContacts: { create: Array<Record<string, unknown>> } } };
      assert.equal(out.data.emergencyContacts.create[0].clinicId, A1);
      assert.equal(out.data.emergencyContacts.create[0].organizationId, ORG_A);
    });
  });

  await test('a nested create carrying ANOTHER tenant’s clinicId is refused', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({
          model: 'Patient',
          operation: 'create',
          args: { data: { firstName: 'Ada', emergencyContacts: { create: [{ name: 'Kin', clinicId: B1 }] } } },
          port,
        }),
      );
    });
  });

  await test('a nested connect to another tenant’s row is refused', async () => {
    const { port, state } = createFakePort();
    seed(state, 'Patient', 'pat-B', { organizationId: ORG_B, clinicId: B1 });
    await runAsTenant(tenantASingleClinic, async () => {
      await expectRefusal('CROSS_TENANT_RELATION_REJECTED', () =>
        guardOperationArgs({ model: 'Appointment', operation: 'create', args: { data: { clinicId: A1, patient: { connect: { id: 'pat-B' } } } }, port }),
      );
    });
  });

  await test('a nested connect to the caller’s own row is allowed', async () => {
    const { port, state } = createFakePort();
    seed(state, 'Patient', 'pat-A', { organizationId: ORG_A, clinicId: A1 });
    await runAsTenant(tenantASingleClinic, async () => {
      const out = (await guardOperationArgs({ model: 'Appointment', operation: 'create', args: { data: { patient: { connect: { id: 'pat-A' } } } }, port })) as { data: Record<string, unknown> };
      assert.equal(out.data.clinicId, A1);
    });
  });

  await test('a sibling clinic in the SAME organization is refused — scalar form', async () => {
    const { port, state } = createFakePort();
    seed(state, 'Clinic', A2, { organizationId: ORG_A });
    await runAsTenant(tenantASingleClinic, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'Patient', operation: 'create', args: { data: { clinicId: A2 } }, port }),
      );
    });
  });

  await test('a sibling clinic in the SAME organization is refused — RELATION form', async () => {
    // The gap this pins: `Clinic` is organization-scoped, so the generic
    // nested-relation walk would only prove the target belongs to the caller's
    // ORGANIZATION, and `{ clinic: { connect: { id: siblingClinic } } }` would
    // sail through while the scalar equivalent was refused. The ownership
    // relation is now checked against the CLINIC SET, before that walk.
    const { port, state } = createFakePort();
    seed(state, 'Clinic', A2, { organizationId: ORG_A });
    await runAsTenant(tenantASingleClinic, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'Patient', operation: 'create', args: { data: { clinic: { connect: { id: A2 } } } }, port }),
      );
      // ...and the caller's own clinic still works through the relation form.
      const ok = (await guardOperationArgs({
        model: 'Patient',
        operation: 'create',
        args: { data: { clinic: { connect: { id: A1 } } } },
        port,
      })) as { data: Record<string, unknown> };
      // The organization is filled in IN THE SAME STYLE the caller used.
      // Injecting the `organizationId` scalar next to `clinic: { connect }`
      // mixes Prisma's checked and unchecked input variants and is rejected
      // outright — the database-backed suite caught exactly that.
      assert.deepEqual(ok.data.organization, { connect: { id: ORG_A } });
      assert.equal(ok.data.organizationId, undefined, 'the scalar form must not be mixed in');
      assert.equal(ok.data.clinicId, undefined, 'the relation supplied the clinic; the scalar must not be invented too');
    });
  });

  await test('a create with NO clinic at all still uses the scalar form (the default, unchanged)', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      const out = (await guardOperationArgs({ model: 'Patient', operation: 'create', args: { data: { firstName: 'Plain' } }, port })) as { data: Record<string, unknown> };
      assert.equal(out.data.clinicId, A1);
      assert.equal(out.data.organizationId, ORG_A);
      assert.equal(out.data.clinic, undefined);
      assert.equal(out.data.organization, undefined);
    });
  });

  await test('the organization relation form is checked against the caller’s organization', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({ model: 'Patient', operation: 'create', args: { data: { clinicId: A1, organization: { connect: { id: ORG_B } } } }, port }),
      );
    });
  });

  await test('an ownership relation written with anything other than { connect: { id } } is refused', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      for (const payload of [
        { clinic: { connectOrCreate: { where: { id: A1 }, create: {} } } },
        { clinic: { create: { name: 'Sneaky' } } },
        { clinic: { disconnect: true } },
        { clinic: { connect: { slug: 'by-slug' } } },
      ]) {
        await expectRefusal('UNSUPPORTED_WRITE_SHAPE', () =>
          guardOperationArgs({ model: 'Patient', operation: 'create', args: { data: payload }, port }),
        );
      }
    });
  });

  await test('an unrecognised nested key fails closed rather than passing through', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      const err = await expectRefusal('UNSUPPORTED_WRITE_SHAPE', () =>
        guardOperationArgs({ model: 'Patient', operation: 'create', args: { data: { emergencyContacts: { someFutureOperation: {} } } }, port }),
      );
      assert.match(err.message, /someFutureOperation/);
    });
  });

  await test('nested deleteMany gets the tenant predicate merged in', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      const out = (await guardOperationArgs({
        model: 'Patient',
        operation: 'update',
        args: { where: { id: 'p1' }, data: { emergencyContacts: { deleteMany: { name: 'Kin' } } } },
        port,
      })) as { data: { emergencyContacts: { deleteMany: Record<string, unknown> } } };
      assert.deepEqual(out.data.emergencyContacts.deleteMany.AND, [{ organizationId: ORG_A, clinicId: { in: [A1] } }]);
    });
  });

  await test('nested updateMany gets both a constrained where and a validated data', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({
          model: 'Patient',
          operation: 'update',
          args: { where: { id: 'p1' }, data: { emergencyContacts: { updateMany: [{ where: {}, data: { clinicId: B1 } }] } } },
          port,
        }),
      );
    });
  });

  await test('nested connectOrCreate refuses a where that resolves to another tenant’s row', async () => {
    const { port, state } = createFakePort();
    seed(state, 'Patient', 'pat-B', { organizationId: ORG_B, clinicId: B1 });
    await runAsTenant(tenantASingleClinic, async () => {
      await expectRefusal('CROSS_TENANT_RELATION_REJECTED', () =>
        guardOperationArgs({
          model: 'Appointment',
          operation: 'create',
          args: { data: { clinicId: A1, patient: { connectOrCreate: { where: { id: 'pat-B' }, create: { firstName: 'X' } } } } },
          port,
        }),
      );
    });
  });

  await test('nested connectOrCreate whose where matches nothing falls through to a GUARDED create', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      const out = (await guardOperationArgs({
        model: 'Appointment',
        operation: 'create',
        args: { data: { clinicId: A1, patient: { connectOrCreate: { where: { id: 'brand-new' }, create: { firstName: 'X' } } } } },
        port,
      })) as { data: { patient: { connectOrCreate: { create: Record<string, unknown> } } } };
      assert.equal(out.data.patient.connectOrCreate.create.clinicId, A1);
      assert.equal(out.data.patient.connectOrCreate.create.organizationId, ORG_A);
    });
  });

  await test('a to-one nested update validates its data', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantASingleClinic, async () => {
      await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
        guardOperationArgs({
          model: 'Appointment',
          operation: 'update',
          args: { where: { id: 'a1' }, data: { patient: { update: { data: { clinicId: B1 } } } } },
          port,
        }),
      );
    });
  });

  // ── G. Non-tenant models ───────────────────────────────────────────────────
  section('G. Platform-global, system-internal and review-required models');

  await test('platform-global data is readable, with and without a context', async () => {
    const { port } = createFakePort();
    const bare = await guardOperationArgs({ model: 'Plan', operation: 'findMany', args: { where: { active: true } }, port });
    assert.deepEqual(bare, { where: { active: true } }, 'no predicate is added, and none should be');
    await runAsTenant(tenantA, async () => {
      const inTenant = await guardOperationArgs({ model: 'Plan', operation: 'findMany', args: {}, port });
      assert.deepEqual(inTenant, {});
    });
  });

  await test('writing platform-global data from tenant execution is refused', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      for (const operation of ['create', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
        await expectRefusal('PLATFORM_GLOBAL_WRITE_FORBIDDEN', () =>
          guardOperationArgs({ model: 'Plan', operation, args: { where: { id: 'x' }, data: {}, create: {}, update: {} }, port }),
        );
      }
    });
  });

  await test('writing platform-global data with NO context is also refused', async () => {
    const { port } = createFakePort();
    await expectRefusal('PLATFORM_GLOBAL_WRITE_FORBIDDEN', () =>
      guardOperationArgs({ model: 'Plan', operation: 'create', args: { data: {} }, port }),
    );
  });

  await test('a SYSTEM_INTERNAL model is unreachable from tenant execution, for every operation', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      for (const operation of GUARDED_MODEL_OPERATIONS) {
        await expectRefusal('SYSTEM_ONLY_MODEL', () =>
          guardOperationArgs({ model: 'JobLock', operation, args: { where: {}, data: {}, create: {}, update: {} }, port }),
        );
      }
    });
  });

  await test('an EXPLICIT_REVIEW_REQUIRED model is unreachable from tenant execution, for every operation', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      for (const operation of GUARDED_MODEL_OPERATIONS) {
        await expectRefusal('OWNERSHIP_UNRESOLVED_MODEL', () =>
          guardOperationArgs({ model: 'SecurityIncident', operation, args: { where: {}, data: {}, create: {}, update: {} }, port }),
        );
      }
    });
  });

  await test('all five EXPLICIT_REVIEW_REQUIRED models are blocked — none was quietly reclassified', async () => {
    const { port } = createFakePort();
    const blocked = TENANT_MODEL_CLASSIFICATION.filter((e) => e.guardMode === 'BLOCKED_PENDING_REVIEW').map((e) => e.model);
    assert.deepEqual(blocked.slice().sort(), [
      'ExternalCalendarInboundEvent', 'MessagingInboundEvent', 'SecurityIncident',
      'SecurityIncidentActivity', 'SecuritySignalEvent',
    ]);
    await runAsTenant(tenantA, async () => {
      for (const model of blocked) {
        await expectRefusal('OWNERSHIP_UNRESOLVED_MODEL', () =>
          guardOperationArgs({ model, operation: 'findMany', args: {}, port }),
        );
      }
    });
  });

  await test('the F3-2 decision holds: those five ARE reachable under system execution', async () => {
    const { port } = createFakePort();
    await runAsSystem({ reason: 'security-incident-lifecycle' }, async () => {
      const out = await guardOperationArgs({ model: 'SecurityIncident', operation: 'findMany', args: { where: { status: 'open' } }, port });
      assert.deepEqual(out, { where: { status: 'open' } }, 'system execution passes through unmodified');
    });
  });

  // ── H. Missing context and unknown models ──────────────────────────────────
  section('H. Fail-closed defaults');

  await test('a tenant-owned model with NO context is refused, for every operation', async () => {
    const { port } = createFakePort();
    for (const operation of GUARDED_MODEL_OPERATIONS) {
      await expectRefusal('MISSING_TENANT_CONTEXT', () =>
        guardOperationArgs({ model: 'Patient', operation, args: { where: {}, data: {}, create: {}, update: {} }, port }),
      );
    }
  });

  await test('an unknown model is refused in tenant execution', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await expectRefusal('UNCLASSIFIED_MODEL', () =>
        guardOperationArgs({ model: 'TotallyNewModel', operation: 'findMany', args: {}, port }),
      );
    });
  });

  await test('an unknown model is refused with NO context too', async () => {
    const { port } = createFakePort();
    await expectRefusal('UNCLASSIFIED_MODEL', () =>
      guardOperationArgs({ model: 'TotallyNewModel', operation: 'findMany', args: {}, port }),
    );
  });

  await test('an unknown model is STILL refused under system execution — system is not omniscience', async () => {
    const { port } = createFakePort();
    await runAsSystem({ reason: 'background-job' }, async () => {
      await expectRefusal('UNCLASSIFIED_MODEL', () =>
        guardOperationArgs({ model: 'TotallyNewModel', operation: 'findMany', args: {}, port }),
      );
    });
  });

  // ── I. Raw SQL ─────────────────────────────────────────────────────────────
  section('I. Raw SQL');

  const RAW = ['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'];

  await test('all four raw operations are refused from tenant execution', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      for (const operation of RAW) {
        await expectRefusal('RAW_SQL_FORBIDDEN_IN_TENANT_CONTEXT', () =>
          guardOperationArgs({ model: undefined, operation, args: ['SELECT 1'], port }),
        );
      }
    });
  });

  await test('raw SQL is refused with no context at all', async () => {
    const { port } = createFakePort();
    await expectRefusal('RAW_SQL_FORBIDDEN_IN_TENANT_CONTEXT', () =>
      guardOperationArgs({ model: undefined, operation: '$queryRaw', args: ['SELECT 1'], port }),
    );
  });

  await test('raw SQL is allowed under system execution', async () => {
    const { port } = createFakePort();
    await runAsSystem({ reason: 'database-health-check' }, async () => {
      const out = await guardOperationArgs({ model: undefined, operation: '$queryRaw', args: ['SELECT 1'], port });
      assert.deepEqual(out, ['SELECT 1']);
    });
  });

  await test('raw SQL is allowed inside an audited scope, and only for the duration of that scope', async () => {
    const { port } = createFakePort();
    await runAsTenant(tenantA, async () => {
      await runWithAuditedRawSql(
        { registryKey: 'routes/reports', justification: 'clinicScopeSql predicate, see rawSqlAuditRegistry' },
        async () => {
          const out = await guardOperationArgs({ model: undefined, operation: '$queryRaw', args: ['SELECT 1'], port });
          assert.deepEqual(out, ['SELECT 1']);
        },
      );
      await expectRefusal('RAW_SQL_FORBIDDEN_IN_TENANT_CONTEXT', () =>
        guardOperationArgs({ model: undefined, operation: '$queryRaw', args: ['SELECT 1'], port }),
      );
    });
  });

  await test('an audited scope with no justification is refused at construction', async () => {
    await assert.rejects(
      Promise.resolve().then(() =>
        runWithAuditedRawSql({ registryKey: 'routes/reports', justification: '  ' }, async () => undefined),
      ),
      /justification/,
    );
  });

  await test('an unrecognised client-level operation is refused', async () => {
    const { port } = createFakePort();
    await runAsSystem({ reason: 'background-job' }, async () => {
      await expectRefusal('UNSUPPORTED_OPERATION', () =>
        guardOperationArgs({ model: undefined, operation: '$somethingNew', args: [], port }),
      );
    });
  });

  // ── J. System execution ────────────────────────────────────────────────────
  section('J. System execution passes through, and is not reachable by accident');

  await test('system execution adds no predicate to a tenant-owned model', async () => {
    const { port } = createFakePort();
    await runAsSystem({ reason: 'background-job', detail: 'data-retention' }, async () => {
      const out = await guardOperationArgs({ model: 'Patient', operation: 'findMany', args: { where: { firstName: 'Ada' } }, port });
      assert.deepEqual(out, { where: { firstName: 'Ada' } });
    });
  });

  await test('a tenant slice INSIDE a system job is constrained again', async () => {
    const { port } = createFakePort();
    await runAsSystem({ reason: 'background-job' }, async () => {
      await runAsTenant(tenantA, async () => {
        const out = (await guardOperationArgs({ model: 'Patient', operation: 'findMany', args: {}, port })) as { where: Record<string, unknown> };
        assert.deepEqual(out.where, { organizationId: ORG_A, clinicId: CLINIC_IN_A });
      });
      const back = await guardOperationArgs({ model: 'Patient', operation: 'findMany', args: {}, port });
      assert.deepEqual(back, {}, 'the system context is restored after the tenant slice');
    });
  });

  // ── K. Concurrency through the guard ───────────────────────────────────────
  section('K. Concurrent tenants through the guard');

  await test('100 interleaved guarded reads each carry their own tenant predicate', async () => {
    const { port } = createFakePort();
    const results = await Promise.all(
      Array.from({ length: 100 }, (_unused, i) =>
        runAsTenant(
          {
            organizationId: `org-${i}`,
            clinicScope: { kind: 'EXPLICIT', clinicIds: [`clinic-${i}`] },
            actor: { kind: 'USER', id: `u${i}` },
          },
          async () => {
            await new Promise((r) => setTimeout(r, i % 9));
            const out = (await guardOperationArgs({ model: 'Patient', operation: 'findMany', args: {}, port })) as { where: Record<string, unknown> };
            return { i, where: out.where };
          },
        ),
      ),
    );
    for (const { i, where } of results) {
      assert.deepEqual(where, { organizationId: `org-${i}`, clinicId: { in: [`clinic-${i}`] } });
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
