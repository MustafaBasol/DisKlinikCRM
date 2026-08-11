# F3 — Production Hardening

Faz durumu: `IN_PROGRESS` · Son güncelleme: 2026-08-11 (F3-DIGIDENTIS-MAP-001, bug fix — narrative below unchanged except this new entry, appended additively)

**F3-DIGIDENTIS-MAP-001 (2026-08-11):** DigiDentiS integration pilot stabilization bug fix — Platform Admin → Harici Takvim → DigiDentiS mapping screen's NoraMedi-side practitioner dropdown showed only "—" for clinics with active dentists (DigiDentiS-side dropdown populated correctly; connection test green). Branch `fix/f3-digidentis-map-001-noramedi-practitioner-dropdown`, baseline `origin/main` @ `13caabb2644d586097d133d72c258ceed33e1f35` (includes F3-IMPL-002/003/004/-R1 above). **Root cause:** `GET /api/platform/clinics/:clinicId/external-calendar/local-options` (`server/src/routes/platformExternalCalendar.ts`) filtered strictly on `role: 'DENTIST'` against `User.role`. Per `utils/roles.ts`'s own documented normalization table, dentists can be stored with a legacy lowercase role (`doctor`/`dentist`) and/or have their effective role for a clinic come from `UserClinic.role` (branch assignment) rather than org-wide `User.role` — exactly the two conditions `routes/whatsapp.ts`'s pre-existing `getClinicPractitioners()` already accounts for via `role: { in: ['DENTIST', 'dentist', 'doctor'] }` across both `UserClinic` and `User.clinicId`. The strict equality filter silently excluded any such dentist; empty-dropdown behavior was data-shape-dependent, not universal, which is why it was not caught earlier. **Fix:** mirrored `getClinicPractitioners()`'s existing, already-shipped two-source/legacy-role-tolerant query pattern into `local-options` — no second practitioner source of truth introduced, no schema/migration change, no clinic/org scoping touched, DigiDentiS-side (`remote-options`) route untouched. New `platformExternalCalendarLocalOptions.test.ts`: real-HTTP E2E against the actual unmodified router (14/14: auth, multi-dentist, legacy-role, branch-role, non-dentist exclusion, inactive exclusion, other-clinic/other-org exclusion, single-dentist, zero-dentist-vs-404, DTO shape). Pre-existing `externalCalendarMapping.test.ts` (10/10) and `externalCalendarConnectionService.test.ts` (22/22) re-run unchanged, zero regression; `cd server && npm run typecheck` exit `0`. Does not change the F3 exit-gate status (unchanged, not satisfied). `AGENT_COMPLETED`/`TESTS_PASSED`/`PR_OPENED` ([PR #360](https://github.com/MustafaBasol/DisKlinikCRM/pull/360)) — `NOT_MERGED`/`NOT_DEPLOYED`/`NOT_PRODUCTION_VERIFIED`. Full detail: [evidence/F3-DIGIDENTIS-MAP-001_NORAMEDI_PRACTITIONER_DROPDOWN_ROOT_CAUSE.md](../evidence/F3-DIGIDENTIS-MAP-001_NORAMEDI_PRACTITIONER_DROPDOWN_ROOT_CAUSE.md).

**F3-IMPL-004 (2026-08-10):** PII/PHI runtime log hygiene, wave 1 — ran in parallel with F3-IMPL-002/F3-IMPL-003 under a separate task ID; dedicated worktree, branch `feature/f3-impl-004-pii-log-hygiene-wave1`, baseline `origin/main` @ `1909b186a01611c8be90313b7166085a887d05f4`. Full detail in [evidence/F3-IMPL-004_PII_PHI_LOG_HYGIENE_WAVE1.md](../evidence/F3-IMPL-004_PII_PHI_LOG_HYGIENE_WAVE1.md). Follows F3-IMPL-001 below, which fixed R-018 at 7 sites in `routes/platformAdmin.ts` and flagged the remaining repo-wide `console.*` sites as future work. Full production-runtime `console.*`/`logger.*` inventory across `routes/`, `services/`, `jobs/`, `scripts/`, `utils/`, `middleware/` (excluding tests): ~541 call sites classified `SAFE_METADATA`/`POTENTIAL_PII`/`CONFIRMED_PII`/`PHI_MEDICAL`/`SECRET_TOKEN`/`MESSAGE_CONTENT`/`DEBUG_ONLY`/`TEST_ONLY`. **Bounded wave 1: fixed every `SECRET_TOKEN` (7), `CONFIRMED_PII` (12), and `PHI_MEDICAL` (24) finding — 43 call sites across 18 files** — an Instagram/Facebook access-token prefix logged on every outbound Meta API call, two Google AI Studio API-key-in-URL leaks reachable via generic catch blocks, a `dropdb`-failure message leaking `PGHOST`/`PGPORT`/`PGUSER`, 9 admin/user emails removed or masked across 2 CLI scripts and 2 routes, 12 structured WhatsApp/Instagram assistant logs that redacted phone but still logged the co-located treatment/practitioner name in the clear, 5 clinical-write error catches routed through the existing `safeErrorFields()` helper instead of raw `err.message`, and 1 unmasked inbound rate-limiter sender identifier. **Explicitly not touched (deferred as wave 2):** ~116 `POTENTIAL_PII` sites and 2 `MESSAGE_CONTENT` sites (same underlying `console.error(label, err)`/raw-error pattern, but the leak is possible rather than routine — retrofitting would mean ~50+ additional files, a repo-wide rewrite this task is scoped not to do), plus ~378 `SAFE_METADATA` and 2 `DEBUG_ONLY` sites (benign, left alone per instruction). 6 new test files + 5 extended existing ones (negative test per changed seam, proving the sensitive fixture is absent and safe metadata remains, mix of runtime console-spy and static source-scan per the pre-existing `whatsappBookingFlowLogRedaction.test.ts` precedent) — all passing. `cd server && npm run typecheck` exit `0`; 13 regression suites across every touched domain re-run, 0 failures. No schema/migration, tenant-scope, or authorization change. `test:runtime:postgres` judged not required (no Prisma query/data-access path changed, only logging arguments) and not run — decision recorded rather than silently skipped. `AGENT_COMPLETED`/`TESTS_PASSED` — PR to be opened — `NOT_MERGED`/`NOT_DEPLOYED`/`NOT_PRODUCTION_VERIFIED`. **Exact next task:** a wave 2 scoped to the deferred `POTENTIAL_PII`/`MESSAGE_CONTENT` sites using the same fix pattern this wave established, plus a later lint-rule evaluation to prevent regression.

**F3-IMPL-004-R1 (2026-08-11):** reconciliation-only task — reconciles existing PR #356 (`feature/f3-impl-004-pii-log-hygiene-wave1`) against current `origin/main` now that F3-IMPL-002 (PR #357) and F3-IMPL-003 (PR #358, +R1) have both merged. Normal `git merge` (no rebase, no force-push). Overlap limited to program-control docs (this file, `CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `evidence/README.md`) plus `server/package.json` test-script entries — all resolved additively, neither side's content dropped. Zero overlap between F3-IMPL-004's 18 changed production/test files and the F3-IMPL-002/F3-IMPL-003 changed-file set — no runtime conflict. Full detail: [evidence/F3-IMPL-004-R1_CURRENT_MAIN_RECONCILIATION.md](../evidence/F3-IMPL-004-R1_CURRENT_MAIN_RECONCILIATION.md).

**F3-IMPL-002 (2026-08-10):** second F3 implementation task; closes the worker/job-ownership gap F3-IMPL-001 deliberately left open (see that task's own docstring in `backgroundJobsOwnership.ts`: it declined to flip the API's job-ownership default until a dedicated worker process was actually part of the deployment topology). Baseline `origin/main` @ `1909b186a01611c8be90313b7166085a887d05f4` (PR #355/F3-IMPL-001 merge commit), independently confirmed via `git fetch`/`git rev-parse`, no drift. Pre-work inventory found the gap narrower than the task brief assumed: `server/src/worker.ts` (a dedicated worker entrypoint) already existed and already worked correctly (`JobLock`-protected, always owns jobs); the actual gap was entirely in deployment/process-management — no `ecosystem.config.*` in-repo (R-040), `scripts/noramedi-deploy.sh` only ever reloaded `noramedi-api` (R-033), and the API's job-ownership default (owns jobs unless `RUN_BACKGROUND_JOBS=false`) was never safely flippable without a repository-defined worker lifecycle (R-034). **Three coupled changes, in the same PR as required:** (1) `ecosystem.config.cjs` — repository-defined PM2 process contract for both `noramedi-api` and `noramedi-worker` (script/cwd/env), the api app explicitly setting `RUN_BACKGROUND_JOBS=false` now that the worker's lifecycle is itself repository-managed; (2) `scripts/noramedi-deploy.sh` — reloads/starts **both** processes via `pm2 startOrReload ecosystem.config.cjs --only <name> --update-env`, then verifies the worker reached PM2 `online` status (Node-parsed `pm2 jlist`, no HTTP endpoint added) before declaring success, aborting the deploy (`exit 1`) if it does not; (3) `NORAMEDI_PROCESS_ROLE` (`server/src/utils/processRole.ts`) — an optional, validated env var asserted at startup by both entrypoints, failing closed on an unrecognized/mismatched declared role while remaining fully backward compatible when unset. `resolveWorkerBackgroundJobsOwnership()` added alongside the existing `resolveApiBackgroundJobsOwnership()` so the intended production ownership matrix (worker owns, API does not, no duplicate, no zero-owner) is asserted by a test rather than read by eye. No schema/migration change; no HTTP surface added to the worker. `AGENT_COMPLETED`/`TESTS_PASSED`/`PR_OPENED` — `NOT_MERGED`/`NOT_DEPLOYED`/`NOT_PRODUCTION_VERIFIED` (this task performed no production deployment or verification — RISK_REGISTER.md R-033/R-034/R-040 remain `OPEN`, now with a repository-level mitigation recorded). Full detail: [evidence/F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md](../evidence/F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md).

**F3-IMPL-003 (2026-08-10):** Platform-Admin Privileged Mutation Audit Coverage (R-019) — the direct follow-up F3-IMPL-001 itself named as the next R-019 slice; runs in parallel with F3-IMPL-002 (disjoint files: only `routes/platformAdmin.ts` + its test file touched here). Full inventory of all 70 authenticated platform-admin routes (`platformAdmin.ts` 46, `platformSecurityIncidents.ts` 13, `platformExternalCalendar.ts` 11): 28 `READ_ONLY`, 5 `OUT_OF_SCOPE`, 19 already `AUDITED_DURABLY` (5 via `PlatformAdminAuditEvent`, 9 security-incident routes via a separate `SecurityIncidentActivity` trail, 5 external-calendar routes via `writeAuditLog()` — both left untouched, already covered), 18 `UNAUDITED` at task start. Closed the 6 highest-risk (priority classes 1–3 of 5): `POST /auth/mfa/{setup,verify,disable}` (security/auth config), `PUT`/`DELETE /sms-providers` (provider/credential config), `PATCH /privacy/data-retention/settings` (privacy/runtime control — the most glaring gap, its sibling `legacy-consent-correction` toggle already had this exact audit pattern). All six write `PlatformAdminAuditEvent` transactionally with the mutation, id-attributed, zero PII/secrets. 12 endpoints (priority classes 4–5: org/clinic/plan/user lifecycle, file-backup triggers) intentionally deferred — see evidence file §4. No schema change. `platformAdmin.test.ts`: 82/82 (22 new). Full `postgres`/`postgres-compat` orchestrator runs: both exit `0`. R-019 reduced, not closed — 25/37 mutation endpoints now audited, 12 remain. See [evidence/F3-IMPL-003_PLATFORM_ADMIN_AUDIT_COVERAGE.md](../evidence/F3-IMPL-003_PLATFORM_ADMIN_AUDIT_COVERAGE.md).

**F3-IMPL-001 (2026-08-10):** first F3 implementation task assigned and worked. Bounded pre-work inventory (items A–O) executed against `origin/main` @ `9cb256856b628a5ed5cc6ff85f84ec01a4a12cf0` (PR #354/F2-DOC-005 merge commit); full matrix in [evidence/F3-IMPL-001_FIRST_CUSTOMER_PRODUCTION_HARDENING.md](../evidence/F3-IMPL-001_FIRST_CUSTOMER_PRODUCTION_HARDENING.md). Five bounded, coupled runtime gaps closed: (1) `DATABASE_URL` production fail-hard (`utils/databaseUrl.ts`, closes a silent-local-Postgres-fallback risk), (2) explicit, unit-tested API/worker background-job ownership decision + startup diagnostic (`utils/backgroundJobsOwnership.ts`) — **deliberately does not flip the default**, see evidence doc for why, (3) `X-Request-Id` response header for client/log correlation (`middleware/requestId.ts`), (4) removed admin email from 7 `console.log` sites in `routes/platformAdmin.ts` (R-018), (5) durable `PlatformAdminAuditEvent` audit trail added for `POST /backups/run` and `POST /backups/restore-test`, previously fully unaudited (R-019). R-018/R-019 are **reduced, not closed** — most platform-admin mutation endpoints remain unaudited and app-level `console.log` PII discipline is not repo-wide; both are explicitly out of this task's bounded scope. `AGENT_COMPLETED`/`TESTS_PASSED`/`PR_OPENED` ([PR #355](https://github.com/MustafaBasol/DisKlinikCRM/pull/355)), `NOT_MERGED`/`NOT_DEPLOYED`/`NOT_PRODUCTION_VERIFIED`.

## Objective (Hedef)

Production ortamını kurumsal seviyeye sertleştirmek: gözlemlenebilirlik standardı (ADR-012), güvenlik sertleştirme, olay müdahale, log hijyeni (PII/PHI) ve platform-admin denetimi.

## Business reason (İş gerekçesi)

Pilot ve ticari lansman öncesi; kesinti, sızıntı ve yetki aşımı risklerinin operasyonel kontrollerle kapatılması gerekir. Gözlemlenemeyen sistem ölçeklenemez.

## Entry conditions (Giriş koşulları)

- F2 çıkışı
- F0-006 production topoloji kanıtı

## Exit gate (Çıkış kapısı)

- Gözlemlenebilirlik standardı canlıda kanıtla çalışıyor (log/metrik/trace/alarm)
- Güvenlik sertleştirme kontrol listesi kapatılmış
- Olay müdahale prosedürü tatbikatla doğrulanmış

## Dependencies (Bağımlılıklar)

- F2; ADR-012

## Allowed work (İzinli işler)

- İzleme/alarm kurulumu, log hijyeni, güvenlik başlıkları/limitleri, admin denetim izi

## Prohibited work (Yasak işler)

- Şema/mimari büyük değişiklikler (F5+ konusu)
- KVKK dondurma sınırı işleri (teyit gelmeden)

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, F2 kanıtları incelendikten sonra atanacaktır.

- Gözlemlenebilirlik standardının uygulanması (ADR-012)
- PII/PHI log politikası ve log denetimi
- Platform-admin yetki denetimi ve break-glass prosedürü
- Rate limiting ve kötüye kullanım korumaları gözden geçirmesi
- Olay müdahale (incident response) runbook'ları ve tatbikat
- Güvenlik sertleştirme kontrol listesi (headers, TLS, secrets)

## Required evidence (Gerekli kanıt)

- Canlı izleme panosu/alarm kanıtı; tatbikat kayıtları; sertleştirme kontrol listesi çıktısı

## Required tests (Gerekli testler)

- Güvenlik regresyon testleri; smoke testleri; alarm tetikleme testleri

## Security requirements (Güvenlik gereksinimleri)

- R-018 (log sızıntısı) ve R-019 (admin aşımı) kontrollerinin kanıtla kapatılması

## Tenant requirements (Tenant gereksinimleri)

- İzleme/loglar tenant bazında ayrıştırılabilir ama izolasyonu bozmaz

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Log ve telemetri verilerinde veri minimizasyonu

## Rollback expectations (Geri alma beklentileri)

- İzleme/limit değişiklikleri konfigürasyonla geri alınabilir olmalı

## Risks (Riskler)

- R-003, R-018, R-019, R-022

## Open questions (Açık sorular)

- Gözlemlenebilirlik araç seti seçimi (ADR-012)

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
| 2026-08-10 | F3-IMPL-001 | Faz durumu `TODO` → `IN_PROGRESS`. First implementation task: bounded pre-work inventory (A–O) + 5 P0 runtime hardening fixes (DATABASE_URL fail-hard, background-job ownership diagnostics, X-Request-Id correlation, platform-admin email log removal, backup-endpoint audit trail). Exit gate NOT satisfied — no live observability dashboard, no security-hardening checklist sign-off, no incident-response drill evidence. R-018/R-019 reduced, not closed. See [evidence/F3-IMPL-001_FIRST_CUSTOMER_PRODUCTION_HARDENING.md](../evidence/F3-IMPL-001_FIRST_CUSTOMER_PRODUCTION_HARDENING.md). |
| 2026-08-10 | F3-IMPL-001-R1 | PR #355 exact-head CI (run `31394080617`) surfaced one deterministic Layer 5 failure: `platformAdmin.test.ts`'s toggle-log test still asserted the pre-R0 email-in-log contract that R0 itself had just removed for R-018. Test-only fix — no production code changed; the accepted R0 security decision (id logged, email never logged) is unchanged and now additionally covered by a new negative assertion. `platformAdmin.test.ts`: 60/60 (was 59/60). Full `postgres-compat` orchestrator: exit `0`. See evidence doc §25. |
| 2026-08-10 | F3-IMPL-002 | Production worker process contract, deploy lifecycle & job-ownership hardening. `ecosystem.config.cjs` (repository-defined PM2 contract for `noramedi-api`/`noramedi-worker`), `scripts/noramedi-deploy.sh` extended to reload/verify both processes (fails closed if worker doesn't reach `online`), `NORAMEDI_PROCESS_ROLE` startup guard (`server/src/utils/processRole.ts`, fails closed on mismatch, backward-compatible when unset), `resolveWorkerBackgroundJobsOwnership()` added for symmetry/testability. Closes R-033/R-040 at the repository level, reduces R-034; none closed/mitigated pending production deployment. See [evidence/F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md](../evidence/F3-IMPL-002_PRODUCTION_WORKER_PROCESS_CONTRACT.md). |
| 2026-08-10 | F3-IMPL-003 | Platform-Admin Privileged Mutation Audit Coverage (R-019): full 70-route inventory, 6 highest-risk endpoints (MFA setup/verify/disable, SMS provider PUT/DELETE, data-retention runtime-toggle PATCH) migrated onto `PlatformAdminAuditEvent`; 12 endpoints (org/clinic/plan/user lifecycle, file-backup triggers) intentionally deferred. No schema change. `platformAdmin.test.ts`: 82/82 (22 new). Both `postgres`/`postgres-compat` orchestrators: exit `0`. R-019 reduced (25/37 mutation endpoints audited), not closed. See [evidence/F3-IMPL-003_PLATFORM_ADMIN_AUDIT_COVERAGE.md](../evidence/F3-IMPL-003_PLATFORM_ADMIN_AUDIT_COVERAGE.md). |
| 2026-08-11 | F3-IMPL-004-R1 | Reconciliation-only: existing PR #356 (F3-IMPL-004, `NOT_MERGED`) merged against current `origin/main` (now includes F3-IMPL-002/PR #357 and F3-IMPL-003/PR #358+R1). Normal `git merge`, no rebase/force-push. 5 conflicts, all in program-control docs + `server/package.json` test-script entries, all resolved additively; zero runtime-file conflicts (F3-IMPL-004's 18 changed files are disjoint from F3-IMPL-002/003's changed files). No schema/migration/tenant/authorization change. See [evidence/F3-IMPL-004-R1_CURRENT_MAIN_RECONCILIATION.md](../evidence/F3-IMPL-004-R1_CURRENT_MAIN_RECONCILIATION.md). |
| 2026-08-11 | F3-DIGIDENTIS-MAP-001 | Bug fix: NoraMedi practitioner dropdown empty on the DigiDentiS mapping screen. Root cause: `local-options` route filtered strictly on canonical-cased `role: 'DENTIST'` against `User.role`, missing legacy-cased (`doctor`/`dentist`) and branch-scoped (`UserClinic.role`) dentists — the same two conditions `routes/whatsapp.ts`'s `getClinicPractitioners()` already handles. Fix mirrors that existing pattern; no schema change, no scoping change, DigiDentiS side untouched. New E2E suite 14/14; 2 pre-existing suites re-run unchanged (32/32); typecheck clean. `AGENT_COMPLETED`/`TESTS_PASSED`/`PR_OPENED` ([PR #360](https://github.com/MustafaBasol/DisKlinikCRM/pull/360)) — `NOT_MERGED`/`NOT_DEPLOYED`/`NOT_PRODUCTION_VERIFIED`. See [evidence/F3-DIGIDENTIS-MAP-001_NORAMEDI_PRACTITIONER_DROPDOWN_ROOT_CAUSE.md](../evidence/F3-DIGIDENTIS-MAP-001_NORAMEDI_PRACTITIONER_DROPDOWN_ROOT_CAUSE.md). |
