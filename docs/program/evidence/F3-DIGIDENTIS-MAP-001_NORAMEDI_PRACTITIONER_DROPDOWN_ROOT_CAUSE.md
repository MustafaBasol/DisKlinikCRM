# F3-DIGIDENTIS-MAP-001 — NoraMedi Practitioner Dropdown Empty on DigiDentiS Mapping Screen: Root Cause and Fix

**Task ID:** F3-DIGIDENTIS-MAP-001 · **Phase:** F3 — Production Hardening (DigiDentiS integration pilot stabilization) · **ClickUp:** 869egukwb · **Branch:** `fix/f3-digidentis-map-001-noramedi-practitioner-dropdown` · **Baseline:** `origin/main` @ `13caabb2644d586097d133d72c258ceed33e1f35` (merge of PR #356, F3-IMPL-004/-R1 — independently confirmed via `git fetch origin main` + `git rev-parse origin/main`; the pre-fix content of the one touched file, `server/src/routes/platformExternalCalendar.ts`, is byte-identical between this baseline and the investigation's starting commit `7f3157e507842bbd0eb5b14e8f1b5480a1e132d7` on the unrelated in-progress branch `feature/f2-stage3-impl-001-privacy-imaging-lifecycle-migration`, confirmed via `git diff`, so no work from that branch leaked into this fix).

## 1. Symptom

Platform Admin → Harici Takvim (External Calendar) → DigiDentiS mapping screen, for a given clinic (reported example: "Gebze Diş Dünyası"): the DigiDentiS-side practitioner dropdown populates correctly (e.g. "Kerem Özgüler"), but the NoraMedi-side practitioner dropdown shows only "—", so clinic dentists cannot be mapped. The DigiDentiS connection test is green (unrelated to this bug — that only proves the DigiDentiS credentials/HMAC signing work, not that NoraMedi-side data is being queried correctly).

## 2. Full path traced

`src/pages/platform/PlatformExternalCalendar.tsx:119` (`loadDetail`, fired when the admin clicks a clinic in the list) →
`GET /api/platform/clinics/:clinicId/external-calendar/local-options` →
`server/src/routes/platformExternalCalendar.ts` (mounted at `/api/platform`, `server/src/index.ts:199`) →
direct `prisma.user`/`prisma.userClinic` queries (no separate practitioner-directory service exists in this codebase; `User`/`UserClinic` are the single source of truth) →
response `{ practitioners: [{id, label}], services: [{id, label}] }` →
`setLocalOptions(res.data)` (`PlatformExternalCalendar.tsx:120`) → rendered into the NoraMedi-side `<select>` as `LocalOption { id, label }`.

**A. Is the selected clinicId sent?** Yes — `loadDetail(clinic)` calls the endpoint with `clinic.id` as the URL path param; the route's `getClinicIdParam(req)` reads it from `req.params.clinicId` and every downstream query filters by it. Confirmed by the new regression test's 401/200 auth cases and the clinic-scoping cases below all resolving against the exact clinicId in the URL, not a session-derived one.

**B. Is the backend querying the correct NoraMedi model?** Yes — `User`/`UserClinic`, the existing single source of truth for clinic staff, already used by `findUserAssignedToClinic` (`server/src/utils/relationGuards.ts:50`) and by the same "list this clinic's dentists" feature already shipped for WhatsApp (`getClinicPractitioners`, `server/src/routes/whatsapp.ts:1955`). No second practitioner source of truth was introduced.

**C/D/E/F — the actual root cause:** the query filtered strictly on `role: 'DENTIST'` (exact-string match against `User.role`). Per `server/src/utils/roles.ts`'s own documented normalization table (its module docstring, lines 4-24): canonical roles are stored uppercase (`DENTIST`), but **legacy roles are stored lowercase** (`doctor`, `admin`, `receptionist`, `billing`) — `doctor`/`dentist` both normalize to canonical `DENTIST` via `normalizeRole()`. Additionally, a user's *effective* role for a specific clinic can come from `UserClinic.role` (a branch-scoped assignment, schema.prisma:1617) rather than their org-wide `User.role` — exactly the two-source-of-truth shape `getEffectiveRoleForClinic` (`roles.ts:85`) and `findUserAssignedToClinic` already handle elsewhere in this codebase. The original query checked neither: it matched only canonical-cased `User.role`, and used `User.role` even for users whose clinic membership came through `UserClinic`. Any dentist stored with a legacy-cased role, or promoted to DENTIST only at the branch level via `UserClinic.role`, was silently excluded — producing an empty dropdown for clinics whose active dentists happen to be in either shape, while a clinic whose dentists all happen to have canonical-cased, primary-`clinicId` roles would show correctly (explaining why this wasn't caught earlier: it is data-shape-dependent, not universally broken). This is not a hypothetical: the identical two-source, legacy-casing-tolerant condition is already why `routes/whatsapp.ts`'s `getClinicPractitioners`/`getActiveDoctorCountForClinic` (lines 1932-1977) query `role: { in: ['doctor', 'DENTIST', 'dentist'] }` across both `UserClinic` and `User.clinicId` instead of a strict `User.role` equality check.

No organization-filter gap, no wrong-clinicId bug, no platform-admin-specific authorization gap, and no DTO field-name mismatch were found — `getClinicIdParam` is correct, `authenticatePlatformAdmin` behaves identically to every other platform-admin route, and the frontend's `LocalOption { id, label }` interface already matched the backend's `{ id, label }` shape exactly.

## 3. Fix

`server/src/routes/platformExternalCalendar.ts`, `GET /clinics/:clinicId/external-calendar/local-options` — replaced the single `prisma.user.findMany({ where: { role: 'DENTIST', OR: [...] } })` query with the same two-source pattern already established by `getClinicPractitioners`:

1. `prisma.userClinic.findMany({ where: { clinicId, isActive: true, user: { isActive: true }, role: { in: ['DENTIST', 'dentist', 'doctor'] } } })` — branch-scoped assignments, checked against `UserClinic.role`.
2. `prisma.user.findMany({ where: { clinicId, isActive: true, role: { in: [...] }, id: { notIn: [...alreadyAssignedIds] } } })` — legacy/primary-clinic assignments, checked against `User.role`, deduplicated against (1).
3. Union, sorted by first+last name.

`prisma.appointmentType` (services) query is untouched. Response shape (`{ id, label }` for both practitioners and services) is unchanged — no frontend change required or made.

Tenant/clinic scoping is unchanged and unweakened: every query is still filtered by the exact `:clinicId` path param (itself only reachable after `prisma.clinic.findUnique` confirms it exists), and `organizationId` is never read from caller input anywhere in this route file (consistent with the rest of `platformExternalCalendar.ts`, per its own header comment). A dentist belonging to a different clinic — same organization or a different one — is excluded purely by the `clinicId` filter, unaffected by this change.

## 4. Tests

New file: `server/src/tests/platformExternalCalendarLocalOptions.test.ts` — real-HTTP regression suite mounting the actual, unmodified `platformExternalCalendar.ts` router (same pattern as the existing `externalCalendarWebhookRouteE2E.test.ts`: `express()` + `app.listen(0)` + real `node:http` requests, prisma model delegates swapped for in-memory fakes, router dynamically imported after the swap). Covers:

| # | Scenario | Result |
|---|---|---|
| 1 | No platform admin token → `401` | ✓ |
| 2 | Valid platform admin token → `200` | ✓ |
| 3 | Multiple eligible dentists in one clinic, correctly shaped + sorted | ✓ |
| 4 | Legacy lowercase role (`"doctor"`) still returned | ✓ |
| 5 | Branch-scoped `UserClinic.role = "dentist"` honored even when org-wide `User.role` is not DENTIST | ✓ |
| 6 | Non-dentist role (`RECEPTIONIST`) excluded | ✓ |
| 7 | Inactive dentist excluded | ✓ |
| 8 | Dentist in a different clinic, different organization → excluded | ✓ |
| 9 | Dentist in a different clinic, **same** organization → excluded | ✓ |
| 10 | Clinic with exactly one eligible dentist → exactly that one returned | ✓ |
| 11 | Clinic with zero eligible dentists → `200` + `[]`, not an error | ✓ |
| 12 | Nonexistent clinic → `404` (distinguishable from the zero-dentist case) | ✓ |
| 13 | Services remain clinic-scoped, active-only, correctly shaped (unaffected by this fix) | ✓ |
| 14 | Practitioner DTO exposes exactly `{id, label}` | ✓ |

`14 passed, 0 failed` (`npx tsx src/tests/platformExternalCalendarLocalOptions.test.ts`).

No existing test files were modified. Pre-existing suites re-run unchanged, confirming no regression:

| Command | Result |
|---|---|
| `npx tsx src/tests/platformExternalCalendarLocalOptions.test.ts` | 14 passed, 0 failed |
| `npx tsx src/tests/externalCalendarMapping.test.ts` | 10 passed, 0 failed |
| `npx tsx src/tests/externalCalendarConnectionService.test.ts` | 22 passed, 0 failed |
| `cd server && npm run typecheck` | `prisma generate` + `tsc --noEmit` clean, exit `0` |

The DigiDentiS-side (`remote-options`) route and the mapping save/reload path (`externalCalendarMappingService.ts` / `externalCalendarMapping.test.ts`) were not touched — their existing coverage (above) is cited as unchanged, not re-authored.

Real-Postgres (`test:runtime:postgres`/`postgres-compat`) suites were not run for this change — no schema/migration touched, and the in-memory-fake E2E suite above already exercises the exact real router with real HTTP against every clinic/role/active-state boundary this fix changes; judged sufficient, decision recorded rather than silently skipped.

## 5. Scope discipline

- No schema or migration change — `User`/`UserClinic` and their `role` columns are unchanged; the fix is query logic only.
- No new practitioner/user source of truth introduced — reuses the existing `User`/`UserClinic` models via the same two-source pattern already shipped for WhatsApp's clinic-practitioner lookup.
- No clinic/org scoping removed or weakened.
- No DigiDentiS-side (`remote-options`) code touched.
- No unrelated refactor of `platformExternalCalendar.ts` — only the one route handler's query changed (plus an explanatory comment).

## 6. Program-tracking note

`docs/program/NORAMEDI_MASTER_TRACKER.md` §4/§5 and `docs/program/phases/F3_PRODUCTION_HARDENING.md` (both read fresh from `origin/main` for this task, not from the unrelated stale branch this investigation started on) show F3 already `IN_PROGRESS` as of F3-IMPL-001..004(-R1) (2026-08-10/11) — the task brief's own F3 framing is consistent with actual repository state, not stale. This task is a scoped bug fix within that same F3 phase (DigiDentiS integration pilot stabilization), not a new phase-entry decision; it does not change the F3 exit-gate status (still not satisfied — no live observability dashboard, no security-hardening checklist sign-off, no incident-response drill, all unchanged from F3-IMPL-001).

## 7. Status

`AGENT_COMPLETED`: yes. `TESTS_PASSED`: yes (14/14 new + 32/32 pre-existing cited suites + typecheck clean). `PR_OPENED`: yes — [PR #360](https://github.com/MustafaBasol/DisKlinikCRM/pull/360). `MERGED`: no. `DEPLOYED`: no. `PRODUCTION_VERIFIED`: no (this task performed no production access). Per the assigning task brief: **not merged, not deployed, not marked complete** — stopped here for architecture review.

**corrected 2026-08-11, F3-DIGIDENTIS-MAP-001-R1:** the section above described the read-path (dropdown listing) fix only. Architecture review of PR #360 found the read-path fix was directionally correct but incomplete on its own: the eligibility rule it introduced (§3 above) was enforced only on `GET .../local-options`, not on the mapping **write path**. Read §8 below before treating this task as closed — the practitioner-eligibility invariant is now enforced consistently on both paths as of R1, but §7's `TESTS_PASSED`/`AGENT_COMPLETED` tags above cover only the read-path scope they were written for, not the R1 write-path scope covered in §8/§9.

## 8. R1 — Architecture-review finding: the write path did not enforce practitioner eligibility

**Finding:** `upsertExternalCalendarMapping()` (`server/src/services/externalCalendar/externalCalendarMappingService.ts`) creates/updates a `mappingType='practitioner'` row after calling its private `verifyLocalEntityBelongsToClinic()`, which — before this R1 fix — only checked that the target `User` was active and belonged to the clinic (via `User.clinicId` or an active `UserClinic` row), with **no check on role at all**. The dropdown (§3's fix) now hides non-practitioners from the UI, but a direct, authenticated `PUT /api/platform/clinics/:clinicId/external-calendar/mappings` call could still map a receptionist, clinic manager, or billing user to a DigiDentiS doctor — the UI omission was cosmetic, not an enforced invariant. This is a real gap: Platform Admin API calls are not restricted to the admin UI's own request shapes.

**Root cause class:** the eligibility rule (branch-scoped `UserClinic.role` OR legacy `User.clinicId`+`role`, value in `DENTIST`/`dentist`/`doctor`, `User.isActive` required) was written once, directly inline, inside the `local-options` route handler (§3's fix) — there was no shared, importable contract for "is this user an eligible practitioner for this clinic," so the write-path validator never got it and had no way to reuse it without either duplicating the query a third time (after `routes/whatsapp.ts`'s pre-existing copy) or reaching across into another domain's route file.

**Fix:** extracted ONE shared contract into `server/src/utils/relationGuards.ts` — the existing, domain-neutral, already-multiply-imported home for clinic-scoped entity lookups (`findUserAssignedToClinic`, `findPatientInClinic`, `findAppointmentTypeInClinic`, etc.), not owned by either the external-calendar or user/staff domain:

- `listClinicPractitioners(clinicId)` — the list variant (branch-scoped ∪ legacy, deduplicated, sorted), same shape as the query previously inlined in `local-options`.
- `findClinicPractitioner(userId, clinicId)` — the single-user variant, same rule, returns the user's `{id, firstName, lastName}` or `null`.

Both call sites now delegate to this one contract:
- `platformExternalCalendar.ts`'s `local-options` route calls `listClinicPractitioners(clinicId)` (its previous ~30-line inline query block was deleted).
- `externalCalendarMappingService.ts`'s `verifyLocalEntityBelongsToClinic()` practitioner branch now calls `findClinicPractitioner(localId, clinicId)` instead of its old loose `prisma.user.findFirst` clinic-membership-only check.

No second practitioner source of truth was introduced, and `relationGuards.ts`'s existing exports (`findUserAssignedToClinic` and everything else) were **not modified** — only two new functions were added — so no other existing consumer of that file changes behavior. `routes/whatsapp.ts`'s own pre-existing, independently-shipped `getClinicPractitioners()`/`getActiveDoctorCountForClinic()` copy was left untouched (out of this task's scope — it predates F3-DIGIDENTIS-MAP-001 and isn't part of the blocking finding); it remains a third, functionally-identical but textually-duplicate copy of the same rule, noted here as residual, non-blocking duplication rather than silently left unmentioned.

Tenant/clinic scoping is unchanged: both new functions filter by the exact `clinicId` argument, exactly as the code they replaced did; `findClinicPractitioner` additionally requires the target `userId` to match, so a user from a different clinic or organization simply doesn't resolve, regardless of role.

## 9. R1 — Tests

New file: `server/src/tests/externalCalendarMappingPractitionerEligibility.test.ts` — 18 cases, directly exercising both the shared contract and the actual write path (`upsertExternalCalendarMapping`), matching the architecture review's scenario letters:

| Scenario | Case | Result |
|---|---|---|
| A | Branch-scoped eligible dentist (`UserClinic.role="dentist"`, org-wide role non-practitioner) — `findClinicPractitioner` accepts, dropdown lists, write path succeeds | ✓ |
| B | Legacy eligible dentist (`User.clinicId` + `role="doctor"`, no `UserClinic` row) — accepted, listed, write succeeds | ✓ |
| C | Receptionist in the same clinic — rejected by `findClinicPractitioner`, absent from dropdown, write path throws `ExternalCalendarMappingLocalEntityInvalidError` | ✓ |
| D | Clinic manager in the same clinic — same three rejections | ✓ |
| E | Billing (non-practitioner) user in the same clinic — same three rejections | ✓ |
| F | Inactive dentist — same three rejections | ✓ |
| G | Dentist in a different clinic, different organization — same three rejections | ✓ |
| G | Dentist in a different clinic, same organization — same three rejections | ✓ |
| I | Cross-check: the exact set of ids the write path accepts equals the exact set `listClinicPractitioners` lists, both directions | ✓ |

`18 passed, 0 failed` (`npx tsx src/tests/externalCalendarMappingPractitionerEligibility.test.ts`).

Scenario H (existing valid practitioner mappings still resolve) is covered by the pre-existing `externalCalendarMapping.test.ts` suite, re-run below — not duplicated in the new file.

`externalCalendarMapping.test.ts` required updated in-memory `prisma` fakes (`role` field added to its two fixture users; a `prisma.userClinic` fake added, previously absent from that file) because `findClinicPractitioner` now always attempts a `UserClinic` lookup first — this is a test-fixture change only, no assertion was weakened, and the file's original 10 test cases and their assertions are unchanged:

| Command | Result |
|---|---|
| `npx tsx src/tests/externalCalendarMappingPractitionerEligibility.test.ts` | 18 passed, 0 failed |
| `npx tsx src/tests/platformExternalCalendarLocalOptions.test.ts` | 14 passed, 0 failed (unchanged from §4 — `listClinicPractitioners` emits the identical query shape the route's inline code previously did) |
| `npx tsx src/tests/externalCalendarMapping.test.ts` | 10 passed, 0 failed (fixtures updated as above; assertions unchanged) |
| `npx tsx src/tests/externalCalendarConnectionService.test.ts` | 22 passed, 0 failed (unaffected) |
| `cd server && npm run typecheck` | `prisma generate` + `tsc --noEmit` clean, exit `0` |

**On broader/DB-required suites:** `relationGuards.ts` is imported by other call sites outside external-calendar (e.g. task-relation validation), but only two new exports were added — its pre-existing exports were not touched, so no other consumer's behavior can change. On that basis, `test:runtime:postgres`/`postgres-compat` were judged not required and not run for R1, the same standard applied in §4; this is a recorded judgment call, not a silent skip, and is the one item architecture review should double-check if it disagrees with the additive-change reasoning above.

## 10. R1 — Status

`AGENT_COMPLETED`: yes (write-path gap closed). `TESTS_PASSED`: yes (18/18 new + 14/14 + 10/10 + 22/22 pre-existing = 64/64, typecheck clean). `PR_OPENED`: pending update to existing PR #360 (not a second PR). `MERGED`: no. `DEPLOYED`: no. `PRODUCTION_VERIFIED`: no. Per the R1 remediation brief: **not merged, not deployed** — updated PR #360 for a second architecture-review pass.
