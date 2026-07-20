# KVKK-HIGH-008-F1 — PR #186 Production Deployment Verification

**Task ID:** KVKK-HIGH-008-F1-PROD-DOCS
**Date:** 2026-07-20
**Phase:** F0 — Baseline, Program Control, and Architecture Validation

## 1. Evidence classification

`VERIFIED_USER_SUPPLIED_PRODUCTION_EVIDENCE`.

**This documentation task did not execute any production command itself.** All production observations below were supplied to this task as read-only command output captured by the operator directly on the production host. This task's own execution was limited to: repository/Git evidence collection (`git fetch`, `git rev-parse`, `git merge-base --is-ancestor`, `gh pr view`), documentation edits under `docs/program/`, and standard documentation-validation commands (`git diff --check`, `git status --short`, `git diff --stat`, `git diff --name-only`, conflict-marker grep). No connection to the production host was made by this task, no production endpoint was called, no feature was activated, no `PlatformSetting` row was written, no `PlatformAdminAuditEvent` row was created, and no patient/consent data was read or mutated by this task.

## 2. Production path

`/var/www/noramedi`.

## 3. Production branch

`main`.

## 4. Production HEAD

`85e3ffbca7ee1b53789564e16c5e58c5ec498cf2` (PR #187's own merge commit).

## 5. PR #186 and #187 ancestry evidence

- PR #186: branch `fix/kvkk-high008-runtime-toggle`, state `MERGED`, merge commit `1a82302861139441f07ff5c0209728d3e711728f`.
- PR #187: branch `docs/f0-011-p2-kvkk-high007-high008-verification`, state `MERGED`, merge commit `85e3ffbca7ee1b53789564e16c5e58c5ec498cf2`, `mergedAt: 2026-07-20T18:49:13Z`.
- User-supplied production evidence: PR #186 merge-commit ancestor check against production HEAD, exit code `0`. PR #187 merge-commit ancestor check against production HEAD, exit code `0`.
- Independently, this documentation task's own isolated worktree (baseline `origin/main` @ `85e3ffbca7ee1b53789564e16c5e58c5ec498cf2`) confirmed via `git merge-base --is-ancestor 1a82302861139441f07ff5c0209728d3e711728f HEAD` → exit `0`, and `git merge-base --is-ancestor 85e3ffbca7ee1b53789564e16c5e58c5ec498cf2 HEAD` → exit `0` (trivially true, since HEAD *is* PR #187's merge commit) — this confirms `origin/main` itself contains both PRs; it is repository-evidence, not a re-execution of the production-host check.

## 6. Clean-worktree evidence

`git status --short` on the production path produced no output; the production worktree was reported clean; `origin/main` and production `HEAD` matched.

## 7. PM2 process status

- `noramedi-api`: `online`, ~7 minutes uptime at evidence capture, restart count observed `17`.
- `noramedi-worker`: `online`, ~7 minutes uptime at evidence capture, restart count observed `16`.
- No crash loop was observed in the supplied evidence. Restart counts are recorded as observational metadata only; no instability claim is made beyond what is stated here.

## 8. Health results

Five consecutive local `/api/health` checks returned HTTP `200`. Result: `5/5` passed.

## 9. Prisma migration status

Prisma reported `65` migrations. `prisma migrate status`: "Database schema is up to date!"

## 10. Exact three migration statuses

| Migration | Applied | Rolled back |
|---|---|---|
| `20260719120821_kvkk_high007_consent_reconciliation` | `true` | `false` |
| `20260719155318_kvkk_high008_legacy_consent_correction` | `true` | `false` |
| `20260720180000_add_platform_admin_audit_event` | `true` | `false` |

## 11. Runtime setting

- `PlatformSetting` row for `privacy.legacyConsentCorrection.runtimeEnabled`: **absent** (no persisted row).
- Repository behavior defaults this setting to `false` when no row exists.
- **Effective production state:** persisted row absent; effective default `false`. This is recorded precisely as *persisted row absent; effective default false* — it is not rewritten as "explicit persisted false," since no row was written and no explicit `false` value was ever persisted.

## 12. PlatformAdminAuditEvent count

`0`.

## 13. PatientLegacyConsentCorrection count

`0`.

## 14. Read-only verification command exit code

`0`.

## 15. Explicitly verified facts

- PR #186 is `MERGED` into `main` (merge commit `1a82302861139441f07ff5c0209728d3e711728f`).
- PR #187 is `MERGED` into `main` (merge commit `85e3ffbca7ee1b53789564e16c5e58c5ec498cf2`, `mergedAt: 2026-07-20T18:49:13Z`).
- PR #186's code, including the additive `PlatformAdminAuditEvent` migration, is present on deployed production `main` (ancestry confirmed, exit code `0` for both PRs).
- PR #187's documentation commit is present in deployed production `main` (production HEAD equals PR #187's own merge commit).
- All three named migrations (KVKK-HIGH-007, KVKK-HIGH-008, PR #186's audit-event migration) are applied and not rolled back; production schema is current.
- Runtime control for KVKK-HIGH-008's legacy-consent-correction mutation route is effectively `false` in production, via missing-row default-false behavior, not an explicit persisted value.
- `noramedi-api` and `noramedi-worker` are online; basic health (5/5 local `/api/health` `200`) is verified.
- No `PatientLegacyConsentCorrection` rows exist; no `PlatformAdminAuditEvent` rows exist yet.
- The production worktree is clean and matches `origin/main`.

## 16. Explicitly unverified facts

- Actual disabled-mutation-endpoint behavior through an authenticated production request.
- Authorized read/history endpoint behavior in production.
- A successful `PlatformSetting` PATCH producing a `PlatformAdminAuditEvent` row.
- `actorPlatformAdminId` attribution in a real production audit row.
- The previous/new value chain in a real production audit row.
- Zero `SecuritySignalEvent` creation during a real production toggle action.
- Production audit-row PII/PHI/secret-content inspection — not possible, because no audit row exists.
- Full production cross-tenant negative verification.
- Full production audit verification.
- Controlled feature activation.
- KVKK baseline stability.

## 17. Security/tenant impact

No tenant-scoped or cross-tenant behavior was exercised by this task. The runtime gate is a platform-wide (not per-tenant) kill switch; its effective state (`false`, via missing-row default) means the legacy-consent-correction mutation route remains fail-closed for every tenant in production, consistent with the pre-PR-186 fail-safe posture. No tenant data was read, written, or inspected by this task. Full production cross-tenant negative verification (an authenticated request from one tenant's context attempting to affect another's data through this workflow) remains outstanding — see §16.

## 18. Migration/data impact

All three migrations are additive-only (new table/columns/model, no destructive schema change), consistent with prior F0-011-P1/KVKK-HIGH-008-PMVR/F0-011-P2 findings for the first two, and with PR #186's own delivery description for the third (`PlatformAdminAuditEvent`, create-only, FK to `PlatformAdmin`). No backfill, reconciliation, or data mutation was performed by this deployment or by this documentation task. `PatientLegacyConsentCorrection` and `PlatformAdminAuditEvent` row counts are both `0` — no correction has been created and no admin-audit event has been recorded in production.

## 19. Rollback/cutback posture

Unchanged from the posture already recorded in [KVKK_HIGH008_FREEZE_BOUNDARY.md §7.1](../KVKK_HIGH008_FREEZE_BOUNDARY.md) and [RISK_REGISTER.md R-046/R-070](../RISK_REGISTER.md): a blind application rollback to a pre-gate commit is unsafe, because older code does not read the persisted setting and would re-expose the mutation route regardless of its value. The safe order remains: (1) set/keep the toggle at `false` via the platform-admin route (already the effective state); (2) retain the additive schema; (3) redeploy only a gate-aware compatible commit, or apply a temporary route-level block, if a code-level cutback is ever needed; (4) forward-fix. This deployment used a standard `prisma migrate deploy` — no physical rollback occurred and no `_prisma_migrations` mutation occurred, so no new ledger drift (R-070) was introduced by it.

## 20. Risk disposition

- **R-046** — remains `OPEN`. Production deployment and migration application are accepted on this user-supplied evidence; disposable-environment rollback and tenant-isolation rehearsal (F0-011-P2) already passed; full production cross-tenant negative verification and full production audit verification are still missing. Production deployment success does not close R-046.
- **R-061** — updated to: `OPEN — mitigation merged and deployed; audit migration applied and effective-default-false verified in production; authenticated disabled-route behavior and successful platform-admin audit creation remain not independently production-verified.`
- **R-062** — remains `MITIGATED` (migration-ordering component only). HIGH-007/HIGH-008 ordering is verified; PR #186's audit migration is now additionally confirmed applied in production; schema is up to date; raw SQL statement-level idempotency remains unproven; physical rollback and ledger-drift risk remain owned by R-046/R-070.
- **R-070** — remains `OPEN`. This deployment used standard Prisma migration application; no physical rollback occurred; no `_prisma_migrations` mutation occurred; therefore no new ledger drift was introduced by this deployment.

## 21. Status separation

For PR #186: agent completed — yes; relevant tests passed — yes, based on previously accepted targeted evidence; PR opened — yes; merged — yes; deployed — yes; migration applied — yes; effective-false verified — yes; basic production health verified — yes; full behavioral production verification — **no / partial**; controlled activation — no; KVKK baseline stable — no.

For PR #187: agent completed — yes; targeted tests passed — 193/193; full suite passed — no claim; PR opened — yes; merged — yes; deployed — not applicable to docs-only deliverables; production verified — not applicable to docs-only deliverables.

For this docs task (KVKK-HIGH-008-F1-PROD-DOCS): agent completed — at most yes; documentation validation — see the delivery report for exact commands/results; PR opened — only once an actual PR exists; merged — no; deployed — not applicable; production verified — not applicable.

## 22. Exact next task

**Primary — non-activating verification (safe to schedule as the next task, no additional authorization beyond this one required):** a read-only, non-activating behavioral verification of PR #186, limited to checks that do not change `privacy.legacyConsentCorrection.runtimeEnabled` at any point:

- read-only policy/settings endpoint (`GET`) verification;
- disabled-mutation-route fail-closed behavior (confirming the route rejects while the setting is absent/`false`);
- unauthorized-request rejection;
- invalid-payload rejection;
- confirmation that no `PlatformAdminAuditEvent` row is created by a rejected or disabled-route attempt;
- count/hash or other non-PII checks confirming no `PatientLegacyConsentCorrection`/consent-data change resulted from any of the above.

None of these checks write, PATCH, or otherwise change the `PlatformSetting` row — the setting stays at its current effective state (row absent, effective `false`) throughout.

**Explicitly separate and not part of this task's scope:** a `PlatformSetting` PATCH that changes `runtimeEnabled` from `false` to `true` — even temporarily, even if immediately followed by a rollback PATCH back to `false` — **is controlled activation, not a non-activating verification.** A `false → true → false` cycle is not authorized by PR #188 or by the current production-evidence task, regardless of how briefly the setting would read `true`. Performing one, and observing the resulting `PlatformAdminAuditEvent` row's attribution/previous-new-value chain, requires its own separate controlled-activation decision: a named approver/authorization, a scheduled maintenance window, a defined rollback/cutback plan, a monitoring plan for the activation window, and an explicit, pre-agreed evidence-capture scope. **Until that separate authorization exists, no toggle cycle should be proposed, scheduled, or treated as in-scope for "the next safe verification task."**

**Otherwise:** proceed with the next roadmap-ordered task while retaining R-061 and R-046 as `OPEN`.

The current deployment is healthy and effective-false; behavioral production verification is the next gate, not a prerequisite for the current deployment's continued operation.

## 23. Non-authorization statement

This document, and the KVKK-HIGH-008-F1-PROD-DOCS task that produced it, record read-only, user-supplied production evidence and a documentation reconciliation only. They do not authorize, perform, or declare: feature activation, a `PlatformSetting` write, a `PlatformAdminAuditEvent` creation, any production endpoint invocation, any patient/consent data mutation, or a "KVKK baseline stable" declaration. Those remain separate, explicit steps requiring their own dedicated, scoped tasks and — where the program's status model requires it — external review/decision.
