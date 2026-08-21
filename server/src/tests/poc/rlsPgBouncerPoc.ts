/**
 * rlsPgBouncerPoc.ts — F3-3 PostgreSQL FORCE RLS + PgBouncer transaction-mode PoC.
 *
 * ISOLATED, DISPOSABLE, NON-PRODUCTION. Provisions its own throwaway PostgreSQL
 * and PgBouncer containers, proves what it can, and destroys them. It never
 * reads `DATABASE_URL`, never touches a shared database, creates no Prisma
 * migration, and changes nothing in the application.
 *
 * This is the execution of the PoC that
 * `docs/architecture/tenant-rls-pgbouncer-poc-design.md` (F0-009) designed and
 * explicitly declined to run. That document's §12 classifies "Rollout Stage 7
 * (disposable RLS PoC execution)" and "Stage 9 (PgBouncer staging PoC)" as
 * *"Allowed now: isolated disposable PoC only — not authorized to actually run
 * by this document; a future task must explicitly schedule and execute it."*
 * F3-3 is that task.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a rollout, not a migration, and not evidence that RLS may be
 * enabled in production. ADR-004 and ADR-005 stay `NEEDS_POC` until a human
 * reviews this output.
 *
 * Not registered in any CI chain: it needs Docker, takes minutes, and measures
 * latency — three properties that make a bad CI gate.
 *
 *   npm run poc:f3-3-rls
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import {
  APP_ROLE,
  MIGRATOR_ROLE,
  PGBOUNCER_IMAGE,
  PLATFORM_ROLE,
  POSTGRES_IMAGE,
  applyPrismaSchema,
  applyRolesAndPolicies,
  assertDockerAvailable,
  pgbouncerVersion,
  provisionPocEnvironment,
  psql,
  psqlFile,
  startPgBouncer,
  teardownPocEnvironment,
  type PocEnvironment,
} from './rlsPocEnvironment.js';

// ─── Result recording ────────────────────────────────────────────────────────

type Outcome = 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO';

interface ExperimentResult {
  readonly id: string;
  readonly title: string;
  readonly outcome: Outcome;
  readonly detail: string;
}

const results: ExperimentResult[] = [];
let currentSection = '';

function section(title: string) {
  currentSection = title;
  console.log(`\n${'─'.repeat(78)}\n${title}\n${'─'.repeat(78)}`);
}

async function experiment(id: string, title: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    results.push({ id, title, outcome: 'PASS', detail });
    console.log(`  ✅ ${id}  ${title}`);
    if (detail) console.log(`        ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    results.push({ id, title, outcome: 'FAIL', detail });
    console.error(`  ❌ ${id}  ${title}`);
    console.error(`        ${detail.split('\n').slice(0, 6).join('\n        ')}`);
  }
}

function record(id: string, title: string, outcome: Outcome, detail: string) {
  results.push({ id, title, outcome, detail });
  const icon = outcome === 'PASS' ? '✅' : outcome === 'FAIL' ? '❌' : outcome === 'BLOCKED' ? '⛔' : 'ℹ️ ';
  console.log(`  ${icon} ${id}  ${title}`);
  if (detail) console.log(`        ${detail}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ─── Tenant context helper — the thing under test ────────────────────────────

interface TenantIdentity {
  readonly organizationId: string;
  readonly clinicIds: readonly string[];
}

/**
 * Runs `fn` inside ONE database transaction carrying transaction-local tenant
 * identity.
 *
 * `set_config(..., is_local => true)` is the entire design. `SET` (session
 * scope) would survive the transaction, outlive the request, and — under a
 * transaction-pooling PgBouncer — be inherited by whichever unrelated tenant
 * borrowed the connection next. Experiments TX2/TX5 and PB3 exist to prove
 * that distinction rather than trust it.
 */
async function inTenantTransaction<T>(
  client: PrismaClient,
  tenant: TenantIdentity,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${tenant.organizationId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.clinic_ids', ${tenant.clinicIds.join(',')}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

/**
 * The same thing, with both settings issued in ONE statement.
 *
 * Exists because the first benchmark reported RLS "costing" +50-75%, and that
 * number was mostly an artefact of measurement: the RLS path issues two extra
 * round trips per transaction that the baseline does not, and on this
 * Docker-on-Windows loopback a round trip is ~1.3 ms against a ~5 ms query.
 * Separating the two costs is the difference between "RLS is expensive" and
 * "asking the database twice is expensive".
 */
async function inTenantTransactionOneRoundTrip<T>(
  client: PrismaClient,
  tenant: TenantIdentity,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT
      set_config('app.organization_id', ${tenant.organizationId}, true),
      set_config('app.clinic_ids', ${tenant.clinicIds.join(',')}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

function makeClient(connectionString: string, max = 5): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max, connectionTimeoutMillis: 15_000 }) });
}

/** PostgreSQL SQLSTATE for a row-level-security WITH CHECK violation. */
const RLS_VIOLATION = '42501';
const FOREIGN_KEY_VIOLATION = '23503';

function sqlState(err: unknown): string | undefined {
  const meta = (err as { meta?: { code?: string }; code?: string })?.meta;
  return meta?.code ?? (err as { code?: string })?.code;
}

async function expectRlsRefusal(fn: () => Promise<unknown>, what: string): Promise<string> {
  try {
    await fn();
  } catch (err) {
    const state = sqlState(err);
    const message = err instanceof Error ? err.message : String(err);
    assert(
      state === RLS_VIOLATION || /row-level security/i.test(message),
      `${what}: expected an RLS policy violation, got ${state ?? 'no SQLSTATE'} — ${message.slice(0, 200)}`,
    );
    return `refused with ${state ?? 'row-level security'}`;
  }
  throw new Error(`${what}: the operation SUCCEEDED and must not have`);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface Fixture {
  organizationId: string;
  clinic1Id: string;
  clinic2Id: string;
  patientClinic1Id: string;
  patientClinic2Id: string;
  paymentPlanId: string;
  installmentId: string;
}

async function seedTenant(migrator: PrismaClient, label: string): Promise<Fixture> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const plan = await migrator.plan.create({
    data: { name: `poc-${suffix}`, displayName: `PoC ${label}`, maxUsers: 100, maxPatients: 100000, monthlyPrice: 0, features: {} },
  });
  const organization = await migrator.organization.create({
    data: { name: `PocOrg-${suffix}`, slug: `poc-${suffix}`, planId: plan.id },
  });
  const clinic1 = await migrator.clinic.create({
    data: { name: `PocClinic1-${suffix}`, slug: `pc1-${suffix}`, organizationId: organization.id, maxPatients: 100000 },
  });
  const clinic2 = await migrator.clinic.create({
    data: { name: `PocClinic2-${suffix}`, slug: `pc2-${suffix}`, organizationId: organization.id, maxPatients: 100000 },
  });
  const patient1 = await migrator.patient.create({
    data: { organizationId: organization.id, clinicId: clinic1.id, firstName: `P1${label}`, lastName: suffix },
  });
  const patient2 = await migrator.patient.create({
    data: { organizationId: organization.id, clinicId: clinic2.id, firstName: `P2${label}`, lastName: suffix },
  });
  const paymentPlan = await migrator.paymentPlan.create({
    data: { clinicId: clinic1.id, patientId: patient1.id, totalAmount: 1000, installmentCount: 2 },
  });
  const installment = await migrator.paymentPlanInstallment.create({
    data: { planId: paymentPlan.id, installmentNo: 1, dueDate: new Date(), amount: 500 },
  });

  return {
    organizationId: organization.id,
    clinic1Id: clinic1.id,
    clinic2Id: clinic2.id,
    patientClinic1Id: patient1.id,
    patientClinic2Id: patient2.id,
    paymentPlanId: paymentPlan.id,
    installmentId: installment.id,
  };
}

// ─── Latency helpers ─────────────────────────────────────────────────────────

interface Stats { median: number; p95: number; p99: number; mean: number; n: number }

function summarize(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: at(0.5), p95: at(0.95), p99: at(0.99), mean: sorted.reduce((a, b) => a + b, 0) / sorted.length, n: sorted.length };
}

async function measure(iterations: number, warmup: number, fn: () => Promise<unknown>): Promise<Stats> {
  for (let i = 0; i < warmup; i += 1) await fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  return summarize(samples);
}

const NO_STATS: Stats = { median: NaN, p95: NaN, p99: NaN, mean: NaN, n: 0 };

/**
 * A measurement that fails must not take the whole report with it. The
 * correctness experiments above are the point of this run; losing their
 * printed results because a benchmark threw would be the worst possible
 * trade.
 */
async function measureOrRecord(id: string, title: string, iterations: number, warmup: number, fn: () => Promise<unknown>): Promise<Stats> {
  try {
    return await measure(iterations, warmup, fn);
  } catch (err) {
    record(id, title, 'FAIL', `measurement failed: ${err instanceof Error ? err.message : String(err)}`);
    return NO_STATS;
  }
}

const ms = (v: number) => `${v.toFixed(3)} ms`;

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('F3-3 — FORCE RLS + PgBouncer transaction-mode PoC (isolated, disposable, non-production)\n');

  const dockerVersion = assertDockerAvailable();
  console.log(`  docker server   ${dockerVersion}`);
  console.log(`  postgres image  ${POSTGRES_IMAGE}`);
  console.log(`  pgbouncer image ${PGBOUNCER_IMAGE}`);
  console.log(`  pgbouncer       ${pgbouncerVersion()}`);
  console.log(`  node            ${process.version} ${process.platform} ${process.arch}`);

  const env: PocEnvironment = provisionPocEnvironment();
  const clients: PrismaClient[] = [];

  try {
    console.log(`\n  run id          ${env.runId}`);
    console.log('  applying the REAL Prisma schema as the migrator role...');
    applyPrismaSchema(env);
    console.log('  applying PoC roles, FORCE RLS and policies...');
    applyRolesAndPolicies(env);

    const migrator = makeClient(env.directUrls.migrator);
    const appDirect = makeClient(env.directUrls.app);
    const platformDirect = makeClient(env.directUrls.platform);
    clients.push(migrator, appDirect, platformDirect);

    const A = await seedTenant(migrator, 'A');
    const B = await seedTenant(migrator, 'B');

    const tenantAOneClinic: TenantIdentity = { organizationId: A.organizationId, clinicIds: [A.clinic1Id] };
    const tenantABothClinics: TenantIdentity = { organizationId: A.organizationId, clinicIds: [A.clinic1Id, A.clinic2Id] };
    const tenantB: TenantIdentity = { organizationId: B.organizationId, clinicIds: [B.clinic1Id] };

    // ═══ S. Role separation ═════════════════════════════════════════════════
    section('S. Role separation and RLS status (F0-009 §7.2)');

    await experiment('S1', 'the runtime role is not superuser and does NOT have BYPASSRLS', async () => {
      const rows = await migrator.$queryRaw<Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>>`
        SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
        WHERE rolname IN (${MIGRATOR_ROLE}, ${APP_ROLE}, ${PLATFORM_ROLE}) ORDER BY rolname`;
      const app = rows.find((r) => r.rolname === APP_ROLE)!;
      const platform = rows.find((r) => r.rolname === PLATFORM_ROLE)!;
      const mig = rows.find((r) => r.rolname === MIGRATOR_ROLE)!;
      assert(app && !app.rolsuper && !app.rolbypassrls, `${APP_ROLE} must be a plain role`);
      assert(platform && !platform.rolsuper && !platform.rolbypassrls, `${PLATFORM_ROLE} must NOT rely on BYPASSRLS`);
      assert(mig.rolbypassrls, `${MIGRATOR_ROLE} must have BYPASSRLS to migrate and seed`);
      return `${APP_ROLE}: super=false bypassrls=false · ${PLATFORM_ROLE}: super=false bypassrls=false · ${MIGRATOR_ROLE}: bypassrls=true`;
    });

    await experiment('S2', 'the runtime role owns NONE of the guarded tables', async () => {
      const rows = await migrator.$queryRaw<Array<{ tablename: string; tableowner: string }>>`
        SELECT tablename, tableowner FROM pg_tables
        WHERE tablename IN ('Clinic', 'Patient', 'PaymentPlan', 'PaymentPlanInstallment') ORDER BY tablename`;
      assert(rows.length === 4, `expected 4 guarded tables, found ${rows.length}`);
      for (const row of rows) assert(row.tableowner === MIGRATOR_ROLE, `${row.tablename} is owned by ${row.tableowner}`);
      return `all four owned by ${MIGRATOR_ROLE}`;
    });

    await experiment('S3', 'all four guarded tables have RLS ENABLED and FORCED', async () => {
      const rows = await migrator.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
        SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname IN ('Clinic', 'Patient', 'PaymentPlan', 'PaymentPlanInstallment') ORDER BY relname`;
      assert(rows.length === 4, `expected 4 rows, got ${rows.length}`);
      for (const row of rows) {
        assert(row.relrowsecurity, `${row.relname}: RLS not enabled`);
        assert(row.relforcerowsecurity, `${row.relname}: RLS not FORCED`);
      }
      return 'Clinic, Patient, PaymentPlan, PaymentPlanInstallment — all ENABLE + FORCE';
    });

    await experiment('S4', 'no policy contains an IS NULL escape hatch', async () => {
      // The single most dangerous RLS mistake:
      //   USING (tenant = current_setting(...) OR current_setting(...) IS NULL)
      // turns a MISSING context into TOTAL access. Asserted against the
      // catalogue rather than against our own source file, so a hand-edited
      // policy would be caught too.
      const rows = await migrator.$queryRaw<Array<{ policyname: string; qual: string | null; with_check: string | null }>>`
        SELECT policyname, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY policyname`;
      const tenantPolicies = rows.filter((r) => r.policyname.includes('tenant_isolation'));
      assert(tenantPolicies.length === 4, `expected 4 tenant policies, found ${tenantPolicies.length}`);
      for (const row of tenantPolicies) {
        for (const clause of [row.qual, row.with_check]) {
          assert(clause, `${row.policyname}: missing a clause — a policy without WITH CHECK constrains reads only`);
          assert(!/IS NULL/i.test(clause), `${row.policyname} contains an IS NULL escape: ${clause}`);
        }
      }
      return `${tenantPolicies.length} tenant policies, all with USING + WITH CHECK, none permissive on a missing setting`;
    });

    // ═══ F. ENABLE vs FORCE ═════════════════════════════════════════════════
    section('F. ENABLE vs FORCE — proved, not assumed (F0-009 §7.3)');

    await experiment('F1', 'ENABLE only: the table OWNER bypasses a deny-all policy entirely', async () => {
      const rows = await appDirect.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM poc_force_demo`;
      const count = Number(rows[0].count);
      assert(count === 2, `expected the owner to see all 2 rows under ENABLE-only, saw ${count}`);
      return `owner sees 2/2 rows despite USING (false) — this is the trap FORCE exists to close`;
    });

    await experiment('F2', 'adding FORCE closes it: the same owner, same policy, now sees nothing', async () => {
      psql(env, 'ALTER TABLE poc_force_demo FORCE ROW LEVEL SECURITY;');
      const rows = await appDirect.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM poc_force_demo`;
      const count = Number(rows[0].count);
      assert(count === 0, `expected 0 rows under FORCE, saw ${count}`);
      return 'owner sees 0/2 rows — the ONLY thing that changed is the FORCE flag';
    });

    await experiment('F3', 'removing FORCE restores the bypass, confirming the flag is the cause', async () => {
      psql(env, 'ALTER TABLE poc_force_demo NO FORCE ROW LEVEL SECURITY;');
      const rows = await appDirect.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM poc_force_demo`;
      const count = Number(rows[0].count);
      assert(count === 2, `expected 2 rows again, saw ${count}`);
      psql(env, 'ALTER TABLE poc_force_demo FORCE ROW LEVEL SECURITY;');
      return 'bypass returns with NO FORCE and disappears with FORCE — reversible and attributable';
    });

    // ═══ M. Missing / malformed context ═════════════════════════════════════
    section('M. Missing and malformed tenant context (F0-009 §7.3, §7.5)');

    await experiment('M1', 'a query with NO tenant context returns zero rows on every guarded table', async () => {
      const counts = await appDirect.$queryRaw<Array<{ patients: bigint; plans: bigint; installments: bigint; clinics: bigint }>>`
        SELECT
          (SELECT COUNT(*) FROM "Patient")::bigint AS patients,
          (SELECT COUNT(*) FROM "PaymentPlan")::bigint AS plans,
          (SELECT COUNT(*) FROM "PaymentPlanInstallment")::bigint AS installments,
          (SELECT COUNT(*) FROM "Clinic")::bigint AS clinics`;
      const row = counts[0];
      for (const [name, value] of Object.entries(row)) {
        assert(Number(value) === 0, `${name}: expected 0 rows with no context, saw ${value}`);
      }
      return 'Patient 0 · PaymentPlan 0 · PaymentPlanInstallment 0 · Clinic 0 — fail closed, not fail open';
    });

    await experiment('M2', 'an INSERT with NO tenant context is refused by WITH CHECK', async () => {
      return expectRlsRefusal(
        () => appDirect.$executeRaw`
          INSERT INTO "Patient" (id, "clinicId", "organizationId", "firstName", "lastName", "updatedAt")
          VALUES (${randomUUID()}, ${A.clinic1Id}, ${A.organizationId}, 'NoCtx', 'Insert', NOW())`,
        'insert with no context',
      );
    });

    await experiment('M3', 'an EMPTY context value is treated as missing, not as a wildcard', async () => {
      const rows = await appDirect.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', '', true)`;
        await tx.$executeRaw`SELECT set_config('app.clinic_ids', '', true)`;
        return tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient"`;
      });
      assert(Number(rows[0].count) === 0, `expected 0 rows for an empty context, saw ${rows[0].count}`);
      return 'empty string -> NULL -> no rows (nullif() in app_current_organization_id is what does this)';
    });

    await experiment('M4', 'a MALFORMED context value returns zero rows', async () => {
      const rows = await appDirect.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', 'not-a-real-id; DROP TABLE x', true)`;
        await tx.$executeRaw`SELECT set_config('app.clinic_ids', ',,,garbage,,', true)`;
        return tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient"`;
      });
      assert(Number(rows[0].count) === 0, `expected 0 rows for a malformed context, saw ${rows[0].count}`);
      return 'zero rows. NOTE: NoraMedi ids are `text`, not `uuid`, so a malformed value cannot raise a cast error — ' +
        'it simply matches nothing. A uuid-typed column would fail LOUDER; see the evidence document.';
    });

    await experiment('M5', 'a role with no policy at all on a FORCE\'d table sees nothing (deny by default)', async () => {
      psql(env, `
        CREATE TABLE poc_no_policy (id text PRIMARY KEY);
        INSERT INTO poc_no_policy VALUES ('row-1'), ('row-2');
        ALTER TABLE poc_no_policy ENABLE ROW LEVEL SECURITY;
        ALTER TABLE poc_no_policy FORCE ROW LEVEL SECURITY;
        GRANT SELECT ON poc_no_policy TO ${APP_ROLE};
      `);
      const rows = await appDirect.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM poc_no_policy`;
      assert(Number(rows[0].count) === 0, `expected 0 rows with no policy, saw ${rows[0].count}`);
      return 'RLS with no matching policy denies — a forgotten policy hides data rather than exposing it';
    });

    // ═══ T. The correct tenant ══════════════════════════════════════════════
    section('T. The correct tenant sees exactly its own rows');

    await experiment('T1', 'tenant A sees its own patients and nothing else', async () => {
      const rows = await inTenantTransaction(appDirect, tenantABothClinics, (tx) =>
        tx.$queryRaw<Array<{ id: string; organizationId: string }>>`SELECT id, "organizationId" FROM "Patient"`);
      assert(rows.length === 2, `expected A's 2 patients, saw ${rows.length}`);
      for (const row of rows) assert(row.organizationId === A.organizationId, 'a foreign row was visible');
      return `2 rows, both organization A`;
    });

    await experiment('T2', 'a clinic-1-restricted context does NOT see clinic 2 of its own organization', async () => {
      const rows = await inTenantTransaction(appDirect, tenantAOneClinic, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Patient"`);
      assert(rows.length === 1, `expected 1 row, saw ${rows.length}`);
      assert(rows[0].id === A.patientClinic1Id, 'the wrong clinic’s patient was visible');
      return 'cross-clinic-within-one-organization is a DIFFERENT boundary from cross-organization, and it holds';
    });

    await experiment('T3', 'the organization-scoped table returns only the caller’s organization', async () => {
      const rows = await inTenantTransaction(appDirect, tenantABothClinics, (tx) =>
        tx.$queryRaw<Array<{ id: string; organizationId: string }>>`SELECT id, "organizationId" FROM "Clinic"`);
      assert(rows.length === 2, `expected A's 2 clinics, saw ${rows.length}`);
      for (const row of rows) assert(row.organizationId === A.organizationId, 'a foreign clinic was visible');
      return '2 clinics, both organization A';
    });

    await experiment('T4', 'a parent-scoped child is visible only through a parent the caller can read', async () => {
      const own = await inTenantTransaction(appDirect, tenantAOneClinic, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "PaymentPlanInstallment"`);
      assert(own.length === 1 && own[0].id === A.installmentId, `expected only A's installment, saw ${own.length}`);
      const foreign = await inTenantTransaction(appDirect, tenantAOneClinic, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "PaymentPlanInstallment" WHERE id = ${B.installmentId}`);
      assert(foreign.length === 0, 'tenant B’s installment was visible to tenant A');
      return 'the EXISTS-through-parent policy resolves against a parent that is itself under RLS';
    });

    await experiment('T5', 'legitimate same-tenant writes are NOT blocked (false-denial bar)', async () => {
      const id = randomUUID();
      await inTenantTransaction(appDirect, tenantAOneClinic, async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "Patient" (id, "clinicId", "organizationId", "firstName", "lastName", "updatedAt")
          VALUES (${id}, ${A.clinic1Id}, ${A.organizationId}, 'Legit', 'Write', NOW())`;
        const updated = await tx.$executeRaw`UPDATE "Patient" SET notes = 'ok' WHERE id = ${id}`;
        assert(updated === 1, `expected to update the row just inserted, affected ${updated}`);
      });
      const deleted = await inTenantTransaction(appDirect, tenantAOneClinic, (tx) =>
        tx.$executeRaw`DELETE FROM "Patient" WHERE id = ${id}`);
      assert(deleted === 1, `expected to delete own row, affected ${deleted}`);
      return 'insert + update + delete of the caller’s own row all succeed — a guard that fails closed too aggressively breaks the product';
    });

    // ═══ X. The wrong tenant ════════════════════════════════════════════════
    section('X. The wrong tenant is denied — reads, writes and bulk');

    await experiment('X1', 'tenant A cannot READ tenant B’s patient by primary key', async () => {
      const rows = await inTenantTransaction(appDirect, tenantABothClinics, (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Patient" WHERE id = ${B.patientClinic1Id}`);
      assert(rows.length === 0, 'tenant B’s patient was readable');
      return '0 rows — an explicit primary-key lookup is still filtered by the policy';
    });

    await experiment('X2', 'tenant A cannot UPDATE tenant B’s row (0 rows affected, not an error)', async () => {
      const affected = await inTenantTransaction(appDirect, tenantABothClinics, (tx) =>
        tx.$executeRaw`UPDATE "Patient" SET "lastName" = 'Hijacked' WHERE id = ${B.patientClinic1Id}`);
      assert(affected === 0, `expected 0 rows affected, got ${affected}`);
      const check = await migrator.patient.findUnique({ where: { id: B.patientClinic1Id } });
      assert(check?.lastName !== 'Hijacked', 'the row was mutated despite the policy');
      return '0 rows affected; verified unchanged via the BYPASSRLS migrator role';
    });

    await experiment('X3', 'tenant A cannot DELETE tenant B’s row', async () => {
      const affected = await inTenantTransaction(appDirect, tenantABothClinics, (tx) =>
        tx.$executeRaw`DELETE FROM "Patient" WHERE id = ${B.patientClinic1Id}`);
      assert(affected === 0, `expected 0 rows affected, got ${affected}`);
      assert(await migrator.patient.findUnique({ where: { id: B.patientClinic1Id } }), 'the row was deleted');
      return '0 rows affected; row still present';
    });

    await experiment('X4', 'tenant A cannot INSERT a row carrying tenant B’s clinic', async () => {
      return inTenantTransaction(appDirect, tenantABothClinics, (tx) =>
        expectRlsRefusal(
          () => tx.$executeRaw`
            INSERT INTO "Patient" (id, "clinicId", "organizationId", "firstName", "lastName", "updatedAt")
            VALUES (${randomUUID()}, ${B.clinic1Id}, ${B.organizationId}, 'Cross', 'Tenant', NOW())`,
          'insert into another tenant',
        ));
    });

    await experiment('X5', 'THE PAIRING ATTACK: A’s organizationId with B’s clinicId is refused by WITH CHECK', async () => {
      return inTenantTransaction(appDirect, tenantABothClinics, (tx) =>
        expectRlsRefusal(
          () => tx.$executeRaw`
            INSERT INTO "Patient" (id, "clinicId", "organizationId", "firstName", "lastName", "updatedAt")
            VALUES (${randomUUID()}, ${B.clinic1Id}, ${A.organizationId}, 'Pair', 'Attack', NOW())`,
          'pairing attack',
        ));
    });

    await experiment('X6', 'a tenant cannot MOVE its own row into another tenant', async () => {
      return inTenantTransaction(appDirect, tenantABothClinics, (tx) =>
        expectRlsRefusal(
          () => tx.$executeRaw`UPDATE "Patient" SET "clinicId" = ${B.clinic1Id} WHERE id = ${A.patientClinic1Id}`,
          'move row across tenants',
        ));
    });

    await experiment('X7', 'a bulk UPDATE spanning both tenants touches only the caller’s rows', async () => {
      const affected = await inTenantTransaction(appDirect, tenantABothClinics, (tx) =>
        tx.$executeRaw`UPDATE "Patient" SET notes = 'bulk-probe'`);
      assert(affected === 2, `expected exactly A's 2 rows, affected ${affected}`);
      const leaked = await migrator.patient.count({ where: { organizationId: B.organizationId, notes: 'bulk-probe' } });
      assert(leaked === 0, `${leaked} of tenant B's rows were mutated by an unqualified UPDATE`);
      return 'an UNQUALIFIED `UPDATE "Patient" SET ...` affected 2 rows, not 4 — the policy is the WHERE clause';
    });

    await experiment('X8', 'a bulk DELETE spanning both tenants deletes only the caller’s rows', async () => {
      const throwaway = await migrator.patient.create({
        data: { organizationId: A.organizationId, clinicId: A.clinic1Id, firstName: 'Bulk', lastName: 'Delete' },
      });
      const affected = await inTenantTransaction(appDirect, { organizationId: A.organizationId, clinicIds: [A.clinic1Id] }, (tx) =>
        tx.$executeRaw`DELETE FROM "Patient" WHERE "lastName" IN ('Delete', ${B.patientClinic1Id})`);
      assert(affected === 1, `expected 1 row, affected ${affected}`);
      assert(await migrator.patient.findUnique({ where: { id: B.patientClinic1Id } }), 'tenant B lost a row');
      assert(!(await migrator.patient.findUnique({ where: { id: throwaway.id } })), 'the caller’s own row was not deleted');
      return '1 row deleted, tenant B untouched';
    });

    await experiment('X9', 'tenant A cannot read tenant B’s clinic, payment plan or installment', async () => {
      const counts = await inTenantTransaction(appDirect, tenantABothClinics, (tx) =>
        tx.$queryRaw<Array<{ clinics: bigint; plans: bigint; installments: bigint }>>`
          SELECT
            (SELECT COUNT(*) FROM "Clinic" WHERE id = ${B.clinic1Id})::bigint AS clinics,
            (SELECT COUNT(*) FROM "PaymentPlan" WHERE id = ${B.paymentPlanId})::bigint AS plans,
            (SELECT COUNT(*) FROM "PaymentPlanInstallment" WHERE id = ${B.installmentId})::bigint AS installments`);
      for (const [name, value] of Object.entries(counts[0])) {
        assert(Number(value) === 0, `${name}: ${value} of tenant B's rows were visible`);
      }
      return 'all three foreign lookups return 0';
    });

    // ═══ FK. Where RLS alone is NOT enough ══════════════════════════════════
    section('FK. The FK-target gap — RLS alone does not close it (F0-009 §7.3, reproduced)');

    await experiment('FK1', 'a row the caller CANNOT SEE is still a valid foreign-key target', async () => {
      const visible = await inTenantTransaction(appDirect, tenantAOneClinic, (tx) =>
        tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient" WHERE id = ${B.patientClinic1Id}`);
      assert(Number(visible[0].count) === 0, 'setup: B’s patient should be invisible to A');
      return 'confirmed invisible — the next experiment inserts a row REFERENCING it anyway';
    });

    await experiment('FK2', 'RLS does NOT stop a cross-tenant FK reference when the policy does not mention it', async () => {
      // PaymentPlan's policy constrains `clinicId`. It says nothing about
      // `patientId`, so a row with the caller's OWN clinic and ANOTHER
      // tenant's patient satisfies WITH CHECK, and PostgreSQL's FK constraint
      // check runs with elevated privilege and happily resolves the invisible
      // parent. The row is created.
      //
      // This is not a defect in the policy — it is the documented limit of
      // RLS, and it is the concrete reason ADR-002 says RLS is ADDITIVE to the
      // application guard rather than a replacement for it. F3-2's
      // `assertUniqueTargetOwned` is what refuses this exact write.
      const planId = randomUUID();
      await inTenantTransaction(appDirect, tenantAOneClinic, (tx) =>
        tx.$executeRaw`
          INSERT INTO "PaymentPlan" (id, "clinicId", "patientId", "totalAmount", "installmentCount", "updatedAt")
          VALUES (${planId}, ${A.clinic1Id}, ${B.patientClinic1Id}, 1, 1, NOW())`);
      const created = await migrator.paymentPlan.findUnique({ where: { id: planId } });
      assert(created, 'expected the cross-tenant-FK row to be created — if it was not, this finding needs re-checking');
      assert(created.patientId === B.patientClinic1Id, 'the row does not carry the foreign patient');
      await migrator.paymentPlan.delete({ where: { id: planId } });
      return 'ROW WAS CREATED linking tenant A’s plan to tenant B’s patient. RLS is additive, not sufficient — ' +
        'the F3-2 Prisma guard refuses this same write (tenantGuardIsolation.test.ts §E).';
    });

    await experiment('FK3', 'a FK to a NON-EXISTENT row still fails normally (the gap is visibility, not integrity)', async () => {
      try {
        await inTenantTransaction(appDirect, tenantAOneClinic, (tx) =>
          tx.$executeRaw`
            INSERT INTO "PaymentPlan" (id, "clinicId", "patientId", "totalAmount", "installmentCount", "updatedAt")
            VALUES (${randomUUID()}, ${A.clinic1Id}, ${'does-not-exist'}, 1, 1, NOW())`);
      } catch (err) {
        const state = sqlState(err);
        assert(state === FOREIGN_KEY_VIOLATION || /foreign key/i.test(String(err)), `expected an FK violation, got ${state}`);
        return `refused with ${state ?? 'foreign key violation'} — referential integrity is intact; only VISIBILITY is bypassed`;
      }
      throw new Error('a FK to a non-existent row was accepted');
    });

    // ═══ TX. Transaction-local semantics ════════════════════════════════════
    section('TX. Transaction-local context (F0-009 §7.3) — the PgBouncer prerequisite');

    await experiment('TX1', 'the context is visible for the whole interactive transaction', async () => {
      const seen = await inTenantTransaction(appDirect, tenantAOneClinic, async (tx) => {
        const first = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient"`;
        await tx.$executeRaw`SELECT pg_sleep(0.05)`;
        const second = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient"`;
        return [Number(first[0].count), Number(second[0].count)];
      });
      assert(seen[0] === 1 && seen[1] === 1, `expected 1 row throughout, saw ${seen.join(', ')}`);
      return 'stable across multiple statements and an intervening sleep';
    });

    await experiment('TX2', 'after COMMIT the setting is GONE — this is what makes transaction pooling safe', async () => {
      await inTenantTransaction(appDirect, tenantAOneClinic, (tx) =>
        tx.$queryRaw`SELECT COUNT(*) FROM "Patient"`);
      // Same client, same pool, next statement outside any tenant transaction.
      const after = await appDirect.$queryRaw<Array<{ org: string | null; count: bigint }>>`
        SELECT current_setting('app.organization_id', true) AS org, COUNT(*)::bigint AS count FROM "Patient"`;
      assert(after[0].org === null || after[0].org === '', `the setting survived the commit: "${after[0].org}"`);
      assert(Number(after[0].count) === 0, `expected 0 rows after commit, saw ${after[0].count}`);
      return 'setting is NULL and the query sees 0 rows — transaction-local, not session-local';
    });

    await experiment('TX3', 'after ROLLBACK the setting is gone too', async () => {
      await appDirect
        .$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.organization_id', ${A.organizationId}, true)`;
          await tx.$executeRaw`SELECT set_config('app.clinic_ids', ${A.clinic1Id}, true)`;
          throw new Error('deliberate rollback');
        })
        .catch(() => undefined);
      const after = await appDirect.$queryRaw<Array<{ org: string | null; count: bigint }>>`
        SELECT current_setting('app.organization_id', true) AS org, COUNT(*)::bigint AS count FROM "Patient"`;
      assert(!after[0].org, `the setting survived the rollback: "${after[0].org}"`);
      assert(Number(after[0].count) === 0, `expected 0 rows, saw ${after[0].count}`);
      return 'a failed transaction leaves no tenant residue on the connection';
    });

    await experiment('TX4', 'NEGATIVE CONTROL: a SESSION-scoped setting DOES leak past its transaction', async () => {
      // Proves the previous two results are caused by `is_local => true` and
      // not by some incidental reset. This is the bug the design avoids.
      await appDirect.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.probe_session_scope', 'leaked', false)`;
      });
      const after = await appDirect.$queryRaw<Array<{ probe: string | null }>>`
        SELECT current_setting('app.probe_session_scope', true) AS probe`;
      const leaked = after[0].probe === 'leaked';
      await appDirect.$executeRaw`SELECT set_config('app.probe_session_scope', '', false)`;
      assert(leaked, 'expected the session-scoped setting to survive — if it did not, TX2/TX3 prove less than they appear to');
      return 'session-scoped value survived the commit, transaction-scoped value did not — the difference is is_local';
    });

    await experiment('TX5', 'tenant identity CANNOT be changed mid-transaction to escalate', async () => {
      // A second set_config inside the same transaction is legal SQL. The
      // point is that it does not grant anything the caller did not already
      // have: it is issued by the application, not by the client, and the
      // policy re-evaluates against whatever is current. Recorded because a
      // reviewer will ask.
      const [asA, asB] = await appDirect.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${A.organizationId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.clinic_ids', ${A.clinic1Id}, true)`;
        const first = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient"`;
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${B.organizationId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.clinic_ids', ${B.clinic1Id}, true)`;
        const second = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient"`;
        return [Number(first[0].count), Number(second[0].count)];
      });
      assert(asA === 1 && asB === 1, `expected 1 row under each identity, saw ${asA} and ${asB}`);
      return 'the policy re-evaluates per statement; the setting is application-issued, never client-supplied. ' +
        'This is why the Node-side context (F3-2) must remain the only writer.';
    });

    // ═══ P. Parallel tenants ════════════════════════════════════════════════
    section('P. Parallel tenants over a shared pool');

    await experiment('P1', '40 interleaved transactions over a 3-connection pool never cross tenants', async () => {
      const small = makeClient(env.directUrls.app, 3);
      clients.push(small);
      const rounds = 40;
      const outcomes = await Promise.all(
        Array.from({ length: rounds }, (_unused, i) => {
          const tenant = i % 2 === 0 ? tenantAOneClinic : tenantB;
          const expected = i % 2 === 0 ? A.organizationId : B.organizationId;
          return inTenantTransaction(small, tenant, async (tx) => {
            await tx.$executeRaw`SELECT pg_sleep(${(i % 5) / 200})`;
            const rows = await tx.$queryRaw<Array<{ organizationId: string }>>`SELECT "organizationId" FROM "Patient"`;
            return { expected, rows };
          });
        }),
      );
      for (const { expected, rows } of outcomes) {
        assert(rows.length >= 1, 'a tenant saw none of its own rows');
        for (const row of rows) assert(row.organizationId === expected, 'CROSS-TENANT LEAK between concurrent transactions');
      }
      return `${rounds} transactions, 3 connections, 0 leaks`;
    });

    // ═══ W. Worker and platform paths ═══════════════════════════════════════
    section('W. Worker and platform-admin paths (F0-009 §7.6, §32)');

    await experiment('W1', 'the platform role reaches every tenant through a POLICY, not through BYPASSRLS', async () => {
      const rows = await platformDirect.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient"`;
      const count = Number(rows[0].count);
      assert(count >= 4, `expected the platform role to see every tenant's rows, saw ${count}`);
      return `${count} rows across both organizations — granted by an explicit \`TO ${PLATFORM_ROLE}\` policy on exactly ` +
        'the four tables, so break-glass is a reviewable grant rather than an unconditional override';
    });

    await experiment('W2', 'the platform role is NOT omnipotent: a table with no platform policy stays closed', async () => {
      psql(env, `GRANT SELECT ON poc_no_policy TO ${PLATFORM_ROLE};`);
      const rows = await platformDirect.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM poc_no_policy`;
      assert(Number(rows[0].count) === 0, `expected 0 rows, saw ${rows[0].count}`);
      return 'break-glass is scoped to the tables its policies name — adding a table does not silently widen it';
    });

    await experiment('W3', 'a per-tenant iteration loop (the reminders.ts shape) is viable', async () => {
      const tenants = [tenantAOneClinic, tenantABothClinics, tenantB];
      const stats = await measure(60, 10, async () => {
        for (const tenant of tenants) {
          await inTenantTransaction(appDirect, tenant, (tx) => tx.$queryRaw`SELECT COUNT(*) FROM "Patient"`);
        }
      });
      record('W3-metric', 'per-tenant iteration cost', 'INFO',
        `${tenants.length} tenants per sweep — median ${ms(stats.median)} · p95 ${ms(stats.p95)} · ` +
        `per-tenant median ${ms(stats.median / tenants.length)} (n=${stats.n})`);
      return `switching tenant costs one extra round trip per iteration (two set_config calls inside the transaction it ` +
        `already opens); measured per-tenant median ${ms(stats.median / tenants.length)}`;
    });

    // ═══ L. Latency ladder (RLS ON) ═════════════════════════════════════════
    section('L. Latency — RLS enabled (direct connection)');

    const patientCount = 400;
    await migrator.patient.createMany({
      data: Array.from({ length: patientCount }, (_unused, i) => ({
        organizationId: A.organizationId, clinicId: A.clinic1Id, firstName: `Bench${i}`, lastName: 'Load',
      })),
    });

    const rlsOnSelect = await measureOrRecord('L1', 'RLS ON — SELECT 50 patients', 200, 20, () =>
      inTenantTransaction(appDirect, tenantAOneClinic, (tx) => tx.$queryRaw`SELECT id FROM "Patient" LIMIT 50`));
    const rlsOnCount = await measureOrRecord('L2', 'RLS ON — COUNT patients', 200, 20, () =>
      inTenantTransaction(appDirect, tenantAOneClinic, (tx) => tx.$queryRaw`SELECT COUNT(*) FROM "Patient"`));
    const rlsOnInstallment = await measureOrRecord('L3', 'RLS ON — parent-scoped SELECT', 120, 20, () =>
      inTenantTransaction(appDirect, tenantAOneClinic, (tx) => tx.$queryRaw`SELECT id FROM "PaymentPlanInstallment" LIMIT 50`));

    record('L1', 'RLS ON — SELECT 50 patients', 'INFO', `median ${ms(rlsOnSelect.median)} · p95 ${ms(rlsOnSelect.p95)} · p99 ${ms(rlsOnSelect.p99)} (n=${rlsOnSelect.n})`);
    record('L2', 'RLS ON — COUNT patients', 'INFO', `median ${ms(rlsOnCount.median)} · p95 ${ms(rlsOnCount.p95)} · p99 ${ms(rlsOnCount.p99)} (n=${rlsOnCount.n})`);
    record('L3', 'RLS ON — SELECT through the parent-scoped (EXISTS) policy', 'INFO', `median ${ms(rlsOnInstallment.median)} · p95 ${ms(rlsOnInstallment.p95)} (n=${rlsOnInstallment.n})`);

    const rlsOnSelectOneTrip = await measureOrRecord('L3b', 'RLS ON — SELECT 50, context set in ONE statement', 200, 20, () =>
      inTenantTransactionOneRoundTrip(appDirect, tenantAOneClinic, (tx) => tx.$queryRaw`SELECT id FROM "Patient" LIMIT 50`));
    record('L3b', 'RLS ON — SELECT 50, context set in ONE statement', 'INFO',
      `median ${ms(rlsOnSelectOneTrip.median)} · p95 ${ms(rlsOnSelectOneTrip.p95)} (n=${rlsOnSelectOneTrip.n}) — ` +
      `saves ${ms(rlsOnSelect.median - rlsOnSelectOneTrip.median)} vs two separate set_config calls`);

    await experiment('L4', 'EXPLAIN ANALYZE captured for each policy family', async () => {
      const plans: string[] = [];
      await inTenantTransaction(appDirect, tenantAOneClinic, async (tx) => {
        for (const [family, sql] of [
          ['direct dual-key (Patient)', 'EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM "Patient" LIMIT 50'],
          ['clinic-only (PaymentPlan)', 'EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM "PaymentPlan"'],
          ['organization-only (Clinic)', 'EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM "Clinic"'],
          ['parent-scoped EXISTS (PaymentPlanInstallment)', 'EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM "PaymentPlanInstallment"'],
        ] as const) {
          const rows = await tx.$queryRawUnsafe<Array<Record<string, string>>>(sql);
          plans.push(`${family}:\n${rows.map((r) => `    ${Object.values(r)[0]}`).join('\n')}`);
        }
      });
      queryPlans.push(...plans);
      return `captured ${plans.length} plans (printed in full at the end of this run)`;
    });

    // ═══ PB. PgBouncer ══════════════════════════════════════════════════════
    section('PB. PgBouncer, transaction pooling (F0-009 §8)');

    const pgbouncerUp = startPgBouncer(env);
    let pooledSelect: Stats | null = null;

    if (!pgbouncerUp) {
      record('PB0', 'PgBouncer availability', 'BLOCKED',
        `BLOCKED_EXTERNAL_ENVIRONMENT — ${env.pgbouncerBlockReason ?? 'unknown'}`);
    } else {
      const appPooled = makeClient(env.pooledUrls!.app, 5);
      clients.push(appPooled);

      await experiment('PB1', 'Prisma + @prisma/adapter-pg works at all through transaction pooling', async () => {
        const rows = await appPooled.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one`;
        assert(rows[0].one === 1, 'a trivial query failed through the pooler');
        const mode = await appPooled.$queryRaw<Array<{ setting: string }>>`SELECT current_setting('server_version') AS setting`;
        return `simple query and raw SQL both work · PostgreSQL ${mode[0].setting} behind PgBouncer`;
      });

      await experiment('PB2', 'transaction-local tenant context works under transaction pooling', async () => {
        const rows = await inTenantTransaction(appPooled, tenantAOneClinic, (tx) =>
          tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient"`);
        assert(Number(rows[0].count) > 0, 'the caller saw none of its own rows through the pooler');
        const foreign = await inTenantTransaction(appPooled, tenantAOneClinic, (tx) =>
          tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient" WHERE id = ${B.patientClinic1Id}`);
        assert(Number(foreign[0].count) === 0, 'a foreign row was visible through the pooler');
        return 'own rows visible, foreign rows not — SET LOCAL semantics survive the pooler';
      });

      await experiment('PB3', 'a query with NO context on a POOLED connection still returns zero rows', async () => {
        const rows = await appPooled.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient"`;
        assert(Number(rows[0].count) === 0, `expected 0 rows, saw ${rows[0].count} — a pooled connection inherited a context`);
        return 'fail-closed holds identically under pooling';
      });

      await experiment('PB4', 'an interactive transaction is pinned to ONE backend for its whole duration', async () => {
        // If the pooler split statements within a callback across backends,
        // the SET LOCAL design collapses entirely.
        const pids = await appPooled.$transaction(async (tx) => {
          const first = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          await tx.$executeRaw`SELECT pg_sleep(0.02)`;
          const second = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          return [first[0].pid, second[0].pid];
        });
        assert(pids[0] === pids[1], `the transaction spanned backends ${pids[0]} and ${pids[1]}`);
        return `both statements on backend pid ${pids[0]}`;
      });

      await experiment('PB5', 'BACKENDS ARE GENUINELY REUSED — the leak test is not passing vacuously', async () => {
        const pids = new Set<number>();
        for (let i = 0; i < 12; i += 1) {
          const rows = await appPooled.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          pids.add(rows[0].pid);
        }
        assert(pids.size < 12, `12 statements used ${pids.size} distinct backends — no reuse happened, so PB6 proves nothing`);
        return `12 statements shared ${pids.size} backend(s) — connections ARE being recycled`;
      });

      await experiment('PB6', '60 interleaved tenants over a 3-backend pool never observe each other', async () => {
        const outcomes = await Promise.all(
          Array.from({ length: 60 }, (_unused, i) => {
            const tenant = i % 2 === 0 ? tenantAOneClinic : tenantB;
            const expected = i % 2 === 0 ? A.organizationId : B.organizationId;
            return inTenantTransaction(appPooled, tenant, async (tx) => {
              await tx.$executeRaw`SELECT pg_sleep(${(i % 4) / 250})`;
              const rows = await tx.$queryRaw<Array<{ organizationId: string }>>`SELECT DISTINCT "organizationId" FROM "Patient"`;
              return { expected, rows };
            });
          }),
        );
        for (const { expected, rows } of outcomes) {
          assert(rows.length === 1, `a transaction saw ${rows.length} distinct organizations`);
          assert(rows[0].organizationId === expected, 'CROSS-TENANT LEAK through a pooled connection');
        }
        return '60 transactions, 3 backends, 0 leaks — the pool-exhaustion path is the one that matters and it holds';
      });

      await experiment('PB7', 'prepared statements: the adapter works with max_prepared_statements = 0', async () => {
        // node-postgres issues unnamed (protocol-level) statements unless a
        // `name` is supplied, which is why this works even with PgBouncer's
        // prepared-statement tracking DISABLED — the conservative setting an
        // older deployed PgBouncer would force.
        for (let i = 0; i < 25; i += 1) {
          const rows = await inTenantTransaction(appPooled, tenantAOneClinic, (tx) =>
            tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Patient" WHERE "firstName" LIKE ${`Bench${i}%`}`);
          assert(rows.length === 1, 'a parameterized query failed under transaction pooling');
        }
        return '25 parameterized queries, no prepared-statement errors, max_prepared_statements=0';
      });

      await experiment('PB8', 'write paths work through the pooler and stay tenant-constrained', async () => {
        const id = randomUUID();
        await inTenantTransaction(appPooled, tenantAOneClinic, (tx) =>
          tx.$executeRaw`
            INSERT INTO "Patient" (id, "clinicId", "organizationId", "firstName", "lastName", "updatedAt")
            VALUES (${id}, ${A.clinic1Id}, ${A.organizationId}, 'Pooled', 'Write', NOW())`);
        assert(await migrator.patient.findUnique({ where: { id } }), 'the pooled insert did not persist');
        await inTenantTransaction(appPooled, tenantAOneClinic, (tx) =>
          expectRlsRefusal(
            () => tx.$executeRaw`
              INSERT INTO "Patient" (id, "clinicId", "organizationId", "firstName", "lastName", "updatedAt")
              VALUES (${randomUUID()}, ${B.clinic1Id}, ${B.organizationId}, 'Pooled', 'CrossTenant', NOW())`,
            'pooled cross-tenant insert'));
        await migrator.patient.delete({ where: { id } });
        return 'own-tenant insert persisted; cross-tenant insert refused by WITH CHECK through the pooler';
      });

      pooledSelect = await measureOrRecord('PB9', 'RLS ON + PgBouncer — SELECT 50', 200, 20, () =>
        inTenantTransaction(appPooled, tenantAOneClinic, (tx) => tx.$queryRaw`SELECT id FROM "Patient" LIMIT 50`));
      record('PB9', 'RLS ON + PgBouncer — SELECT 50 patients', 'INFO',
        `median ${ms(pooledSelect.median)} · p95 ${ms(pooledSelect.p95)} · p99 ${ms(pooledSelect.p99)} (n=${pooledSelect.n})`);

      await experiment('PB10', 'killing PgBouncer degrades predictably rather than dropping tenant context', async () => {
        const { spawnSync } = await import('node:child_process');
        spawnSync('docker', ['stop', env.pgbouncerContainer], { encoding: 'utf8' });
        let failed = false;
        try {
          await inTenantTransaction(appPooled, tenantAOneClinic, (tx) => tx.$queryRaw`SELECT COUNT(*) FROM "Patient"`);
        } catch {
          failed = true;
        }
        spawnSync('docker', ['start', env.pgbouncerContainer], { encoding: 'utf8' });
        assert(failed, 'a query succeeded while the pooler was stopped');
        return 'queries ERROR while the pooler is down — they do not hang, and they do not silently run unscoped';
      });
    }

    // ═══ R. Rollback ════════════════════════════════════════════════════════
    section('R. Rollback rehearsal (§33)');

    await experiment('R1', 'the rollback script removes every policy and both RLS flags', async () => {
      psqlFile(env, '99_rollback.sql');
      const flags = await migrator.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
        SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname IN ('Clinic', 'Patient', 'PaymentPlan', 'PaymentPlanInstallment')`;
      for (const row of flags) {
        assert(!row.relrowsecurity && !row.relforcerowsecurity, `${row.relname}: RLS still on`);
      }
      const policies = await migrator.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('Clinic', 'Patient', 'PaymentPlan', 'PaymentPlanInstallment')`;
      assert(Number(policies[0].count) === 0, `${policies[0].count} policies survived the rollback`);
      return 'all 4 tables: relrowsecurity=false, relforcerowsecurity=false, 0 policies';
    });

    await experiment('R2', 'the previously-DENIED cross-tenant read now succeeds — the enforcement was real', async () => {
      const rows = await appDirect.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Patient" WHERE id = ${B.patientClinic1Id}`;
      assert(rows.length === 1, 'the read is still denied after rollback — either the rollback or the original denial is wrong');
      return 'tenant B’s row is readable again by the app role — proving X1’s denial was caused by the policy and nothing else';
    });

    await experiment('R3', 'rollback dropped NO column and NO row', async () => {
      const counts = await migrator.$queryRaw<Array<{ patients: bigint; clinics: bigint; plans: bigint }>>`
        SELECT (SELECT COUNT(*) FROM "Patient")::bigint AS patients,
               (SELECT COUNT(*) FROM "Clinic")::bigint AS clinics,
               (SELECT COUNT(*) FROM "PaymentPlan")::bigint AS plans`;
      assert(Number(counts[0].patients) >= patientCount, 'patient rows were lost');
      const columns = await migrator.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM information_schema.columns
        WHERE table_name = 'Patient' AND column_name IN ('organizationId', 'clinicId')`;
      assert(Number(columns[0].count) === 2, 'a tenant column was dropped by the rollback');
      return `${counts[0].patients} patients, ${counts[0].clinics} clinics, tenant columns intact`;
    });

    // ═══ L (continued). Baseline with RLS OFF ═══════════════════════════════
    section('L. Latency — baseline with RLS OFF (measured after rollback)');

    const baselineSelect = await measureOrRecord('L5', 'RLS OFF — SELECT 50', 200, 20, () =>
      appDirect.$transaction(async (tx) =>
        tx.$queryRaw`SELECT id FROM "Patient" WHERE "organizationId" = ${A.organizationId} AND "clinicId" = ${A.clinic1Id} LIMIT 50`));
    const baselineCount = await measureOrRecord('L6', 'RLS OFF — COUNT', 200, 20, () =>
      appDirect.$transaction(async (tx) =>
        tx.$queryRaw`SELECT COUNT(*) FROM "Patient" WHERE "organizationId" = ${A.organizationId} AND "clinicId" = ${A.clinic1Id}`));

    // THE APPLES-TO-APPLES BASELINE. Identical to the RLS-on path in every
    // respect except that no policy exists: same transaction, same two
    // set_config round trips, same predicate written by hand. The difference
    // between this and L1 is the POLICY's cost and nothing else.
    const baselineWithContext = await measureOrRecord('L5b', 'RLS OFF — with the same two set_config round trips', 200, 20, () =>
      inTenantTransaction(appDirect, tenantAOneClinic, (tx) =>
        tx.$queryRaw`SELECT id FROM "Patient" WHERE "organizationId" = ${A.organizationId} AND "clinicId" = ${A.clinic1Id} LIMIT 50`));

    record('L5', 'RLS OFF — SELECT 50 patients (application predicate, same transaction shape)', 'INFO',
      `median ${ms(baselineSelect.median)} · p95 ${ms(baselineSelect.p95)} · p99 ${ms(baselineSelect.p99)} (n=${baselineSelect.n})`);
    record('L6', 'RLS OFF — COUNT patients', 'INFO',
      `median ${ms(baselineCount.median)} · p95 ${ms(baselineCount.p95)} · p99 ${ms(baselineCount.p99)} (n=${baselineCount.n})`);

    const delta = (on: Stats, off: Stats) => ({
      median: ((on.median - off.median) / off.median) * 100,
      p95: ((on.p95 - off.p95) / off.p95) * 100,
      p99: ((on.p99 - off.p99) / off.p99) * 100,
    });
    const selectDelta = delta(rlsOnSelect, baselineSelect);
    const countDelta = delta(rlsOnCount, baselineCount);

    record('L5b', 'RLS OFF — with the same two set_config round trips', 'INFO',
      `median ${ms(baselineWithContext.median)} · p95 ${ms(baselineWithContext.p95)} (n=${baselineWithContext.n})`);

    // The decomposition that matters. Reporting only L7/L8 would blame the
    // policy for a cost that is almost entirely network.
    const contextTripCost = baselineWithContext.median - baselineSelect.median;
    const policyCost = rlsOnSelect.median - baselineWithContext.median;
    record('L7a', 'DECOMPOSED — what the RLS path actually costs', 'INFO',
      `context round trips ${ms(contextTripCost)} (${((contextTripCost / baselineSelect.median) * 100).toFixed(1)}% of baseline) · ` +
      `policy evaluation ${ms(policyCost)} (${((policyCost / baselineSelect.median) * 100).toFixed(1)}% of baseline) · ` +
      `one-statement context saves ${ms(rlsOnSelect.median - rlsOnSelectOneTrip.median)}`);

    record('L7', 'RLS overhead — SELECT 50', 'INFO',
      `p50 ${selectDelta.median >= 0 ? '+' : ''}${selectDelta.median.toFixed(1)}% · ` +
      `p95 ${selectDelta.p95 >= 0 ? '+' : ''}${selectDelta.p95.toFixed(1)}% · ` +
      `p99 ${selectDelta.p99 >= 0 ? '+' : ''}${selectDelta.p99.toFixed(1)}%`);
    record('L8', 'RLS overhead — COUNT', 'INFO',
      `p50 ${countDelta.median >= 0 ? '+' : ''}${countDelta.median.toFixed(1)}% · ` +
      `p95 ${countDelta.p95 >= 0 ? '+' : ''}${countDelta.p95.toFixed(1)}% · ` +
      `p99 ${countDelta.p99 >= 0 ? '+' : ''}${countDelta.p99.toFixed(1)}%`);
    if (pooledSelect) {
      const pooledDelta = delta(pooledSelect, baselineSelect);
      record('L9', 'RLS + PgBouncer overhead vs direct baseline — SELECT 50', 'INFO',
        `p50 ${pooledDelta.median >= 0 ? '+' : ''}${pooledDelta.median.toFixed(1)}% · ` +
        `p95 ${pooledDelta.p95 >= 0 ? '+' : ''}${pooledDelta.p95.toFixed(1)}%`);
    }
  } finally {
    for (const client of clients) {
      await client.$disconnect().catch(() => undefined);
    }
    teardownPocEnvironment(env);
    console.log('\n  environment destroyed (containers, network and scratch credentials removed)');
  }

  // ─── Report ────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => r.outcome === 'FAIL');
  const blocked = results.filter((r) => r.outcome === 'BLOCKED');
  const passed = results.filter((r) => r.outcome === 'PASS');

  if (queryPlans.length > 0) {
    console.log(`\n${'─'.repeat(78)}\nQuery plans under RLS (EXPLAIN ANALYZE)\n${'─'.repeat(78)}`);
    for (const plan of queryPlans) console.log(`\n  ${plan}`);
  }

  console.log(`\n${'═'.repeat(78)}`);
  console.log(`F3-3 PoC: ${passed.length} passed · ${failed.length} failed · ${blocked.length} blocked`);
  console.log('Isolated, disposable, non-production. No production RLS, role or PgBouncer change was made.');
  console.log('═'.repeat(78));

  writeFileSync(
    'f3-3-poc-results.json',
    `${JSON.stringify({ postgresImage: POSTGRES_IMAGE, pgbouncerImage: PGBOUNCER_IMAGE, results, queryPlans }, null, 2)}\n`,
    'utf8',
  );

  if (failed.length > 0) process.exit(1);
}

const queryPlans: string[] = [];

main().catch((err) => {
  console.error('\nFATAL — the PoC harness itself failed:', err);
  process.exit(1);
});
