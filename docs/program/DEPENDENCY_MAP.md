# DEPENDENCY_MAP — Modüller Arası Bağımlılık İlkeleri ve Matris

Son güncelleme: 2026-07-18 (F0-003 — domain kümesi kesinleşti; matris henüz doldurulmadı)

> Bu doküman **hedef** bağımlılık kurallarını tanımlar. Gerçek (mevcut) bağımlılıklar henüz depo kanıtıyla çıkarılmamıştır; matris **F0-004** tarafından doldurulacaktır.
>
> **F0-003 güncellemesi:** Satır/sütun kümesi artık kesinleşmiştir — bkz. [MODULE_MAP.md](MODULE_MAP.md) (29 domain: 13 Core Platform, 7 Core Clinical, 8 Optional Operational + 1 kanıt-tabanlı ek domain, 4 planned/not-implemented grup). F0-003 ayrıca birkaç gözlem (cross-domain doğrudan erişim örnekleri) kaydetti — bkz. [evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md §4](evidence/F0-003_MODULE_OWNERSHIP_EVIDENCE.md#4-cross-domain-dependency-observations-light--full-matrix-is-f0-004s-deliverable). Aşağıdaki matris hücreleri kasıtlı olarak `UNVERIFIED` bırakılmıştır; tam import/çağrı-kanıtlı doldurma F0-004'ün işidir.

## 1. Bağımlılık ilkeleri

- Bağımlılıklar tek yönlü ve açık olmalıdır; döngüsel bağımlılık hedeflenmez.
- Bir modülün iç yapısı (internal infrastructure, repository katmanı, iç yardımcılar) diğer modüller için **görünmez** kabul edilir.
- Modüller arası iletişim; public contract'lar, domain event'leri veya açık application service sözleşmeleri üzerinden yapılır.
- Core (çekirdek) bileşenlere bağımlılık serbesttir ancak Core'un feature modüllerine bağımlı olması **yasaktır**.

## 2. İzinli bağımlılık yönleri

```
Feature modülü  →  Core public contract'ları        (izinli)
Feature modülü  →  Kendi iç katmanları               (izinli)
Feature modülü  →  Diğer modülün public contract'ı   (izinli, onaylı contract ise)
Feature modülü  →  Domain event / outbox üzerinden yan etki  (tercih edilen)
Core            →  Core                              (izinli, katman kurallarına uygun)
```

## 3. Yasak bağımlılık örnekleri

```
Feature modülü  →  Başka modülün internal servisi/deposu     (YASAK)
Feature modülü  →  Başka modülün Prisma modeline doğrudan sorgu  (YASAK, §6)
Core            →  Herhangi bir feature modülü               (YASAK)
Herhangi modül  →  Tenant/permission/entitlement/audit/privacy/storage kontrolünü atlama  (YASAK)
Frontend        →  Entitlement'ı tek başına uygulama (backend'siz)  (YASAK, §9)
```

## 4. Public contract kuralı

Modüller arası okuma, pratik olduğu her yerde **public query/service contract** üzerinden yapılır. Contract'lar; girdi/çıktı tipleri, tenant bağlamı ve yetki gereksinimleri açıkça tanımlanmış, sürümlenebilir arayüzlerdir. Contract listesi F2'de oluşturulacaktır.

## 5. Event tabanlı entegrasyon kuralı

Modüller arası **yan etkiler** (cross-domain side effects), tutarlılık gereksinimi izin verdiği ölçüde **domain event / transactional outbox** üzerinden yürütülür. Güçlü işlemsel tutarlılık gerektiğinde açık bir **application service contract** kullanılabilir.

## 6. Doğrudan Prisma erişim kuralı

Bir modül, başka bir modülün sahip olduğu Prisma modellerine **doğrudan erişemez**. Veri ihtiyacı public contract veya event ile karşılanır. (Mevcut kodun bu kurala uyumu F0-004'te kanıtla ölçülecektir; bu doküman mevcut uyumu **iddia etmez**.)

## 7. Core bağımlılık uyarısı

Core bileşenleri (tenant güvenliği, permissions, entitlements, audit, storage, events, queue) en yüksek yayılım (blast radius) etkisine sahiptir. Core'da yapılacak her değişiklik; tüm modülleri etkileyebileceğinden ek inceleme, güvenlik değerlendirmesi ve regresyon kapsamı gerektirir.

## 8. Yüksek riskli paylaşılan bileşenler

Aşağıdakiler paylaşıldıkça risk taşır ve F0-004'te özel olarak izlenecektir:

- Tenant scope/clinic doğrulama yardımcıları (ör. `validateAndGetClinicIdScope` benzeri)
- Authentication/authorization middleware'leri
- Audit/activity log altyapısı
- Storage erişim katmanı
- Rate limiter ve job/queue altyapısı
- Şifreleme yardımcıları

## 9. Başlangıç hedef kuralları

1. Feature modülleri, onaylı **Core public contract'larına** bağımlı olabilir.
2. Feature modülleri, başka bir modülün **internal infrastructure**'ını import edemez.
3. Cross-domain okumalar, pratik olduğu yerde **public query/service contract** kullanır.
4. Cross-domain yan etkiler, tutarlılık izin verdiğinde **domain event/outbox** kullanır.
5. Güçlü işlemsel tutarlılık, açık bir **application service contract** ile sağlanabilir.
6. Hiçbir modül; **tenant, permission, entitlement, audit, privacy veya storage** kontrollerini atlayamaz.
7. Entitlement'lar yalnızca frontend'de değil; **backend/service/job katmanlarında** uygulanmalıdır.
8. Devre dışı bırakılmış bir modülün **worker'ları ve zamanlanmış job'ları çalışmaya devam edemez**.

## 10. Bağımlılık matrisi (placeholder — F0-004 dolduracak)

Satır = bağımlı olan modül, sütun = bağımlı olunan modül. Değerler: `C` (public contract), `E` (event/outbox), `S` (application service), `X` (ihlal — internal erişim), boş = bağımlılık yok.

| Bağımlı ↓ / Bağımlanılan → | Core Platform | Patients | Appointments | Treatment Cases | Payments | Messaging | Imaging | ... |
|---|---|---|---|---|---|---|---|---|
| Patients | `UNVERIFIED` | — | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | |
| Appointments | `UNVERIFIED` | `UNVERIFIED` | — | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | |
| Treatment Cases | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | — | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | |
| Payments | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | — | `UNVERIFIED` | `UNVERIFIED` | |
| Messaging | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | — | `UNVERIFIED` | |
| Imaging | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | — | |

> Matrisin satır/sütun kümesi, F0-003 modül haritası doğrulandıktan sonra kesinleşecek; F0-004 her hücreyi **import/çağrı kanıtı (dosya:satır)** ile dolduracaktır.
