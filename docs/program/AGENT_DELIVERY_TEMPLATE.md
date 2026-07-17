# AGENT_DELIVERY_TEMPLATE — Ajan Teslim Raporu Şablonu

Claude Code, her görev teslimi sonunda raporunu **bu yapıyla** vermek zorundadır. Boş bölüm bırakılmaz; ilgisizse `None`, kanıtlanamıyorsa `UNVERIFIED` yazılır.

```markdown
TASK
- ID:
- Title:
- Phase:
- Agent status:   (en fazla AGENT_COMPLETED)

SCOPE COMPLETED
- (Tamamlanan kapsam maddeleri)

OUT OF SCOPE CONFIRMED
- (Bilinçli olarak yapılmayanların teyidi)

FILES CREATED
- (Oluşturulan dosyalar)

FILES CHANGED
- (Değiştirilen dosyalar)

FILES DELETED
- (Silinen dosyalar)

DATABASE
- Schema:      (Changed / Unchanged)
- Migration:   (Created / None)
- Backfill:    (Required / None)
- Rollback:    (Yöntem / None)

APPLICATION BEHAVIOR
- (Changed / Unchanged — değiştiyse ne değişti)

TESTS
- Exact command:
- Passed:
- Failed:
- Skipped:
- Duration:

TYPECHECK / LINT / BUILD
- (Çalıştırılan komutlar ve sonuçları)

SECURITY AND TENANCY
- (Güvenlik ve tenant izolasyonu etkisi/değerlendirmesi)

KVKK / PRIVACY
- (KVKK/gizlilik etkisi/değerlendirmesi)

BACKWARD COMPATIBILITY
- (Geriye uyumluluk değerlendirmesi)

ROLLBACK
- (Bu teslim nasıl geri alınır)

OPEN RISKS
- (Açık kalan riskler)

UNVERIFIED CLAIMS
- (Kanıtlanamayan, UNVERIFIED bırakılan iddialar)

TRACKER UPDATES
- (NORAMEDI_MASTER_TRACKER.md / CURRENT_PHASE.md / CHANGELOG.md güncellemeleri)

GIT
- Branch:
- Commit:   (commit atılmadıysa None)
- PR:       (açılmadıysa None)

RECOMMENDED NEXT TASK
- (Görev ID ve başlığı)

FINAL DECLARATION
- (Yalnızca AGENT_COMPLETED beyan edilebilir)
```

## Zorunlu beyan kuralları

- Ajan, FINAL DECLARATION bölümünde yalnızca `AGENT_COMPLETED` beyan edebilir.
- Ajan **asla** `MERGED`, `DEPLOYED` veya `PRODUCTION_VERIFIED` beyan edemez — bu durumlar dış kanıt ve onay gerektirir (bkz. [NORAMEDI_MASTER_TRACKER.md §2.3](NORAMEDI_MASTER_TRACKER.md)).
- Testler çalıştırılmadıysa TESTS bölümüne "not run" ve gerekçesi yazılır; geçtiği iddia edilemez.
