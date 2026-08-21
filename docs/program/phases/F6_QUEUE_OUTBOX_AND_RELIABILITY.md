# F6 — Queue, Outbox, Idempotency, and Reliability

Faz durumu: `TODO` · Son güncelleme: 2026-08-22 (F5-1P — izole PoC yürütüldü; faz durumu **değişmedi**, giriş koşulları hâlâ karşılanmadı)

> **Numaralandırma uyuşmazlığı (F5-1, 2026-08-22).** ClickUp'taki `EPIC F5 — BullMQ, Transactional Outbox ve Messaging Dayanıklılığı` (`869ed1jvf`) **bu faz dokümanına karşılık gelir**; ClickUp'ta tenant/RLS işi `F3-*` ID'leriyle yürütüldüğü için numaralar bir kaydırma ile ilerliyor (ClickUp `F5` == depo `F6`). Depo numaralandırması **değiştirilmedi**; tarih yeniden yazılmadı. "F6 entry" diye yazılmış her kapı, ClickUp EPIC F5'i yönetir. Ayrıntı ve kanıt: [../evidence/F5-1_QUEUE_PLATFORM_AUTHORIZATION_AUDIT.md](../evidence/F5-1_QUEUE_PLATFORM_AUTHORIZATION_AUDIT.md).

## Objective (Hedef)

Güvenilir asenkron altyapı: kuyruk platformu (ADR-007), transactional outbox (ADR-006), idempotency standardı, retry/poison stratejileri ve çok-tenant kuyruk adaleti. Tasarım girdisi: F0-010.

## Business reason (İş gerekçesi)

WhatsApp/SMS/e-posta/resmî entegrasyon hacmi büyüdükçe; kaybolan event'ler (R-010), mükerrer webhook işleme (R-011) ve kuyruk birikmesi (R-009) doğrudan hasta iletişimi ve uyum riskine dönüşür.

## Entry conditions (Giriş koşulları)

- F5 çıkışı
- F0-010 tasarımı ve ADR-006/007 kabulü

## Exit gate (Çıkış kapısı)

- Outbox + dispatcher canlıda kanıtla çalışıyor; event kaybı senaryosu test edilmiş
- Idempotency standardı webhook/job'larda uygulanmış
- Kuyruk metrikleri ve backlog alarmları canlı

## Dependencies (Bağımlılıklar)

- F5; ADR-006/007

## Allowed work (İzinli işler)

- Outbox tabloları/dispatcher, kuyruk platform geçişi, idempotency anahtarları, DLQ/poison yönetimi

## Prohibited work (Yasak işler)

- Erken Kafka girişi (DEFERRED — ölçülebilir tetikleyiciye kadar)
- Event şemalarının sürümsüz kırıcı değişimi

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, F5 kanıtları incelendikten sonra atanacaktır.

- Transactional outbox uygulaması ve dispatcher
- Kuyruk platformunun kurulması/standardizasyonu
- Webhook idempotency standardı (tüm sağlayıcılar)
- Retry/backoff/poison (DLQ) politikaları
- Çok-tenant kuyruk adaleti (fairness) ve kota
- Devre dışı modül job'larının durdurulması (DEPENDENCY_MAP kural 8)
- Kuyruk gözlemlenebilirliği ve backlog alarmları

## Required evidence (Gerekli kanıt)

- Kaos/kayıp senaryosu test kanıtları; idempotency test kanıtları; backlog metrik panosu

## Required tests (Gerekli testler)

- Queue worker testleri; outbox tutarlılık testleri; mükerrer teslim simülasyonu

## Security requirements (Güvenlik gereksinimleri)

- Kuyruk payload'larında veri minimizasyonu; işleme yetki bağlamının korunması

## Tenant requirements (Tenant gereksinimleri)

- Job'lar tenant bağlamıyla çalışır; bir tenant'ın yükü diğerini aç bırakamaz

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Mesajlaşma payload saklama sürelerinin retention politikasına uyumu

## Rollback expectations (Geri alma beklentileri)

- Yeni kuyruk hattı, eski davranışa düşebilecek şekilde flag'li devreye alınır

## Risks (Riskler)

- R-009, R-010, R-011, R-012, R-022

## Open questions (Açık sorular)

- Kuyruk platformu seçimi ve mevcut job altyapısından geçiş yolu (F0-010/ADR-007)

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
| 2026-08-22 | F5-1 | Yetkilendirme denetimi ve mevcut-durum kanıtı eklendi (salt-okunur; kod/şema/bağımlılık değişmedi). ClickUp EPIC F5 == depo F6 eşleşmesi kayıt altına alındı. Giriş koşulları (F5 çıkışı + ADR-006/007 kabulü) **karşılanmadı**; faz `TODO` kaldı. |
| 2026-08-22 | F5-1P | Program sahibi kararı: F5-1 denetimi **KABUL EDİLDİ**. ADR-006/ADR-007 `NEEDS_POC` **değişmedi**, BullMQ **seçilmedi**, production rollout **yetkilendirilmedi**. **İzole/tek-kullanımlık PoC açıkça YETKİLENDİRİLDİ** (ClickUp `869enfvvu`) — `queue-outbox-poc-design.md` §12/§14'ün gerektirdiği ayrı görev budur. Faz `TODO` kaldı. |
| 2026-08-22 | F5-1P | İzole/tek-kullanımlık **karşılaştırmalı PoC yürütüldü** (44 deney, 44 PASS, 0 FAIL). PostgreSQL outbox + dispatcher **vs** BullMQ + Redis. Belirleyici sonuç yapısal: BullMQ işi, geri alınmış bir iş transaction'ından **sağ kalıyor** (yetim event); outbox bu boşluğu kapatıyor. İşlem hacmi **karşılaştırılabilir** (1.887/s vs 1.684/s @ n=1000). Tenant adaleti **hiçbir adayda bedava değil**; naif per-tenant cap ölçülerek **kötüleştirdi**. `ADR_007_RECOMMENDATION = B` — **karar değil, kanıt**. ADR-006/ADR-007 `NEEDS_POC` kaldı; faz `TODO` kaldı; production'da hiçbir değişiklik yapılmadı. Kanıt: [../evidence/F5-1P_QUEUE_PLATFORM_POC.md](../evidence/F5-1P_QUEUE_PLATFORM_POC.md). |
