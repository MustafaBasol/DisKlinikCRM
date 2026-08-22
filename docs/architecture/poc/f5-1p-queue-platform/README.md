# F5-1P — Queue platform disposable PoC

Comparative, **isolated and disposable** proof-of-concept producing the evidence
that the human ADR-007 decision needs. It **does not select a platform** and it
**does not roll anything out**.

ClickUp: [`869enfvvu`](https://app.clickup.com/t/869enfvvu) · Phase: repository `F6` (== ClickUp `EPIC F5`)

## Authorization

`docs/architecture/queue-outbox-poc-design.md` §12 and §14 require *"a separate,
future task with its own review"* before any experiment — including the Stage 4
disposable PoC — may run. **This task is that authorization**, granted by the
program owner on 2026-08-22 after accepting the F5-1 authorization audit
(`docs/program/evidence/F5-1_QUEUE_PLATFORM_AUTHORIZATION_AUDIT.md` §0-A).

What that decision did **not** grant, and what this PoC therefore does not do:

- ADR-006 and ADR-007 both remain `NEEDS_POC`.
- **BullMQ is not selected.** Neither is the PostgreSQL candidate.
- No production rollout, no cutover, no production Redis or PostgreSQL contact.
- No Prisma migration. The PoC schema lives in `sql/01_schema.sql`, deliberately
  **outside** `server/prisma/migrations/` so nothing can apply it by accident.
- No change to `JobLock`, `MessagingInboundEvent`, the worker, or any job.

## What is compared

| | Candidate A | Candidate B |
|---|---|---|
| | PostgreSQL outbox + in-process dispatcher | BullMQ + Redis |
| Claim | guarded status transition (the pattern `clinicBulkExportPackage` already uses in production) **and** `SELECT … FOR UPDATE SKIP LOCKED`, both measured | Redis-side, BullMQ-managed |
| Durability | the business database | Redis AOF (`appendfsync everysec`) |

Both candidates run the **same** workload and the **same** handler, and both
write their business side effect through the **same** PostgreSQL idempotency
key. That is deliberate: it is how the PoC demonstrates
`queue-outbox-poc-design.md` §9's claim that BullMQ's `jobId` dedupe is a
transport property and **not** business idempotency.

Both candidates also use the **real** production tenant primitive
(`server/src/tenancy/tenantContext.ts`, imported not reimplemented), so the
tenant-reconstruction evidence is about the mechanism the application actually
uses.

## Running it

```bash
cd server
npm run poc:f5-1p-queue
```

Requires Docker. Takes a few minutes. Results are written to
`server/f5-1p-poc-results.json` (git-ignored); the recorded run is committed to
[`evidence/f5-1p-poc-run.json`](evidence/f5-1p-poc-run.json).

## Isolation guarantees

These are enforced by the harness, not merely documented:

- `assertNoProductionEnvLeak()` **refuses to start** if `DATABASE_URL`,
  `REDIS_URL` or `DIRECT_DATABASE_URL` is set in the process. The PoC cannot
  inherit a real connection string.
- Credentials are generated per run (`crypto.randomBytes`), never read from a
  file or environment.
- Ports are allocated at random and bound to `127.0.0.1` only, so a locally
  running PostgreSQL or Redis cannot be hit by accident.
- Storage is `tmpfs` for both containers; nothing survives the run.
- Teardown (`docker compose down -v`) runs in a `finally` block, including when
  an experiment throws.

Versions track the production baseline recorded in
`docs/program/PRODUCTION_TOPOLOGY.md` (PostgreSQL 16.14, Redis 7.0.15) so the
measurements are comparable — without touching production.

## Files

| Path | Purpose |
|---|---|
| `docker-compose.yml` | throwaway PostgreSQL 16 + Redis 7.0 |
| `sql/01_schema.sql` | PoC-only schema. **Not a migration.** |
| `evidence/f5-1p-poc-run.json` | the recorded run |
| `../../../../server/src/tests/poc/queuePocEnvironment.ts` | container lifecycle, isolation guards |
| `../../../../server/src/tests/poc/queuePocCandidates.ts` | both candidate implementations |
| `../../../../server/src/tests/poc/queuePlatformPoc.ts` | the experiment matrix |

## Reading the results

Every experiment records `PASS` / `FAIL` / `BLOCKED` / `NOT_APPLICABLE` with the
observed numbers. Failures are recorded, not hidden. A `FAIL` here is a finding
about a candidate, not necessarily a defect in the harness — read the `detail`
field.

Performance numbers are **local disposable-container measurements only**. They
are explicitly **not** production capacity, and must not be cited as such.
