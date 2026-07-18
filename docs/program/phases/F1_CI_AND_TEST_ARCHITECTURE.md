# F1 — CI and Test Architecture

Faz durumu: `TODO` · Son güncelleme: 2026-07-17 (F0-001)

## Objective (Hedef)

Etki-bazlı (affected) test seçimi, katmanlı CI modeli (PR / main / nightly / release) ve güvenilir test altyapısını kurmak; hedef mimari [../TEST_OWNERSHIP.md](../TEST_OWNERSHIP.md) dokümanında tanımlıdır.

## Business reason (İş gerekçesi)

Modüler geliştirme hızının ön koşulu, hızlı ve güvenilir geri bildirim döngüsüdür. Tam suite'e bağımlı yavaş CI; küçük PR politikasını, sık merge'i ve güvenli mimari değişimi engeller.

## Entry conditions (Giriş koşulları)

- G0 onayı (F0 çıkışı)
- F0-005 test envanteri tamamlanmış

## Exit gate (Çıkış kapısı)

- Etki-bazlı CI modeli **kanıtla** çalışıyor (PR'da yalnızca etkilenen kapsam + zorunlu core testleri)
- Nightly tam regresyon kurulu ve istikrarlı
- Flaky test envanteri kapatılmış veya karantinada

## Dependencies (Bağımlılıklar)

- F0 (özellikle F0-005)

## Allowed work (İzinli işler)

- CI workflow tasarımı ve kurulumu (bu fazda CI dosyaları değiştirilebilir — F0'daki yasak bu fazda kalkar, dış onayla)
- Test altyapı iyileştirmeleri (disposable Postgres, izolasyon, hız)
- Test sahiplik etiketleme ve tetikleyici path haritası

## Prohibited work (Yasak işler)

- Uygulama davranış değişiklikleri (test edilebilirlik için zorunlu, onaylı DI seam'leri hariç)
- KVKK dondurma sınırındaki işler (taban çizgisi teyit edilmediyse)

## Initial task backlog (Yüksek seviyeli kategoriler)

> Ayrıntılı görev ID'leri, F0 kanıtları incelendikten sonra atanacaktır.

- Etki-bazlı test seçim mekanizması tasarımı ve kurulumu
- PR / main / nightly / release CI katmanlarının kurulumu
- Test veritabanı stratejisi (disposable Postgres standardı)
- Flaky test tespiti ve karantina süreci
- Migration test katmanı
- Core güvenlik/tenancy regresyon paketinin zorunlu hale getirilmesi
- CI süre/maliyet ölçüm panosu

## Required evidence (Gerekli kanıt)

- CI çalıştırma kayıtları (PR'da etkilenen-kapsam kanıtı, nightly tam kapsam kanıtı)
- Süre ölçümleri (öncesi/sonrası)

## Required tests (Gerekli testler)

- CI modelinin kendisinin doğrulanması: bilinçli değişikliklerle tetikleme testleri

## Security requirements (Güvenlik gereksinimleri)

- CI secret yönetimi; log'lara secret sızmaması

## Tenant requirements (Tenant gereksinimleri)

- Tenant izolasyon regresyonunun her PR'da zorunlu koşması

## KVKK/privacy requirements (KVKK/gizlilik gereksinimleri)

- Test verilerinde gerçek hasta verisi kullanılamaz

## Rollback expectations (Geri alma beklentileri)

- CI değişiklikleri workflow dosyası revert'iyle geri alınabilir olmalı

## Risks (Riskler)

- R-024 (migration hatası), R-027 (branch sapması), R-028 (yanlış tamamlandı beyanı)

## Open questions (Açık sorular)

- Etki-bazlı seçim mekanizmasının aracı (yol-bazlı mı, graph-bazlı mı) — F0-005 verisiyle kararlaştırılacak

## Change history (Değişiklik geçmişi)

| Tarih | Görev | Değişiklik |
|---|---|---|
| 2026-07-17 | F0-001 | Faz dokümanı oluşturuldu (yüksek seviyeli). |
