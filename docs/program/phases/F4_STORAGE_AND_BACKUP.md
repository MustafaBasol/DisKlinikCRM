# F4 — Storage and Backup Foundation

Faz durumu: `TODO` · Son güncelleme: 2026-07-17 (F0-001)

## Objective (Hedef)

Object-storage soyutlamasını (ADR-008) ve kurumsal yedekleme/PITR temelini (ADR-013) kurmak; yerel disk bağımlılığını kaldırmak; restore testlerini rutinleştirmek. Tasarım girdisi: F0-011.

## Business reason (İş gerekçesi)

Imaging (DICOM/CBCT) ölçeklenmeden önce object storage zorunludur (PROGRAM DIRECTION #13). Doğrulanmamış yedek, yedek değildir; sağlık verisinde veri kaybı kabul edilemez.

## Entry conditions (Giriş koşulları)

- F3 çıkışı
- F0-011 tasarımı ve ADR-008/013 kabulü
- KVKK taban çizgisi teyidi (storage-key migrasyonu dondurma listesindedir)

## Exit gate (Çıkış kapısı)

- Object storage canlıda kanıtla çalışıyor; yeni yazımlar object storage'a
- Yedekleme + PITR kurulu; **başarılı restore testi kanıtı** var
- Mevcut dosyaların migrasyon planı onaylı/uygulanmış

## Dependencies (Bağımlılıklar)

- F3; KVKK taban çizgisi teyidi

## Allowed work (İzinli işler)

- Storage abstraction implementasyonu, sağlayıcı entegrasyonu, yedekleme otomasyonu, kademeli dosya migrasyonu

## Prohibited work (Yasak işler)

- Onaysız toplu (big-bang) dosya taşıma
- Attachment fiziksel-silme akışının KVKK teyidi öncesi değiştirilmesi

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, F3 kanıtları incelendikten sonra atanacaktır.

- Sağlayıcı seçimi ve veri yerleşimi (KVKK) doğrulaması
- Storage abstraction katmanının canlıya alınması
- Kademeli storage-key migrasyonu
- Otomatik yedekleme + PITR kurulumu
- Periyodik restore testi otomasyonu
- Disk kullanım alarmları ve temizlik politikaları

## Required evidence (Gerekli kanıt)

- Restore testi kayıtları; migrasyon ilerleme raporları; sağlayıcı yerleşim kanıtı

## Required tests (Gerekli testler)

- Storage entegrasyon testleri; upload/download/delete yaşam döngüsü; migration testleri

## Security requirements (Güvenlik gereksinimleri)

- Şifreleme (at-rest/in-transit); erişim anahtarlarının güvenli yönetimi; URL imzalama politikası

## Tenant requirements (Tenant gereksinimleri)

- Storage anahtar şeması tenant ayrımını garanti etmeli

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Veri yerleşimi (Türkiye/AB) gereksinimlerine uygun sağlayıcı; silme taleplerinin object storage'da da uygulanabilirliği

## Rollback expectations (Geri alma beklentileri)

- Migrasyon adımları çift-yazım/geri-okuma stratejisiyle geri alınabilir olmalı

## Risks (Riskler)

- R-005, R-006, R-007, R-013 (yerleşim boyutu), R-016

## Open questions (Açık sorular)

- Sağlayıcı adayları ve maliyet modeli (F0-011 çıktısı)

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
