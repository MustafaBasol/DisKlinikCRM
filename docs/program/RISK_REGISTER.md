# RISK_REGISTER — Program Risk Kaydı

Son güncelleme: 2026-07-17 (F0-001)

> Olasılık/Etki ölçeği: Low / Medium / High. "Mevcut kontrol" alanı depo kanıtıyla doğrulanmadıkça `UNVERIFIED` yazılır — kontrolün var olduğu **iddia edilmez**. Durum: `OPEN` (aktif risk) / `MITIGATED` / `ACCEPTED` / `CLOSED`.

| ID | Risk | Olasılık | Etki | Mevcut kontrol | Eksik kontrol | Azaltım (mitigation) | Sahip/Domain | Faz | Durum | Kanıt |
|---|---|---|---|---|---|---|---|---|---|---|
| R-001 | Cross-tenant veri sızıntısı | Medium | High | `UNVERIFIED` (uygulama-katmanı scope kontrolleri mevcut olabilir) | RLS, otomatik izolasyon regresyonu | Defense-in-depth: RLS + scope + izolasyon test matrisi (F5) | Tenant Security | F5 | OPEN | `UNVERIFIED` |
| R-002 | Mimari çalışma sırasında KVKK regresyonu | Medium | High | Mimari dondurma sınırı (tracker §8) | KVKK regresyon test paketi | KVKK baseline teyidine kadar fiziksel değişiklik yasağı; F0-007 sınır dokümanı | Compliance | F0 | OPEN | Tracker §8 |
| R-003 | Tek sunucu arızası | Medium | High | `UNVERIFIED` | Çok-instance, failover | F7 HA çalışması | Operations | F7 | OPEN | `UNVERIFIED` |
| R-004 | Tek veritabanı arızası | Medium | High | `UNVERIFIED` | Replica, failover, PITR | ADR-013; F4/F11 | Operations | F4/F11 | OPEN | `UNVERIFIED` |
| R-005 | Yerel disk tükenmesi | Medium | High | `UNVERIFIED` | Object storage, disk alarmları | F4 object storage; ADR-012 alarmlar | Storage | F4 | OPEN | `UNVERIFIED` |
| R-006 | Yedekleme hatası | Medium | High | `UNVERIFIED` | Yedek doğrulama, alarm | ADR-013; otomatik yedek doğrulama | Operations | F4 | OPEN | `UNVERIFIED` |
| R-007 | Restore hatası (yedek geri dönmüyor) | Medium | High | `UNVERIFIED` (restore testi kanıtı yok) | Düzenli restore provası | ADR-013; periyodik restore testi zorunluluğu | Operations | F4 | OPEN | `UNVERIFIED` |
| R-008 | DB bağlantı tükenmesi (connection exhaustion) | Medium | High | `UNVERIFIED` | PgBouncer, bağlantı bütçeleri | ADR-004; F0-009 PoC | Database | F5 | OPEN | `UNVERIFIED` |
| R-009 | Kuyruk birikmesi (queue backlog) | Medium | Medium | `UNVERIFIED` | Backlog metrikleri, ölçekleme | ADR-007; F6 gözlemlenebilirlik | Queue Infrastructure | F6 | OPEN | `UNVERIFIED` |
| R-010 | Kaybolan harici event'ler | Medium | High | `UNVERIFIED` | Transactional outbox | ADR-006; F6 | Domain Events | F6 | OPEN | `UNVERIFIED` |
| R-011 | Mükerrer webhook işleme | Medium | Medium | `UNVERIFIED` | Idempotency anahtarları | F6 idempotency standardı | Messaging | F6 | OPEN | `UNVERIFIED` |
| R-012 | Sağlayıcı kesintisi (WhatsApp/SMS/AI vb.) | High | Medium | `UNVERIFIED` (kısmi fallback mekanizmaları olabilir) | Devre kesici, fallback, kuyruklama | F6 retry/fallback; ADR-009 | Messaging / AI | F6/F8 | OPEN | `UNVERIFIED` |
| R-013 | AI veri yerleşimi (data residency) ihlali | Medium | High | `UNVERIFIED` | Sağlayıcı yerleşim envanteri, politika | ADR-009; F8 governance | AI Platform | F8 | OPEN | `UNVERIFIED` |
| R-014 | AI halüsinasyonu (yanlış içerik üretimi) | High | Medium | `UNVERIFIED` | Değerlendirme/regresyon, insan onayı | F8 evaluation + human review | AI Platform | F8 | OPEN | `UNVERIFIED` |
| R-015 | Hatalı klinik AI çıktısı (hasta güvenliği) | Medium | High | `UNVERIFIED` | Klinik doğrulama, yasal sınıflandırma | G4 kapısı; ayrı yasal/klinik validasyon | Medical Imaging AI | F10 | OPEN | `UNVERIFIED` |
| R-016 | DICOM verisinin ifşası | Medium | High | `UNVERIFIED` | Erişim kontrolü, ağ izolasyonu | ADR-011; F10 güvenlik tasarımı | DICOM/PACS | F10 | OPEN | `UNVERIFIED` |
| R-017 | Device bridge ele geçirilmesi | Medium | High | Bridge güvenlik sertleştirmesi yapıldı (PR #144/#150 çalışmaları) — kapsam ve güncel durumu `UNVERIFIED` | Sürekli güvenlik incelemesi, imzalı güncelleme zinciri kanıtı | F10 bridge güvenlik gözden geçirmesi | Device Bridge | F10 | OPEN | `UNVERIFIED` |
| R-018 | Hassas verinin loglara sızması | Medium | High | `UNVERIFIED` | PII/PHI log politikası, log denetimi | ADR-012 log standardı | Observability | F3 | OPEN | `UNVERIFIED` |
| R-019 | Platform-admin yetki aşımı | Medium | High | `UNVERIFIED` | Denetim izi, break-glass prosedürü, kapsam sınırı | F3 sertleştirme; audit genişletme | Platform Administration | F3 | OPEN | `UNVERIFIED` |
| R-020 | Resmî API sözleşme değişikliği | High | Medium | Adapter yönü (PROGRAM DIRECTION) | Sözleşme sürüm izleme, contract testleri | ADR-010; F9 adapter testleri | Official Integrations | F9 | OPEN | `UNVERIFIED` |
| R-021 | Düzenleyici yanlış sınıflandırma (ör. tıbbi cihaz/AI mevzuatı) | Medium | High | `UNVERIFIED` | Yasal görüş, sınıflandırma kaydı | G4/G5 kapılarında yasal doğrulama | Compliance | F8/F10 | OPEN | `UNVERIFIED` |
| R-022 | Gürültücü komşu (noisy-neighbor) tenant | Medium | Medium | `UNVERIFIED` | Rate limit, kuyruk adaleti, kaynak kotaları | F6 fairness; F7 ölçekleme | Tenant Security | F6/F7 | OPEN | `UNVERIFIED` |
| R-023 | Büyük kurumsal tenant aşırı yükü | Medium | High | `UNVERIFIED` | Dedicated tenant yolu, kapasite planı | ADR-003; F11 | Enterprise | F11 | OPEN | `UNVERIFIED` |
| R-024 | Onboarding sonrası migration hatası | Medium | High | `UNVERIFIED` | Migration testleri, rollback provası | F1 migration test katmanı; release kapıları | Database | F1+ | OPEN | `UNVERIFIED` |
| R-025 | Entitlement uygulanmaması (frontend-only kontrol) | Medium | High | `UNVERIFIED` | Backend/service/job katmanı entitlement zorunluluğu | ADR-014; DEPENDENCY_MAP kural 7-8 | Entitlements | F2 | OPEN | `UNVERIFIED` |
| R-026 | Aşırı modülerleşme (over-modularization) | Medium | Medium | Program yönü: modüler monolit, erken microservice yok | Sınır sayısı/karmaşıklık ölçütleri | ADR-001/015'te sınır kriterleri | Architecture | F2 | OPEN | Tracker §9 |
| R-027 | Uzun ömürlü branch sapması (divergence) | High | Medium | `UNVERIFIED` | Küçük PR politikası, sık rebase | F1 CI hızlandırma; program görev boyutlandırması | Program | F0+ | OPEN | `UNVERIFIED` |
| R-028 | Ajanın işi yanlışlıkla "tamamlandı" ilan etmesi | High | Medium | Durum modeli: ajan en fazla `AGENT_COMPLETED`; kanıt hiyerarşisi | Otomatik kanıt doğrulama araçları | Tracker §2 kuralları; AGENT_DELIVERY_TEMPLATE zorunlu rapor | Program | F0 | MITIGATED (süreçle) | Tracker §2 |

## Kullanım kuralları

- Yeni risk eklerken bir sonraki `R-###` ID'si alınır; mevcut ID'ler yeniden kullanılmaz.
- "Mevcut kontrol" yalnızca depo/deployment kanıtına bağlanabildiğinde `UNVERIFIED` etiketinden kurtulur; kanıt sütununa referans (dosya, commit, test çıktısı) yazılır.
- Riskler faz çıkış kapılarında gözden geçirilir; G0–G6 kapıları ([RELEASE_GATES.md](RELEASE_GATES.md)) ilgili risklerin durumunu kanıt olarak ister.
