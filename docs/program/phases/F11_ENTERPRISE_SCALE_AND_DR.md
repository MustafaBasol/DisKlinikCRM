# F11 — Enterprise Scale, Dedicated Tenants, DR, and Advanced Operations

Faz durumu: `TODO` · Son güncelleme: 2026-07-17 (F0-001)

## Objective (Hedef)

1.000+ klinik ölçeği için kurumsal olgunluk: dedicated tenant kabiliyeti (ADR-003), tam felaket kurtarma (ADR-013), OLAP/analitik ayrımı (ADR-017), SSO/OIDC, kurumsal uyum ve 7/24 operasyon modeli. G6 kapısının kanıt setini üretir.

## Business reason (İş gerekçesi)

Zincir klinikler ve kurumsal müşteriler; dedicated izolasyon, SLA, denetim ve DR garantileri ister. Bu yeteneklerin kanıtlanması, en yüksek gelir segmentinin ön koşuludur.

## Entry conditions (Giriş koşulları)

- F7 çıkışı (yatay ölçek/HA)
- F9 ve F10'un G5/G4 ilerlemesi (kurumsal paketin parçalarıysa)
- ADR-003/013/017 kabulü

## Exit gate (Çıkış kapısı)

- G6 kanıt seti tamam: 1.000+ tenant ölçek testi, DR tatbikatı, dedicated tenant kanıtı, kurumsal güvenlik denetimi

## Dependencies (Bağımlılıklar)

- F7; F9; F10; ADR-003/013/016/017

## Allowed work (İzinli işler)

- Dedicated tenant altyapısı, DR topolojisi, OLAP/warehouse export, SSO/OIDC, kurumsal raporlama

## Prohibited work (Yasak işler)

- Ölçek kanıtı olmadan kurumsal SLA taahhüdü
- Schema-per-tenant'ın varsayılan strateji haline getirilmesi (REJECTED)

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, önceki faz kanıtları incelendikten sonra atanacaktır.

- Dedicated tenant provision/taşıma kabiliyeti
- Tam DR topolojisi ve düzenli tatbikat programı
- OLAP/analitik ayrımı ve data warehouse export
- SSO/OIDC ve kurumsal kimlik entegrasyonları
- Gelişmiş uyum raporlaması ve denetim hazırlığı
- 7/24 operasyon, SLA ölçümü ve raporlaması
- 1.000+ tenant ölçek simülasyonu

## Required evidence (Gerekli kanıt)

- Ölçek testi raporları; DR tatbikat kayıtları; dedicated tenant canlı kanıtı; denetim raporları

## Required tests (Gerekli testler)

- Ölçek/yük testleri; DR restore testleri; SSO entegrasyon testleri

## Security requirements (Güvenlik gereksinimleri)

- Kurumsal güvenlik denetimi (bağımsız); dedicated ortamların izolasyon kanıtı

## Tenant requirements (Tenant gereksinimleri)

- Shared ve dedicated tenant'ların tek operasyon modelinde birlikte yönetimi

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- DR/replica/warehouse kopyalarında da KVKK yükümlülükleri; kurumsal DPA çerçevesi

## Rollback expectations (Geri alma beklentileri)

- Dedicated geçişleri ve DR failover'ları geri alınabilir/prova edilmiş olmalı

## Risks (Riskler)

- R-004, R-007, R-023, R-024

## Open questions (Açık sorular)

- Dedicated tenant tetikleme kriterleri ve fiyatlandırma modeli (ADR-003 ile birlikte)

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
