# TEST_OWNERSHIP — Hedef Test Mimarisi ve Sahiplik Haritası

Son güncelleme: 2026-07-17 (F0-001)

> **UYARI:** Bu doküman **hedef** test mimarisini tanımlar. Etki-bazlı (affected) test altyapısının bugün var olduğu **iddia edilmez**. Mevcut test envanteri, süre ölçümleri ve sahiplik **F0-005** tarafından kanıtla çıkarılacaktır.

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

## 3. Test envanteri (placeholder — F0-005 dolduracak)

F0-005; her test dosyası için aşağıdaki alanları **ölçüm ve depo kanıtıyla** dolduracaktır:

| Test dosyası | Sahip domain | Süre (runtime) | DB gereksinimi | Harici bağımlılık | CI katmanı | Tetikleyici path'ler | Mevcut güvenilirlik |
|---|---|---|---|---|---|---|---|
| `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` |

Alan tanımları:

- **Süre (runtime):** Ölçülmüş ortalama çalışma süresi.
- **DB gereksinimi:** none / disposable Postgres / paylaşılan test DB.
- **Harici bağımlılık:** ör. Meta API mock, S3 mock, SMTP, Docker.
- **CI katmanı:** PR / main / nightly / release.
- **Tetikleyici path'ler:** Bu testin koşmasını gerektiren kaynak dizinleri.
- **Mevcut güvenilirlik:** stable / flaky / broken (kanıtla).

## 4. Sahiplik kuralları (hedef)

- Her test dosyasının tek bir sahip domain'i olmalıdır.
- Contract testleri, contract'ın **sahibi olan** modülde yaşar; tüketen modül tüketici testini kendi tarafında tutar.
- Core güvenlik/tenancy regresyonu Core Platform sahipliğindedir ve hiçbir PR bunları atlayamaz.
