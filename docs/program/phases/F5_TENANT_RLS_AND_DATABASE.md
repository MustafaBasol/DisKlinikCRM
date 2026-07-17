# F5 — Tenant Isolation, Prisma, RLS, and PgBouncer

Faz durumu: `TODO` · Son güncelleme: 2026-07-17 (F0-001)

## Objective (Hedef)

Defense-in-depth tenant izolasyonunu veritabanı katmanına indirmek: PostgreSQL RLS (ADR-005), Prisma + PgBouncer stratejisi (ADR-004), tenant extension rollout'u ve izolasyon regresyon matrisi. Tasarım girdisi: F0-009 PoC tasarımı.

## Business reason (İş gerekçesi)

Binlerce tenant'ta yalnızca uygulama-katmanı scope kontrolüne güvenmek kabul edilemez risktir (R-001). Cross-tenant sızıntı; KVKK ihlali, itibar ve ticari kayıp demektir.

## Entry conditions (Giriş koşulları)

- F4 çıkışı
- **KVKK taban çizgisinin dışarıdan teyidi (zorunlu)** — bu fazın işlerinin çoğu dondurma listesindedir
- F0-009 PoC tasarımının ve ADR-002/004/005 kabulü
- PoC'nin ayrı ortamda **kanıtla** başarılı olması

## Exit gate (Çıkış kapısı)

- RLS + Prisma + PgBouncer üretimde kanıtla çalışıyor
- Tenant izolasyon regresyon matrisi CI'da zorunlu ve geçiyor
- Bağlantı bütçeleri ve tükenme senaryoları ölçülmüş

## Dependencies (Bağımlılıklar)

- F4; KVKK taban çizgisi teyidi; ADR-002/003/004/005

## Allowed work (İzinli işler)

- PoC uygulaması (ayrık ortam), kademeli RLS migration'ları, tenant extension rollout'u, `organizationId` backfill'leri (onaylı planla)

## Prohibited work (Yasak işler)

- Kanıtsız (PoC'siz) production RLS rollout'u
- Schema-per-tenant'a kayma (REJECTED — varsayılan strateji olarak)

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, F4 kanıtları incelendikten sonra atanacaktır.

- RLS/PgBouncer/Prisma PoC uygulaması ve ölçümü (ayrık ortam)
- Tenant bağlam taşıma standardı (session/`SET`, extension)
- Kademeli RLS policy migration planı ve uygulaması
- `organizationId` backfill ve doğrulama
- Tenant izolasyon regresyon matrisi (CI-zorunlu)
- PgBouncer topolojisi ve bağlantı bütçeleri
- Dedicated tenant kabiliyet hazırlığı (ADR-003 kapsamında)

## Required evidence (Gerekli kanıt)

- PoC ölçüm raporu; migration ileri/geri kanıtı; izolasyon matrisi CI kayıtları; performans karşılaştırmaları

## Required tests (Gerekli testler)

- İzolasyon regresyonu; migration testleri; yük altında bağlantı davranışı; permission matrisi

## Security requirements (Güvenlik gereksinimleri)

- RLS bypass yollarının (superuser, policy açıkları) denetimi; uygulama katmanı kontrollerinin **korunması** (defense-in-depth)

## Tenant requirements (Tenant gereksinimleri)

- Hiçbir sorgu tenant bağlamı olmadan veri döndüremez; ihlal tespiti alarmlı

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Backfill/migrasyon sırasında veri minimizasyonu; KVKK akışlarının regresyon testi

## Rollback expectations (Geri alma beklentileri)

- Her RLS migration adımı geri alınabilir; rollout feature-flag'li ve kademeli

## Risks (Riskler)

- R-001, R-002, R-008, R-024

## Open questions (Açık sorular)

- Prisma tenant extension'ın PgBouncer transaction pooling ile session-state uyumu (F0-009 ana sorusu)

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
