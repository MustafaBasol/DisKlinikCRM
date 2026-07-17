# F9 — Official Integration Platform

Faz durumu: `TODO` · Son güncelleme: 2026-07-17 (F0-001)

## Objective (Hedef)

T.C. Sağlık Bakanlığı ve diğer resmî entegrasyonlar (e-Fatura/e-Arşiv, sigorta, muhasebe vb.) için adapter-tabanlı entegrasyon platformunu kurmak (ADR-010): adapter sözleşmesi, sertifika/kimlik yönetimi, hata/retry, denetim izi.

## Business reason (İş gerekçesi)

Resmî entegrasyonlar Türkiye pazarında ticari zorunluluktur; ancak sözleşme değişiklikleri (R-020) ve kimlik bilgisi güvenliği yüksek risklidir. Adapter platformu, her yeni kurumu öngörülebilir maliyetle ekletir.

## Entry conditions (Giriş koşulları)

- F6 çıkışı (güvenilir kuyruk/outbox — resmî çağrılar idempotent ve dayanıklı olmalı)
- ADR-010 kabulü

## Exit gate (Çıkış kapısı)

- Adapter platformu kurulu; ilk resmî entegrasyon sandbox + canlıda kanıtla çalışıyor
- G5 kanıt setinin teknik kısmı hazır

## Dependencies (Bağımlılıklar)

- F6; ADR-010; ilgili kurumların resmî gereksinim dokümanları

## Allowed work (İzinli işler)

- Adapter sözleşmesi, sandbox entegrasyonları, sertifika yönetimi, denetim izi

## Prohibited work (Yasak işler)

- Sandbox kanıtı olmadan canlı resmî uç noktaya bağlanma
- Resmî kimlik bilgilerini düz metin saklama

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, F6 kanıtları incelendikten sonra atanacaktır.

- Hedef resmî API'lerin sözleşme envanteri (Bakanlık, GİB, sigorta)
- Adapter contract standardı ve platform çekirdeği
- Sertifika/kimlik yönetimi (güvenli saklama, rotasyon)
- Hata/retry/idempotency (outbox üzerinden) entegrasyonu
- Resmî işlem denetim izi ve raporlama
- İlk pilot entegrasyonun sandbox + canlı kanıtı

## Required evidence (Gerekli kanıt)

- Sandbox uçtan uca kayıtları; sözleşme test kanıtları; sertifika yönetim kanıtı

## Required tests (Gerekli testler)

- Adapter contract testleri; hata/retry senaryoları; mükerrer gönderim koruması

## Security requirements (Güvenlik gereksinimleri)

- Resmî kanal kimlik bilgileri şifreli ve erişim-denetimli; işlem imzalama gereksinimleri

## Tenant requirements (Tenant gereksinimleri)

- Her tenant'ın resmî kimlikleri izole; bir tenant'ın hatası diğerini etkilemez

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Resmî kurumlara veri aktarımının yasal dayanak ve minimizasyon ilkeleriyle uyumu

## Rollback expectations (Geri alma beklentileri)

- Entegrasyon bazında devre dışı bırakma; gönderilemeyen işlemlerin güvenli kuyruklanması

## Risks (Riskler)

- R-020, R-021, R-011, R-012

## Open questions (Açık sorular)

- İlk pilot resmî entegrasyonun seçimi; kurumların test ortamı erişim süreçleri

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
