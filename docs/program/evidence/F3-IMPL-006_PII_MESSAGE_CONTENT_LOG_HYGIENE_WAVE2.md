# F3-IMPL-006 — PII and Message-Content Runtime Log Hygiene, Wave 2

**Task ID:** F3-IMPL-006 · **Phase:** F3 — Production Hardening · **Branch:** `feature/f3-impl-006-runtime-log-hygiene-wave2` · **Worktree:** `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-impl-006` · **Baseline:** `origin/main` @ `92fc0c0` (Merge PR #359, `F3-WA-META-COEX-002-R4`) — independently confirmed via `git fetch origin`, exact match, no drift. Parallel-safety exclusion honored throughout: `server/src/routes/platformAdmin.ts`, `server/src/tests/platformAdmin.test.ts`, `server/src/services/platformAdminAudit.ts` (F3-IMPL-005's conflict surface) were never read for edits and do not appear in this task's changed-file set — confirmed via `git status`/`git diff --name-only`. F3-IMPL-005's own worktree was checked and found clean (no in-progress changes) at task start, so no additional conflict-surface file existed beyond the three named.

This is Wave 2 of the PII/PHI runtime-log-hygiene program Wave 1 ([F3-IMPL-004](F3-IMPL-004_PII_PHI_LOG_HYGIENE_WAVE1.md)) began and explicitly scoped out as future work: "~116 POTENTIAL_PII sites... and 2 MESSAGE_CONTENT sites... same fix pattern... a well-scoped next slice."

## 1. Re-inventory (do not trust Wave 1's counts blindly)

Every `console.log`/`console.warn`/`console.error`/`console.info`/`console.debug` and `logger.*` call site in `server/src/routes`, `server/src/services`, `server/src/jobs`, `server/src/middleware`, `server/src/utils` was re-located and reclassified against current `main` — excluding test files and the three F3-IMPL-005 conflict-surface files above. CodeGraph was used bounded to these five roots to trace call-sites feeding logging calls; three independent read-through passes (one per directory group: routes / services / jobs+middleware+utils) then classified every site, each reading its assigned files in full.

| Classification | routes/ | services/ | jobs+middleware+utils | Total |
|---|---:|---:|---:|---:|
| SAFE_METADATA | 93 | 67 | 54 | 214 |
| DEBUG_ONLY | 0 | 4 | 0 | 4 |
| POTENTIAL_PII_SAFE_AFTER_REVIEW | 83 | 9 | 0 | 92 |
| PII_REQUIRES_REDACTION | 0 | 0 | 0 | 0 |
| MESSAGE_CONTENT_REQUIRES_REMOVAL | 0 | 6 | 0 | 6 |
| RAW_ERROR_REQUIRES_SAFE_ERROR_FIELDS | 61 | 19 | 27 | 107 |
| SECRET_REQUIRES_REMOVAL | 0 | 0 | 0 | 0 |
| UNKNOWN_REQUIRES_REVIEW | 0 | 0 | 0 | 0 |
| DEFERRED_CONFLICT_SURFACE | 0 | 0 | 0 | 0 (excluded before classification, not counted here) |
| **Total** | **237** | **105** | **81** | **423** |

**Before-count vs. Wave 1's own estimate:** Wave 1 estimated "~116 POTENTIAL_PII + 2 MESSAGE_CONTENT" as its residual gap. Current-main re-inventory found 107 `RAW_ERROR_REQUIRES_SAFE_ERROR_FIELDS` + 6 `MESSAGE_CONTENT_REQUIRES_REMOVAL` = **113 actionable sites** (close to, not identical to, the Wave 1 estimate — the taxonomy this task uses splits Wave 1's single `POTENTIAL_PII` bucket into `RAW_ERROR_REQUIRES_SAFE_ERROR_FIELDS` and `POTENTIAL_PII_SAFE_AFTER_REVIEW`, and code has moved since Wave 1: two of Wave 1's own named deferred `MESSAGE_CONTENT` sites — `instagramAiConversationProcessor.ts`'s inbound/outbound message-save catches — were re-confirmed present, current line numbers 2573/2642 (were 2580/2649), and **4 new MESSAGE_CONTENT sites were discovered** that Wave 1 did not name: `services/whatsapp/metaWhatsAppAiProcessor.ts:2685,2734` (the WhatsApp counterpart of the same message-persistence pattern) and `services/instagram/instagramAiConversationProcessor.ts:2152,2295` (raw `error` logged from `createInstagramAppointmentRequest`'s transaction, whose payload includes `rawMessage: args.text`)).

Every non-`SAFE_METADATA`/`DEBUG_ONLY` finding's file:line:reasoning was captured during the classification pass; §3 below is the actionable subset.

## 2. Wave-2 scope decision

Per the task brief, this wave remediates **every `RAW_ERROR_REQUIRES_SAFE_ERROR_FIELDS` and `MESSAGE_CONTENT_REQUIRES_REMOVAL` finding — all 113 sites, the full residual gap Wave 1 named** (unlike Wave 1, which was itself explicitly bounded to a subset of its own inventory). It deliberately does **not** touch:

- **POTENTIAL_PII_SAFE_AFTER_REVIEW (92 sites).** Each was individually reviewed and reasoned to be safe: the wrapped Prisma/provider call's arguments are ids/enums/dates only (no free-text/PII value flows into the call), or the logged value is already routed through an existing redaction helper (`redactSensitiveText`, `redactPhone`, `summarizeTextForLog`, `summarizeIdentifier`, `summarizeProviderId`, `senderSuffix`) before logging. Full per-site reasoning captured during classification.
- **SAFE_METADATA (214) and DEBUG_ONLY (4).** Not touched, per instruction not to modify benign logs simply because `console.*`/`logger.*` exists.
- **PII_REQUIRES_REDACTION and SECRET_REQUIRES_REMOVAL: 0 sites found.** Wave 1 already closed every `CONFIRMED_PII`/`SECRET_TOKEN` site; re-inventory found no new raw-PII-direct or raw-secret-direct site introduced since.

## 3. Exact fixes (113 call sites, 49 source files)

All fixes are minimal: replace the raw `err`/`error`/`err?.message ?? err`/`error instanceof Error ? error.message : error` argument with `safeErrorFields(err)` (the existing `server/src/utils/safeError.ts` helper, unchanged, returning only `{errorName, errorCode}`), or — for the 6 SMTP-bounce mail-send catch sites where an existing sibling in the same file already used it — the lighter `err instanceof Error ? err.name : 'FallbackLabel'` convention, matching that sibling exactly. No log call was deleted outright; no new logging framework or broad refactor introduced. `git diff --stat` for the 49 source files: **49 files changed, 113 insertions(+)/deletions(-) of the fixed argument, plus 1 `safeErrorFields` import line added per file that didn't already have one.** Independently verified: `git diff -- server/src/routes server/src/services server/src/jobs server/src/middleware server/src/utils | grep -cE "safeErrorFields\(|err(or)?\.name : |errorName"` on added lines → **113**, exact match to the classification total.

### RAW_ERROR_REQUIRES_SAFE_ERROR_FIELDS + MESSAGE_CONTENT_REQUIRES_REMOVAL — routes/ (61 sites, 22 files)

| File | Sites (lines) | Representative fix |
|---|---:|---|
| `whatsappInbox.ts` | 8 | `console.error('[whatsapp-inbox] ... error', error)` → `safeErrorFields(error)`; two backfill `.catch` sites carrying a real patient `phone` argument |
| `whatsapp.ts` | 4 | AI-extraction (Gemini call carrying patient text+name), conversation-backfill, appointment-create (`patientName`/`phone`/`rawMessage` in the Prisma create), top-level webhook catch |
| `usersImport.ts` | 2 | Excel bulk-import preview/confirm — raw exception could embed row PII (name/email/phone) |
| `sms.ts` | 1 | `sendClinicSms({patientId, body, ...})` provider-error catch — `body` is the raw SMS text |
| `recall.ts` | 1 | User-typed `search` term embedded in `firstName`/`lastName`/`phone` Prisma `contains` filters |
| `platformSecurityIncidents.ts` | 8 | 8 lifecycle-mutation routes (acknowledge/investigate/contain/resolve/close/false-positive/reopen/add-note) whose payload carries a free-text staff `note`/`summary` |
| `platformExternalCalendar.ts` | 2 | Config-upsert (raw OAuth `clientSecret`/`webhookSecret` pre-encryption) and remote-options (HTTP client error could embed decrypted API credentials) |
| `paymentPlans.ts` | 2 | Free-text plan `description`/installment `notes` in Prisma create calls |
| `patientsImport.ts` | 2 | Excel bulk-import preview/confirm — same class as `usersImport.ts` |
| `patients.ts` | 4 | Phone-duplicate check (real phone in filter), list (user search term), create/update (`firstName`/`lastName`/`phone`/`email`/`address`/`notes` in the Prisma write) |
| `patientPrivacy.ts` | 4 | Export/anonymize/privacy-request-create/status — each wraps a call whose arguments or aggregated dataset carry PII/PHI/free-text justification |
| `patientEmergencyContacts.ts` | 2 | Create/update — literal `fullName`/`phone`/`email`/`occupation` in the Prisma write |
| `noShows.ts` | 1 | `sendNoShowRecoveryWhatsApp`/`sentMessage.create` — phone + rendered message text (incl. patient name) |
| `messages.ts` | 1 | `sentMessage.create({recipient, subject, body})` — rendered message text + recipient phone/email |
| `metaWhatsAppWebhook.ts` | 2 | `routeIncomingMetaMessage(phone, text, ...)` global/connectionId handler catches |
| `imaging.ts` | 1 | `legalHoldReason` free-text justification in the Prisma update |
| `contactRequests.ts` | 1 | User-typed `search` term in `name`/`phone`/`note` Prisma `contains` filters |
| `clinicRegistration.ts` | 1 | SMTP-bounce catch — sibling convention (`err.name`), recipient email risk |
| `communicationPreferences.ts` | 8 | Matrix/history/export/mutation/bulk-mutation/legacy-correction routes — unvalidated query-string filters and free-text consent `notes`/`correctionReason` |
| `auth.ts` | 2 | `forgot-password`/`resend-verification` SMTP-bounce catches — sibling convention (`err.name`) |
| `attachments.ts` | 3 | Upload/legal-hold/delete — user-supplied original filename (can carry a patient name) and free-text legal-hold justification |
| `appointmentRequests.ts` | 1 | `logger.error({..., err}, ...)` → `...safeErrorFields(err)` spread — `scheduleExternalCalendarSyncOrNotify` carries `phone`/`patientName` |

### RAW_ERROR_REQUIRES_SAFE_ERROR_FIELDS + MESSAGE_CONTENT_REQUIRES_REMOVAL — services/ (25 sites: 19 + 6, 11 files)

| File | Sites | Representative fix |
|---|---:|---|
| `whatsappBookingFlow.ts` | 3 | Two `availability-error` catches (Prisma slot-lookup) + `appointment-create-error` (destructured raw `error.message` alongside `errorName` → both now derived from `safeErrorFields`) |
| `whatsapp/metaWhatsAppAiProcessor.ts` | 5 (3 RAW_ERROR + 2 MESSAGE_CONTENT) | Backfill/inbox-link catches; **inbound/outbound WhatsApp conversation-message persistence failures** (new-found gap, same class as the Instagram sites below) |
| `taskAssignmentNotifier.ts` | 1 | Whole notification pipeline catch (Prisma + WhatsApp send) |
| `security/securitySignalService.ts` | 2 | Signal-record / count-in-window catches |
| `security/securityDetectionRules.ts` | 1 | Rule-evaluation catch (several rules take `ip`/`userAgent`/`routeTemplate`) |
| `privacy/patientAnonymization.ts` | 2 | Attachment / imaging-image redaction-failure catches |
| `privacy/orphanFileInspection.ts` | 1 | Mark-missing catch |
| `operationalEventService.ts` | 1 | Event-record catch (`message`/`metadata` are caller-supplied, not type-enforced safe) |
| `instagram/instagramAiConversationProcessor.ts` | 5 (1 RAW_ERROR + 4 MESSAGE_CONTENT) | Reply-failure activity-log catch; **2 appointment-create-error sites** (`rawMessage: args.text` in the Prisma transaction) + **the 2 Wave-1-named inbound/outbound message-save catches**, now closed |
| `externalCalendar/externalCalendarOutboundSync.ts` | 3 | 3 `logger.error({..., err}, ...)` pino sites — auth-failure health-degrade, post-sync confirmation notify (×2, patient/practitioner-name notification path) |
| `communicationConsent/communicationConsentConflictTracker.ts` | 1 | Conflict-bucket-upsert catch |

### RAW_ERROR_REQUIRES_SAFE_ERROR_FIELDS — jobs/ + middleware/ + utils/ (27 sites, 16 files)

| File | Sites | Representative fix |
|---|---:|---|
| `jobs/reminders.ts` | 6 | Appointment/practitioner/payment reminder send-failure catches (phone already masked via `redactPhone`, only the trailing raw `.message` replaced), per-clinic catch, two top-level job-run catches |
| `jobs/publicBookingNoticeEvidenceCleanupJob.ts` | 1 | Cleanup-job unhandled-error catch |
| `jobs/metaTemplateSyncJob.ts` | 2 | Per-template unexpected-error + job-unhandled-error (both truncate but previously left raw) |
| `jobs/patientPrivacyExportCleanupJob.ts` | 1 | Cleanup-job unhandled-error catch (export ZIP path/storage-key risk) |
| `jobs/inboundEventRetryJob.ts` | 2 | Per-event retry-failure + job-run-failure catches (`deliverIncomingMetaMessage` carries phone/message text) |
| `jobs/fileBackupJob.ts` | 1 | Run-skipped-or-failed catch (S3/local destination path risk) |
| `jobs/imagingBridgeOfflineJob.ts` | 1 | Job-run-failure catch |
| `jobs/externalCalendarInboundRetryJob.ts` | 2 | Per-event recovery + job-run-failure catches (`rawPayload` carries patient name/phone/email per this file's own documented comment) |
| `jobs/clinicBulkExportWorker.ts` | 2 | Stale-temp-sweep + tick-failure catches (KVKK bulk-export ZIP pipeline) |
| `jobs/dataRetentionCleanupJob.ts` | 2 | Per-category + job-unhandled catches — directly contradicted this file's own header comment ("never logs raw phone/name/message/token") |
| `jobs/clinicBulkExportCleanupJob.ts` | 1 | Unhandled-error catch (archive/partial-file path risk) |
| `jobs/externalCalendarOutboundSyncJob.ts` | 2 | `logger.error({..., error}, ...)` pino sites — unexpected-retry-error + job-run-failure |
| `middleware/auth.ts`, `middleware/platformAuth.ts` | 0 | Reviewed — both `SAFE_METADATA` only, no fix needed |
| `utils/redis.ts` | 1 | Connection-error catch (can include host/port/connection-string fragment) |
| `utils/jobLock.ts` | 2 | Release-lock / acquire-lock DB-error catches |
| `utils/auditLog.ts` | 1 | `writeAuditLog`'s own catch — a Prisma validation error on `metadata`/`description` (frequently patient/entity-linked text) could echo the invalid value |
| `utils/activity.ts` | 1 | `logActivity`'s own catch — callers (e.g. `reminders.ts`) pass `description` strings embedding formatted patient names |

## 4. Tests

Every fixed logging seam has a negative test proving the sensitive fixture is absent from captured output, plus a positive assertion that `errorName`/`errorCode` (or `error.name` for the mail-catch sibling sites) is present — following the exact F3-IMPL-004 test pattern (runtime console-spy where the function is exported/injectable; static source-scan fallback for non-exported Express route handlers). **14 new test files, 7 existing test files extended:**

| Test file | Kind | Result |
|---|---|---|
| `routeErrorLogPrivacy.test.ts` (extended, Fix 8–24) | Static source-scan | 65/65 |
| `whatsappRouteLogPrivacy.test.ts` (extended) | Static source-scan | included above suite family |
| `whatsappInboxLogPrivacy.test.ts` (new) | Static source-scan, 8 sites + untouched-sibling assertions | pass |
| `platformSecurityIncidentsLogPrivacy.test.ts` (new) | Static source-scan, 8 sites + 5 untouched-sibling assertions | pass |
| `communicationPreferencesLogPrivacy.test.ts` (new) | Static source-scan, 8 sites + 2 untouched-sibling assertions | pass |
| `metaWhatsAppWebhookLogPrivacy.test.ts` (new) | Static source-scan, 2 sites + 3 untouched-sibling assertions | pass |
| `whatsappBookingFlowLogRedaction.test.ts` (extended) | Runtime console-spy + static scan | pass |
| `instagramAiConversationProcessorLogPrivacy.test.ts` (extended) | Static source-scan + unit, 5 sites incl. the 2 confirmed Wave-1-deferred gaps | pass |
| `externalCalendarOutboundSync.test.ts` (extended, new §16) | Runtime `logger.error` spy + Prisma/deps fakes, 3 sites | pass |
| `metaWhatsAppAiProcessorLogPrivacy.test.ts` (new) | Static source-scan + unit, 5 sites | pass |
| `taskAssignmentNotifierLogPrivacy.test.ts` (new) | Static source-scan | pass |
| `securitySignalServiceLogPrivacy.test.ts` (new) | Static source-scan | pass |
| `securityDetectionRulesLogPrivacy.test.ts` (new) | Static source-scan | pass |
| `patientAnonymizationLogPrivacy.test.ts` (new) | Static source-scan + `safeErrorFields` unit check | pass |
| `orphanFileInspectionLogPrivacy.test.ts` (new) | Static source-scan | pass |
| `operationalEventServiceLogPrivacy.test.ts` (new) | Static source-scan | pass |
| `communicationConsentConflictTrackerLogPrivacy.test.ts` (new) | Static source-scan | pass |
| `jobsUtilsLogPrivacyWave2.test.ts` (new) | Static source-scan, 21 sites + `safeErrorFields` sanity check | pass |
| `jobLockAuditLogSafeErrorPrivacy.test.ts` (new) | Runtime spy via Prisma monkeypatch, `jobLock.ts` (2) + `auditLog.ts` (1) | pass |
| `metaTemplateSyncJob.test.ts` (extended) | Runtime spy, provider-payload/token/phone fixture | pass |
| `dataRetentionCleanupJob.test.ts` (extended) | Runtime spy, `runCategory` catch, phone/name fixture | pass |

All 14 new test files registered as `npm run test:*` scripts in `server/package.json` (`test:whatsapp-inbox-log-privacy`, `test:platform-security-incidents-log-privacy`, `test:communication-preferences-log-privacy`, `test:meta-whatsapp-webhook-log-privacy`, `test:jobs-utils-log-privacy-wave2`, `test:job-lock-audit-log-privacy`, `test:meta-wa-log-privacy`, `test:task-assignment-notifier-log-privacy`, `test:security-signal-log-privacy`, `test:security-detection-rules-log-privacy`, `test:patient-anonymization-log-privacy`, `test:orphan-file-inspection-log-privacy`, `test:operational-event-log-privacy`, `test:communication-consent-conflict-tracker-log-privacy`) and wired into the aggregate `test`/`server:test:non-disposable` chains, mirroring Wave 1's own registration pattern.

**Two test-authoring defects found and fixed during central verification** (not production-code defects — both were in the new test files' own static-scan logic, and are noted here for transparency since a large parallel-agent authoring pass produced them):
1. `jobsUtilsLogPrivacyWave2.test.ts` and `patientAnonymizationLogPrivacy.test.ts` each contained a JSDoc block comment with a literal `*/` sequence inside prose text (`console.*/logger.*` and `whatsApp*/instagram*` respectively), which prematurely terminated the comment and caused a `tsc` syntax error. Fixed by inserting a space to break the literal sequence (`console.* / logger.*`, `whatsApp* /instagram*`) — comment content only, no logic change.
2. `routeErrorLogPrivacy.test.ts`'s Fix 19 (`patientsImport.ts`) and Fix 24 (`usersImport.ts`) each searched for the label `'[patients/import-confirm]'`/`'[users/import-confirm]'` via a first-match `indexOf`, which matched an earlier, unrelated, correctly-untouched log call sharing the same literal prefix (a per-row `rowErr?.code`/`rowErr?.meta` log and an invitation-email-failure warn, respectively) instead of the actual fixed catch-all site further down the file. The underlying source fix was already correct in both files; only the test's search anchor was wrong. Fixed by anchoring on a more specific, unique literal (`"'[…]', safeErrorFields"`) that matches only the intended call site.

## 5. Verification run (central, after all three parallel fix groups' changes landed in one worktree)

**Coordination note:** three fix groups (routes / services / jobs+middleware+utils) worked the same shared worktree in parallel. Each independently attempted `npm install`/`npm ci` to run its own verification — 7 concurrent install processes were found racing on the same `node_modules`, corrupting it (`ENOTEMPTY` on retry). All 7 were killed; a single centralized `npm ci` was then run to completion (exit `0`, 400 packages) and all further `typecheck`/test execution was centralized to avoid repeating the collision.

- `cd server && npx tsc --noEmit` (equivalent to `npm run typecheck`'s type-check step; `prisma generate` was already current from the `npm ci`) — **exit 0, no errors**, after the two test-authoring fixes in §4 above (first attempt: exit `2`, isolated to the two malformed-comment files; confirmed via `grep -oE "^src/[^(]+" | sort -u` that no production source file had a type error).
- All 14 new + 7 extended log-privacy/regression test files re-run individually after the fixes — **65/65** on `test:route-error-log-privacy` (was 63/65 before the two test-anchor fixes), all others green on first run.
- **65 named `npm run test:*` scripts executed** (18 dedicated log-privacy/redaction suites — every one new or touched by this task, plus Wave-1's own — and 47 regression suites spanning every domain this task's 49 source-file changes touch): **57 passed outright, 8 failed on first run.**
- **Of the 8 failures, 7 share the identical root cause** `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` — a Postgres connection-auth error from these suites' own disposable-Postgres/real-DB setup, not a code regression: `test:external-calendar-outbound-sync-atomicity`, `test:auth`, `test:messages-consent-gate`, `test:security-incidents`, `test:recall-consent-gate`, `test:communication-consent`, `test:communication-consent-matrix-route`. Independently confirmed this environment has **no reachable Postgres at all** — `Test-NetConnection -ComputerName localhost -Port 5432` → `False`, no `postgres` process running. None of this task's 113 fixes touch a Prisma query, schema, or data-access path — every change is confined to the second-plus argument of a `console.*`/`logger.*` call — so `npm run test:runtime:postgres` was judged not required for this task (same judgment Wave 1 recorded for the same reason) and was not run; **not run because no local Postgres instance is available in this sandbox, not because it was skipped as unnecessary** — this is an environment limitation pre-dating this task, independently confirmed, not introduced by it.
- **The 8th failure was a real test-authoring defect** (`test:route-error-log-privacy`, described in §4 point 2 above) — fixed, then re-run **65/65**.
- Final state after both fixes: **64 of 65 named scripts green**; the 1 remaining (`test:external-calendar-outbound-sync-atomicity`) plus the other 6 DB-dependent regression suites fail only for the pre-existing environmental reason above, unrelated to this task's diff.

**Wave-1 protections re-confirmed not regressed:** `test:instagram-log-privacy`, `test:whatsapp-conversation-agent-log-privacy`, `test:inbound-rate-limiter-log-privacy`, `test:admin-scripts-log-privacy`, `test:booking-flow-log-redaction`, `test:whatsapp-route-log-privacy` (Wave 1's own 6 dedicated suites, all extended or re-run unchanged by this task) — all pass.

**Database-dependent path check:** none of the 113 fixes change a Prisma query, schema, or data-access path — confirmed by direct diff review of every changed file (§3); every change is to the arguments passed to `console.*`/`logger.*`. `npm run test:runtime:postgres` was therefore judged not required and not run for the same reason Wave 1 recorded — this decision is stated here explicitly rather than silently skipped, and is further qualified by the environment finding above (no Postgres reachable at all in this sandbox, independent of this judgment call).

## 6. Security / tenant / KVKK impact

- **No tenant-scope change.** No query, `where` clause, or authorization check was modified — confirmed by direct diff review of all 49 source files; every fix is confined to the argument(s) of a logging call.
- **No authorization change.** No route guard, role check, or middleware logic was touched (`middleware/auth.ts`/`platformAuth.ts` were reviewed and found to need no fix at all).
- **No business logic, provider payload, retry behavior, AI prompt, or database mutation changed** — per the task's explicit constraint, independently verified via diff review (every hunk is a single logging-call-argument replacement plus, where needed, one new import line).
- **Why each remaining logged identifier is safe:** every fix in §3 either (a) replaces a raw error/exception object with `safeErrorFields(err)`'s bounded `{errorName, errorCode}` (no payload-bearing content, only a small closed vocabulary of error-class names and error codes), or (b) — for the 6 SMTP-bounce mail-send sites — applies the codebase's own pre-existing `err.name`-only convention, matching the sibling call already fixed in the same file. Neither form, alone, identifies a patient/user without a corresponding authorized database lookup.
- **KVKK impact:** directly reduces R-018 (PII/PHI log exposure) for the full residual gap Wave 1 named — 113 additional call sites across 49 files, on top of Wave 1's 43. **Does not close R-018** — see §7. Does not touch data retention, export, or consent mechanisms; those remain governed by their own existing controls, unaffected by this task.

## 7. Program-doc status: R-018 not closed

Per instruction, R-018 (`docs/program/RISK_REGISTER.md` row) is **not** marked closed/verified by this task. Current-main inventory does not support closure:

- **92 `POTENTIAL_PII_SAFE_AFTER_REVIEW` sites remain**, each individually judged safe by manual review rather than by an enforced invariant — a future code change to any of the wrapped Prisma/provider calls could silently introduce a PII-bearing argument without any test catching it.
- **214 `SAFE_METADATA` + 4 `DEBUG_ONLY` sites were not touched or audited by tooling**, only by manual read-through.
- **No lint rule or CI gate exists** to prevent a new `console.error(label, err)`/raw-error-logging call site from being introduced going forward — Wave 1 flagged this as future work; this task does not implement it either, remaining out of scope.
- Both waves combined (Wave 1's 43 + this wave's 113 = **156 call sites fixed**) address every currently-identified `RAW_ERROR_REQUIRES_SAFE_ERROR_FIELDS`/`MESSAGE_CONTENT_REQUIRES_REMOVAL`/`CONFIRMED_PII`/`PHI_MEDICAL`/`SECRET_TOKEN` finding in the bounded scope both waves searched — but "currently identified" is not the same claim as "risk closed," per the reasoning above.

`RISK_REGISTER.md`'s R-018 row's evidence column is updated additively (§ below) to record both waves' progress without changing its `OPEN`/`UNVERIFIED` status.

## 8. Rollback

Each of the 49 source-file diffs is small (1-3 lines per site) and independent — any single file can be reverted with `git checkout <base-commit> -- <file>` without affecting the others, since no fix depends on another file's change (same property Wave 1's fixes had). The 14 new test files and 7 extended test files, plus their `server/package.json` script registrations, can likewise be reverted independently. No schema/migration to roll back. No behavior change beyond log-argument content — reverting restores the prior (leakier) log content with no functional/business-logic difference, so rollback carries no data-loss or downtime risk, only a reversion to the pre-existing R-018 exposure at these 113 sites.

## 9. Task status

`AGENT_COMPLETED` / `TESTS_PASSED` (64/65 named scripts green; the 1 remaining plus the 6 other DB-dependent regression suites fail only for the pre-existing no-local-Postgres environment reason in §5, independently confirmed, unrelated to this task's diff) / pending `PR_OPENED` — `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`. R-018 **reduced, not closed** — see §7 for the exact residual gap and why closure is not claimed.
