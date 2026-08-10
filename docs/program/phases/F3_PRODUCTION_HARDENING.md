# F3 — Production Hardening

Faz durumu: `IN_PROGRESS` · Son güncelleme: 2026-08-10 (F3-IMPL-001)

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
