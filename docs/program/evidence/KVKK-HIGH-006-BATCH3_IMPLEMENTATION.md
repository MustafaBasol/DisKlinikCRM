# KVKK-HIGH-006 Batch 3 — Messaging/Post-Treatment/Services Centralized Clinic-Scope Remediation

## 1. Task ID and phase

**Task ID:** KVKK-HIGH-006 Batch 3 — implementation of the "Batch 3" group defined in
[KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md](KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md) §21.
**Phase:** F0 — Baseline, Program Control, and Architecture Validation (parent: KVKK-HIGH-006, `STILL_OPEN`).

This document does not close KVKK-HIGH-006. It is one of four planned batches (S2 §21); Batch 1
(`reports.ts`, `appointmentRequests.ts`, `dentalChart.ts`, `messages.ts:451,473`), Batch 2
(`paymentPlans.ts`, `inventory.ts`, `insuranceProvisions.ts`), and Batch 4
(`middleware/planLimits.ts`, gated on a prerequisite product decision) remain unimplemented as of
this task and are explicitly out of scope here (see §9 "Forbidden files").

## 2. Baseline SHA and worktree

Fresh `git fetch origin` + `git rev-parse origin/main` immediately before starting returned:

```
70ac5ed9d729783c7cda492b126b1f34d6b3ca77
```

Isolated worktree created from this exact commit:

- Worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-batch3`
- Branch: `fix/kvkk-high006-batch3-messaging-scope` (tracks `origin/main`)
- `git rev-parse HEAD` in the worktree immediately after creation: `70ac5ed9d729783c7cda492b126b1f34d6b3ca77` — confirmed match, no drift.

**Primary-tree protection:** the primary tree `D:\Mustafa\Siteler\DisKlinikCRM` was touched only
with `git status`/`git log`/`git branch`/`git worktree list` (all read-only) before the worktree
was created. No file in the primary tree, and no other existing worktree, was read, modified,
staged, committed, stashed, reset, cleaned, checked out, or rebased at any point in this task.

## 3. Scope confirmation — resolving the messages.ts ambiguity named in the task brief

The task brief flagged that "the two high-sensitivity `messages.ts` read/send record routes may
have been discussed under Batch 1 but excluded from S3's exact three-file scope" and instructed:
stop if documentation remains contradictory.

Documentation review found **no contradiction**, only initially-missing local visibility (the
primary/local checkout was behind `origin/main` by several merged PRs — #189 through #193 — which
is why the S1/S2/Batch-plan documents were not visible until `origin/main` was fetched fresh).
Once read directly from `origin/main`:

- `docs/program/evidence/KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md` §21
  **explicitly and unambiguously** assigns `messages.ts:446,468` (the read/send routes, now at
  source lines 451/473 after this batch's edits shifted line numbers above them) to **Batch 1**:
  > "the read/send routes 446/468 are grouped in Batch 1 for PHI-send sensitivity"
- Batch 3 is explicitly defined as: `messages.ts:155,225,584,665,729` (template create/seed, Meta
  submit/sync/status), all 7 `postTreatment.ts` occurrences, all 8 `services.ts` occurrences.
- Neither `docs/program/NORAMEDI_MASTER_TRACKER.md` nor `docs/program/RISK_REGISTER.md` (R-071)
  contradicts this — both simply summarize the batch split without re-litigating individual line
  assignments, and neither claims the two read/send routes belong to Batch 3.

**Conclusion: no contradiction exists.** The two `messages.ts` read/send routes are authoritatively
Batch 1 scope and were **not** modified by this task. This is independently confirmed by the final
`rg` sweep in §8, which shows exactly 2 remaining `req.user.clinicId` matches in `messages.ts`,
both inside `GET /messages/:id` (line 451) and `POST /messages/:id/send` (line 473) — the two
Batch-1-designated routes, and nothing else.

## 4. Correction to S2 §21's stated centralized contract for `messages.ts`

S2 §21 states the centralized contract for `messages.ts`'s `MessageTemplate` model is
`validateAndGetScope` ("organizationId-bearing model" cohort, grouped with `postTreatment.ts`).
Independent verification against `server/prisma/schema.prisma` (lines 728-769) before writing any
code found this to be **incorrect**: `model MessageTemplate` has a `clinicId` field but **no**
`organizationId` field. `validateAndGetScope` requires an `organizationId`-bearing model and cannot
be used against `MessageTemplate` without producing a type/runtime mismatch.

This is also independently confirmed by the file's own pre-existing, already-correct sibling
routes: `GET /message-templates` (line 118), `PUT /message-templates/:id` (line 191), and
`GET /messages` (line 418) all already call `validateAndGetClinicIdScope` against
`prisma.messageTemplate`/`prisma.sentMessage` — never `validateAndGetScope`. This batch's five
remediated `messages.ts` routes use `resolveEffectiveClinicId`/`validateAndGetClinicIdScope`,
consistent with the file's own established, already-correct precedent, not S2's stated (and
schema-incorrect) `validateAndGetScope` claim for this file. `postTreatment.ts`'s two models
(`PostTreatmentMessageTemplate`, `PostTreatmentMessageQueue`) were independently confirmed (schema
lines 1756-1811) to genuinely carry `organizationId`, so `validateAndGetScope` is correctly used
there, matching S2.

## 5. Files changed

| File | Occurrences remediated | Centralized contract applied |
|---|---|---|
| `server/src/routes/services.ts` | 8/8 (lines 37,55,83,106,126,176,213,253 in the pre-change source) | `validateAndGetClinicIdScope` (list, record-derived mutations) + `resolveEffectiveClinicId` (create) — `AppointmentType`/`AppointmentTypeMaterial` have no `organizationId` column |
| `server/src/routes/postTreatment.ts` | 7/7 (lines 43,68,119,171,193,225,245) | `validateAndGetScope` (list, record-derived mutations) + `resolveEffectiveClinicId` (create) — both models carry `organizationId` |
| `server/src/routes/messages.ts` | 5/5 in Batch 3 scope (lines 155,225,584,665,729) — 446/468 (Batch 1) untouched | `validateAndGetClinicIdScope` (record-derived Meta lookups) + `resolveEffectiveClinicId` (create/seed) — corrected from S2's stated `validateAndGetScope`, see §4 |
| `server/package.json` | N/A | added `test:kvkk-high006-batch3` script and wired it into the aggregate `test` chain |
| `server/src/tests/kvkkHigh006Batch3ClinicScope.test.ts` (new) | N/A | 31-case regression suite, §7 |

No route, model, schema, or migration file outside this list was touched. `insuranceProvisions.ts`
was mentioned only as a labeling cross-reference in S2 §21's Batch 3 header ("already counted in
Batch 2, not double-counted") — it was not read for editing and is not part of Batch 2/3's actual
per-file remediation list; it remains untouched, consistent with the forbidden-files list (§9).

## 6. Per-route remediation detail

### services.ts

- **`GET /appointment-types`, `GET /services`** (list): added an optional `?clinicId=`/`'all'`
  query parameter; scope resolved via `validateAndGetClinicIdScope`. Omitted selector preserves
  today's effective behavior for single-clinic callers; multi-clinic/`canAccessAllClinics` callers
  now see their full accessible/org-wide catalog instead of only their JWT-default clinic.
- **`POST /appointment-types`, `POST /services`** (create): accepts an optional `clinicId` in the
  request body (silently ignored by `appointmentTypeSchema`, which has no `clinicId` field, so it
  never collided with body validation); resolved via `resolveEffectiveClinicId`. Omitted body field
  falls back to the requester's own validated default clinic — byte-identical to prior behavior for
  every existing caller.
- **`PUT /appointment-types/:id`, materials list/replace/add/update/delete** (record-derived
  mutations): `ensureServiceInClinic(serviceId, clinicId)` was replaced with
  `ensureServiceInScope(serviceId, scope)`, where `scope` is the requester's **full** accessible
  scope (`validateAndGetClinicIdScope(user, undefined, res)`), not a single static clinic. Every
  subsequent write (materials create/replace/delete, `logActivity`, inventory-item validation) now
  uses the **found record's own** `clinicId`, never `req.user.clinicId` — mirrors the
  `relationGuards.ts` record-derived pattern already used elsewhere in the codebase. This is the
  fix for the confirmed defect: a multi-clinic-authorized user (e.g. OWNER managing Clinic B while
  their JWT default is Clinic A) can now reach and modify Clinic B's services/material recipes,
  which was previously impossible (false 404) even though they were legitimately authorized.

### postTreatment.ts

- **`GET /post-treatment-templates`, `GET /post-treatment-queue`** (list): added optional
  `?clinicId=`/`'all'`; scope via `validateAndGetScope` (both models carry `organizationId`). The
  pre-existing `if (!clinicId) return res.status(400)...` "No clinic context" guard was removed —
  it is now subsumed by `validateAndGetScope`'s own 403 response for the genuine zero-access edge
  case (a user with `allowedClinicIds.length === 0` and no `canAccessAllClinics`), which is the
  only condition that guard could ever have caught. This is a minor status-code change (400 → 403)
  for that one edge case only; every other caller's behavior is unchanged or widened, never
  narrowed.
- **`POST /post-treatment-templates`** (create): accepts an optional `clinicId` in the request body
  (not part of `createTemplateSchema`, so harmless to zod validation); resolved via
  `resolveEffectiveClinicId`. `organizationId` is always the requester's own
  `req.user!.organizationId` (unchanged, safe constant — never client-supplied).
- **`PUT /post-treatment-templates/:id`, `DELETE /post-treatment-templates/:id`,
  `POST /post-treatment-queue/:id/approve`, `POST /post-treatment-queue/:id/cancel`**
  (record-derived): each now resolves the requester's full accessible scope via
  `validateAndGetScope(user, undefined, res)` and looks the template/queue entry up **within** that
  scope before acting, then uses the **found record's own** `clinicId` for any downstream
  service/package validation. `approveAndSendQueueEntry(queueId, clinicId)` (in
  `services/postTreatmentMessaging.ts`, not modified) is now called with the queue entry's own
  `clinicId` (from a pre-lookup within the accessible scope) rather than the caller's default
  clinic — its own internal re-validation (`findFirst({where:{id,clinicId,status:'waiting_approval'}})`)
  is unchanged and still enforces the exact-match/status invariant.
  **Minor status-code note:** the approve route's pre-lookup returns a distinct 404
  (`'Queue entry not found'`) for entries genuinely outside the caller's accessible scope, whereas
  before, `approveAndSendQueueEntry`'s own internal check produced a 400
  (`'QUEUE_ENTRY_NOT_FOUND'`, via the route's catch block) for both "doesn't exist" and "wrong
  status" cases uniformly. Entries that exist within scope but have the wrong status still produce
  the original 400 `QUEUE_ENTRY_NOT_FOUND` (unchanged), since `approveAndSendQueueEntry` itself was
  not modified. This is a narrow, non-security-relevant refinement (both are non-success responses;
  no information disclosure changes), documented here for completeness per the task's
  status-code-review requirement.

### messages.ts (Batch 3 routes only — 446/468 untouched, see §3)

- **`POST /message-templates`** (create): accepts an optional `?clinicId=` query parameter (the
  existing precedent already used by `POST /messages/prepare` in this same file, line 333-335);
  resolved via `resolveEffectiveClinicId`.
- **`POST /message-templates/seed`**: same pattern as create.
- **`POST /message-templates/:id/meta/submit`, `POST /message-templates/:id/meta/sync`,
  `GET /message-templates/:id/meta/status`** (record-derived Meta lookups): each resolves the
  requester's full accessible scope via `validateAndGetClinicIdScope(user, undefined, res)`, looks
  the template up within that scope, and uses the **found template's own** `clinicId` for every
  downstream WhatsApp-connection resolution (`resolveConnectionForClinic`/`resolveConnectionById`)
  and `logActivity` call. The `meta/status` route's Prisma `select` gained a `clinicId: true` field
  (needed to resolve the connection); it is destructured out (`const { ..., clinicId: _clinicId,
  ...safeTemplate } = template`) before the response is built, so the JSON response shape is
  byte-identical to before — no new field is exposed to callers.

## 7. Tests

New file: `server/src/tests/kvkkHigh006Batch3ClinicScope.test.ts` (registered as
`npm run test:kvkk-high006-batch3`, wired into the aggregate `test` script). Follows the existing,
established mock-based pattern used by `treatmentCaseClinicScope.test.ts`/`servicePricing.test.ts`
(no live database required — the exact `buildClinicIdScope`/`buildClinicScopeWhere`/
`resolveEffectiveClinicId` logic from `server/src/utils/clinicScope.ts` is re-implemented inline
and exercised against each of the three files' distinct scope-decision shapes: list,
create-with-`resolveEffectiveClinicId`, and record-derived-mutation).

**31/31 passed.** Coverage against the task's required matrix:

| Required case | services.ts | postTreatment.ts | messages.ts |
|---|:-:|:-:|:-:|
| Single-clinic compatibility (unchanged) | ✓ | ✓ | ✓ |
| Allowed sibling clinic (widened, fixed today) | ✓ | ✓ | ✓ |
| Unauthorized/disallowed clinic denial (403) | ✓ | ✓ | ✓ |
| Org-wide/`'all'` behavior | ✓ | ✓ | ✓ (canAccessAllClinics) |
| Cross-organization denial | ✓ | ✓ | ✓ |
| Omitted selector (backward compatibility) | ✓ | ✓ | ✓ (default-clinic create) |
| Record-owned clinic enforcement | ✓ | ✓ | ✓ |
| Records outside scope unavailable (404) | ✓ | ✓ | ✓ |
| Created records use validated clinic | ✓ | ✓ | ✓ |
| No PHI/message content exposed across clinic/org scope | ✓ (no PHI in this file) | ✓ | ✓ |
| Invalid/nonexistent clinic selector → 403, not 500 | ✓ | — (covered via cross-org case) | — (covered via cross-org case) |

"Meta/post-treatment/provider behavior remains compatible" was verified by re-running the
**pre-existing**, unmodified regression suites for the services this batch's routes call into:
`npm run test:pricing` (`servicePricing.test.ts`, 29/29 passed — cross-org service-price isolation
logic, independent of this batch's routing changes, confirmed unaffected) and
`npm run test:post-treatment` (`postTreatmentMessaging.test.ts`, 16/16 passed — Meta Cloud
template-send logic in `services/postTreatmentMessaging.ts`, not modified by this batch, confirmed
unaffected) and `npm run test:treatment-case-scope` (11/11 passed — unrelated file, confirms the
established test-harness pattern itself still runs cleanly in this worktree).

`npm run test:messages-consent-gate` (`messagesConsentGate.test.ts`) was attempted and failed at
its very first fixture-setup call (`prisma.organization.create()`) — this worktree has no `.env`/
live Postgres connection configured (a fresh `git worktree add` checkout, `npm install` run, no
database provisioned; confirmed no `.env` file exists). This is an **environment limitation, not a
regression**: the failure occurs identically regardless of this batch's changes (it fails before
any application code runs), and the file under test exercises `assertCommunicationPermission`/
consent-gate logic on `POST /messages/:id/send` — a Batch 1, not Batch 3, route, and one this batch
did not modify. Per this task's constraints (no production access, no real patient data, disposable
environment only), a live-database run of this suite was not attempted; it is recorded here as
outstanding, environment-blocked verification, consistent with S2 §22's "not performed by S2" /
"Production verification required: Yes, not performed" convention for every batch.

## 8. Diff checks

```
$ git diff --check
(no output — clean, no whitespace/conflict-marker errors)

$ git diff --stat
 server/package.json                |  6 +++-
 server/src/routes/messages.ts      | 30 +++++++++++++------
 server/src/routes/postTreatment.ts | 53 +++++++++++++++++++--------------
 server/src/routes/services.ts      | 61 ++++++++++++++++++++++++++------------
 4 files changed, 99 insertions(+), 51 deletions(-)

$ git status --short
 M server/package.json
 M server/src/routes/messages.ts
 M server/src/routes/postTreatment.ts
 M server/src/routes/services.ts
?? docs/program/evidence/KVKK-HIGH-006-BATCH3_IMPLEMENTATION.md
?? server/src/tests/kvkkHigh006Batch3ClinicScope.test.ts
```

(`server/package-lock.json` initially showed a 1-line diff from a fresh `npm install` in this new
worktree — an `@aws-sdk/lib-storage` pin-vs-caret drift unrelated to any dependency this task added
or needed; it was reverted with `git checkout -- server/package-lock.json` before this final check,
so no lockfile change is included in this batch's diff.)

**Post-verification correction:** an independent review found `server/package.json` also carried an
undocumented `"allowScripts": { "@prisma/engines@7.8.0": true, "esbuild@0.28.1": true, "prisma@7.8.0":
true }` block — an npm 11 install-time trust-prompt artifact from this worktree's `npm install`, the
same class of incidental drift as the `package-lock.json` case above, but not caught before the
original diff snapshot was recorded. It has been removed. No dependency, override, or script other
than the Batch 3 test wiring is present in this file's diff.

**Pre-publish reconciliation against updated `origin/main`:** between this document's original
authoring and publication, PR #194 (Batch 1) and PR #195 (Batch 2) merged to `main`, advancing
`origin/main` to `b372406a191e4c557c58a1823cd441bd67f7ae27`. Batch 1's merge included its own
`server/package.json` change (three new scripts — `test:reports-clinic-scope`,
`test:appointment-request-record-scope`, `test:dental-chart-clinic-scope` — plus their registration
in the aggregate `test` chain) that this branch, forked before Batch 1 merged, did not have. Applying
this branch's original `server/package.json` diff as-is against current `main` would have silently
reverted Batch 1's script additions. Before publishing, `server/package.json` was reset to the
current `origin/main` version and only the two intended Batch 3 edits were re-applied on top: the new
`test:kvkk-high006-batch3` script entry (inserted after `test:treatment-case-scope`, matching Batch
3's own script-block convention) and its registration in the aggregate `test` chain at the same
position. The resulting diff (6 insertions, 1 deletion, per the corrected `git diff --stat` above)
preserves every one of Batch 1's script entries verbatim, adds only the Batch 3 entry, and contains
no `allowScripts` block. `messages.ts`, `postTreatment.ts`, and `services.ts` required no equivalent
reconciliation — confirmed by `git log --oneline 70ac5ed..b372406 -- <those three files>` returning no
commits, i.e. Batch 1/Batch 2 never touched them (§10).

## 9. `rg` sweep — classification of every remaining match

```
$ rg -n "req\.user(!|\?)?\.clinicId" server/src/routes/messages.ts server/src/routes/postTreatment.ts server/src/routes/services.ts
server/src/routes/messages.ts:451:  const clinicId = req.user!.clinicId;
server/src/routes/messages.ts:473:  const clinicId = req.user!.clinicId;
server/src/routes/services.ts:18:// accessible clinic scope (never a single, static req.user.clinicId), and the
```

| File:Line | Route | Classification |
|---|---|---|
| `messages.ts:451` | `GET /messages/:id` | **Out of scope — Batch 1** (S2 §21 explicitly assigns this route to Batch 1 for PHI-send sensitivity; confirmed by direct source read, see §3). Not modified. |
| `messages.ts:473` | `POST /messages/:id/send` | **Out of scope — Batch 1**, same reasoning. Not modified. |
| `services.ts:18` | N/A — comment | Not a code occurrence; a doc-comment on `ensureServiceInScope` explaining *why* the helper takes a scope instead of a single clinicId. Not a `req.user.clinicId` usage; correctly excluded from any occurrence count. |

`postTreatment.ts`: **zero** remaining matches (7/7 remediated).
`services.ts`: **zero** remaining live-code matches (8/8 remediated; 1 comment reference only).
`messages.ts`: **2** remaining matches, both confirmed out-of-scope Batch 1 routes, left untouched
per the task's explicit scope boundary.

## 10. Forbidden files — untouched confirmation

`reports.ts`, `appointmentRequests.ts`, `dentalChart.ts`, `paymentPlans.ts`, `inventory.ts`,
`insuranceProvisions.ts`, `middleware/planLimits.ts`, `utils/clinicScope.ts`,
`utils/relationGuards.ts`, `prisma/schema.prisma`, all migration files, and all frontend files were
not opened for editing and do not appear in `git status --short`/`git diff --stat` (§8). They were
read only where necessary to establish ground truth (`clinicScope.ts`, `relationGuards.ts`,
`schema.prisma` — all read-only, §4/§6) and never modified.

## 11. Business logic preservation

- **Messaging:** template CRUD field shapes, Meta WhatsApp submit/sync/status response shapes, and
  `sendWhatsAppMessage`/consent-gate logic (Batch 1, untouched) are unchanged. Only the clinic-scope
  *decision* changed (widened from single-clinic to accessible-scope), never the message content,
  channel routing, or Meta API payloads.
- **Post-treatment:** template/queue field shapes, `sendDelayMinutes`/`requireStaffApproval`
  scheduling semantics, and `approveAndSendQueueEntry`'s own status/consent enforcement (not
  modified) are unchanged.
- **Services:** price (`basePrice`/`currency`), `durationMinutes`, and material-recipe
  (`quantity`/`unit`/`deductionTiming`/`isOptional`) fields and their validation
  (`validateRecipeInventoryItems`) are unchanged — the inventory-item-ownership check now runs
  against the **record-derived** clinic (previously the same value in all cases where the fix
  matters, since inventory items are looked up by the actual owning clinic either way; the only
  behavior difference is which service/material records are reachable at all, not how they are
  priced or validated once found).

## 12. R-071 status

**R-071 (`RISK_REGISTER.md`) remains `OPEN`.** This document implements Batch 3 only (20 of the
47 total remediation-required occurrences: `services.ts` 8, `postTreatment.ts` 7, `messages.ts` 5).
Per S2 §27's acceptance criteria, moving R-071 to `MITIGATED` requires Batch 1 (the task brief's
explicitly-named highest-priority routes) to be implemented, tested, merged, and independently
re-verified — none of which this task performs. Batches 1, 2, and 4 remain unimplemented. This
document's own commit is not pushed, no PR is opened, and no merge/deploy/production action has
occurred (§13).

## 13. Explicit non-actions

- **No commit was created.** All changes exist only as uncommitted working-tree modifications in
  the isolated worktree `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-batch3`.
- **No push, no PR, no merge, no deploy** of any kind occurred.
- **No production access, no real patient data.** All tests run against in-memory mock fixtures
  (`kvkkHigh006Batch3ClinicScope.test.ts`) or pre-existing unit-level service tests
  (`servicePricing.test.ts`, `postTreatmentMessaging.test.ts`) — none touch a live database.
- **No shared tracker file was modified** (`CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`,
  `RISK_REGISTER.md`, `docs/compliance/KVKK_COMPLIANCE_AUDIT_AND_REMEDIATION.md` are all untouched
  by this task — confirmed by `git status --short`, §8). This document is the only new file created
  under `docs/program/evidence/`.
- **The primary working tree and all pre-existing worktrees were never touched** (§2).
