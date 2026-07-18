# F7 — Horizontal Scaling and High Availability

Faz durumu: `TODO` · Son güncelleme: 2026-07-17 (F0-001)

## Objective (Hedef)

Uygulamayı çok-instance çalışır hale getirmek; yük dengeleme, DB replica/failover, oturum/durum yönetimi ve kapasite otomasyonu ile yüksek erişilebilirlik sağlamak (ADR-016 ile tutarlı).

## Business reason (İş gerekçesi)

Tek sunucu (R-003) ve tek veritabanı (R-004) arızaları; yüzlerce kliniğin aynı anda çalışamaması demektir. Hızlı büyüme (G3) yatay ölçek kanıtı ister.

## Entry conditions (Giriş koşulları)

- F6 çıkışı (asenkron altyapı güvenilir)
- ADR-016 kabulü

## Exit gate (Çıkış kapısı)

- Çok-instance çalıştırma kanıtı (yük altında)
- DB failover tatbikatı başarılı
- Hedef eşzamanlılıkta yük testi kapıları geçilmiş

## Dependencies (Bağımlılıklar)

- F6; ADR-016

## Allowed work (İzinli işler)

- Stateless'laştırma, yük dengeleyici, replica/failover, kapasite otomasyonu, yük testleri

## Prohibited work (Yasak işler)

- Erken Kubernetes girişi (DEFERRED — ölçülebilir tetikleyiciye kadar; ADR-016 aksini kanıtlamadıkça)

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, F6 kanıtları incelendikten sonra atanacaktır.

- Instance-yerel durumların (dosya, bellek-içi lock, cron) envanteri ve giderilmesi
- Yük dengeleme ve health-check standardı
- PostgreSQL replica + failover kurulumu ve tatbikatı
- Job/cron'ların çok-instance güvenliği (lock/lease standardı)
- Yük testi senaryoları ve performans kapıları
- Kapasite planlama ve ölçekleme runbook'ları

## Required evidence (Gerekli kanıt)

- Yük testi raporları; failover tatbikat kayıtları; çok-instance canlı kanıtı

## Required tests (Gerekli testler)

- Yük/performans testleri; failover senaryoları; job tekilleştirme testleri

## Security requirements (Güvenlik gereksinimleri)

- Instance'lar arası trafik ve secret paylaşımının güvenliği

## Tenant requirements (Tenant gereksinimleri)

- Ölçekleme altında izolasyon ve adalet korunur (R-022, R-023)

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Replica/yedek kopyaların da KVKK veri yerleşimi ve silme yükümlülüklerine tabi olması

## Rollback expectations (Geri alma beklentileri)

- Tek-instance çalışmaya güvenli dönüş yolu korunur

## Risks (Riskler)

- R-003, R-004, R-008, R-022, R-023

## Open questions (Açık sorular)

- Orkestrasyon tetikleyicileri: hangi ölçüm Kubernetes'i gerekçelendirir? (ADR-016)

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
