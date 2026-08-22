# F3-3 — FORCE RLS + PgBouncer transaction-mode PoC

**Isolated, disposable, non-production.** Everything here runs in throwaway
Docker containers that are destroyed at the end of the run. Nothing in this
directory is a Prisma migration, nothing is registered with Prisma Migrate, and
nothing has been applied to any shared or production database.

Results and analysis: [`../../../program/evidence/F3-3_RLS_PGBOUNCER_POC.md`](../../../program/evidence/F3-3_RLS_PGBOUNCER_POC.md).
Design this executes: [`../../tenant-rls-pgbouncer-poc-design.md`](../../tenant-rls-pgbouncer-poc-design.md) (F0-009).

## Run it

```bash
cd server
npm run poc:f3-3-rls
```

Requires Docker. Takes about five minutes. It provisions its own PostgreSQL and
PgBouncer, applies the **real** `schema.prisma`, creates three roles, turns on
FORCE RLS for four tables, runs 51 experiments, rehearses the rollback, and
tears everything down in a `finally` block.

It reads no `DATABASE_URL` and cannot touch an existing database: every
connection string it uses is built from a container it started itself.

It is deliberately **not** in any CI chain — it needs Docker, takes minutes, and
measures latency.

## What is here

| Path | What it is |
|---|---|
| `sql/01_roles.sql` | `noramedi_migrator` (owner, `BYPASSRLS`), `noramedi_app` (runtime, neither), `noramedi_platform` (break-glass, **not** `BYPASSRLS`), plus the two transaction-local context functions. |
| `sql/02_policies.sql` | `ENABLE` + `FORCE ROW LEVEL SECURITY` and the tenant/break-glass policies for `Clinic`, `Patient`, `PaymentPlan`, `PaymentPlanInstallment` — one per tenant-ownership shape in the F3-1 registry. |
| `sql/03_force_rls_ownership_demo.sql` | A table owned by the runtime role, used to prove the `ENABLE` vs `FORCE` difference instead of citing it. |
| `sql/99_rollback.sql` | The rollback, rehearsed by the harness and then verified by re-running a previously-denied read. Drops no column, no row and no role. |
| `pgbouncer/pgbouncer.ini.template` | `pool_mode = transaction`, small pool, `server_reset_query` deliberately empty. `__POSTGRES_HOST__` is substituted at run time. |
| `../../../../server/src/tests/poc/rlsPocEnvironment.ts` | Container provisioning and teardown. |
| `../../../../server/src/tests/poc/rlsPgBouncerPoc.ts` | The 51 experiments. |

## Credentials

There are none in this directory. The harness generates three random passwords
per run, writes the PgBouncer auth file into a scratch directory that it deletes
at teardown, and the committed `.template` contains placeholders only.

`auth_type = scram-sha-256` with a **plaintext** auth file: a SCRAM verifier
cannot be replayed onward to PostgreSQL, so a pooler that authenticates to the
backend on the client's behalf needs the original secret. That is a real
operational consequence of putting PgBouncer in front of PostgreSQL and it is
discussed in the evidence document, not hidden here.

## What a run proves, and what it does not

It proves the mechanism works in a disposable environment. It is **not**
authorization to enable RLS, change a database role, or deploy PgBouncer
anywhere. `ADR-004` and `ADR-005` stay `NEEDS_POC` until a human reviews the
evidence document.
