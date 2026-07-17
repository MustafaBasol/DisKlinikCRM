# TASK_TEMPLATE — Görev Tanım Şablonu

Yeni bir program görevi tanımlanırken bu şablon kopyalanır ve tüm alanlar doldurulur. "Etki yok" bile olsa alan boş bırakılmaz; `None` veya `Unchanged` yazılır. Kanıtlanmamış hiçbir şey "var/tamam" olarak yazılamaz; `UNVERIFIED` kullanılır.

```markdown
# <Task ID> — <Title>

## Kimlik
- **Task ID:** F#-###
- **Title:**
- **Phase:** F#
- **Status:** TODO | READY | IN_PROGRESS | AGENT_COMPLETED | ... (bkz. NORAMEDI_MASTER_TRACKER.md §2.2)

## Tanım
- **Objective (Hedef):** Bu görev neyi başarmalı?
- **Background (Arka plan):** Neden şimdi? Hangi karar/analizden doğdu?
- **Repository evidence (Depo kanıtı):** Görevi gerekçelendiren mevcut dosya/commit/PR referansları.
- **Dependencies (Bağımlılıklar):** Önce tamamlanması gereken görevler/kararlar.

## Kapsam
- **Scope (Kapsam):** Yapılacak işin sınırları.
- **Out of scope (Kapsam dışı):** Açıkça yapılmayacaklar.
- **Acceptance criteria (Kabul kriterleri):** Ölçülebilir, kanıtlanabilir maddeler.

## Etki analizi
- **Security impact (Güvenlik etkisi):**
- **Tenant impact (Tenant etkisi):**
- **KVKK/privacy impact (KVKK/gizlilik etkisi):**
- **Database/migration impact (Veritabanı/migration etkisi):**
- **Queue/event impact (Kuyruk/event etkisi):**
- **Storage impact (Depolama etkisi):**
- **AI impact (AI etkisi):**
- **Imaging impact (Görüntüleme etkisi):**
- **Official integration impact (Resmî entegrasyon etkisi):**
- **Backward compatibility (Geriye uyumluluk):**

## Güvence
- **Rollback method (Geri alma yöntemi):** Bu iş nasıl geri alınır?
- **Required tests (Gerekli testler):** Çalıştırılması zorunlu test komutları/kapsamı.
- **Required typecheck/lint/build:** Zorunlu statik kontroller.
- **Required documentation updates (Gerekli dokümantasyon güncellemeleri):** Tracker, faz dokümanı, CHANGELOG vb.

## Süreç
- **Agent completion rules (Ajan tamamlama kuralları):** Ajan en fazla `AGENT_COMPLETED` atayabilir; teslim raporu AGENT_DELIVERY_TEMPLATE.md formatında olmalıdır.
- **Reviewer decision (İnceleyici kararı):** ChatGPT/kullanıcı — onay veya `CHANGES_REQUESTED`.
- **Merge decision (Merge kararı):** Kullanıcı; kanıt: PR/commit referansı.
- **Deployment decision (Deployment kararı):** Kullanıcı; kanıt: revizyon/ortam bilgisi.
- **Production verification (Production doğrulaması):** Canlı smoke/kabul testi sonucu ve kaydı.
- **Exact next task (Kesin sonraki görev):** Bu görev bitince sıradaki görev ID'si.
```
