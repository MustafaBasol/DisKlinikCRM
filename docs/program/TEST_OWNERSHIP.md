# TEST_OWNERSHIP — Test Mimarisi, Envanteri ve Sahiplik Haritası

Son güncelleme: 2026-07-19 (F0-005 rebaseline — bkz. aşağıdaki durum notu)

> **Durum:** §1–§2 **hedef** test mimarisini tanımlar (aşağıda F0-001'den değişmeden korunmuştur — etki-bazlı/affected test altyapısı bugün **mevcut değildir**, F1'in işidir). §3'ten itibaren, F0-005 tarafından **depo-kanıtıyla ve gerçek komut çalıştırmasıyla doğrulanmış** mevcut-durum (current-state) test envanteri, süre ölçümleri, sahiplik ve güvenilirlik verisi yer alır.
>
> **Rebaseline notu (2026-07-19):** Bu görevin orijinal baseline'ı commit `5ee0b6af30fff187b7190d649f1fc3e844362105` idi (97 kayıt). PR #171 (bu görevin kendi PR'ı) merge edilmeden önce `origin/main`, PR #169 ile bir commit ilerledi (`7fcf2f850f151241266f07349c4bf4442c72bbca` — "communication preference and consent management"), 3 yeni test dosyası ekleyerek. F0-005 branch'i normal, force olmayan bir `git merge origin/main` ile güncellendi (0 conflict); bu 3 dosya envantere eklendi ve ilgili tüm runtime komutları yeniden çalıştırıldı. Güncel baseline artık **commit `7fcf2f850f151241266f07349c4bf4442c72bbca`**, toplam **100** test/doğrulama hedefi. Detay: evidence doc §1a.
>
> Detaylı kanıt: [evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md](evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md).
> Yapısal/makine-okunur envanter: [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) (100 test/doğrulama hedefi, sahiplik, F0-004 yüksek-riskli edge kapsamı, kapsam boşlukları, F1 için önerilen affected-test yönlendirme tablosu).
> Runtime komut/sonuç kaydı: [evidence/F0-005_test_runtime_results.json](evidence/F0-005_test_runtime_results.json).
>
> **Kapsam dışı (bu görevde yapılmadı):** test dosyası değişikliği, snapshot güncelleme, assertion gevşetme, skip ekleme, timeout değişikliği, package script ekleme/değiştirme, CI workflow değişikliği, yeni test framework/coverage tool kurulumu, runtime kaynak refactor'u, Prisma şema/migration değişikliği veya deploy'u, production/VPS erişimi, affected-test seçim mekanizmasının implementasyonu. (2026-07-19 rebaseline'ı yalnızca `origin/main`'den normal bir merge içerir — merge ile gelen test/şema/migration/script değişiklikleri PR #169 tarafından bağımsız olarak zaten merge edilmişti, bu görev tarafından yazılmadı.)

## 1. Hedef test mimarisi katmanları

| Katman | Kapsam |
|---|---|
| Module unit tests | Tek modülün saf birim testleri; DB/harici bağımlılık yok |
| Module service tests | Modül servis katmanı; gerektiğinde disposable DB ile |
| Module API tests | Modülün HTTP endpoint'leri; handler-level, gerçek doğrulama |
| Public contract tests | Modüller arası public contract'ların sözleşme testleri |
| Cross-module integration tests | Birden çok modülü kapsayan uçtan uca akışlar |
| Core security and tenancy regression | Tenant izolasyonu, permission matrisi, auth regresyonu |
| Migration tests | Şema migration'larının ileri/geri güvenliği |
| Nightly full regression | Gecelik tam kapsam |
| Release regression | Sürüm öncesi tam kapsam + ek kapılar |
| Production smoke tests | Canlı ortamda doğrulama testleri |

## 2. Hedeflenen CI modeli

### Pull request

- Etkilenen modül testleri (affected module tests)
- Etkilenen contract testleri
- Zorunlu core smoke/güvenlik testleri

### Main merge

- Etkilenen testler
- Build/typecheck
- Temel smoke

### Nightly

- Tam backend test kapsamı
- Tam frontend test kapsamı
- Migration testleri
- Tenant izolasyon testleri
- Permission matrisi
- Queue worker testleri
- Cross-module akışlar

### Release

- Nightly kapsamı
- Production-benzeri DB
- Upgrade migration testi
- Rollback provası
- E2E
- Güvenlik testleri
- Performans kapıları
- Deployment smoke

> Etki-bazlı (affected) seçim mekanizması **henüz mevcut değildir**; F1'de tasarlanıp kurulacaktır. Bu doküman yalnızca hedefi tanımlar.

## 3. Mevcut test envanteri — özet (F0-005, depo-kanıtıyla)

Güncel baseline commit `7fcf2f850f151241266f07349c4bf4442c72bbca` (orijinal baseline `5ee0b6af30fff187b7190d649f1fc3e844362105` idi; 2026-07-19'da PR #169'u içeren bir `origin/main` merge'i ile rebaseline edildi — bkz. evidence doc §1a). Tam 100 satırlık per-test kayıt (sahip domain, secondary domain, test tipi, korunan kaynak dosyalar, DB/Redis/filesystem/network gereksinimi, env var, order/timing sensitivity, gözlemlenen runtime, tekrar-çalıştırma durumu) [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) `testFiles[]` içindedir. Bu bölüm yalnızca özet sayıları verir.

| Alan | Sayı | Kanıt |
|---|---|---|
| Backend `server/src/tests/*.test.ts` | 72 (rebaseline öncesi 70 idi; PR #169'dan +2) | F0-003'ün "72/72" sayımıyla + PR #169'un 2 yeni dosyasıyla tutarlı (72 `.test.ts` + 2 fixture yardımcı dosya = 74) |
| Frontend test dosyası | 6 (rebaseline öncesi 5 idi; PR #169'dan +1) | her biri tek bir `npm run test:*` script'ine bağlı, orphan yok |
| bridge-agent test dosyası | 9 | `bridge-agent/` içinde `npm run test` hepsini zincirler; PR #169'dan etkilenmedi |
| windows-bridge .NET test projesi | 4 | ~354 `[Fact]`/`[Theory]` (proje/script granülaritesinde envanterlendi — bkz. evidence doc §1); PR #169'dan etkilenmedi |
| windows-bridge installer PowerShell test script'i | 4 | CI'nin (`windows-bridge-pr.yml`) çağırdığı tam liste; PR #169'dan etkilenmedi |
| Manuel disposable-DB doğrulama script'i (`server/scripts/verify-*.ts`) | 3 | tasarım gereği `npm test`'e bağlı değil |
| **Toplam test/doğrulama hedefi** | **100** (rebaseline öncesi 97 idi) | |
| JS/TS test framework'ü / merkezi runner | **Yok** | Backend/frontend/bridge-agent'taki tüm `.test.ts` dosyaları `node:assert/strict` + elle yazılmış `test()/section()` yardımcı fonksiyonuyla, framework'süz, dosya-başına-`tsx` ile çalışır. Windows Bridge'in 4 .NET test projesi ise gerçek bir framework kullanır (**xUnit**, `dotnet test` ile) — bu makinede pinned SDK sürümü (10.0.301, kurulu: 9.0.305) nedeniyle çalıştırılamadı, framework eksikliğinden değil. Bkz. evidence doc §5. |
| CI tarafından çalıştırılan test dosyası sayısı | 4 backend + 3 frontend + 4 dotnet + 4 ps1 (yalnızca imaging path'inde) | tek workflow: `.github/workflows/windows-bridge-pr.yml` — bkz. §7; PR #169'un 3 yeni dosyası bu path kapsamında değil, sıfır CI kapsamıyla geldi |

### 3.1 Sahiplik dağılımı (domain başına test sayısı)

| Domain | Test sayısı |
|---|---|
| Imaging — Device Bridge / Windows Bridge | 22 |
| Privacy / Consent / Retention / Data Subject Rights | 16 (rebaseline öncesi 13 idi; PR #169'un 3 dosyası da bu domain'e primary sahip olarak eklendi) |
| Messaging — WhatsApp | 10 |
| Appointments and Availability | 8 |
| Tenant Security and Scope | 4 |
| Identity and Access | 4 |
| Basic Payments | 4 |
| Public Booking | 4 |
| Reporting / Analytics | 3 |
| Patients | 3 |
| Messaging — Instagram | 3 |
| Messaging AI Orchestration | 3 |
| Imaging — Server Ingest and Viewer | 2 |
| Observability / Operational Events | 2 |
| Platform Administration | 2 |
| Organization / Clinic / User Membership | 2 |
| Storage Abstraction | 1 |
| Dental Laboratory / Prosthetics Tracking | 1 |
| Cross-Domain Contract | 1 |
| Automations / Reminders / Follow-up / Recall | 1 |
| Security Incident Response and Detection | 1 |
| Messaging — SMS | 1 |
| Permissions / Roles | 1 |
| Repository/Build Tooling | 1 |

**Sahip test dosyası sıfır olan 12 domain:** Entitlements and Release Flags, Audit and Activity, Configuration and Secrets, Shared Events / Queue Contracts / Idempotency, Notifications, Treatment Cases *(yalnızca secondary domain olarak 3 testte geçiyor, hiçbirinde primary sahip değil)*, Dental Chart / Procedures, Tasks and Follow-up, Messaging — Email, Inventory, Insurance, Advanced Finance — Compensation and Payouts. Tam gerekçe: evidence doc §11, `coverageGaps.domainsWithNoOwnedTests`.

## 4. Runtime ölçüm sonuçları — özet

Tam komut/süre/exit-code kaydı [evidence/F0-005_test_runtime_results.json](evidence/F0-005_test_runtime_results.json) içindedir (her kayıtta bu rebaseline'da yeniden çalıştırılıp çalıştırılmadığını gösteren `rerunAt7fcf2f8` bayrağıyla).

| Komut | Sonuç |
|---|---|
| `server/` `npm ci` | rebaseline'da tekrar çalıştırılmadı — lockfile merge'den etkilenmedi; önceki sonuç (temiz, 25s) korunuyor |
| `npx prisma generate` (server/) | rebaseline'da tekrar çalıştırıldı (şema değişti) — temiz, 3s — **her testten önce zorunlu, otomatik değil** |
| `server/` `npm run typecheck` | rebaseline'da tekrar çalıştırıldı — temiz, 0 hata, 49s |
| repo-root `npm ci` | rebaseline'da tekrar çalıştırılmadı — lockfile merge'den etkilenmedi; önceki sonuç (temiz, 23s) korunuyor |
| repo-root `npm run build` | rebaseline'da tekrar çalıştırıldı — temiz, 0 hata, 71s |
| `bridge-agent/` `npm run test` | rebaseline'da tekrar çalıştırılmadı — `bridge-agent/` merge'den etkilenmedi; önceki sonuç (temiz, 105/105 geçti, 9s) korunuyor |
| `server/` `npm run test` (56 script'lik tam zincir, öncesi 54) | rebaseline'da tekrar çalıştırıldı — **2481/2482 geçti, 1 başarısız**, 115s; zincir aynı noktada (`test:clinic-bulk-export`, script 53) duruyor, script 54-56 (`test:security-incidents`, `test:communication-consent`, `test:communication-consent-backfill`) bu çalıştırmada çalışmıyor |
| `test:communication-consent` (tekil, yeni) | **BLOKLU** — 4/92 geçti, 88 başarısız (`ECONNREFUSED`) |
| `test:communication-consent-backfill` (tekil, yeni) | **BLOKLU** — 7 test'in hiçbiri çalışmadan crash (`ECONNREFUSED`) |
| 6 orphan `test:*` script'i (`npm run test` zincirinde değil) | rebaseline'da tekrar çalıştırıldı — **101/103 geçti, 2 başarısız**, orijinalle birebir aynı |
| 6 script'siz dosya (`npx tsx` ile doğrudan) | rebaseline'da tekrar çalıştırıldı — 177/177 geçti, orijinalle birebir aynı |
| 6 frontend test script'i (öncesi 5; +`test:communication-consent-matrix`) | rebaseline'da tekrar çalıştırıldı — 128/128 geçti (115 orijinal + 13 yeni) |
| `windows-bridge` `dotnet test` | rebaseline'da tekrar çalıştırılmadı — `windows-bridge/` merge'den etkilenmedi; **BLOKLU** sonucu (SDK sürüm uyuşmazlığı, 10.0.301 gerekli, 9.0.305 kurulu) korunuyor |
| windows-bridge installer PowerShell (4 script) | rebaseline'da tekrar çalıştırılmadı — `windows-bridge/` merge'den etkilenmedi; önceki sonuç (58/58 geçti) korunuyor |
| `securityIncident.test.ts` + 3 manuel verify script'i | rebaseline'da tekrar çalıştırıldı — **BLOKLU**, orijinalle birebir aynı — depoda commit edilmiş disposable-Postgres kurulumu yok |

### 4.1 Bulunan başarısızlıklar ve blokajlar (düzeltilmedi, yalnızca kaydedildi)

Kesin terminoloji — bu 5 kalem birbirinin yerine geçmez:

- **1 deterministic source-drift test başarısızlığı**: `overdueInstallments.test.ts` — test sonuna kadar çalıştı ve assertion'ları güncel üretim koduna göre yanlış; bu testin kendisinde gerçek, tekrarlanabilir bir kusur, ve üretim davranışının altında fark edilmeden değiştiğini ortaya çıkarıyor.
- **1 ortam-duyarlı (environment-sensitive) line-ending başarısızlığı**: `clinicBulkExport.test.ts` — test sonuna kadar çalıştı ve yalnızca Windows CRLF checkout'un testin `\n` içeren literal string aramasıyla çakışması nedeniyle başarısız oldu; korunan ürün davranışının doğru olduğu teyit edildi.
- **3 ortam blokajı** (yukarıdakiler gibi "başarısızlık" değil — testler hiç sonuna kadar çalışamıyor): `securityIncident.test.ts` (orijinal baseline), `communicationConsent.test.ts` (yeni — 2026-07-19 rebaseline), `communicationPreferenceBackfill.test.ts` (yeni — 2026-07-19 rebaseline). Üçü de bu ortamda mevcut olmayan bir `DATABASE_URL` gerektiriyor (depoda commit edilmiş disposable-Postgres kurulumu yok).

**Bu dokümantasyon görevi tarafından tespit edilmiş 0 doğrulanmış product-runtime kusuru vardır.** Tek deterministic başarısızlık test/üretim driftidir, canlı ortamda bağımsız olarak doğrulanmış bir runtime kusuru değildir; tek ortam-duyarlı başarısızlığın ürün kusuru OLMADIĞI teyit edilmiştir; 3 blokaj ise ürün davranışı hakkında hiçbir pass/fail sonucu vermez. Görev talimatları gereği, bu 5 kalemden hiçbirini ortadan kaldırmak için hiçbir şey düzeltilmedi, gevşetilmedi veya atlanmadı.

1. **`clinicBulkExport.test.ts`** — "status DTO never serializes sensitive fields" — **ortam-duyarlı (environment-sensitive) line-ending başarısızlığı** (Windows CRLF checkout + testin `\n` içeren literal string araması), gerçek ürün kusuru değil. 2× tekrarlandı, STABLE_FAIL.
2. **`overdueInstallments.test.ts`** — **deterministic source-drift** — 2 gerçek deterministic assertion başarısızlığı. Üretim kodu artık literal `'overdue'` status değeri yazıyor/okuyor; bu **orphan** test (hiçbir zaman `npm run test` zincirinde veya CI'da çalışmıyor) hâlâ eski davranışı varsayıyor. 2× tekrarlandı, STABLE_FAIL. **CI-uygulama boşluğunun somut kanıtı — bkz. §7.**
3. **`securityIncident.test.ts`** — ortam blokajı (erişilebilir DB yok), kod kusuru değil.
4. **`communicationConsent.test.ts`** (yeni, PR #169) — ortam blokajı (erişilebilir DB yok), kod kusuru değil. 92 assertion'dan yalnızca 4'ü (DB gerektirmeyenler) geçti.
5. **`communicationPreferenceBackfill.test.ts`** (yeni, PR #169) — ortam blokajı (erişilebilir DB yok), kod kusuru değil. 7 test'in hiçbiri çalışmadan crash.

Tam kök-neden analizi: evidence doc §9.

## 5. F0-004 yüksek-riskli 9 edge'in test kapsamı

| Sınıflandırma | Sayı |
|---|---|
| NOT_COVERED | 8 |
| PARTIALLY_COVERED | 1 |
| COVERED_DIRECTLY / COVERED_INDIRECTLY | 0 |

**En kritik bulgu:** `routes/whatsappInbox.ts:757`'deki eksik `pg_advisory_xact_lock` koruması (F0004-E0684, F0-004'ün "en şiddetli" bulgusu) — bu double-booking race condition'ın testi **yok**. `whatsappInbox.test.ts` var (25 test case) ama kendi docstring'ine göre yalnızca `utils/roles.ts` izin kontrollerini kapsıyor, gerçek route handler'ı hiç import etmiyor. Tam tablo (9 edge, dosya:satır, kanıt, eksik davranış): [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) `highRiskEdgeCoverage[]` ve evidence doc §7.

## 6. Command-map bulguları

- `npm run test` (server) 56/62 `test:*` script'ini zincirler (öncesi 54/60 idi; PR #169 2 script ekledi, ikisi de zincirin sonuna eklendi); **6 script hiç çağrılmıyor** (`test:consent-resume`, `test:meta-template`, `test:outbound`, `test:no-show-follow-up-parity`, `test:overdue-installments`, `test:overdue-receivables`) — bu liste rebaseline'dan etkilenmedi.
- **6 backend `.test.ts` dosyasının hiç `package.json` script'i yok**: `aiPrivacyBoundary.test.ts`, `channelConsentGate.test.ts`, `clinicLegalProfile.test.ts`, `patientSharedPhone.test.ts`, `platformBackup.test.ts`, `treatmentPackagePermissions.test.ts`.
- `npm run test` (server) `npx prisma generate` çalıştırılmadan **başarısız olur** (`@prisma/client` `PrismaClient` export etmiyor hatası) — bu ön koşul script'e gömülü değil.
- Root `npm run build` adı yanıltıcı: yalnızca typecheck değil, gerçek bir production bundle build'i (`tsc -b && vite build`).
- `bridge-agent/package.json:test` çalışıyor ama hiçbir CI workflow'u tarafından çağrılmıyor.

Tam detay: evidence doc §6.

## 7. CI-uygulama boşluğu — merkezi bulgu

Depoda test çalıştıran **tam olarak bir** GitHub Actions workflow'u var: [`.github/workflows/windows-bridge-pr.yml`](../../.github/workflows/windows-bridge-pr.yml), yalnızca `windows-bridge/**`/imaging path'lerine dokunan PR'larda tetikleniyor. **68/72 backend test dosyası (öncesi 66/70), 3/6 frontend test dosyası (öncesi 2/5) ve 9/9 bridge-agent test dosyası hiçbir CI kapsamında değil.** `npm run test` (tam 56-script backend zinciri, öncesi 54) hiçbir workflow tarafından hiçbir zaman çağrılmıyor. PR #169'un eklediği 3 yeni dosya (`communicationConsent.test.ts`, `communicationPreferenceBackfill.test.ts`, `communicationConsentMatrixHelpers.test.ts`) da bu path kapsamı dışında kaldığı için sıfır CI kapsamıyla geldi — aynı boşluğun yeni bir örneği. §4.1 madde 2 (`overdueInstallments.test.ts`) bu boşluğun teorik değil, **şu anda gerçek ve sessiz bir regresyon taşıdığının** doğrudan kanıtıdır. Tam detay: evidence doc §11.

## 8. Kapsam boşlukları (özet)

Domain boşlukları (§3.1), concurrency boşlukları (F0004-E0684 — hiç test yok), tenant-security boşlukları (`multiBranchAccess.test.ts`'in 1043 satırlık kendi mantık mirror'ı gerçek `clinicScope.ts`/`clinicAccess.ts`'i hiç import etmiyor — §9.2'deki drift riskiyle aynı yapı), provider-failure boşlukları (yalnızca unit-seviye fetch-stub testleri var), migration boşlukları (otomatik migration up/down testi yok), frontend boşlukları (sıfır `FRONTEND_COMPONENT` testi, DOM/RTL harness'i yok), bridge boşlukları (.NET testleri bu görevde ölçülemedi — SDK uyuşmazlığı), load/chaos boşlukları (hiç yok). Tam liste: [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) `coverageGaps` ve evidence doc §12–§14.

## 9. F1 için önerilen affected-test yönlendirme tablosu (öneri — henüz uygulanmadı)

Her F0-003 domain'i için sahip test dosyaları, mevcut odaklı komut, F0-004 bağımlı contract/security suite'leri, eskalasyon kuralı ve kritiklik: [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) `affectedTestRecommendations[]` (36 kayıt — 24 sahipli domain + 12 sıfır-testli domain). Bunlar **F1'in tasarım girdisidir, uygulanmış bir mekanizma değildir.**

## 10. Sahiplik kuralları (hedef — F0-001'den korunmuştur)

- Her test dosyasının tek bir kanonik sahip domain'i olmalıdır (bkz. §3'ün uyguladığı kural: "behavior principally protected, not folder location" — 12 belirsiz vaka için gerekçe evidence doc §3'tedir).
- Contract testleri, contract'ın **sahibi olan** modülde yaşar; tüketen modül tüketici testini kendi tarafında tutar.
- Core güvenlik/tenancy regresyonu Core Platform sahipliğindedir ve hiçbir PR bunları atlayamaz.
