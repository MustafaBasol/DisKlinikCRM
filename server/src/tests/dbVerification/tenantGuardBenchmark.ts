/**
 * tenantGuardBenchmark.ts — F3-2 guard overhead measurement.
 *
 * The guard runs on every data path in the application, so "how much does it
 * cost" is a rollout question, not a curiosity. This script answers it with
 * measurements rather than intuition.
 *
 * WHAT IS COMPARED, AND WHY IT IS COMPARED THAT WAY
 * ------------------------------------------------
 * The baseline is NOT "the same query with no tenant predicate". That would
 * measure the cost of tenant isolation itself, which the application already
 * pays today through `clinicScope.ts`, and would flatter nothing. The baseline
 * is the query WITH the predicate a Layer-1 route writes by hand — so what is
 * reported is the marginal cost of the extension: the interception, the
 * registry lookup, the argument rewrite, and (for writes) the ownership checks.
 *
 * Two figures are produced for each operation:
 *   - END-TO-END, through a real PostgreSQL. Realistic, but dominated by
 *     network and planner noise, which is exactly why the second figure exists.
 *   - REWRITE-ONLY, `guardOperationArgs()` with no database at all. This is the
 *     CPU the guard actually adds, and it is the number that generalises beyond
 *     this laptop.
 *
 * NOT A PRODUCTION MEASUREMENT. Local/CI only. No claim is made here about
 * production latency, and none should be derived from this output.
 *
 * Deliberately NOT part of any CI chain: it asserts nothing, and a timing
 * assertion in CI is a flake generator. Run it by hand and record the numbers:
 *
 *   DATABASE_URL=... npm run test:tenant-guard-benchmark
 */

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import prisma from '../../db.js';
import {
  createPrismaTenantGuardPort,
  createTenantGuardedClient,
  guardOperationArgs,
} from '../../tenancy/prismaTenantGuard.js';
import { runAsTenant, type TenantExecutionContext } from '../../tenancy/tenantContext.js';

const SEED_PATIENTS = 400;
const WARMUP = 30;
const ITERATIONS = 300;
const REWRITE_ITERATIONS = 20_000;

const guarded = createTenantGuardedClient(prisma) as any;
const port = createPrismaTenantGuardPort(prisma);

interface Stats {
  median: number;
  p95: number;
  mean: number;
  samples: number;
}

function summarize(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    median: at(0.5),
    p95: at(0.95),
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    samples: sorted.length,
  };
}

async function measure(fn: (i: number) => Promise<unknown>): Promise<Stats> {
  for (let i = 0; i < WARMUP; i += 1) await fn(i);
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    await fn(i);
    samples.push(performance.now() - start);
  }
  return summarize(samples);
}

function ms(value: number): string {
  return `${value.toFixed(3)} ms`;
}

function reportRow(label: string, baseline: Stats, guardedStats: Stats): void {
  const overheadMedian = guardedStats.median - baseline.median;
  const pct = baseline.median > 0 ? (overheadMedian / baseline.median) * 100 : 0;
  console.log(
    `  ${label.padEnd(34)} baseline ${ms(baseline.median).padStart(10)} / p95 ${ms(baseline.p95).padStart(10)}` +
      `   guarded ${ms(guardedStats.median).padStart(10)} / p95 ${ms(guardedStats.p95).padStart(10)}` +
      `   overhead ${ms(overheadMedian).padStart(10)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`,
  );
}

async function main() {
  const suffix = randomUUID().slice(0, 8);

  const plan = await prisma.plan.create({
    data: { name: `bench-${suffix}`, displayName: 'Benchmark', maxUsers: 1000, maxPatients: 1_000_000, monthlyPrice: 0, features: {} },
  });
  const organization = await prisma.organization.create({
    data: { name: `BenchOrg-${suffix}`, slug: `bench-${suffix}`, planId: plan.id },
  });
  const clinic = await prisma.clinic.create({
    data: { name: `BenchClinic-${suffix}`, slug: `benchc-${suffix}`, organizationId: organization.id, maxPatients: 1_000_000 },
  });

  await prisma.patient.createMany({
    data: Array.from({ length: SEED_PATIENTS }, (_unused, i) => ({
      organizationId: organization.id,
      clinicId: clinic.id,
      firstName: `Bench${i}`,
      lastName: `Patient${suffix}`,
    })),
  });
  const seeded = await prisma.patient.findMany({ where: { organizationId: organization.id }, select: { id: true } });
  const ids = seeded.map((row) => row.id);

  const context: Omit<TenantExecutionContext, 'mode'> = {
    organizationId: organization.id,
    clinicScope: { kind: 'EXPLICIT', clinicIds: [clinic.id] },
    actor: { kind: 'USER', id: 'bench-user' },
  };

  // The predicate a Layer-1 route writes by hand today — the honest baseline.
  const layer1Where = { organizationId: organization.id, clinicId: clinic.id };

  console.log('\nF3-2 tenant guard — overhead measurement');
  console.log(`  seeded patients: ${ids.length}   warmup: ${WARMUP}   iterations: ${ITERATIONS}`);
  console.log(`  node ${process.version}   platform ${process.platform} ${process.arch}`);
  console.log('\nEnd-to-end (real PostgreSQL; includes network + planner noise)');

  const findManyBaseline = await measure(() => prisma.patient.findMany({ where: layer1Where, take: 50 }));
  const findManyGuarded = await measure(() => runAsTenant(context, () => guarded.patient.findMany({ take: 50 })));
  reportRow('findMany(take: 50)', findManyBaseline, findManyGuarded);

  const findUniqueBaseline = await measure((i) => prisma.patient.findUnique({ where: { id: ids[i % ids.length], AND: [layer1Where] } }));
  const findUniqueGuarded = await measure((i) => runAsTenant(context, () => guarded.patient.findUnique({ where: { id: ids[i % ids.length] } })));
  reportRow('findUnique(by id)', findUniqueBaseline, findUniqueGuarded);

  const countBaseline = await measure(() => prisma.patient.count({ where: layer1Where }));
  const countGuarded = await measure(() => runAsTenant(context, () => guarded.patient.count({})));
  reportRow('count', countBaseline, countGuarded);

  const updateBaseline = await measure((i) =>
    prisma.patient.update({ where: { id: ids[i % ids.length], AND: [layer1Where] }, data: { notes: `b${i}` } }),
  );
  const updateGuarded = await measure((i) =>
    runAsTenant(context, () => guarded.patient.update({ where: { id: ids[i % ids.length] }, data: { notes: `g${i}` } })),
  );
  reportRow('update(by id)', updateBaseline, updateGuarded);

  const createdBaselineIds: string[] = [];
  const createBaseline = await measure(async (i) => {
    const row = await prisma.patient.create({ data: { ...layer1Where, firstName: `CB${i}`, lastName: suffix } });
    createdBaselineIds.push(row.id);
  });
  const createdGuardedIds: string[] = [];
  const createGuarded = await measure(async (i) => {
    const row = (await runAsTenant(context, () =>
      guarded.patient.create({ data: { firstName: `CG${i}`, lastName: suffix } }),
    )) as { id: string };
    createdGuardedIds.push(row.id);
  });
  reportRow('create', createBaseline, createGuarded);

  // Parent-scoped writes are the expensive shape by construction: the guard has
  // to fetch the parent's ownership before the insert. Measured explicitly so
  // the cost is a number rather than a worry.
  const patientForPlans = ids[0];
  const paymentPlan = await prisma.paymentPlan.create({
    data: { clinicId: clinic.id, patientId: patientForPlans, totalAmount: 100, installmentCount: 1 },
  });
  const installmentBaseline = await measure((i) =>
    prisma.paymentPlanInstallment.create({ data: { planId: paymentPlan.id, installmentNo: 100000 + i, dueDate: new Date(), amount: 1 } }),
  );
  const installmentGuarded = await measure((i) =>
    runAsTenant(context, () =>
      guarded.paymentPlanInstallment.create({ data: { planId: paymentPlan.id, installmentNo: 200000 + i, dueDate: new Date(), amount: 1 } }),
    ),
  );
  reportRow('create (PARENT_SCOPED, +1 lookup)', installmentBaseline, installmentGuarded);

  // ── Rewrite-only: the CPU the guard adds, with no database at all ──────────
  console.log('\nRewrite-only (no database; the guard’s own CPU cost per operation)');

  async function measureRewrite(label: string, model: string, operation: string, args: unknown) {
    const samples: number[] = [];
    await runAsTenant(context, async () => {
      for (let i = 0; i < 1000; i += 1) await guardOperationArgs({ model, operation, args, port });
      for (let i = 0; i < REWRITE_ITERATIONS; i += 1) {
        const start = performance.now();
        await guardOperationArgs({ model, operation, args, port });
        samples.push(performance.now() - start);
      }
    });
    const stats = summarize(samples);
    console.log(
      `  ${label.padEnd(34)} median ${ms(stats.median).padStart(10)}   p95 ${ms(stats.p95).padStart(10)}   mean ${ms(stats.mean).padStart(10)}   n=${stats.samples}`,
    );
  }

  await measureRewrite('read rewrite (DUAL_KEY)', 'Patient', 'findMany', { where: { firstName: 'x' } });
  await measureRewrite('read rewrite (CLINIC_ID)', 'PaymentPlan', 'findMany', {});
  await measureRewrite('read rewrite (ORGANIZATION_ID)', 'AuditLog', 'findMany', {});
  await measureRewrite('read rewrite (PARENT_SCOPED)', 'PaymentPlanInstallment', 'findMany', {});
  await measureRewrite('write validate (create)', 'Patient', 'create', { data: { firstName: 'a', lastName: 'b' } });
  await measureRewrite('write validate (nested create)', 'Patient', 'create', {
    data: { firstName: 'a', lastName: 'b', emergencyContacts: { create: [{ contactType: 'OTHER', fullName: 'K' }] } },
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await prisma.paymentPlanInstallment.deleteMany({ where: { planId: paymentPlan.id } });
  await prisma.paymentPlan.deleteMany({ where: { clinicId: clinic.id } });
  await prisma.patientEmergencyContact.deleteMany({ where: { organizationId: organization.id } });
  await prisma.patient.deleteMany({ where: { organizationId: organization.id } });
  await prisma.clinic.deleteMany({ where: { organizationId: organization.id } });
  await prisma.organization.deleteMany({ where: { id: organization.id } });
  await prisma.plan.deleteMany({ where: { id: plan.id } });
  await prisma.$disconnect();

  console.log('\nLocal/CI measurement only. No production latency claim is made or implied.\n');
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
