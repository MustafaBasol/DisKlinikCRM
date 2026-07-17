# F10 — Imaging, DICOM, CBCT, and Medical Imaging AI

Faz durumu: `TODO` · Son güncelleme: 2026-07-17 (F0-001)

## Objective (Hedef)

DICOM/CBCT/2D-3D görüntüleme altyapısını kurumsal ölçeğe taşımak: Orthanc/OHIF-tarzı yerleşik PACS bileşenleri (ADR-011), device bridge güvenliği, object storage üzerinde görüntü hattı ve üçüncü taraf tıbbi görüntüleme AI entegrasyonları (G4 kapısına tabi).

## Business reason (İş gerekçesi)

Görüntüleme, diş kliniklerinin günlük operasyonunun merkezindedir ve ticari farklılaştırıcıdır. PACS'ı sıfırdan yazmak (reddedilen yön) yerine yerleşik bileşenlerle güvenli entegrasyon; hız ve regülasyon uyumu sağlar.

## Entry conditions (Giriş koşulları)

- F4 çıkışı (object storage zorunlu ön koşul — PROGRAM DIRECTION #13)
- AI kısmı için F8 (gateway/governance)
- ADR-011 kabulü

## Exit gate (Çıkış kapısı)

- Görüntü hattı object storage üzerinde kanıtla çalışıyor
- PACS bileşen entegrasyonu ve viewer canlıda
- Bridge güvenlik kanıtları güncel; G4 teknik kanıt seti hazır

## Dependencies (Bağımlılıklar)

- F4; F8 (AI kısmı); ADR-008/009/011; mevcut imaging/bridge çalışmalarının baseline'ı (durumları `UNVERIFIED`; F0-002'de envanterlenecek)

## Allowed work (İzinli işler)

- PACS bileşen entegrasyonu, görüntü hattı, viewer, bridge güvenlik iyileştirmeleri, AI entegrasyon altyapısı

## Prohibited work (Yasak işler)

- PACS'ı sıfırdan yazma
- Klinik AI çıktılarının yasal/klinik validasyonsuz tanı akışına sokulması (G4)

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, önceki faz kanıtları incelendikten sonra atanacaktır.

- Mevcut imaging/bridge durum envanteri (baseline)
- PACS bileşen (Orthanc/OHIF-tarzı) değerlendirme ve entegrasyon
- Görüntülerin object storage hattına alınması
- DICOM erişim güvenliği ve tenant ayrımı
- Device bridge güvenlik gözden geçirmesi ve güncelleme zinciri
- Medical Imaging AI entegrasyon çerçevesi (gateway üzerinden)
- Görüntü hacmi kapasite ve maliyet planı

## Required evidence (Gerekli kanıt)

- Görüntü hattı uçtan uca kanıtı; erişim denetim testleri; bridge güvenlik raporu

## Required tests (Gerekli testler)

- Imaging E2E; DICOM erişim/izolasyon testleri; AI çıktı değerlendirme seti

## Security requirements (Güvenlik gereksinimleri)

- R-016 (DICOM ifşası) ve R-017 (bridge) kontrollerinin kanıtla kapatılması; görüntü şifreleme

## Tenant requirements (Tenant gereksinimleri)

- Görüntüler ve PACS erişimi tenant bazında izole

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Görüntü verisi özel nitelikli sağlık verisidir: saklama, silme ve aktarım kuralları; AI'a giden görüntülerde minimizasyon/anonimleştirme

## Rollback expectations (Geri alma beklentileri)

- Imaging özellikleri feature-flag'li; PACS entegrasyonu kademeli ve geri alınabilir

## Risks (Riskler)

- R-005, R-015, R-016, R-017, R-021

## Open questions (Açık sorular)

- Mevcut imaging-foundation ve bridge çalışmalarının bu faza taşınma şekli (baseline sonrası)
- AI sağlayıcılarının yasal sınıflandırması (R-021)

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
