# RELEASE_GATES — Yayın Kapıları (G0–G6)

Son güncelleme: 2026-07-17 (F0-001)

## Temel ilkeler

- **Kontrollü pilot hazırlığı (G1), genel ticari lansman hazırlığı (G2) ile aynı şey DEĞİLDİR.**
- **Kod tamamlanması, yayın hazırlığı değildir.**
- **Deployment, production doğrulaması değildir.**
- **Klinik AI hazırlığı, ayrı yasal ve klinik validasyon gerektirir.**

Tüm kapılar başlangıçta `NOT_APPROVED` durumundadır. Hiçbir kapı geçilmiş **sayılmaz**. Kapı onayı yalnızca dış onay sahibi tarafından, listelenen kanıtlar sunulduktan sonra verilebilir; ajan bir kapıyı onaylayamaz.

---

## G0 — F0 Architecture Validation Complete

- **Status:** `NOT_APPROVED`
- **Amaç:** F0 fazının çıktılarıyla (baseline, haritalar, PoC tasarımları, riskler) mimari programın uygulanabilirliğinin doğrulanması.
- **Gerekli teknik kanıt:** F0-002 baseline envanteri; F0-003/004 doğrulanmış haritalar; F0-009/010/011 PoC tasarımları; F0-013 konsolide rapor.
- **Gerekli güvenlik kanıtı:** F0-007 KVKK dondurma sınırı; risk kaydının güncellenmiş durumu.
- **Gerekli uyum (compliance) kanıtı:** Aktif KVKK çalışmasının durum raporu.
- **Gerekli test kanıtı:** F0-005 test envanteri ve ölçümleri.
- **Gerekli operasyonel kanıt:** F0-006 production topoloji raporu.
- **Onay sahibi:** ChatGPT incelemesi + kullanıcı kararı.
- **Rollback hazırlığı:** Uygulanamaz (dokümantasyon fazı); yine de F0 çıktılarının Git geçmişi korunur.

## G1 — Controlled Pilot Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** Sınırlı sayıda gerçek klinikle kontrollü pilotun güvenle yürütülebilmesi.
- **Gerekli teknik kanıt:** Kararlı deploy hattı; temel HA/yedekleme; hata bütçesi tanımı.
- **Gerekli güvenlik kanıtı:** Tenant izolasyon regresyonu geçer; kritik güvenlik bulguları kapalı.
- **Gerekli uyum kanıtı:** KVKK baseline dışarıdan teyitli; aydınlatma/consent akışları çalışır.
- **Gerekli test kanıtı:** Core güvenlik/tenancy testleri + smoke seti geçer (kanıtla).
- **Gerekli operasyonel kanıt:** İzleme/alarm; olay müdahale (incident) prosedürü; restore testi kanıtı.
- **Onay sahibi:** Kullanıcı (ChatGPT incelemesiyle).
- **Rollback hazırlığı:** Pilot kliniklerin verisiyle birlikte geri dönüş/çıkış planı belgelenmiş olmalı.
- **Not:** F0-012 bu kapının kanıt listesini ayrıntılandıracaktır.

## G2 — General Commercial Launch Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** Genel ticari lansman: kontrolsüz sayıda kliniğin self-service onboarding'i.
- **Gerekli teknik kanıt:** Ölçeklenebilir onboarding; kota/limit altyapısı; performans kapıları geçer.
- **Gerekli güvenlik kanıtı:** Bağımsız güvenlik gözden geçirmesi; entitlement'ların backend'de zorlandığı kanıtı.
- **Gerekli uyum kanıtı:** KVKK süreçlerinin ölçekte işlediği kanıtı; sözleşme/DPA şablonları.
- **Gerekli test kanıtı:** Release regresyon kapsamı + E2E geçer.
- **Gerekli operasyonel kanıt:** SLO'lar, kapasite planı, destek süreci, faturalama doğrulaması.
- **Onay sahibi:** Kullanıcı.
- **Rollback hazırlığı:** Sürüm geri alma provası (rollback rehearsal) kanıtı.
- **Not:** G1'in geçilmesi G2'nin geçildiği anlamına **gelmez**.

## G3 — Rapid Growth Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** Kısa sürede yüzlerce klinik onboarding'ini kaldırabilme.
- **Gerekli teknik kanıt:** Yük testleri (hedef eşzamanlılıkta); yatay ölçekleme kanıtı; kuyruk adaleti.
- **Gerekli güvenlik kanıtı:** Noisy-neighbor kontrolleri; izolasyonun yük altında korunduğu kanıtı.
- **Gerekli uyum kanıtı:** Veri işleme envanterinin ölçekte güncel kalması.
- **Gerekli test kanıtı:** Performans kapıları CI'da; nightly regresyon istikrarı.
- **Gerekli operasyonel kanıt:** Otomatik ölçekleme/kapasite; on-call modeli.
- **Onay sahibi:** Kullanıcı.
- **Rollback hazırlığı:** Onboarding durdurma (kill switch) ve geri basınç mekanizması.

## G4 — Imaging and Clinical AI Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** DICOM/CBCT görüntüleme ve tıbbi görüntüleme AI özelliklerinin canlıya alınması.
- **Gerekli teknik kanıt:** Object storage üzerinde imaging hattı; PACS bileşen entegrasyonu; bridge güvenlik kanıtı.
- **Gerekli güvenlik kanıtı:** DICOM erişim kontrolü; görüntü verisi şifreleme; bridge tedarik zinciri kanıtı.
- **Gerekli uyum kanıtı:** **Ayrı yasal ve klinik validasyon** (tıbbi cihaz/AI mevzuat sınıflandırması dahil).
- **Gerekli test kanıtı:** Imaging E2E; AI çıktı değerlendirme/regresyon seti.
- **Gerekli operasyonel kanıt:** Görüntü hacmi kapasite planı; imaging izleme.
- **Onay sahibi:** Kullanıcı + yasal/klinik danışmanlık.
- **Rollback hazırlığı:** Imaging özelliklerinin feature flag ile kapatılabilirliği kanıtı.

## G5 — Official Integration Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** Sağlık Bakanlığı ve diğer resmî entegrasyonların canlı kullanımı.
- **Gerekli teknik kanıt:** Adapter platformu; sertifika/kimlik yönetimi; sandbox'ta uçtan uca kanıt.
- **Gerekli güvenlik kanıtı:** Resmî kanal kimlik bilgilerinin güvenli saklanması; denetim izi.
- **Gerekli uyum kanıtı:** İlgili kurumların teknik/idari gereksinimlerinin karşılandığı kanıtı.
- **Gerekli test kanıtı:** Adapter contract testleri; hata/retry senaryoları.
- **Gerekli operasyonel kanıt:** Kesinti/sözleşme değişikliği müdahale planı.
- **Onay sahibi:** Kullanıcı.
- **Rollback hazırlığı:** Entegrasyon bazında devre dışı bırakma ve kuyruklama kanıtı.

## G6 — 1,000+ Clinic Enterprise Ready

- **Status:** `NOT_APPROVED`
- **Amaç:** 1.000+ klinik, dedicated tenant seçenekleri, tam DR ve kurumsal operasyon olgunluğu.
- **Gerekli teknik kanıt:** Dedicated tenant kabiliyeti; DR tatbikatı (bölge/altyapı kaybı senaryosu); OLAP/analitik ayrımı.
- **Gerekli güvenlik kanıtı:** Kurumsal güvenlik denetimi; SSO/OIDC; gelişmiş uyum raporlaması.
- **Gerekli uyum kanıtı:** Kurumsal DPA/SLA çerçevesi; denetim hazırlığı.
- **Gerekli test kanıtı:** Ölçek testleri (1.000+ tenant simülasyonu); DR restore kanıtı.
- **Gerekli operasyonel kanıt:** 7/24 operasyon modeli; SLA raporlaması; kapasite yönetimi.
- **Onay sahibi:** Kullanıcı.
- **Rollback hazırlığı:** Bölgesel/dedicated geçişlerin geri alınabilirlik planı.

---

## Kapı durum tablosu

| Kapı | Ad | Durum |
|---|---|---|
| G0 | F0 Architecture Validation Complete | `NOT_APPROVED` |
| G1 | Controlled Pilot Ready | `NOT_APPROVED` |
| G2 | General Commercial Launch Ready | `NOT_APPROVED` |
| G3 | Rapid Growth Ready | `NOT_APPROVED` |
| G4 | Imaging and Clinical AI Ready | `NOT_APPROVED` |
| G5 | Official Integration Ready | `NOT_APPROVED` |
| G6 | 1,000+ Clinic Enterprise Ready | `NOT_APPROVED` |
