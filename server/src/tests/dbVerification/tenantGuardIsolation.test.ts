/**
 * tenantGuardIsolation.test.ts — F3-2 cross-tenant isolation, against a REAL database.
 *
 * `tenantGuardUnit.test.ts` proves the guard's DECISIONS with a fake port. This
 * suite proves the things a fake port cannot, because they are properties of
 * Prisma and PostgreSQL rather than of our own code:
 *
 *   1. THE LOAD-BEARING ASSUMPTION. The guard merges its predicate into
 *      `where` for `findUnique` / `update` / `delete` / `upsert`, relying on
 *      Prisma's extended-where-unique behaviour (`WhereUniqueInput` is
 *      `AtLeast<unique key & full filter set>`). If Prisma accepted those extra
 *      filters TYPE-wise and ignored them at RUNTIME, the unit suite would
 *      still be green and every single-row read would be unguarded. §A tests
 *      that claim first, and nothing else in this file is meaningful until it
 *      passes.
 *   2. Real rows, two real organizations, two real clinics inside one of them:
 *      cross-ORGANIZATION and cross-CLINIC-within-one-organization are
 *      different failures and are tested separately.
 *   3. Real `$transaction` semantics — a client extension has to survive being
 *      derived into a transaction client, and the context has to survive the
 *      await chain inside it.
 *   4. Real bulk-write COUNTS. `updateMany` returning `{ count: 0 }` is the
 *      difference between "blocked" and "silently mutated another clinic's
 *      rows", and only a database can tell you which happened.
 *
 * Requires DATABASE_URL to point at a DISPOSABLE PostgreSQL — registered under
 * `server:test:disposable-db` (CI Layer 3), never under `server:test:non-disposable`.
 *
 * Every fixture is synthetic. No real patient data appears anywhere in this file.
 *
 * Run with: npx tsx src/tests/dbVerification/tenantGuardIsolation.test.ts
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import prisma from '../../db.js';
import { createTenantGuardedClient } from '../../tenancy/prismaTenantGuard.js';
import { TenantGuardError, type TenantGuardErrorCode } from '../../tenancy/tenantGuardErrors.js';
import { runAsSystem, runAsTenant } from '../../tenancy/tenantContext.js';

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

/**
 * THE GUARDED CLIENT. Built here, in a test, and nowhere else in the
 * repository — `server/src/db.ts` still exports a plain client, because
 * installing the extension on it is the frozen rollout step (see
 * tenancy/prismaTenantGuard.ts's header).
 */
const guarded = createTenantGuardedClient(prisma) as any;

// ─── Synthetic fixtures ──────────────────────────────────────────────────────

const createdOrgIds: string[] = [];
const createdPlanIds: string[] = [];

interface Tenant {
  organizationId: string;
  clinic1Id: string;
  clinic2Id: string;
  patientId: string;
  paymentPlanId: string;
  installmentId: string;
  auditLogId: string;
}

async function makeTenant(label: string): Promise<Tenant> {
  const suffix = randomUUID().slice(0, 8);
  const plan = await prisma.plan.create({
    data: {
      name: `tg-${label}-${suffix}`,
      displayName: `Tenant Guard ${label}`,
      maxUsers: 100,
      maxPatients: 100000,
      monthlyPrice: 0,
      features: {},
    },
  });
  createdPlanIds.push(plan.id);

  const organization = await prisma.organization.create({
    data: { name: `TgOrg-${label}-${suffix}`, slug: `tg-${label}-${suffix}`, planId: plan.id },
  });
  createdOrgIds.push(organization.id);

  const clinic1 = await prisma.clinic.create({
    data: { name: `TgClinic1-${label}-${suffix}`, slug: `tgc1-${label}-${suffix}`, organizationId: organization.id, maxPatients: 100000 },
  });
  const clinic2 = await prisma.clinic.create({
    data: { name: `TgClinic2-${label}-${suffix}`, slug: `tgc2-${label}-${suffix}`, organizationId: organization.id, maxPatients: 100000 },
  });

  const patient = await prisma.patient.create({
    data: { organizationId: organization.id, clinicId: clinic1.id, firstName: `Tg${label}`, lastName: `Patient${suffix}` },
  });

  const paymentPlan = await prisma.paymentPlan.create({
    data: { clinicId: clinic1.id, patientId: patient.id, totalAmount: 1000, installmentCount: 2 },
  });

  const installment = await prisma.paymentPlanInstallment.create({
    data: { planId: paymentPlan.id, installmentNo: 1, dueDate: new Date(), amount: 500 },
  });

  const auditLog = await prisma.auditLog.create({
    data: { organizationId: organization.id, action: 'tenant_guard_fixture', entityType: 'test' },
  });

  return {
    organizationId: organization.id,
    clinic1Id: clinic1.id,
    clinic2Id: clinic2.id,
    patientId: patient.id,
    paymentPlanId: paymentPlan.id,
    installmentId: installment.id,
    auditLogId: auditLog.id,
  };
}

async function cleanup() {
  for (const organizationId of createdOrgIds) {
    await prisma.paymentPlanInstallment.deleteMany({ where: { plan: { clinic: { organizationId } } } });
    await prisma.paymentPlan.deleteMany({ where: { clinic: { organizationId } } });
    await prisma.patientEmergencyContact.deleteMany({ where: { organizationId } });
    await prisma.patient.deleteMany({ where: { organizationId } });
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.clinic.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  }
  for (const planId of createdPlanIds) {
    await prisma.plan.deleteMany({ where: { id: planId } });
  }
}

/** Tenant context for organization `t`, restricted to one clinic. */
function asClinic1(t: Tenant) {
  return {
    organizationId: t.organizationId,
    clinicScope: { kind: 'EXPLICIT' as const, clinicIds: [t.clinic1Id] },
    actor: { kind: 'USER' as const, id: `user-${t.organizationId}` },
  };
}

/** Tenant context for organization `t`, org-wide (an OWNER). */
function asOrgWide(t: Tenant) {
  return {
    organizationId: t.organizationId,
    clinicScope: { kind: 'ORGANIZATION_WIDE' as const },
    actor: { kind: 'USER' as const, id: `owner-${t.organizationId}` },
  };
}

async function expectRefusal(code: TenantGuardErrorCode, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof TenantGuardError, `expected TenantGuardError, got ${String(err)}`);
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    return;
  }
  throw new Error(`expected refusal ${code}, but the operation succeeded`);
}

// ─── Suite ───────────────────────────────────────────────────────────────────

const A = await makeTenant('A');
const B = await makeTenant('B');

// ---------------------------------------------------------------------------
section('A. The load-bearing Prisma assumption: extended where-unique is HONOURED at runtime');
// ---------------------------------------------------------------------------

await test('an unguarded findUnique with an extra non-matching filter really does return null', async () => {
  // Straight Prisma, no guard involved. If this returns the row, every
  // single-row read the guard "protects" is in fact unprotected, and the
  // merge strategy in prismaTenantGuard.ts must be replaced with a probe.
  const hit = await prisma.patient.findUnique({
    where: { id: A.patientId, AND: [{ organizationId: B.organizationId }] },
  });
  assert.equal(hit, null, 'Prisma ignored an extra filter on findUnique — the guard strategy is unsound');
});

await test('an unguarded findUnique with a MATCHING extra filter still returns the row', async () => {
  const hit = await prisma.patient.findUnique({
    where: { id: A.patientId, AND: [{ organizationId: A.organizationId }] },
  });
  assert.equal(hit?.id, A.patientId, 'the extra filter must not break legitimate reads');
});

await test('an unguarded update with a non-matching extra filter fails rather than updating', async () => {
  await assert.rejects(
    prisma.patient.update({
      where: { id: A.patientId, AND: [{ organizationId: B.organizationId }] },
      data: { lastName: 'Hijacked' },
    }),
  );
  const row = await prisma.patient.findUnique({ where: { id: A.patientId } });
  assert.notEqual(row?.lastName, 'Hijacked');
});

// ---------------------------------------------------------------------------
section('B. Read isolation — cross ORGANIZATION');
// ---------------------------------------------------------------------------

await test('tenant A cannot read tenant B’s Patient by id', async () => {
  await runAsTenant(asClinic1(A), async () => {
    assert.equal(await guarded.patient.findUnique({ where: { id: B.patientId } }), null);
    assert.equal(await guarded.patient.findFirst({ where: { id: B.patientId } }), null);
    await assert.rejects(guarded.patient.findUniqueOrThrow({ where: { id: B.patientId } }));
  });
});

await test('tenant A’s findMany returns only its own patients', async () => {
  await runAsTenant(asClinic1(A), async () => {
    const rows = await guarded.patient.findMany({});
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      assert.equal(row.organizationId, A.organizationId);
      assert.equal(row.clinicId, A.clinic1Id);
    }
    assert.equal(rows.some((r: { id: string }) => r.id === B.patientId), false);
  });
});

await test('tenant A cannot read tenant B’s clinical/financial rows (clinicId-only model)', async () => {
  await runAsTenant(asClinic1(A), async () => {
    assert.equal(await guarded.paymentPlan.findUnique({ where: { id: B.paymentPlanId } }), null);
    const rows = await guarded.paymentPlan.findMany({});
    assert.equal(rows.some((r: { id: string }) => r.id === B.paymentPlanId), false);
  });
});

await test('tenant A cannot read tenant B’s organization-scoped rows (AuditLog)', async () => {
  await runAsTenant(asClinic1(A), async () => {
    assert.equal(await guarded.auditLog.findUnique({ where: { id: B.auditLogId } }), null);
    assert.equal(await guarded.auditLog.findUnique({ where: { id: A.auditLogId } }) !== null, true);
  });
});

await test('tenant A cannot read tenant B’s parent-scoped rows (PaymentPlanInstallment)', async () => {
  await runAsTenant(asClinic1(A), async () => {
    assert.equal(await guarded.paymentPlanInstallment.findUnique({ where: { id: B.installmentId } }), null);
    assert.notEqual(await guarded.paymentPlanInstallment.findUnique({ where: { id: A.installmentId } }), null);
  });
});

await test('count / aggregate / groupBy are constrained too, not just findMany', async () => {
  await runAsTenant(asClinic1(A), async () => {
    const counted = await guarded.patient.count({ where: { id: { in: [A.patientId, B.patientId] } } });
    assert.equal(counted, 1, 'count must not see across the tenant boundary');

    const aggregated = await guarded.paymentPlan.aggregate({
      _sum: { totalAmount: true },
      where: { id: { in: [A.paymentPlanId, B.paymentPlanId] } },
    });
    assert.equal(aggregated._sum.totalAmount, 1000, 'aggregate summed another tenant’s money');

    const grouped = await guarded.patient.groupBy({
      by: ['organizationId'],
      _count: { _all: true },
      where: { id: { in: [A.patientId, B.patientId] } },
    });
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].organizationId, A.organizationId);
  });
});

// ---------------------------------------------------------------------------
section('C. Read isolation — cross CLINIC inside ONE organization');
// ---------------------------------------------------------------------------

await test('a clinic-1-restricted context cannot read a clinic-2 row in its OWN organization', async () => {
  const sibling = await prisma.patient.create({
    data: { organizationId: A.organizationId, clinicId: A.clinic2Id, firstName: 'Sibling', lastName: 'Clinic2' },
  });
  await runAsTenant(asClinic1(A), async () => {
    assert.equal(await guarded.patient.findUnique({ where: { id: sibling.id } }), null);
  });
  // ...and an organization-wide context in the same organization CAN.
  await runAsTenant(asOrgWide(A), async () => {
    assert.notEqual(await guarded.patient.findUnique({ where: { id: sibling.id } }), null);
  });
});

await test('an organization-wide context still cannot cross the ORGANIZATION boundary', async () => {
  await runAsTenant(asOrgWide(A), async () => {
    assert.equal(await guarded.patient.findUnique({ where: { id: B.patientId } }), null);
    assert.equal(await guarded.paymentPlan.findUnique({ where: { id: B.paymentPlanId } }), null);
  });
});

await test('a context with an EMPTY clinic list reads nothing at all', async () => {
  await runAsTenant(
    { ...asClinic1(A), clinicScope: { kind: 'EXPLICIT', clinicIds: [] } },
    async () => {
      assert.deepEqual(await guarded.patient.findMany({}), []);
      assert.equal(await guarded.patient.count({}), 0);
    },
  );
});

// ---------------------------------------------------------------------------
section('D. Write isolation');
// ---------------------------------------------------------------------------

await test('tenant A cannot UPDATE tenant B’s row', async () => {
  await runAsTenant(asClinic1(A), async () => {
    await assert.rejects(guarded.patient.update({ where: { id: B.patientId }, data: { lastName: 'Hijacked' } }));
  });
  const after = await prisma.patient.findUnique({ where: { id: B.patientId } });
  assert.notEqual(after?.lastName, 'Hijacked');
});

await test('tenant A cannot DELETE tenant B’s row', async () => {
  await runAsTenant(asClinic1(A), async () => {
    await assert.rejects(guarded.patient.delete({ where: { id: B.patientId } }));
  });
  assert.notEqual(await prisma.patient.findUnique({ where: { id: B.patientId } }), null);
});

await test('updateMany over BOTH tenants affects exactly one row — the caller’s', async () => {
  await runAsTenant(asClinic1(A), async () => {
    const result = await guarded.patient.updateMany({
      where: { id: { in: [A.patientId, B.patientId] } },
      data: { notes: 'guard-updateMany-probe' },
    });
    assert.equal(result.count, 1, 'updateMany reached across the tenant boundary');
  });
  assert.equal((await prisma.patient.findUnique({ where: { id: A.patientId } }))?.notes, 'guard-updateMany-probe');
  assert.notEqual((await prisma.patient.findUnique({ where: { id: B.patientId } }))?.notes, 'guard-updateMany-probe');
});

await test('deleteMany over BOTH tenants deletes nothing of the other tenant’s', async () => {
  const throwaway = await prisma.patient.create({
    data: { organizationId: A.organizationId, clinicId: A.clinic1Id, firstName: 'Throw', lastName: 'Away' },
  });
  await runAsTenant(asClinic1(A), async () => {
    const result = await guarded.patient.deleteMany({ where: { id: { in: [throwaway.id, B.patientId] } } });
    assert.equal(result.count, 1);
  });
  assert.notEqual(await prisma.patient.findUnique({ where: { id: B.patientId } }), null);
  assert.equal(await prisma.patient.findUnique({ where: { id: throwaway.id } }), null);
});

await test('tenant A cannot CREATE a row carrying tenant B’s clinicId', async () => {
  await runAsTenant(asClinic1(A), async () => {
    await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
      guarded.patient.create({
        data: { organizationId: A.organizationId, clinicId: B.clinic1Id, firstName: 'X', lastName: 'Y' },
      }),
    );
  });
  const leaked = await prisma.patient.findFirst({ where: { clinicId: B.clinic1Id, firstName: 'X' } });
  assert.equal(leaked, null, 'the rejected create must leave no row behind');
});

await test('THE PAIRING ATTACK against the real database: A’s org + B’s clinic writes nothing', async () => {
  await runAsTenant(asClinic1(A), async () => {
    await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
      guarded.patient.create({
        data: { organizationId: A.organizationId, clinicId: B.clinic1Id, firstName: 'Pair', lastName: 'Attack' },
      }),
    );
  });
  assert.equal(await prisma.patient.findFirst({ where: { firstName: 'Pair', lastName: 'Attack' } }), null);
});

await test('a SIBLING clinic in the caller’s own organization is refused, in both the scalar and relation forms', async () => {
  // `Clinic` is organization-scoped, so proving the target clinic belongs to
  // the caller's organization is NOT enough — that is true of the sibling too.
  // The ownership relation is checked against the clinic SET.
  await runAsTenant(asClinic1(A), async () => {
    await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
      guarded.patient.create({ data: { firstName: 'Sib', lastName: 'Scalar', clinicId: A.clinic2Id } }),
    );
    await expectRefusal('CROSS_TENANT_WRITE_REJECTED', () =>
      guarded.patient.create({ data: { firstName: 'Sib', lastName: 'Relation', clinic: { connect: { id: A.clinic2Id } } } }),
    );
  });
  assert.equal(await prisma.patient.findFirst({ where: { firstName: 'Sib' } }), null);
});

await test('the caller’s OWN clinic still works through the relation form', async () => {
  let createdId = '';
  await runAsTenant(asClinic1(A), async () => {
    const created = await guarded.patient.create({
      data: { firstName: 'Own', lastName: 'Relation', clinic: { connect: { id: A.clinic1Id } } },
    });
    createdId = created.id;
  });
  const persisted = await prisma.patient.findUnique({ where: { id: createdId } });
  assert.equal(persisted?.clinicId, A.clinic1Id);
  assert.equal(persisted?.organizationId, A.organizationId);
});

await test('a create with no clinicId is filled in from the context and lands in the right clinic', async () => {
  let createdId = '';
  await runAsTenant(asClinic1(A), async () => {
    const created = await guarded.patient.create({ data: { firstName: 'Auto', lastName: 'Scoped' } });
    createdId = created.id;
    assert.equal(created.clinicId, A.clinic1Id);
    assert.equal(created.organizationId, A.organizationId);
  });
  const persisted = await prisma.patient.findUnique({ where: { id: createdId } });
  assert.equal(persisted?.clinicId, A.clinic1Id);
});

await test('upsert cannot hijack another tenant’s row', async () => {
  const before = await prisma.patient.findUnique({ where: { id: B.patientId } });
  await runAsTenant(asClinic1(A), async () => {
    // The where cannot match B's row through the guard, so Prisma falls to the
    // create branch — which the guard forces into A's tenant. Either way B's
    // row must be untouched, which is the property that matters.
    await guarded.patient
      .upsert({
        where: { id: B.patientId },
        create: { firstName: 'Ups', lastName: 'Ert' },
        update: { lastName: 'Hijacked' },
      })
      .catch(() => undefined);
  });
  const after = await prisma.patient.findUnique({ where: { id: B.patientId } });
  assert.equal(after?.lastName, before?.lastName, 'upsert mutated another tenant’s row');
});

// ---------------------------------------------------------------------------
section('E. Nested writes and parent ownership');
// ---------------------------------------------------------------------------

await test('a nested create inherits the caller’s tenant, in the database', async () => {
  let contactId = '';
  await runAsTenant(asClinic1(A), async () => {
    const created = await guarded.patient.create({
      data: {
        firstName: 'Nested',
        lastName: 'Parent',
        emergencyContacts: { create: [{ contactType: 'OTHER', fullName: 'Kin One' }] },
      },
      include: { emergencyContacts: true },
    });
    contactId = created.emergencyContacts[0].id;
  });
  const contact = await prisma.patientEmergencyContact.findUnique({ where: { id: contactId } });
  assert.equal(contact?.organizationId, A.organizationId);
  assert.equal(contact?.clinicId, A.clinic1Id);
});

await test('a nested connect to another tenant’s row is refused and writes nothing', async () => {
  await runAsTenant(asClinic1(A), async () => {
    await expectRefusal('CROSS_TENANT_RELATION_REJECTED', () =>
      guarded.paymentPlan.create({
        data: {
          totalAmount: 1,
          installmentCount: 1,
          patient: { connect: { id: B.patientId } },
        },
      }),
    );
  });
  assert.equal(await prisma.paymentPlan.findFirst({ where: { patientId: B.patientId, totalAmount: 1 } }), null);
});

await test('a parent-scoped create against another tenant’s parent is refused and writes nothing', async () => {
  await runAsTenant(asClinic1(A), async () => {
    await expectRefusal('CROSS_TENANT_RELATION_REJECTED', () =>
      guarded.paymentPlanInstallment.create({
        data: { planId: B.paymentPlanId, installmentNo: 99, dueDate: new Date(), amount: 1 },
      }),
    );
  });
  assert.equal(await prisma.paymentPlanInstallment.findFirst({ where: { planId: B.paymentPlanId, installmentNo: 99 } }), null);
});

await test('a parent-scoped create against the caller’s OWN parent succeeds', async () => {
  await runAsTenant(asClinic1(A), async () => {
    const created = await guarded.paymentPlanInstallment.create({
      data: { planId: A.paymentPlanId, installmentNo: 2, dueDate: new Date(), amount: 500 },
    });
    assert.equal(created.planId, A.paymentPlanId);
  });
});

// ---------------------------------------------------------------------------
section('F. Fail-closed defaults against the real client');
// ---------------------------------------------------------------------------

await test('a tenant-owned model with no execution context is refused', async () => {
  await expectRefusal('MISSING_TENANT_CONTEXT', () => guarded.patient.findMany({}));
  await expectRefusal('MISSING_TENANT_CONTEXT', () => guarded.patient.create({ data: { firstName: 'No', lastName: 'Ctx' } }));
});

await test('a SYSTEM_INTERNAL model is refused from tenant execution and allowed under system execution', async () => {
  await runAsTenant(asClinic1(A), async () => {
    await expectRefusal('SYSTEM_ONLY_MODEL', () => guarded.jobLock.findMany({}));
  });
  await runAsSystem({ reason: 'background-job', detail: 'tenant-guard-isolation-test' }, async () => {
    assert.ok(Array.isArray(await guarded.jobLock.findMany({})));
  });
});

await test('an EXPLICIT_REVIEW_REQUIRED model is refused from tenant execution and allowed under system execution', async () => {
  await runAsTenant(asClinic1(A), async () => {
    await expectRefusal('OWNERSHIP_UNRESOLVED_MODEL', () => guarded.securityIncident.findMany({}));
    await expectRefusal('OWNERSHIP_UNRESOLVED_MODEL', () => guarded.securitySignalEvent.count({}));
  });
  await runAsSystem({ reason: 'security-incident-lifecycle' }, async () => {
    assert.ok(Array.isArray(await guarded.securityIncident.findMany({})));
  });
});

await test('platform-global data is readable from tenant execution but not writable', async () => {
  await runAsTenant(asClinic1(A), async () => {
    assert.ok((await guarded.plan.findMany({})).length >= 1);
    await expectRefusal('PLATFORM_GLOBAL_WRITE_FORBIDDEN', () =>
      guarded.plan.create({ data: { name: `bad-${randomUUID()}`, displayName: 'Bad', maxUsers: 1, maxPatients: 1, monthlyPrice: 0, features: {} } }),
    );
  });
});

await test('raw SQL is refused from tenant execution and allowed under system execution', async () => {
  await runAsTenant(asClinic1(A), async () => {
    await expectRefusal('RAW_SQL_FORBIDDEN_IN_TENANT_CONTEXT', () => guarded.$queryRaw`SELECT 1`);
  });
  await runAsSystem({ reason: 'database-health-check' }, async () => {
    const rows = await guarded.$queryRaw`SELECT 1 AS one`;
    assert.equal((rows as Array<{ one: number }>)[0].one, 1);
  });
});

// ---------------------------------------------------------------------------
section('G. Interactive transactions');
// ---------------------------------------------------------------------------

await test('the guard applies inside $transaction, and the context survives the await chain', async () => {
  await runAsTenant(asClinic1(A), async () => {
    await guarded.$transaction(async (tx: any) => {
      assert.equal(await tx.patient.findUnique({ where: { id: B.patientId } }), null);
      const own = await tx.patient.findUnique({ where: { id: A.patientId } });
      assert.equal(own?.id, A.patientId);
      const rows = await tx.patient.findMany({});
      assert.equal(rows.some((r: { id: string }) => r.id === B.patientId), false);
    });
  });
});

await test('a cross-tenant write inside a transaction rolls the whole transaction back', async () => {
  await runAsTenant(asClinic1(A), async () => {
    await assert.rejects(
      guarded.$transaction(async (tx: any) => {
        await tx.patient.create({ data: { firstName: 'Tx', lastName: 'Rollback' } });
        await tx.patient.create({ data: { firstName: 'Tx', lastName: 'Foreign', clinicId: B.clinic1Id } });
      }),
    );
  });
  assert.equal(
    await prisma.patient.findFirst({ where: { firstName: 'Tx', lastName: 'Rollback' } }),
    null,
    'the first insert must have rolled back with the refused second one',
  );
});

// ---------------------------------------------------------------------------
section('H. Concurrency against a real database');
// ---------------------------------------------------------------------------

await test('two tenants querying concurrently through ONE guarded client never see each other', async () => {
  const rounds = 12;
  const results = await Promise.all(
    Array.from({ length: rounds }, (_unused, i) => {
      const tenant = i % 2 === 0 ? A : B;
      return runAsTenant(asClinic1(tenant), async () => {
        await new Promise((r) => setTimeout(r, i % 5));
        const rows = await guarded.patient.findMany({ select: { id: true, organizationId: true } });
        await new Promise((r) => setTimeout(r, (rounds - i) % 3));
        const count = await guarded.patient.count({});
        return { expected: tenant.organizationId, rows, count };
      });
    }),
  );

  for (const { expected, rows, count } of results) {
    assert.ok(count >= 1);
    for (const row of rows) assert.equal(row.organizationId, expected, 'cross-contamination between concurrent tenants');
  }
});

// ---------------------------------------------------------------------------
section('I. Layer 1 is intact — the unguarded client is completely unaffected');
// ---------------------------------------------------------------------------

await test('the default exported client still has no tenant predicate injected', async () => {
  // F3-2 must not silently change behaviour for the ~90 route files that use
  // `prisma` directly; the guard is opt-in until rollout is authorized.
  await runAsTenant(asClinic1(A), async () => {
    const crossTenant = await prisma.patient.findUnique({ where: { id: B.patientId } });
    assert.notEqual(crossTenant, null, 'db.ts must remain unguarded until the rollout decision is made');
  });
});

await test('the guarded client is a distinct object; wrapping did not mutate the shared one', () => {
  assert.notEqual(guarded, prisma);
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
await cleanup();
await prisma.$disconnect();
if (failed > 0) process.exit(1);
