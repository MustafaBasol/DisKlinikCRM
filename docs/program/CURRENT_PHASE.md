# CURRENT_PHASE — Aktif Faz Durumu

Son güncelleme: 2026-07-18 (F0-002 Stage A)

## Aktif faz

**F0 — Baseline, Program Control, and Architecture Validation**

Faz dokümanı: [phases/F0_BASELINE_AND_VALIDATION.md](phases/F0_BASELINE_AND_VALIDATION.md)
Faz durumu: `IN_PROGRESS`

## Faz amacı

Kurumsal mimari programına başlamadan önce:

- Depo-tabanlı yetkili takip sistemini kurmak (F0-001),
- Depo, deployment ve test taban çizgisini **kanıtla** çıkarmak,
- Modül/bağımlılık/test sahipliği haritalarını hazırlamak,
- Kritik mimari kararlar (RLS, PgBouncer, outbox, object storage) için PoC **tasarımlarını** üretmek,
- G0 kapısına sunulacak konsolide doğrulama raporunu (F0-013) hazırlamak.

## KVKK geliştirmesi sürerken F0 neden çalışıyor?

KVKK-HIGH-004 (secure clinic bulk export) çalışması [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) ile `main`'e **merge edilmiştir** (2026-07-17). Bu, tüm KVKK programının tamamlandığı anlamına gelmez; ek KVKK/güvenlik çalışmaları hâlâ aktif olabilir. Yerel gözlem: ana çalışma ağacında `feature/kvkk-crit-003-security-incident-foundation` branch'i gözlemlenmiştir; ancak bu branch'in remote branch, PR, kapsam ve tamamlanma durumu `UNVERIFIED`'dır. F0'ın işleri **invaziv olmayan** dokümantasyon ve analizdir; KVKK koduna dokunmaz, onunla çakışmaz. Fiziksel mimari değişiklikleri, kullanıcı/ChatGPT kararlı bir KVKK taban çizgisini dışarıdan teyit edene kadar **donmuş** kalır.

## Şu an ilerleyebilecek işler

- Dokümantasyon ve program takibi
- Depo envanteri ve taban çizgisi toplama
- Modül ve bağımlılık haritalama
- Test envanteri ve sahiplik haritası
- ADR taslak çalışması
- İnvaziv olmayan analiz ve PoC **tasarımı**

## KVKK taban çizgisine kadar DONMUŞ işler

1. Geniş Prisma şema değişiklikleri
2. Tenant `organizationId` backfill'leri
3. RLS migration'ları
4. Prisma tenant extension rollout'u
5. Fiziksel modül refactoring'i
6. Privacy modeli taşıma
7. Consent modeli taşıma
8. Retention modeli taşıma
9. Anonimleştirme iş akışı yeniden yapılandırması
10. Attachment fiziksel-silme iş akışı değişiklikleri
11. Storage-key migrasyonu
12. Geniş authentication middleware yeniden yapılandırması

## Aktif görev

**F0-002 — Repository and Deployment Baseline Inventory** → `IN_PROGRESS` — Stage A (depo kanıtı) `AGENT_COMPLETED` (bkz. [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md)); Stage B (production kanıtı) kullanıcının salt-okunur VPS kanıtı sağlamasını bekliyor ([evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md](evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md)). Genel görev durumu ajan tarafından bunun ötesine geçirilemez.

## Sonraki görev

**F0-002 Stage B — Production Topology, Commit, Migration, and Runtime Verification** → kullanıcı girdisi bekleniyor (production evidence request çıktısı). Ardından F0-003 sıraya girer (bu turda **başlatılmadı**).

## Giriş koşulları

- Program başlangıç kararı (verildi — bu program promptu ile).
- Başka ön koşul yok.

## Çıkış koşulları

- F0-001…F0-013 görevlerinin tamamlanması,
- [RELEASE_GATES.md](RELEASE_GATES.md) içindeki **G0 — F0 Architecture Validation Complete** kapısının dış onayı.

## F0 doğrulama kapısı (G0)

G0, F0-013 konsolide raporunun; baseline kanıtları, harita doğrulamaları, PoC tasarımları ve risk değerlendirmesiyle birlikte dış inceleyici (ChatGPT/kullanıcı) tarafından onaylanmasını gerektirir. Ayrıntı: [RELEASE_GATES.md](RELEASE_GATES.md).

## Bilinen blokajlar

Bkz. [NORAMEDI_MASTER_TRACKER.md §12](NORAMEDI_MASTER_TRACKER.md#12-current-blockers-güncel-blokajlar). Özet:

- KVKK taban çizgisi dışarıdan kararlı olarak teyit edilmedi (KVKK-HIGH-004 [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) ile merge edildi; devam eden KVKK/güvenlik çalışması `UNVERIFIED`).
- Depo baseline'ı kanıtla toplandı (F0-002 Stage A); production topolojisi, RLS/PgBouncer, storage ve queue/outbox kanıtları henüz yok (F0-002 Stage B, F0-006, F0-009, F0-010, F0-011).

## Tarih ve güncelleme geçmişi

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Doküman oluşturuldu; F0 `IN_PROGRESS`, F0-001 `AGENT_COMPLETED`, F0-002 `READY`. |
| 2026-07-17 | F0-001 | Dış inceleme başladı: F0-001 → `REVIEW_REQUIRED`; kalite düzeltmeleri (PR_OPEN kural netleştirmesi) uygulandı. |
| 2026-07-17 | F0-001 | [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166) açıldı: F0-001 → `PR_OPEN`. |
| 2026-07-17 | F0-001 | Dış inceleme düzeltme istedi (bayat KVKK taban çizgisi ifadeleri): F0-001 → `CHANGES_REQUESTED`; PR #165'in merge edildiği kaydedildi, aktif KVKK çalışması `UNVERIFIED`'a döndürüldü. |
| 2026-07-17 | F0-001 | Düzeltmeler commit `ef11d2d` ile [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166)'ya push edildi; PR açık: F0-001 → `PR_OPEN`. |
| 2026-07-18 | F0-001 | [PR #166](https://github.com/MustafaBasol/DisKlinikCRM/pull/166) merge edildi (merge commit `4302825abcdf4f5dbb90b4ded92b2e44a947df18`, `2026-07-18T08:08:10Z`, `gh pr view` ile doğrulandı): F0-001 → `MERGED`. |
| 2026-07-18 | F0-002 | Stage A (depo kanıtı) tamamlandı: izole worktree/branch oluşturuldu, PR #166 merge-ancestry doğrulandı, depo/toolchain/script/Prisma/deployment/runtime-bağımlılık/CI envanteri kanıtla dolduruldu (bkz. [evidence/F0-002_REPOSITORY_BASELINE.md](evidence/F0-002_REPOSITORY_BASELINE.md)); production evidence request hazırlandı ([evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md](evidence/F0-002_PRODUCTION_EVIDENCE_REQUEST.md)). F0-002 → `IN_PROGRESS` (Stage A `AGENT_COMPLETED`, Stage B kullanıcı girdisi bekliyor). |
