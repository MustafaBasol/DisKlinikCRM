# F3 — Production Hardening

Faz durumu: `TODO` · Son güncelleme: 2026-07-17 (F0-001)

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
