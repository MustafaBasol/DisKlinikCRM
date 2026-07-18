# TEST_OWNERSHIP — Test Mimarisi, Envanteri ve Sahiplik Haritası

Son güncelleme: 2026-07-18 (F0-005)

> **Durum:** §1–§2 **hedef** test mimarisini tanımlar (aşağıda F0-001'den değişmeden korunmuştur — etki-bazlı/affected test altyapısı bugün **mevcut değildir**, F1'in işidir). §3'ten itibaren, F0-005 tarafından **depo-kanıtıyla ve gerçek komut çalıştırmasıyla doğrulanmış** mevcut-durum (current-state) test envanteri, süre ölçümleri, sahiplik ve güvenilirlik verisi yer alır.
>
> Detaylı kanıt: [evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md](evidence/F0-005_TEST_INVENTORY_AND_RUNTIME_EVIDENCE.md).
> Yapısal/makine-okunur envanter: [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) (97 test/doğrulama hedefi, sahiplik, F0-004 yüksek-riskli edge kapsamı, kapsam boşlukları, F1 için önerilen affected-test yönlendirme tablosu).
> Runtime komut/sonuç kaydı: [evidence/F0-005_test_runtime_results.json](evidence/F0-005_test_runtime_results.json).
>
> **Kapsam dışı (bu görevde yapılmadı):** test dosyası değişikliği, snapshot güncelleme, assertion gevşetme, skip ekleme, timeout değişikliği, package script ekleme/değiştirme, CI workflow değişikliği, yeni test framework/coverage tool kurulumu, runtime kaynak refactor'u, Prisma şema/migration değişikliği veya deploy'u, production/VPS erişimi, affected-test seçim mekanizmasının implementasyonu.

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

Baseline commit `5ee0b6af30fff187b7190d649f1fc3e844362105`. Tam 97 satırlık per-test kayıt (sahip domain, secondary domain, test tipi, korunan kaynak dosyalar, DB/Redis/filesystem/network gereksinimi, env var, order/timing sensitivity, gözlemlenen runtime, tekrar-çalıştırma durumu) [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) `testFiles[]` içindedir. Bu bölüm yalnızca özet sayıları verir.

| Alan | Sayı | Kanıt |
|---|---|---|
| Backend `server/src/tests/*.test.ts` | 70 | F0-003'ün "72/72" sayımıyla tutarlı (70 `.test.ts` + 2 fixture yardımcı dosya) |
| Frontend test dosyası | 5 | her biri tek bir `npm run test:*` script'ine bağlı, orphan yok |
| bridge-agent test dosyası | 9 | `bridge-agent/` içinde `npm run test` hepsini zincirler |
| windows-bridge .NET test projesi | 4 | ~354 `[Fact]`/`[Theory]` (proje/script granülaritesinde envanterlendi — bkz. evidence doc §1) |
| windows-bridge installer PowerShell test script'i | 4 | CI'nin (`windows-bridge-pr.yml`) çağırdığı tam liste |
| Manuel disposable-DB doğrulama script'i (`server/scripts/verify-*.ts`) | 3 | tasarım gereği `npm test`'e bağlı değil |
| **Toplam test/doğrulama hedefi** | **97** | |
| Test framework'ü | **Yok** | Tüm `.test.ts` dosyaları `node:assert/strict` + elle yazılmış `test()/section()` yardımcı fonksiyonuyla, framework'süz çalışır — bkz. evidence doc §5 |
| CI tarafından çalıştırılan test dosyası sayısı | 4 backend + 3 frontend + 4 dotnet + 4 ps1 (yalnızca imaging path'inde) | tek workflow: `.github/workflows/windows-bridge-pr.yml` — bkz. §7 |

### 3.1 Sahiplik dağılımı (domain başına test sayısı)

| Domain | Test sayısı |
|---|---|
| Imaging — Device Bridge / Windows Bridge | 22 |
| Privacy / Consent / Retention / Data Subject Rights | 13 |
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

Tam komut/süre/exit-code kaydı [evidence/F0-005_test_runtime_results.json](evidence/F0-005_test_runtime_results.json) içindedir.

| Komut | Sonuç |
|---|---|
| `server/` `npm ci` | temiz, 25s |
| `npx prisma generate` (server/) | temiz, 11s — **her testten önce zorunlu, otomatik değil** |
| `server/` `npm run typecheck` | temiz, 0 hata, 45s |
| repo-root `npm ci` | temiz, 23s |
| repo-root `npm run build` | temiz, 0 hata, 54s |
| `bridge-agent/` `npm run test` | temiz, 105/105 geçti, 9s |
| `server/` `npm run test` (54 script'lik tam zincir) | **2481/2482 geçti, 1 başarısız**, 107s |
| 6 orphan `test:*` script'i (`npm run test` zincirinde değil) | **101/103 geçti, 2 başarısız** |
| 6 script'siz dosya (`npx tsx` ile doğrudan) | 177/177 geçti |
| 5 frontend test script'i | 115/115 geçti |
| `windows-bridge` `dotnet test` | **BLOKLU** — SDK sürüm uyuşmazlığı (10.0.301 gerekli, 9.0.305 kurulu) |
| windows-bridge installer PowerShell (4 script) | 58/58 geçti (Windows PowerShell 5.1) |
| `securityIncident.test.ts` + 3 manuel verify script'i | **BLOKLU** — depoda commit edilmiş disposable-Postgres kurulumu yok |

### 4.1 Bulunan başarısızlıklar (düzeltilmedi, yalnızca kaydedildi)

1. **`clinicBulkExport.test.ts`** — "status DTO never serializes sensitive fields" — **ortam/platform kaynaklı** (Windows CRLF checkout + testin `\n` içeren literal string araması), gerçek ürün kusuru değil. 2× tekrarlandı, STABLE_FAIL.
2. **`overdueInstallments.test.ts`** — 2 gerçek deterministic assertion başarısızlığı. Üretim kodu artık literal `'overdue'` status değeri yazıyor/okuyor; bu **orphan** test (hiçbir zaman `npm run test` zincirinde veya CI'da çalışmıyor) hâlâ eski davranışı varsayıyor. 2× tekrarlandı, STABLE_FAIL. **CI-uygulama boşluğunun somut kanıtı — bkz. §7.**
3. **`securityIncident.test.ts`** — ortam blokajı (erişilebilir DB yok), kod kusuru değil.

Tam kök-neden analizi: evidence doc §9.

## 5. F0-004 yüksek-riskli 9 edge'in test kapsamı

| Sınıflandırma | Sayı |
|---|---|
| NOT_COVERED | 8 |
| PARTIALLY_COVERED | 1 |
| COVERED_DIRECTLY / COVERED_INDIRECTLY | 0 |

**En kritik bulgu:** `routes/whatsappInbox.ts:757`'deki eksik `pg_advisory_xact_lock` koruması (F0004-E0684, F0-004'ün "en şiddetli" bulgusu) — bu double-booking race condition'ın testi **yok**. `whatsappInbox.test.ts` var (25 test case) ama kendi docstring'ine göre yalnızca `utils/roles.ts` izin kontrollerini kapsıyor, gerçek route handler'ı hiç import etmiyor. Tam tablo (9 edge, dosya:satır, kanıt, eksik davranış): [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) `highRiskEdgeCoverage[]` ve evidence doc §7.

## 6. Command-map bulguları

- `npm run test` (server) 54/60 `test:*` script'ini zincirler; **6 script hiç çağrılmıyor** (`test:consent-resume`, `test:meta-template`, `test:outbound`, `test:no-show-follow-up-parity`, `test:overdue-installments`, `test:overdue-receivables`).
- **6 backend `.test.ts` dosyasının hiç `package.json` script'i yok**: `aiPrivacyBoundary.test.ts`, `channelConsentGate.test.ts`, `clinicLegalProfile.test.ts`, `patientSharedPhone.test.ts`, `platformBackup.test.ts`, `treatmentPackagePermissions.test.ts`.
- `npm run test` (server) `npx prisma generate` çalıştırılmadan **başarısız olur** (`@prisma/client` `PrismaClient` export etmiyor hatası) — bu ön koşul script'e gömülü değil.
- Root `npm run build` adı yanıltıcı: yalnızca typecheck değil, gerçek bir production bundle build'i (`tsc -b && vite build`).
- `bridge-agent/package.json:test` çalışıyor ama hiçbir CI workflow'u tarafından çağrılmıyor.

Tam detay: evidence doc §6.

## 7. CI-uygulama boşluğu — merkezi bulgu

Depoda test çalıştıran **tam olarak bir** GitHub Actions workflow'u var: [`.github/workflows/windows-bridge-pr.yml`](../../.github/workflows/windows-bridge-pr.yml), yalnızca `windows-bridge/**`/imaging path'lerine dokunan PR'larda tetikleniyor. **66/70 backend test dosyası, 2/5 frontend test dosyası ve 9/9 bridge-agent test dosyası hiçbir CI kapsamında değil.** `npm run test` (tam 54-script backend zinciri) hiçbir workflow tarafından hiçbir zaman çağrılmıyor. §4.1 madde 2 (`overdueInstallments.test.ts`) bu boşluğun teorik değil, **şu anda gerçek ve sessiz bir regresyon taşıdığının** doğrudan kanıtıdır. Tam detay: evidence doc §11.

## 8. Kapsam boşlukları (özet)

Domain boşlukları (§3.1), concurrency boşlukları (F0004-E0684 — hiç test yok), tenant-security boşlukları (`multiBranchAccess.test.ts`'in 1043 satırlık kendi mantık mirror'ı gerçek `clinicScope.ts`/`clinicAccess.ts`'i hiç import etmiyor — §9.2'deki drift riskiyle aynı yapı), provider-failure boşlukları (yalnızca unit-seviye fetch-stub testleri var), migration boşlukları (otomatik migration up/down testi yok), frontend boşlukları (sıfır `FRONTEND_COMPONENT` testi, DOM/RTL harness'i yok), bridge boşlukları (.NET testleri bu görevde ölçülemedi — SDK uyuşmazlığı), load/chaos boşlukları (hiç yok). Tam liste: [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) `coverageGaps` ve evidence doc §12–§14.

## 9. F1 için önerilen affected-test yönlendirme tablosu (öneri — henüz uygulanmadı)

Her F0-003 domain'i için sahip test dosyaları, mevcut odaklı komut, F0-004 bağımlı contract/security suite'leri, eskalasyon kuralı ve kritiklik: [evidence/F0-005_test_inventory.json](evidence/F0-005_test_inventory.json) `affectedTestRecommendations[]` (36 kayıt — 24 sahipli domain + 12 sıfır-testli domain). Bunlar **F1'in tasarım girdisidir, uygulanmış bir mekanizma değildir.**

## 10. Sahiplik kuralları (hedef — F0-001'den korunmuştur)

- Her test dosyasının tek bir kanonik sahip domain'i olmalıdır (bkz. §3'ün uyguladığı kural: "behavior principally protected, not folder location" — 12 belirsiz vaka için gerekçe evidence doc §3'tedir).
- Contract testleri, contract'ın **sahibi olan** modülde yaşar; tüketen modül tüketici testini kendi tarafında tutar.
- Core güvenlik/tenancy regresyonu Core Platform sahipliğindedir ve hiçbir PR bunları atlayamaz.
