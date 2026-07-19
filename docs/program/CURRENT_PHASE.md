# CURRENT_PHASE — Aktif Faz Durumu

Son güncelleme: 2026-07-19 (F0-006 tamamlandı — production topology/configuration doğrulaması; F0-002 → `MERGED` durum düzeltmesi)

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

KVKK-HIGH-004 (secure clinic bulk export) çalışması [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) ile `main`'e **merge edilmiştir** (2026-07-17). Bu, tüm KVKK programının tamamlandığı anlamına gelmez; devam eden KVKK/güvenlik çalışması artık [PR #167](https://github.com/MustafaBasol/DisKlinikCRM/pull/167) (KVKK-CRIT-003, security incident response foundation) olarak kanıtlandı — `OPEN`, draft değil, `feature/kvkk-crit-003-security-incident-foundation` branch'inden `main`'e, 29 değişen dosya, 3 commit (`gh pr view 167` ile doğrulandı, `VERIFIED_GITHUB`). PR'ın kendi commit mesajları uygulama/test iddiaları içerir, ancak bunlar F0-002 tarafından bağımsız olarak doğrulanmadı/kabul edilmedi. PR #167 **merge edilmedi, deploy edilmedi, production'da doğrulanmadı**. Ayrıca birincil çalışma ağacında (`D:\Mustafa\Siteler\DisKlinikCRM`) KVKK-HIGH-007 (consent reconciliation) adlı ikinci, commit edilmemiş bir KVKK çalışması F0-006 tarafından yalnızca `git status --short` ile (salt-okunur) gözlemlendi — dosya içerikleri incelenmedi, hiçbir dosyaya dokunulmadı. F0'ın işleri **invaziv olmayan** dokümantasyon ve analizdir; KVKK koduna dokunmaz, onunla çakışmaz. Fiziksel mimari değişiklikleri, kullanıcı/ChatGPT kararlı bir KVKK taban çizgisini dışarıdan teyit edene (yani PR #167 merge/kabul kararı) kadar **donmuş** kalır.

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

**F0-006 — Production Topology and Configuration Verification** → `AGENT_COMPLETED`. İzole worktree `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-006-production-topology`, branch `docs/f0-006-production-topology-verification`, base `origin/main` @ `db89b60c91666cb029c32757f171f227a643c79c` (F0-002'nin kendi merge commit'i). Süreç/deployment/config/storage/backup topolojisi kaynak-kod seviyesinde izlendi ve F0-002 Stage B ile mutabakat sağlandı; 12 yeni risk (R-029…R-040) kaydedildi. `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` dış teyit gerektirir.

**Not (F0-002 düzeltmesi):** F0-002 aslında [PR #172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172) ile `main`'e merge edilmiştir (merge commit `db89b60c91666cb029c32757f171f227a643c79c`, `2026-07-19T12:02:51Z`, `gh pr view 172` ile teyit edildi) — `PR_OPEN` durumu, o merge commit'inin kendi tracker anlık görüntüsündeki öz-referans gecikmesiydi (F0-003/004/005'te de görülen aynı desen), F0-006 tarafından düzeltildi.

## Sonraki görev

**F0-006'nın pull request'i için dış inceleme ve merge kararı.** Merge sonrası sıradaki adaylar: **F0-007 — Active KVKK Work Baseline and Architecture Freeze Boundary** ve **F0-011 — Object Storage and Backup Migration Design** (ikisinin de bağımlılıkları — F0-002 ve, F0-011 için ayrıca F0-006 — artık karşılandı). F0-002, F0-003, F0-004, F0-005 hepsi `main`'e merge edilmiş durumda.

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

- KVKK taban çizgisi dışarıdan kararlı olarak teyit edilmedi (KVKK-HIGH-004 [PR #165](https://github.com/MustafaBasol/DisKlinikCRM/pull/165) ile merge edildi; devam eden KVKK/güvenlik çalışmasının [PR #167](https://github.com/MustafaBasol/DisKlinikCRM/pull/167) sonrası güncel kapsam/durum tespiti F0-007'nin işidir — F0-002 bu alana dokunmaz).
- Depo baseline'ı kanıtla toplandı (F0-002 Stage A); production baseline kanıtı da artık toplandı ve belgelendi (F0-002 Stage B — bkz. [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md)). RLS/PgBouncer, storage-migrasyon tasarımı ve queue/outbox kanıtları hâlâ yok (F0-009, F0-010, F0-011); production topolojinin biçimsel/ayrıntılı incelemesi F0-006'ya aittir (F0-002'nin bu turdaki gözlemsel kanıtı F0-006'nın girdisidir, yerine geçmez).

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
| 2026-07-19 | F0-002 | Branch `origin/main`'e merge edildi (F0-003/F0-004/F0-005 artık `MERGED`, PR #167/#169 KVKK çalışması dahil) — normal, force olmayan `git merge`, 2 dokümantasyon-yalnız çakışma çözüldü. Stage B production baseline kanıtı kullanıcı tarafından salt-okunur olarak sağlandı (evidence timestamp `2026-07-19T13:43:12+03:00`) ve [evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md](evidence/F0-002_PRODUCTION_BASELINE_EVIDENCE.md)'e işlendi; repository baseline'ın §6.9 kanıt matrisi bu kanıtla mutabakat sağlandı. F0-002 → `AGENT_COMPLETED` (Stage A + Stage B tamamlandı; `MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED` atanmadı). |
| 2026-07-19 | F0-002 | [PR #172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172) `main` hedefli açıldı: F0-002 → `PR_OPEN`. Merge kararı dış incelemeye aittir. |
| 2026-07-19 | F0-002 | [PR #172](https://github.com/MustafaBasol/DisKlinikCRM/pull/172) merge edildi (merge commit `db89b60c91666cb029c32757f171f227a643c79c`, `2026-07-19T12:02:51Z`, `gh pr view 172` ile doğrulandı): F0-002 → `MERGED`. |
| 2026-07-19 | F0-006 | İzole worktree/branch oluşturuldu (`docs/f0-006-production-topology-verification` @ `db89b60c91666cb029c32757f171f227a643c79c`). Süreç/deployment/config/Postgres/Redis/storage/backup/güvenlik topolojisi kaynak-kod seviyesinde izlendi, F0-002 Stage B ile mutabakat sağlandı (görev-sağlanan ikinci bir anlık görüntü tamamen tutarlı bulundu), zorunlu drift tablosu oluşturuldu, 12 yeni risk (R-029…R-040) kaydedildi. F0-006 → `AGENT_COMPLETED`. |
