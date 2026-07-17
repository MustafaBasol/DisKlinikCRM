# NoraMedi Program Takip Sistemi (`docs/program/`)

Bu dizin, NoraMedi kurumsal mimari ve modülerleşme programının (F0–F11) depo-tabanlı, yetkili (authoritative) takip sistemidir. Programın canlı durumu yalnızca burada ve Git kanıtlarında izlenir.

## 1. Amaç

- Program görevlerinin durumunu tek bir doğruluk kaynağında tutmak.
- Ajan (Claude Code) beyanları ile doğrulanmış kanıtları (merge, deploy, production testi) birbirinden ayırmak.
- Faz bazlı ilerlemeyi, mimari kararları, riskleri ve yayın kapılarını (release gates) izlenebilir kılmak.

## 2. Hangi dosya yetkilidir?

Güncel durum için yetkili dosya: [`NORAMEDI_MASTER_TRACKER.md`](NORAMEDI_MASTER_TRACKER.md)

Kaynak hiyerarşisi (yukarıdaki aşağıdakini ezer):

1. Git commitleri, merge edilmiş pull requestler, deploy edilmiş revizyonlar, migration'lar ve test kanıtları
2. `docs/program/NORAMEDI_MASTER_TRACKER.md`
3. İlgili faz dokümanı (`docs/program/phases/`)
4. Kabul edilmiş Architecture Decision Record'lar (ADR)
5. Güncel depo kanıtı (kodun kendisi)
6. Stratejik yol haritası dokümanları
7. Geçmiş konuşmalar ve ajan özetleri

## 3. Görev ID'leri nasıl atanır?

- Biçim: `F<faz>-<sıra>` (örn. `F0-001`, `F0-002`, `F5-003`).
- ID'ler faz dokümanında ve master tracker'da birlikte tanımlanır; ikisi çelişirse master tracker geçerlidir.
- F0 dışındaki fazlara ayrıntılı görev ID'si, bir önceki fazın kanıtları incelenmeden **atanmaz**.

## 4. Faz dokümanları ile master tracker ilişkisi

- `phases/` altındaki her doküman, o fazın amacını, giriş/çıkış koşullarını, izinli/yasak işleri ve görev listesini tanımlar.
- Master tracker ise **anlık durumu** (statü, aktif görev, blokajlar) tutar.
- Faz dokümanı "ne yapılacak"ın, master tracker "şu an nerede olduğumuz"un kaynağıdır.

## 5. Claude Code tracker'ı nasıl günceller?

- Ajan bir göreve başlarken ilgili görevi `IN_PROGRESS` yapar.
- Ajan, depo işini bitirdiğine inandığında görevi en fazla `AGENT_COMPLETED` durumuna getirebilir.
- Ajan şu durumları **asla** kendi başına atayamaz: `REVIEW_REQUIRED`, `TESTS_PASSED`, `MERGED`, `DEPLOYED`, `PRODUCTION_VERIFIED`. Bunlar dış onay ve kanıt gerektirir.
- Ajan `PR_OPEN` durumunu ancak gerçek bir pull request açıldıktan sonra (PR referansıyla) kaydedebilir.
- Her güncellemede `CHANGELOG.md`'ye kayıt düşülür.

## 6. ChatGPT incelemesi durumu nasıl etkiler?

- ChatGPT (ve kullanıcı), `AGENT_COMPLETED` durumundaki teslimi inceler.
- İnceleme sonucu ya `CHANGES_REQUESTED` (ajan düzeltme yapar) ya da onay yönünde ilerlemedir (PR → merge → deploy → production doğrulaması).
- Bir görev, dış inceleme olmadan `AGENT_COMPLETED`'ın ötesine geçemez.

## 7. Word / stratejik dokümanlar neden canlı takipçi değildir?

Word yol haritası ve benzeri stratejik dokümanlar hedefleri ve gerekçeleri anlatır; ancak versiyon kontrolünde canlı durum taşımazlar, Git kanıtına bağlanamazlar ve güncellikleri garanti edilemez. Bu nedenle **stratejik referans**tırlar, durum kaynağı değildirler.

## 8. Git kanıtı ve production doğrulaması neden zorunludur?

Bir ajanın "tamamlandı" demesi; işin incelendiğini, merge edildiğini, deploy edildiğini veya production'da doğrulandığını **kanıtlamaz**. Sağlık verisi işleyen, KVKK'ya tabi, çok kiracılı (multi-tenant) bir sistemde yalnızca şunlar kanıttır:

- `MERGED` → doğrulanmış merge kanıtı (commit/PR referansı)
- `DEPLOYED` → doğrulanmış deployment kanıtı (revizyon/sürüm bilgisi)
- `PRODUCTION_VERIFIED` → başarılı canlı smoke/kabul testi kaydı

## 9. Geçmiş dokümanlar nasıl ele alınır?

- `docs/` altındaki numaralı geçmiş dokümanlar (sprint planları, analiz raporları vb.) tarihsel bağlam olarak korunur; silinmez.
- İçlerindeki durum ifadeleri **güncel durum kanıtı sayılmaz**; güncel durum için master tracker ve Git'e bakılır.
- Bir geçmiş doküman ile master tracker çelişirse master tracker geçerlidir.

## 10. Doğrulanmamış iddia yasağı

Bu dizindeki hiçbir doküman, depo kanıtı ile doğrulanmamış bir mimari yeteneğin "uygulanmış/tamamlanmış" olduğunu iddia edemez. Kanıt yoksa `UNVERIFIED` yazılır.

## 11. Özet iş akışı

```
Görev promptu
→ ajan uygulaması (Claude Code)
→ AGENT_COMPLETED
→ ChatGPT incelemesi
→ değişiklik talebi veya onay
→ PR
→ merge
→ deployment
→ production doğrulaması
```

## 12. Dizin içeriği

| Dosya | İçerik |
|---|---|
| [NORAMEDI_MASTER_TRACKER.md](NORAMEDI_MASTER_TRACKER.md) | Yetkili canlı durum: fazlar, görevler, blokajlar, kararlar |
| [CURRENT_PHASE.md](CURRENT_PHASE.md) | Aktif fazın özeti ve dondurulmuş işler |
| [MODULE_MAP.md](MODULE_MAP.md) | Hedef domain/modül haritası (geçici, depo-doğrulaması bekliyor) |
| [DEPENDENCY_MAP.md](DEPENDENCY_MAP.md) | Modüller arası bağımlılık ilkeleri ve matris iskeleti |
| [TEST_OWNERSHIP.md](TEST_OWNERSHIP.md) | Hedef test mimarisi ve CI modeli |
| [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) | ADR indeksi (ADR-001…017) |
| [RISK_REGISTER.md](RISK_REGISTER.md) | Program risk kaydı |
| [RELEASE_GATES.md](RELEASE_GATES.md) | Yayın kapıları G0–G6 |
| [TASK_TEMPLATE.md](TASK_TEMPLATE.md) | Yeni görev tanım şablonu |
| [AGENT_DELIVERY_TEMPLATE.md](AGENT_DELIVERY_TEMPLATE.md) | Ajan teslim raporu şablonu |
| [CHANGELOG.md](CHANGELOG.md) | Program dokümantasyonu değişiklik günlüğü |
| [phases/](phases/) | F0–F11 faz dokümanları |
