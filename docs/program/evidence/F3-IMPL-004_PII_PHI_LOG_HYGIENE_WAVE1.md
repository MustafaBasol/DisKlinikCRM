# F3-IMPL-004 — PII/PHI Runtime Log Hygiene, Wave 1

**Task ID:** F3-IMPL-004 · **Phase:** F3 — Production Hardening · **Branch:** `feature/f3-impl-004-pii-log-hygiene-wave1` · **Worktree:** `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-004` · **Baseline:** `origin/main` @ `1909b186a01611c8be90313b7166085a887d05f4` (independently confirmed via `git fetch origin`/`git rev-parse origin/main`, exact match, no drift). Ran in parallel with F3-IMPL-002 (production worker contract) and F3-IMPL-003 (platform-admin audit); this task's parallel-safety exclusions (`server/src/index.ts`, `server/src/worker.ts`, `server/src/utils/backgroundJobsOwnership.ts`, `scripts/noramedi-deploy.sh`, `server/src/routes/platformAdmin.ts`, and any `platformAdmin`/`AdminAudit`-named file) were honored throughout — confirmed via `git status`/`git diff --name-only`, none of the 18 changed files match.

This is a bounded first wave, not a repo-wide logging rewrite. It follows on from [F3-IMPL-001](F3-IMPL-001_FIRST_CUSTOMER_PRODUCTION_HARDENING.md), which fixed R-018 at 7 sites in `routes/platformAdmin.ts` and explicitly left "the ~91 other non-test `console.*` call sites found repo-wide" as future work, and flagged "a repo-wide `console.*`→structured-logger migration (or a lint rule)" as a natural next slice.

## 1. Pre-work inventory

Every `console.log`/`console.warn`/`console.error`/`console.info`/`console.debug` and `logger.*` call in production runtime source (`server/src/routes`, `server/src/services`, `server/src/jobs`, `server/src/scripts`, `server/src/utils`, `server/src/middleware`) was located and classified, excluding test files (`*.test.ts`/`*.spec.ts`/`__tests__/`/`/tests/`) and the excluded files above. Three independent passes (one per directory group) each read every candidate file in full and classified every call site.

| Classification | routes/ | services/ | jobs+scripts+utils+middleware | Total |
|---|---:|---:|---:|---:|
| SAFE_METADATA | ~134 | 61 | 183 | ~378 |
| DEBUG_ONLY | 0 | 2 | 0 | 2 |
| POTENTIAL_PII | ~84 | 24 | 8 | ~116 |
| CONFIRMED_PII | 2 | 1 | 9 | 12 |
| PHI_MEDICAL | 15 | 9 | 0 | 24 |
| SECRET_TOKEN | 1 | 6 | 0 | 7 |
| MESSAGE_CONTENT | 0 | 2 | 0 | 2 |
| TEST_ONLY | 0 | 0 | 0 | 0 |
| **Total** | **~236** | **105** | **200** | **~541** |

(`~` marks a ±1-2 reconciliation tolerance the routes-group reviewer flagged between its per-file sums and the raw grep count — every file was read in full regardless; not chased further since it doesn't change which sites are CONFIRMED_PII/PHI_MEDICAL/SECRET_TOKEN.)

Full per-file classification detail (every non-SAFE_METADATA/DEBUG_ONLY finding, with file:line, code, and reasoning) was captured during the inventory pass; the exact fix list in §3 below is the actionable subset.

## 2. Wave-1 scope decision

Per the task brief's own priority list — patient name, email, phone, message content, appointment/treatment details, medical history, DICOM metadata, tokens, secrets, provider credentials — Wave 1 remediates **every SECRET_TOKEN, CONFIRMED_PII, and PHI_MEDICAL finding** (43 call sites across 18 files). It deliberately does **not** touch:

- **POTENTIAL_PII (116 sites) and MESSAGE_CONTENT (2 sites, both narrow variants of the same root cause).** Nearly all of these share one shape: `console.error(label, err)` / `err?.message ?? err` around a Prisma write whose arguments include PII/PHI, where a validation error *could* echo the value but doesn't in the common case (contrast with the CONFIRMED_PII SMTP-bounce and PHI_MEDICAL clinical-write sites in §3, which do so routinely/reliably enough to fix now). Retrofitting all 116+ of these would mean touching on the order of 60+ additional files — exactly the repo-wide rewrite this task is explicitly scoped not to do. Flagged as the next wave (see §8).
- **SAFE_METADATA (~378) and DEBUG_ONLY (2).** Not touched, per the task's explicit instruction not to modify benign logs simply because `console.*` exists.

## 3. Exact fixes (43 call sites, 18 files)

All fixes are minimal: either drop a risky field from an already-structured log object (keeping its safe id-based sibling), or replace a raw error/value with its type/code/masked form. No log call was deleted outright; no new logging framework or broad refactor was introduced. Full diffs in the PR; `git diff --stat` for the 18 source files: **18 files changed, 55 insertions(+), 59 deletions(-)**.

### SECRET_TOKEN (7 sites → 5 fix locations)

| File | Fix |
|---|---|
| `services/instagram/InstagramMessagingProvider.ts` (3 sites: request/response/error logs) | Removed `tokenPrefix`/`tokenLength` (first 8 chars of the real Instagram/Facebook access token) from the shared `diagnosticBase` object spread into all 3 logs; deleted the now-unused `tokenPrefix()` function. Contradicted the file's own "tokens are NEVER logged" header comment. |
| `services/whatsappStepAwareNlu.ts:538` | `console.error('[whatsapp-agent] step-aware-nlu-error', error)` → logs `error instanceof Error ? redactSensitiveText(error.message) : 'unknown error'`. The wrapped call embeds the raw Google AI Studio API key in the request URL query string; a network-layer error can echo that URL. |
| `services/whatsappConversationAgent.ts:312` | Same fix, same root cause (`runGoogleConversationAgent` also builds its endpoint with the raw key in the query string). |
| `services/backupService.ts:272` | `console.error('[backup] Failed to drop temp DB:', dropErr?.message)` → logs `{ code: dropErr?.code }` only. Node's `execFile('dropdb', ...)` failure message embeds `PGHOST`/`PGPORT`/`PGUSER` parsed from `DATABASE_URL`. |
| `routes/whatsapp.ts:1286` | `console.error('[whatsapp-public-api] connection resolution error', error)` → logs `error instanceof Error ? error.name : 'UnknownError'`. Wraps comparison of a caller-supplied `providedSecret` against stored credentials. |

### CONFIRMED_PII (12 sites)

| File | Fix |
|---|---|
| `utils/inboundRateLimiter.ts:42-47` | Raw `sender` (phone or external id) in the rate-limit warn → `maskSender(sender)` (new local helper, `***`+last-4 convention, works for both phone and non-numeric ids). |
| `scripts/repair-owner-admin.ts` (6 sites) | All `${targetEmail}`/`${user.email}` interpolations → `${user.id}` (added a new `Hedef kullanıcı: ${user.id}` log right after the user is resolved, since the original first log fired before resolution). |
| `scripts/platform-admin-recover-password.ts:321` | Dry-run `Email:` line → new `maskEmail()` helper (`a***@domain.com`), mirroring the file's existing `maskAdminId()` pattern. The `.email` field on the result type itself is untouched. |
| `scripts/migrate-to-multibranch.ts:125` | `${adminUser.email}` → `${adminUser.id}`. |
| `services/instagram/instagramAiConversationProcessor.ts:648` | Raw `externalSenderId` in `[instagram-assistant] reply send failed` → `senderSuffix(args.externalSenderId)` (the file's own existing last-4-chars helper, already used elsewhere in the same file), added as an override key after the `...metadata` spread. |
| `routes/users.ts:219` | SMTP-bounce `err?.message` (can echo `user.email`) → `err instanceof Error ? err.name : 'MailError'`. |
| `routes/usersImport.ts:382` | Same fix for the bulk-import invitation-email path. |

### PHI_MEDICAL (24 sites)

| File | Fix |
|---|---|
| `services/instagram/instagramAiConversationProcessor.ts` (2 sites) | Dropped `serviceName`/`practitionerName` from both `[appointment-request] created` logs, kept `serviceId`/`practitionerId`. |
| `services/whatsappBookingFlow.ts` (7 sites) | Dropped `matchedServiceName`, `matchedPractitioner`, `requestedTime` (×3), `requestedStartTime`/`requestedEndTime`, `practitionerName` — kept every id-based sibling field and the file's existing `redactPhone`/`summarizeTextForLog` calls untouched. |
| `routes/whatsapp.ts` (3 sites) | Dropped `serviceName`/`practitionerName` from all 3 `[appointment-request] created` logs (assistant flow, staff flow, public-API flow). A 4th sibling site (`/cancel-request`) already hardcoded both to `null` — confirmed untouched. |
| `routes/whatsapp.ts` (7 sites) | `selectedAppointmentTypeName: state?.selectedAppointmentTypeName ?? null` → hardcoded `null` in the 7 route-handler debug logs that weren't already safe, matching the 6 sibling sites that already did this. Non-logging uses of the same field (conversation-state persistence) verified untouched. |
| `routes/patientMedicalHistory.ts:327` | `err?.message ?? err` → `safeErrorFields(err)` (existing repo helper, `{errorName, errorCode}`). Wraps a `patientMedicalHistory.create` carrying allergies/medications/pregnancy status/conditions. |
| `routes/dentalChart.ts:104` | Same fix; wraps a `toothRecord.upsert` carrying a free-text clinical `note`. |
| `routes/imaging.ts:763` | Same fix; wraps `ingestImagingStudyCore`, which writes `originalName`/`description` — this file's own header states filenames/DICOM tags must never be logged. |
| `routes/imagingBridgePublic.ts:385` | Same fix, same underlying call as imaging.ts. |
| `routes/treatmentCases.ts:458` | Same fix (file already imported `safeErrorFields` for another catch — reused it here); wraps an `inventoryTransaction.create` carrying a free-text material-usage note. |

## 4. Tests

Every changed logging seam has a negative test proving the sensitive fixture does not appear in captured output, plus a positive assertion that the safe replacement (id, name/code, masked suffix) does. 6 new test files, 5 existing test files extended:

| Test file | Kind | Result |
|---|---|---|
| `tests/instagramProvider.test.ts` (extended) | Runtime console-spy (`testConnection`/`sendMessage`) | 66/66 |
| `tests/whatsappStepAwareNlu.test.ts` (extended) | Runtime console-spy, mocked `fetch` throwing a URL-embedded key | 13/13 |
| `tests/whatsappConversationAgentLogPrivacy.test.ts` (new) | Runtime console-spy | 2/2 |
| `tests/platformBackup.test.ts` (extended) | Static source-scan (real `dropdb` not exercisable in this environment) | 25/25 |
| `tests/whatsappBookingFlowLogRedaction.test.ts` (extended) | Runtime console-spy (new locations 7–13) + static source-scan | 26/26 |
| `tests/instagramAiConversationProcessorLogPrivacy.test.ts` (new) | Static source-scan + fixture-literal absence checks | 5/5 |
| `tests/whatsappRouteLogPrivacy.test.ts` (new) | Static source-scan (route handlers are non-exported, DB/Express-coupled) | 17/17 |
| `tests/inboundRateLimiterLogPrivacy.test.ts` (new) | Runtime console-spy (phone-shaped + non-numeric sender) | 3/3 |
| `tests/adminScriptsLogPrivacy.test.ts` (new) | Static source-scan (2 scripts) + runtime console-spy (`printResult`) | 7/7 |
| `tests/routeErrorLogPrivacy.test.ts` (new) | Static source-scan (7 route fixes) + `safeErrorFields` fixture check | 13/13 |

All 6 new files registered as `test:*` scripts in `server/package.json` and appended to the aggregate `test` chain (confirmed no duplicate/corrupted entries after 5 parallel edits — `package.json` re-validated as parseable JSON, every new script present exactly once).

Static-source-scan was the deliberate fallback wherever the log-emitting code lives in a non-exported function requiring heavy Express/Prisma mocking to reach at runtime (e.g. deep inside `routes/whatsapp.ts` route handlers); runtime console-capture was used everywhere a function was already exported/injectable with lightweight fixtures (the majority of sites). This mirrors the pre-existing pattern in `whatsappBookingFlowLogRedaction.test.ts`.

## 5. Verification run (central, after all fixes merged into one worktree)

- `cd server && npm run typecheck` (`prisma generate && tsc --noEmit`) — **exit 0, no errors.**
- All 7 new/extended log-privacy suites — **pass** (`test:route-error-log-privacy`, `test:inbound-rate-limiter-log-privacy`, `test:admin-scripts-log-privacy`, `test:instagram-log-privacy`, `test:whatsapp-conversation-agent-log-privacy`, `test:whatsapp-route-log-privacy`, `test:booking-flow-log-redaction`).
- Regression suites for every touched domain — **all pass, 0 failures**: `test:whatsapp`, `test:instagram`, `test:meta-wa` (includes `whatsappStepAwareNlu.test.ts`), `test:patient-medical-history`, `test:imaging`, `test:dental-chart-clinic-scope`, `test:treatment-case-scope`, `test:user-import-onboarding`, `test:staff-onboarding`, `test:platform-backup`, `test:file-backup`, `test:imaging-bridge-pairing`, `test:imaging-bridge-onboarding`, `test:imaging-bridge-update`, `test:inbox`.
- `git status --porcelain` in the worktree after all 5 parallel remediation agents finished: exactly 23 modified + 6 new files, all within the 18 target source files, `server/package.json`, and the 11 test files above — no stray/unintended file touched, no excluded file touched.

**Database-dependent path check:** none of the 18 fixes change a Prisma query, schema, or data-access path — every change is to the arguments passed to `console.*`/`logger.*` calls. `npm run test:runtime:postgres` was therefore judged not required for this task and not run; this judgment is recorded here rather than silently skipped. No schema migration involved.

## 6. Security / tenant / KVKK

- **No tenant-scope change.** No query, `where` clause, or authorization check was modified — every fix is confined to the second+ argument of a logging call.
- **No authorization change.** No route guard, role check, or middleware was touched.
- **Why each remaining logged identifier is safe:** every fix in §3 either (a) drops a name/content field entirely, keeping only an already-present internal id (not independently identifying without database access), (b) replaces a raw error/message with a bounded, non-payload-bearing type/code (`error.name`, `safeErrorFields()`'s `{errorName, errorCode}`), or (c) applies the codebase's existing masking convention (`***`+last-4 for phone/sender-ids, `local[0]***@domain` for email, `id.slice(0,8)...` for admin ids — all pre-existing patterns reused, not invented). None of these forms, alone, identifies a patient/user without a corresponding database lookup restricted by the same authorization the request path already enforces.
- **KVKK impact:** directly reduces R-018 (PII/PHI log exposure) for the 43 highest-confidence sites found. Does not touch data retention, export, or consent mechanisms — those remain governed by their own existing controls (data retention job, patient privacy export, communication consent), unaffected by this task.

## 7. Rollback

Each of the 18 source-file diffs is small (2-26 lines) and independent — any single file can be reverted with `git checkout <base-commit> -- <file>` without affecting the others, since no fix depends on another file's change. The 6 new test files and `server/package.json` script registrations can likewise be reverted independently (removing a `test:*` entry and its aggregate-chain reference). No schema/migration to roll back. No behavior change beyond log output — reverting restores the prior (leakier) log content with no functional/business-logic difference, so rollback carries no data-loss or downtime risk, only a reversion to the pre-existing R-018 exposure at these 43 sites.

## 8. Remaining R-018 gap and exact next task

**Not closed by this task:**
- **~116 POTENTIAL_PII sites** (raw `error`/`error.message` logged around Prisma writes or provider calls whose arguments carry PII/PHI, where the leak is possible but not the routine case) across ~50+ files in `routes/`, `services/`, and `jobs/`. The dominant pattern (`console.error(label, err)` → should become `safeErrorFields(err)` or `err.name`) is now mechanical and precedented by this wave's §3 fixes, making it a well-scoped next slice.
- **2 MESSAGE_CONTENT sites** (`instagramAiConversationProcessor.ts:2580,2649` — Prisma validation errors on inbound/outbound message-save calls can embed the raw message text).
- **~378 SAFE_METADATA + 2 DEBUG_ONLY sites** — correctly left untouched.
- **No structured-logger migration** — `console.*` remains the dominant call pattern outside the pino-based `utils/logger.ts` HTTP layer (hardened separately, pre-dates this task). Repo-wide migration remains future work, as F3-IMPL-001 already flagged.

**Exact next task:** a Wave 2 scoped to the ~116 POTENTIAL_PII `err.message`-near-Prisma-write sites (and the 2 MESSAGE_CONTENT sites), applying the same `safeErrorFields(err)`/`error.name` substitution pattern established in this wave, file-by-file, with the same negative-test-per-seam requirement. A separate, later task should evaluate a lint rule (e.g. banning bare `err.message`/raw `err` in `console.error` second-argument position) to prevent regression, rather than relying on wave-by-wave manual sweeps indefinitely.

## Task status

`AGENT_COMPLETED` / `TESTS_PASSED` / pending `PR_OPENED` (see PR link in tracker once opened) — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`.
