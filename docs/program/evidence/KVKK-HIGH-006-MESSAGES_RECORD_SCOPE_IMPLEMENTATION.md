# KVKK-HIGH-006 — `messages.ts` Record-Derived Clinic Scope Implementation (Two Remaining High-Sensitivity Occurrences)

## 1. Task ID and phase

**Task ID:** KVKK-HIGH-006 — `messages.ts` high-sensitivity message read/send routes (the two occurrences not owned by Batch 3)
**Phase:** F0 — Baseline, Program Control, and Architecture Validation
**Parent task:** KVKK-HIGH-006 — direct/inconsistent use of `req.user.clinicId` in runtime authorization/data-scope paths instead of the centralized `validateAndGetClinicIdScope`/`validateAndGetScope` contracts (`server/src/utils/clinicScope.ts:87,210`). This document implements a **subset** of the remediation the KVKK-HIGH-006-S2 classification document (`docs/program/evidence/KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md`) scoped to `messages.ts` — specifically the two routes S2 flagged **High sensitivity** and left distinct from the five routes assigned to Batch 3 (`fix/kvkk-high006-batch3-messaging-scope`). **It does not close KVKK-HIGH-006** as a whole; the parent task tracks the full 47-occurrence remediation across 10+ files.

## 2. Baseline SHA and isolation

Fresh `git fetch origin` + `git rev-parse origin/main` immediately before starting this task returned:

```
70ac5ed9d729783c7cda492b126b1f34d6b3ca77
```

Isolated worktree created from this exact commit:

- Worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-messages-record-scope`
- Branch: `fix/kvkk-high006-messages-record-scope` (created from `origin/main`, tracks `origin/main`)
- `git rev-parse HEAD` immediately after worktree creation: `70ac5ed9d729783c7cda492b126b1f34d6b3ca77` — confirmed match, no drift.

**Primary-tree protection:** the primary tree `D:\Mustafa\Siteler\DisKlinikCRM` was touched only with `git fetch`, `git worktree list`, and read-only `git log`/`git show` commands before the worktree was created. No file in the primary tree was read for editing, modified, staged, committed, stashed, reset, cleaned, checked out, or rebased at any point.

**Batch 1 / Batch 3 worktree protection:** `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-batch3` and `...\kvkk-high006-s3-batch1` were opened **read-only** (`git status --short`, `git diff -- <file>`, `git log`) solely to confirm (a) which five `messages.ts` occurrences Batch 3 already owns and (b) the accepted record-derived-scope pattern used elsewhere in the program (`dentalChart.ts`, `appointmentRequests.ts`). No file in either worktree was written to, staged, committed, or otherwise mutated.

## 3. Pre-implementation verification against current source (not just prior evidence)

The task brief's line numbers (446/468, "approximately 451/473 after Batch 3") were verified directly against current source rather than assumed:

- `git show origin/main:server/src/routes/messages.ts | grep -nE "req\.user(!|\?)?\.clinicId"` on the fresh `origin/main` tip (`70ac5ed`) returned **7** occurrences at lines **155, 225, 446, 468, 584, 665, 729** — identical to the KVKK-HIGH-006-S2 inventory (§13 of that document), confirming no source drift since S2 was written.
- Batch 3's own worktree (`kvkk-high006-batch3`) has **uncommitted** (not yet merged) changes to `messages.ts` that fix five of those seven occurrences (originally 155, 225, 584, 665, 729 — now at shifted line numbers 451/473-adjacent positions in Batch 3's working copy, per its `git diff`), leaving exactly two untouched in Batch 3's own working copy: the ones at (Batch-3-shifted) lines **451** and **473**, corresponding to origin/main's unshifted lines **446** and **468**.
- Because this task's worktree branches from `origin/main` directly (not from Batch 3's branch), **all seven** raw occurrences are present in this worktree at `origin/main`'s original line numbers (155, 225, 446, 468, 584, 665, 729) until Batch 3 commits and merges. Per the task's explicit scope, only the two at **446** and **468** were touched here; the other five (Batch 3's ownership) were left untouched, confirmed by an exact-count regression assertion (§7).

**Conclusion:** the two occurrences this task owns are:

| Line (origin/main, this worktree) | Route | Method + Path |
|---|---|---|
| 446 | `GET /api/messages/:id` | single-message read |
| 468 | `POST /api/messages/:id/send` | message send (SMS/WhatsApp dispatch) |

Both are classified **G** (`CENTRAL_SCOPE_CONTRACT_BYPASS`, secondary `F` `MULTI_CLINIC_ACCESS_NARROWING`) and **High** sensitivity in KVKK-HIGH-006-S2 §13 — `SentMessage` rows carry patient-linked content (recipient, body, patient include) for non-gateway channels.

## 4. Evidence classification

`RUNTIME_CODE_REMEDIATION` — two Express route handlers changed in `server/src/routes/messages.ts`, plus one new test file and its `package.json` script registration. No schema, migration, shared helper, or frontend file was touched. No production access.

## 5. The bug (before)

Both routes derived their sole authorization filter from `req.user!.clinicId` — the JWT-resolved **default** clinic, which the codebase's own type comment documents as `// defaultClinicId — sadece UI varsayılanı, yetkilendirme değil` ("UI default only, not authorization", `server/src/middleware/auth.ts`).

```ts
// GET /api/messages/:id (before)
const clinicId = req.user!.clinicId;
...
const where: any = { id, clinicId };
const message = await prisma.sentMessage.findFirst({ where, ... });

// POST /api/messages/:id/send (before)
const clinicId = req.user!.clinicId;
...
const message = await prisma.sentMessage.findFirst({ where: { id, clinicId }, ... });
// clinicId (== req.user!.clinicId) then reused for: sendClinicSms(), assertCommunicationPermission(),
// sendWhatsAppMessage(), logActivity() (x4), recordOperationalEvent()
```

**Consequence 1 (multi-clinic access narrowing):** a user authorized for multiple clinics (`allowedClinicIds` with more than one entry, or `canAccessAllClinics`) whose JWT default clinic differs from the message's actual clinic got a **false 404** — the message existed and was in-scope, but the lookup only ever looked in the caller's default clinic.

**Consequence 2 (wrong-clinic provider/consent/audit attribution — the more serious defect on the send route):** in the narrow case where a message belonging to a *different* clinic than the caller's default happened to share an `id` collision path (not possible for `id` itself, but the underlying architectural defect is that nothing prevented it structurally) or, more realistically, if this pattern were ever combined with an explicit multi-clinic selector elsewhere, every downstream operation — SMS provider selection (`sendClinicSms({ clinicId })`), WhatsApp consent gate (`assertCommunicationPermission({ clinicId })`), WhatsApp provider dispatch (`sendWhatsAppMessage(clinicId, ...)`), and all four `logActivity`/`recordOperationalEvent` calls — used the caller's default clinic rather than the clinic that actually owns the `SentMessage` row being sent. This is the specific defect the task's required pattern (§6) closes: provider and audit operations must always be keyed to the **record's own** clinic, never the caller's UI default.

## 6. The fix (after) — required pattern applied

```
resolve accessible clinic scope (validateAndGetClinicIdScope(req.user!, undefined, res))
  → locate the SentMessage within that scope (prisma.sentMessage.findFirst({ where: { id, ...scope } }))
  → use its actual clinicId (const clinicId = message.clinicId)
  → perform read/send/provider operations using that record-owned clinicId
```

```ts
// GET /api/messages/:id (after)
const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
if (scope === false) return;
...
const where: any = { id, ...scope };
if (normalizedRole === 'DENTIST') where.patient = dentistPatientAccessWhere(userId);
const message = await prisma.sentMessage.findFirst({ where, ... });
if (!message) return res.status(404).json({ error: 'Message not found' });
res.json(message);

// POST /api/messages/:id/send (after)
const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
if (scope === false) return;
...
const where: any = { id, ...scope };
const message = await prisma.sentMessage.findFirst({ where, ... });
if (!message) return res.status(404).json({ error: 'Message not found' });
const clinicId = message.clinicId; // record-owned clinicId, used for every downstream op below
if (message.status !== 'prepared') { ... }
...
const smsResult = await sendClinicSms({ organizationId: req.user!.organizationId, clinicId, ... });
const permission = await assertCommunicationPermission({ organizationId: req.user!.organizationId, clinicId, ... });
const sendResult = await sendWhatsAppMessage(clinicId, { ... });
await logActivity({ clinicId, ... }); // x4, unchanged call sites, now record-owned clinicId
```

`selectedClinicId` is passed as `undefined` (not read from a query parameter) because these are single-record `:id` lookups, not list endpoints — the record's own existence within the accessible scope is the authorization boundary, exactly mirroring the already-correct sibling `GET /api/messages` route (line ~418, unchanged) and the accepted `messageTemplate`-route pattern already present in Batch 3's uncommitted work (`meta/submit`, `meta/sync`, `meta/status` — read-only inspection confirmed, not reused/copied verbatim, independently re-derived here since it is the same documented §8-item-5 pattern from KVKK-HIGH-006-S2).

`validateAndGetClinicIdScope` with `selectedClinicId === undefined` never returns `false` unless `user.allowedClinicIds.length === 0` (i.e., a user with zero clinic assignments) — see `buildClinicIdScope`, `server/src/utils/clinicScope.ts:179-208`. This is the only path that can produce the route's 403; every other case resolves to a `{clinicId: string}` or `{clinicId: {in: string[]}}` filter that the record-level `findFirst` evaluates.

## 7. Exact diff

```diff
--- a/server/src/routes/messages.ts
+++ b/server/src/routes/messages.ts
@@ router.get('/messages/:id', ...) => {
   const id = getParam(req, 'id');
-  const clinicId = req.user!.clinicId;
   const { normalizedRole, id: userId } = req.user!;

+  const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
+  if (scope === false) return;
+
   try {
-    const where: any = { id, clinicId };
+    const where: any = { id, ...scope };
     if (normalizedRole === 'DENTIST') {
       where.patient = dentistPatientAccessWhere(userId);
     }
     ...

@@ router.post('/messages/:id/send', ...) => {
   const id = getParam(req, 'id');
-  const clinicId = req.user!.clinicId;
+
+  const scope = await validateAndGetClinicIdScope(req.user!, undefined, res);
+  if (scope === false) return;

   try {
+    const where: any = { id, ...scope };
     const message = await prisma.sentMessage.findFirst({
-      where: { id, clinicId },
+      where,
       include: { patient: { select: patientContactSelect }, template: true },
     });
     if (!message) return res.status(404).json({ error: 'Message not found' });
+    const clinicId = message.clinicId;
     if (message.status !== 'prepared') {
     ...
```

`validateAndGetClinicIdScope` was already imported in this file (used by the sibling `GET /api/messages` route) — no new import required. **Only these two route handlers were changed.** Nothing else in `messages.ts` was touched: the other five raw `req.user!.clinicId` occurrences (Batch 3's ownership, at lines 155, 225, 584, 665, 729 in this worktree's unmodified-elsewhere copy) remain byte-for-byte as they were on `origin/main`.

Actual `git diff --stat` for this worktree:

```
server/package.json           |  8 +++++++-
server/src/routes/messages.ts | 14 ++++++++++----
2 files changed, 17 insertions(+), 5 deletions(-)
```

(`package.json`'s 8-line change registers the new test script — §9 — and is not a runtime change.) `server/src/tests/messagesRecordScope.test.ts` is new/untracked (not counted in `--stat` for tracked-file diffs).

## 8. Requirements verification

| Requirement | How verified |
|---|---|
| Authorized sibling-clinic access succeeds | Simulation test #2 (`messagesRecordScope.test.ts`): multi-clinic user with `allowedClinicIds` including the sibling clinic reads/would-send a message owned by that sibling clinic → 200, `clinicId` resolves to the sibling clinic, not the caller's default. |
| Inaccessible clinic record remains unavailable | Simulation test #3: single-clinic user attempting a sibling-clinic message → 404 (not 403 — the record-scoped `findFirst` itself is the boundary, it never confirms the id's existence to an unauthorized caller). |
| Cross-organization access is denied | Simulation test #5: a message belonging to a different organization's clinic is unreachable regardless of `canAccessAllClinics`, because `buildClinicIdScope`'s org-clinics query is always scoped to `user.organizationId` — a foreign-org clinic id can never appear in the resolved scope. Result: 404, existence not leaked. |
| PHI/message content cannot leak across clinic scope | Direct consequence of the above two: `findFirst` with `{ id, ...scope }` returns `null` (not the record) for any message outside the resolved scope; `res.json(message)` is never reached for out-of-scope ids. |
| Send operations use the target record's actual clinicId | Simulation test #10: `dispatchClinicId` (fed to `sendWhatsAppMessage`/`sendClinicSms`) is asserted equal to `message.clinicId` and explicitly asserted **not equal** to `user.clinicId` when they differ. Source-inspection test confirms `const clinicId = message.clinicId;` exists in the actual send-route body, positioned after the `findFirst`/404-guard and before every downstream call. |
| Provider and consent-gate behavior remains unchanged | Source-inspection test confirms `sendClinicSms(`, `assertCommunicationPermission(`, `sendWhatsAppMessage(`, and the `status !== 'prepared'` guard are all still present, call-site-unchanged, in the send route — only the *source* of the `clinicId` argument changed, not the gates themselves or their call order. |
| Intentional 403/404 semantics remain secure | Simulation tests #7/#8: zero-clinic-assignment users get 403 (scope cannot be built — mirrors `validateAndGetClinicIdScope`'s own `false`/403 branch); any other authorized-but-wrong-clinic or nonexistent-id case gets 404, uniformly, so a 404 never distinguishes "wrong clinic" from "doesn't exist" (no existence oracle). |

## 9. Tests added/updated

New file: `server/src/tests/messagesRecordScope.test.ts` (21 assertions, `node:assert/strict` + `tsx`, no external framework — matches the repository's existing convention, e.g. `dentalChartClinicScope.test.ts`, `reportsClinicScope.test.ts`).

Registered as `npm run test:messages-record-scope` in `server/package.json`, chained into the aggregate `npm test` script immediately after `test:messages-consent-gate`.

Two sections:

1. **Logic simulation** (12 tests) — mirrors `buildClinicIdScope`'s no-explicit-selector path (`server/src/utils/clinicScope.ts:179-208`) plus the two routes' post-fix record-derived-scope shape, using in-memory mock clinics/messages (no DB). Covers: the pre-fix bug reproduced and the fix regression-guarded side by side, the full clinic-scope access matrix (single-clinic/multi-clinic/`canAccessAllClinics`/zero-assignment/cross-org/nonexistent-id), the 403-vs-404 distinction, and — specific to the send route — that the *provider-dispatch*, *consent-gate*, and *audit-log* `clinicId` inputs are all the same record-derived value, distinct from the caller's default clinic, and that an unauthorized attempt returns before any of those calls would run.
2. **Source-inspection regression** (9 tests) — reads the actual `server/src/routes/messages.ts` file at runtime (`readFileSync`) and asserts directly against it: neither fixed route body contains `req.user!.clinicId`/`req.user?.clinicId` anywhere; both call `validateAndGetClinicIdScope` and handle the `false` branch; the send route contains the literal `const clinicId = message.clinicId;` derivation; `sendClinicSms`/`assertCommunicationPermission`/`sendWhatsAppMessage`/the `'prepared'`-status guard are all still present (provider/consent behavior unchanged); **exactly 5** raw `req.user!.clinicId` occurrences remain in the whole file (proving Batch 3's separately-owned five were not touched); and the pre-existing, already-correct sibling `GET /api/messages` list route is untouched.

This second section is what gives confidence in the absence of a live database: it verifies the claims against the real shipped file, not just an abstracted model of it.

## 10. Exact commands and results

Run from `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high006-messages-record-scope\server` (fresh worktree, no pre-existing `node_modules`):

```
npm install --no-audit --no-fund
  → added 381 packages (2m); flagged 3 packages with pending install scripts
    (@prisma/engines, esbuild, prisma — standard for this repo, not new/suspicious)
npm approve-scripts "@prisma/engines" esbuild prisma
npm rebuild
  → rebuilt dependencies successfully

npm run typecheck
  → npx prisma generate && tsc --noEmit
  → Prisma Client generated (v7.8.0); tsc --noEmit exit code 0, zero errors

npx tsx src/tests/messagesRecordScope.test.ts
  → 21 passed, 0 failed — exit 0
(equivalently: npm run test:messages-record-scope → same result)
```

Targeted regression set (message/consent/provider/clinic-scope surface, DB-free):

```
npx tsx src/tests/messageSafetyHardening.test.ts      → 36 passed, 0 failed
npx tsx src/tests/messageTemplatePurpose.test.ts       → 17 passed, 0 failed
npx tsx src/tests/messageTemplateWabaBinding.test.ts   → 20 passed, 0 failed
npx tsx src/tests/smsModule.test.ts                    → 77 passed, 0 failed
```

**Totals:** 5 test files (1 new + 4 pre-existing, unmodified), **171 individual assertions, 0 failures**, all exit code 0.

## 11. DB-backed tests: attempted, could not run — simulation vs. integration coverage explicitly distinguished

`server/src/tests/messagesConsentGate.test.ts` (pre-existing, unmodified) exercises `POST /api/messages/:id/send` against a **real** Postgres database (creates real `Organization`/`Clinic`/`Patient`/`User`/`SentMessage` rows via `prisma.*.create`). This is the one existing test file in the repository that would give true end-to-end integration coverage of the exact route this task changed. It was run to check for regressions:

```
npx tsx src/tests/messagesConsentGate.test.ts
  → 0 passed, 4 failed — every test fails identically, in fixture setup
    (`prisma.organization.create()` in `createFixture()`, before any of this
    task's changed code executes)
```

**Root cause confirmed independently of the test, at the TCP level, before attributing the failure to environment rather than to this change:**

```
(echo > /dev/tcp/127.0.0.1/5432)
  → "Connection refused" — no Postgres listening on the default port in this sandbox.
```

No `.env` with a live `DATABASE_URL`, no `docker-compose.yml`, and no reachable Postgres instance exist in this sandboxed worktree environment (confirmed: `server/.env` does not exist in the primary tree either, aside from the checked-out `.env` this task copied from `.env.example` purely so `npx prisma generate` — which does not require a live connection — could run for the typecheck). This is an environment limitation, not a defect introduced by this change: the failure occurs inside `createFixture()`'s very first `prisma.organization.create()` call, before the test ever reaches the route handler under test, and would fail identically against an unmodified `origin/main` copy of `messages.ts` in this same sandbox.

**What this means for coverage, stated plainly:**

- **Verified by direct, executable evidence in this environment:** typecheck (0 errors), the full clinic-scope access-decision matrix and the send-route provider/consent/audit `clinicId`-propagation logic (simulation, §9.1), and that the actual shipped route bodies contain exactly the code the diff claims and nothing else (source-inspection, §9.2).
- **Not verified in this environment, and explicitly flagged as a gap rather than silently assumed:** true end-to-end integration coverage through the real Express handler against a real database and real Prisma client (what `messagesConsentGate.test.ts` would provide if a database were reachable) — specifically, whether `prisma.sentMessage.findFirst({ where: { id, ...scope } })` behaves against Prisma's actual query-compilation of the `{clinicId: {in: [...]}}` shape exactly as the hand-simulated `matchesScope()` helper in the new test predicts. The shape itself (`ClinicIdScopeWhere`) is the same centralized type already exercised end-to-end by other DB-backed tests for sibling routes in this codebase (e.g., `messagesConsentGate.test.ts` itself does not exercise `...scope` spreading, but `validateAndGetClinicIdScope`'s Prisma-shape contract is exercised by other files' integration tests outside this task's scope) — it was not re-derived or altered by this change, only consumed the same way the file's own sibling `GET /api/messages` route already consumes it.
- **Recommendation for whoever next has DB access:** run `npx tsx src/tests/messagesConsentGate.test.ts` (unmodified, pre-existing) and, if desired, extend it with a sibling-clinic fixture (a second `Clinic` row in the same `Organization`, a `SentMessage` owned by it, and a user whose `allowedClinicIds`/`canAccessAllClinics` covers it but whose `clinicId` default is the first clinic) to get true integration confirmation of §8's requirements against a live Prisma/Postgres stack. This was not fabricated here because no database was reachable to run it against.

## 12. Remaining `messages.ts` matches and classification

Post-fix, `grep -nE "req\.user(!|\?)?\.clinicId" server/src/routes/messages.ts` in this worktree returns exactly **5** matches:

```
155:  const clinicId = req.user!.clinicId;
225:  const clinicId = req.user!.clinicId;
590:  const clinicId = req.user!.clinicId;
671:  const clinicId = req.user!.clinicId;
735:  const clinicId = req.user!.clinicId;
```

(Line numbers 590/671/735 reflect this worktree's own +10-line shift from the two routes' inserted `scope`-resolution blocks above them; the underlying routes are the same five KVKK-HIGH-006-S2 identified as `message-templates` POST/seed and `meta/submit`/`meta/sync`/`meta/status`.)

**Classification: `ASSIGNED_TO_BATCH_3` — out of this task's scope, intentionally untouched.** These correspond exactly to the five occurrences confirmed (read-only) in Batch 3's own uncommitted working tree (`kvkk-high006-batch3`, `git diff -- server/src/routes/messages.ts`) as already being remediated there with the same `resolveEffectiveClinicId`/`validateAndGetClinicIdScope` pattern. This task did not modify, re-implement, or duplicate that work. Batch 3's changes are uncommitted in its own separate worktree/branch and were not merged, rebased onto, or otherwise combined with this task's branch.

## 13. Confirmation: nothing committed or pushed

```
git log --oneline -3          → HEAD is 70ac5ed (== origin/main), no new commits
git rev-parse HEAD            → 70ac5ed9d729783c7cda492b126b1f34d6b3ca77
git rev-parse origin/main     → 70ac5ed9d729783c7cda492b126b1f34d6b3ca77 (identical)
git status --short            → M server/package.json, M server/src/routes/messages.ts,
                                 ?? server/src/tests/messagesRecordScope.test.ts (all unstaged/untracked)
```

No `git add`, `git commit`, `git push`, PR, merge, or deploy was performed at any point in this task. No production system was accessed. CodeGraph was not used (per standing instruction and this task's explicit prohibition).

## 14. Validation commands (as required by the task brief)

```
git diff --check       → clean, no whitespace errors
git diff --stat        → server/package.json | 8 +++++++-
                          server/src/routes/messages.ts | 14 ++++++++++----
                          2 files changed, 17 insertions(+), 5 deletions(-)
git status --short     → M server/package.json
                          M server/src/routes/messages.ts
                          ?? server/src/tests/messagesRecordScope.test.ts

rg -n "req\.user(!|\?)?\.clinicId" server/src/routes/messages.ts
  → 155, 225, 590, 671, 735 (exactly 5 — Batch 3's ownership, unmodified)
```
