# F0-011-P3 — KVKK-HIGH-008-F1 Production Deployment and Disabled-State Verification Evidence

**Task identifier:** F0-011-P3 (documentation-only evidence pass; not a code task)
**Evidence date:** 2026-07-20
**Baseline `origin/main` SHA at task start:** `85e3ffbca7ee1b53789564e16c5e58c5ec498cf2` (merge commit of [PR #187](https://github.com/MustafaBasol/DisKlinikCRM/pull/187), which itself carries [PR #186](https://github.com/MustafaBasol/DisKlinikCRM/pull/186)'s merge commit `1a82302861139441f07ff5c0209728d3e711728f` as an ancestor)
**Worktree:** `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high008-production-deployment-evidence`, branch `docs/kvkk-high008-production-deployment-evidence`
**Primary working tree:** not modified. `D:\Mustafa\Siteler\DisKlinikCRM`, branch `docs/kvkk-20260720-production-reconciliation`, HEAD `404f653181b5acc7599956a1bcdb35000af3d9cd`, clean at task start and at task end; only read-only `git status --short`/`git branch --show-current`/`git rev-parse HEAD` were run against it.

## 0. Purpose and relationship to prior tasks

`NORAMEDI_MASTER_TRACKER.md` §13's most recent "Exact next task" entry (recorded by F0-011-P2) named this task explicitly: *"the next operational task is the explicitly scoped deployment and production verification of PR #186 with `privacy.legacyConsentCorrection.runtimeEnabled=false`, the `PlatformAdminAuditEvent` migration applied, disabled-mutation behavior verified, and audit attribution checked."* This document records that deployment's outcome, using **operator-supplied, read-only production evidence** (this task did not itself access production — see §8).

This task did not implement, review, or modify runtime code. `KVKK-HIGH-006` was not implemented, inspected, or touched.

## 1. CodeGraph and search scope

A `.codegraph/` index exists at the repository root, but it indexes code symbols and call graphs, not prose documentation. Since this task's entire scope is reading/updating `docs/program/` Markdown files (not locating or tracing code), CodeGraph queries were not applicable and were skipped per the "if unavailable/not applicable, use narrowly scoped Git and direct file inspection" fallback. Only the following files were read, all within `docs/program/`: `KVKK_HIGH008_FREEZE_BOUNDARY.md`, `NORAMEDI_MASTER_TRACKER.md` (targeted sections: §1 header, §5, §6 F0-011-P1/F0-011-P2/F0-012, §11–§13), `RISK_REGISTER.md` (header + R-046/R-061/R-062/R-070 rows), `CURRENT_PHASE.md`, `phases/F0_BASELINE_AND_VALIDATION.md`, `LAUNCH_GATES.md` (§D/§G/blockers), and `evidence/F0-011-P2_KVKK_HIGH007_HIGH008_ROLLBACK_TENANT_VERIFICATION.md`. No repository-wide scan was performed; no `server/src` or `src` application code was read or modified.

## 2. Deployment identity

| Field | Value |
|---|---|
| Production host | `disklinik-prod-01` |
| Application path | `/var/www/noramedi` |
| Production branch | `main` |
| Deployed HEAD | `85e3ffbca7ee1b53789564e16c5e58c5ec498cf2` |
| Deployed commit | Merge pull request #187 from `MustafaBasol/docs/f0-011-p2-kvkk-high007-high008-verification` |
| PR #186 inclusion | Confirmed included as an ancestor of the deployed HEAD (PR #186's merge commit `1a82302861139441f07ff5c0209728d3e711728f`) |
| Production database | `noramedi_crm`, PostgreSQL, `localhost:5432` |
| Production Git working tree | Clean |

**Classification: `production-deployed`.**

## 3. Migration evidence

| Field | Value |
|---|---|
| Migration applied | `20260720180000_add_platform_admin_audit_event` |
| Migration finished at | `2026-07-20 21:58:32.518943+03` |
| `npx prisma migrate status` | `Database schema is up to date` |

**Classification: `migration-applied`.** This is the additive `PlatformAdminAuditEvent` migration introduced by PR #186 (see [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §7.2/§7.3) — no data migration, no backfill, no destructive DDL.

## 4. Schema verification (production, read-only)

- `PlatformAdminAuditEvent` table exists.
- 10 expected columns exist.
- Primary key exists.
- Indexes exist on `(actorPlatformAdminId, createdAt)` and `(action, createdAt)`.
- Foreign key `actorPlatformAdminId → PlatformAdmin(id)`, `ON UPDATE CASCADE ON DELETE SET NULL`, confirmed present.

This matches the schema described in [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §7.2 exactly — no drift between the merged migration and the production schema.

## 5. Build, process, and health evidence

- Frontend production build succeeded: `tsc -b && vite build`. One non-blocking build warning (existing chunks larger than 500 kB) was observed — unrelated to this KVKK deployment, not a new finding, not remediated by this pass.
- PM2 processes `noramedi-api` and `noramedi-worker` reloaded and reported `online`.
- `https://api.noramedi.com/api/health` → `200 OK`, `{"status":"ok"}`.
- `https://noramedi.com` → `200 OK`.
- `https://app.noramedi.com` → `302` to `/login` (expected — unauthenticated redirect).

**Classification: `health-verified`.**

## 6. Row-count evidence (immediately after deployment)

| Table / signal | Count |
|---|---|
| `PlatformAdminAuditEvent` | `0` |
| `SecuritySignalEvent` with rule key `platform_admin.config_change.v1` | `0` |

The zero `SecuritySignalEvent` count for this rule key is consistent with, and corroborates, [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §7.2's correction: the `SecuritySignalEvent`-based audit write from the first implementation pass was removed and replaced by the dedicated `PlatformAdminAuditEvent` model before PR #186 merged. This production observation is repository-consistent, not a new behavior introduced by this evidence pass.

Zero rows in `PlatformAdminAuditEvent` means no admin has toggled `privacy.legacyConsentCorrection.runtimeEnabled` in production since deployment — consistent with, and supporting, §7 below.

## 7. Runtime flag — stored and effective state

| Field | Value |
|---|---|
| Platform setting key | `privacy.legacyConsentCorrection.runtimeEnabled` |
| Stored `PlatformSetting` row | **absent** |
| Effective value | `false` (through fail-closed default — the gate function treats a missing row as disabled, per [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §7) |

Per instruction, this is stated precisely and must not be conflated with "explicitly stored as `false`":

```text
Stored row: absent
Effective value: false through fail-closed default
```

No `PATCH .../legacy-consent-correction/settings` call has ever been made against production (consistent with the zero `PlatformAdminAuditEvent` rows in §6). The runtime flag was **not** enabled by this deployment or by any action during this evidence pass.

**Classification: `production-disabled-state-verified`.** This is a state observation (stored row absent, effective value false), not a behavioral test — this pass did **not** invoke the mutation endpoint (`POST .../legacy-corrections/sms-opt-out`) against production to observe an actual `403 runtime_disabled` response. That remains a distinct, unperformed verification step; do not read this evidence as having exercised the endpoint.

## 8. What production was touched for, and what was not done

Production was accessed, by the operator, only for:

1. Code update (fetch/checkout of the deployed HEAD).
2. Dependency installation.
3. Prisma Client generation.
4. Migration deploy (`20260720180000_add_platform_admin_audit_event`).
5. Frontend build.
6. PM2 reload.
7. Read-only verification (schema, row counts, setting state, health, HTTP checks — all recorded above).

Explicitly, **none** of the following occurred:

- **No backfill was run.** Classification: `no-backfill-verified`.
- **No patient, consent, correction, conflict, or reconciliation data was intentionally modified.** Row counts in §6 corroborate this (zero correction/audit activity).
- **No destructive rollback was performed.**
- **The runtime flag was not activated.** Classification: `not activated`.
- **This document does not authorize, and does not itself perform, controlled activation of the KVKK-HIGH-008 workflow's runtime flag.** Classification: `controlled activation not authorized`.
- This task did not run migrations, did not run a backfill, did not enable any flag, did not implement KVKK-HIGH-006, and did not modify backend or frontend runtime code — see the Mandatory operating constraints this task was scoped under.

## 9. Additive audit table — rollback/cutback rule (reaffirmed, not changed)

Consistent with [KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §7.1 and `RISK_REGISTER.md` R-070's hardened mitigation: **the additive `PlatformAdminAuditEvent` table must be retained during any future application cutback, once audit rows exist.** At the time of this evidence pass, `PlatformAdminAuditEvent` holds `0` rows (§6), so no evidence currently exists in that table to lose — but the retain-during-cutback rule applies prospectively from the moment the first row is written, not only once rows already exist. A blind rollback to a pre-gate application commit remains unsafe for the same reason documented in §7.1 of the freeze-boundary document: such a commit does not read `privacy.legacyConsentCorrection.runtimeEnabled` at all and would silently re-expose the mutation route.

## 10. Status distinctions — what this evidence does and does not establish

Per this program's non-authorizing status model ([KVKK_HIGH008_FREEZE_BOUNDARY.md](../KVKK_HIGH008_FREEZE_BOUNDARY.md) §2, §5):

- **`production-deployed`** — established (§2).
- **`migration-applied`** — established (§3, §4).
- **`health-verified`** — established (§5).
- **`no-backfill-verified`** — established (§8).
- **`production-disabled-state-verified`** — established as a *state* observation (§7): stored row absent, effective value false. **Not** established: a live behavioral test of the mutation endpoint's `403`/audit-on-attempt path against production.
- **`not activated`** — established (§7, §8).
- **`controlled activation not authorized`** — this document does not authorize activation; a separate, explicit, external controlled-activation decision remains outstanding.
- **R-061** — **remains `OPEN`.** The mitigation (PR #186) is now merged, deployed, and its production disabled-state is confirmed (stored absent / effective false). This closes the deployment, migration-application, and effective-default-false-state components of the "deployment and production verification pending" language in the current `RISK_REGISTER.md` R-061 row. **It does not close R-061's behavioral-verification component, which remains only partially resolved — R-061's residual scope is broader than the controlled-activation decision alone.** The following production behaviors remain unverified: authenticated disabled mutation-route fail-closed behavior; the expected production response/status while disabled; authorized read/history-endpoint behavior while disabled; a successful `PlatformSetting` PATCH creating a `PlatformAdminAuditEvent` row; real production `actorPlatformAdminId` attribution; the real previous/new value chain recorded in an actual audit row; absence of a `SecuritySignalEvent` during an actual toggle action; and absence of PII/PHI/secrets in an actual created audit row. Separately, and in addition, the explicit human accept/reject decision on controlled activation (who may flip the flag, under what governance) remains outstanding. See the updated R-061 row for the precise remaining gap.

**Precise status for PR #186, do not collapse to a single "production-verified" label:**

| Item | Status |
|---|---|
| `MERGED` | yes |
| `DEPLOYED` | yes |
| Migration applied | yes |
| Effective-default-false verified | yes |
| Basic production health verified | yes |
| Behavioral production verification | **PARTIAL** |
| Controlled activation | no |
| KVKK baseline stable | no |

Deployment, migration application, effective-default-false state, and basic health verification gaps are closed. Behavioral production verification remains partial.
- **R-062** — the additive `PlatformAdminAuditEvent` migration (previously "merged but not yet production-applied/verified") is now confirmed production-applied and schema-verified (§3, §4). R-062's own residual items (raw-SQL idempotency unproven, R-046/R-070 rollback/ledger risk) are unaffected and remain as recorded.
- **R-046** — **unaffected, remains `OPEN`.** This evidence pass performed no production cross-tenant negative verification and no production audit verification — those remain outstanding, exactly as F0-011-P2 already recorded.
- **KVKK baseline "stable" declaration** — **not made** by this evidence pass. [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](../KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §5 condition 5 remains unsatisfied.

## 11. WhatsApp agent JSON-parsing log lines (R-066) — explicit non-finding

The task brief instructed this pass to check whether any WhatsApp agent JSON-parsing log lines were observed in historical PM2 logs during this deployment, and if so, to classify them rather than attribute them to this KVKK deployment. **No new WhatsApp/JSON-parsing log lines were supplied as part of this deployment's evidence** (§2–§8 above is the complete evidence set provided). `RISK_REGISTER.md` R-066 already exists, tracks this exact finding (`whatsappConversationAgent.ts`/`whatsappStepAwareNlu.ts` malformed-JSON fallback, no schema validation, no metrics), was recorded by the 2026-07-20 post-deployment reconciliation pass (PR #184) as **pre-existing and unrelated** to KVKK-HIGH-008, and already has its own isolated-PR remediation boundary. No new risk row is added here — R-066 already fully covers this item; a duplicate entry would fragment, not improve, the record.

## 12. Non-actions (explicit)

- **No migration was run by this task.** The migration in §3 was run by the operator as part of the described production deployment, before this documentation pass began; this task only recorded read-only evidence of it.
- **No backfill was run by this task or observed to have been run in production.**
- **No flag was enabled by this task.** The flag's absent/false state (§7) was not changed by this task.
- **KVKK-HIGH-006 was not implemented, inspected for implementation purposes, or touched by this task.**
- **No production access was performed by this task itself.** All production facts in this document are operator-supplied, read-only command results, consistent with this program's `VERIFIED_USER_SUPPLIED_PRODUCTION_EVIDENCE` classification used for PR #184's and PR #185's equivalent prior evidence.
- **The primary working tree was not modified** (see header).

## 13. Residual risks and exact next task

- **R-061 residual scope (broader than the controlled-activation decision alone):** authenticated disabled mutation-route fail-closed behavior; the expected production response/status while disabled; authorized read/history-endpoint behavior while disabled; a successful `PlatformSetting` PATCH creating a `PlatformAdminAuditEvent` row; real production `actorPlatformAdminId` attribution; the real previous/new value chain recorded in an actual audit row; absence of a `SecuritySignalEvent` during an actual toggle action; and absence of PII/PHI/secrets in an actual created audit row are all unverified. Zero rows in `PlatformAdminAuditEvent` and zero `SecuritySignalEvent` rows for the config-change rule key (§6) prove only that no production action has yet created those rows — they do not verify the success path. Separately, an explicit, recorded, external accept/reject decision on *who* may perform controlled activation of `privacy.legacyConsentCorrection.runtimeEnabled` in production, and under what governance (approval record, monitoring plan), has also not been made.
- **R-046 outstanding:** full production cross-tenant negative verification and full production audit verification (for the underlying legacy-consent-correction workflow) remain unperformed — unaffected by this pass, out of this task's permitted scope.
- **KVKK baseline stable declaration:** remains not made ([KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](../KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §5 condition 5).
- **KVKK-HIGH-006** remains `STILL_OPEN`/`READY_FOR_SCOPING`, unaffected by this pass — a separate runtime-remediation task, not documentation-only.

**Exact next task — a sequence, not immediate activation:**

- **(A)** Complete, externally review, and merge this documentation-only reconciliation PR.
- **(B)** Obtain an explicit human decision on whether a production-safe behavioral verification of the R-061 residual items above can be performed without: enabling the feature; using a real patient; or creating or changing patient/consent data.
- **(C)** If no safe behavioral test exists, retain the unverified behavioral items as residual evidence gaps — do not improvise a substitute verification.
- **(D)** KVKK-HIGH-006 remains a separate, ready runtime-remediation task and may continue in parallel, in its own branch/worktree.
- **(E)** Controlled activation is a later, separately authorized decision — it must not be implied as the immediate next production action.
