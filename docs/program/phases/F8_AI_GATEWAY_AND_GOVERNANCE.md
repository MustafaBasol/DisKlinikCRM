# F8 — AI Gateway and AI Governance

Faz durumu: `TODO` · Son güncelleme: 2026-07-17 (F0-001)

## Objective (Hedef)

Tüm AI kullanımını tek bir gateway'den geçirmek (ADR-009): provider registry, model routing, prompt sürümleme, kullanım/maliyet ölçümü, güvenlik politikası, PII/PHI minimizasyonu, değerlendirme/regresyon, insan onayı ve AI denetim izi (provenance).

## Business reason (İş gerekçesi)

Yaygın AI kullanımı; veri yerleşimi (R-013), halüsinasyon (R-014) ve klinik risk (R-015) ile birleştiğinde governance'sız sürdürülemez. Maliyet ve sağlayıcı kesintisi de merkezi yönetim ister.

## Entry conditions (Giriş koşulları)

- F2 çıkışı (modül sınırları — gateway bir Core/AI Platform modülüdür)
- ADR-009 kabulü
- F2 sonrası paralelleştirilebilirlik kararı F0-013'te verilecek

## Exit gate (Çıkış kapısı)

- Tüm AI çağrıları gateway üzerinden (bypass denetimi kanıtlı)
- Kullanım/maliyet ölçümü tenant bazında canlı
- PII/PHI minimizasyon politikası uygulanıyor; değerlendirme seti kurulu

## Dependencies (Bağımlılıklar)

- F2; ADR-009

## Allowed work (İzinli işler)

- Gateway implementasyonu, provider registry, metering, prompt sürümleme, eval altyapısı

## Prohibited work (Yasak işler)

- Gateway dışı doğrudan AI sağlayıcı çağrısı ekleme
- Klinik karar AI'ının yasal/klinik validasyonsuz canlıya alınması (G4 konusu)

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, önceki faz kanıtları incelendikten sonra atanacaktır.

- Mevcut AI kullanım envanteri ve gateway'e geçiş
- Provider registry ve model routing
- Prompt versioning standardı
- Tenant bazlı kullanım/maliyet metering
- Safety policy ve PII/PHI minimizasyon katmanı
- Evaluation/regression seti ve insan onay akışları
- AI audit ve provenance kayıtları

## Required evidence (Gerekli kanıt)

- Bypass denetim kanıtı; metering panosu; eval raporları; veri yerleşimi envanteri

## Required tests (Gerekli testler)

- Gateway birim/entegrasyon testleri; policy testleri; eval regresyonu

## Security requirements (Güvenlik gereksinimleri)

- Sağlayıcı anahtarlarının merkezi güvenli yönetimi; çıktıların injection açısından ele alınması

## Tenant requirements (Tenant gereksinimleri)

- AI kullanımı ve maliyeti tenant bazında izole ölçülür; tenant verisi sağlayıcıya minimize edilerek gider

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- PHI'nin sağlayıcıya gitmeden önce minimizasyonu/anonimleştirilmesi; sağlayıcı veri yerleşimi uyumu; aydınlatma metinlerinde AI kullanımı

## Rollback expectations (Geri alma beklentileri)

- AI özellikleri feature-flag'le kapatılabilir; gateway kesintisinde güvenli degrade

## Risks (Riskler)

- R-013, R-014, R-015, R-012

## Open questions (Açık sorular)

- Gateway'in ayrı süreç mi, modül mü olacağı (ADR-009); eval veri setlerinin kaynağı

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
