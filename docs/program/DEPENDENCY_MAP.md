# DEPENDENCY_MAP — Modüller Arası Bağımlılık İlkeleri ve Matris

Son güncelleme: 2026-07-18 (F0-004 — matris depo-kanıtıyla dolduruldu)

> Bu dokümanın §1–§9'u **hedef** bağımlılık kurallarını tanımlar (aşağıda değişmeden korunmuştur). §10, F0-004 tarafından depo-kanıtıyla (import/çağrı/veri-erişimi kanıtı, dosya:satır) doldurulmuş **mevcut durum** matrisidir.
>
> **F0-004 güncellemesi:** Satır/sütun kümesi F0-003'ün kesinleştirdiği 37 domain'dir (bkz. [MODULE_MAP.md](MODULE_MAP.md) ve [evidence/F0-003_module_ownership_inventory.json](evidence/F0-003_module_ownership_inventory.json)). Matris artık depo-doğrulanmış — her dolu hücre en az bir kanıt kaydına (`F0004-Exxxx` edge ID) bağlıdır. Detaylı kanıt, döngü analizi, fan-in/fan-out, raw-SQL sınıflandırması ve contract adayları için bkz. [evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md](evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md); yapısal/makine-okunur tam envanter için bkz. [evidence/F0-004_dependency_inventory.json](evidence/F0-004_dependency_inventory.json).
>
> **Önemli sınırlama:** Bu matris **mevcut** (current-state) bağımlılıkları belgeler. Hiçbir modül sınırı bugün derleme/lint zamanında zorlanmamaktadır; `X` işaretli hücreler dahil hiçbir hücre "izinli" anlamına gelmez — yalnızca §1–§9'daki hedef kurallara göre sınıflandırılmış gözlemlenen gerçekliktir.
>
> **F0-007 ek notu (additive, matris yeniden üretilmedi):** PRV/WHA/SMS/REC satırlarına ilişkin hücreler, KVKK-HIGH-007 devam çalışması (aktif, commit edilmemiş) tarafından değiştirilmekte olan davranışı temsil eder — bu matris hâlâ F0-004'ün orijinal kanıt-tabanlı anlık görüntüsüdür (commit `368bcc8`/`5ee0b6a` civarı) ve devam çalışmasının etkisini **yansıtmaz**. Özellikle: `WHA`→`PAT`/`APT` altındaki 9 `X` (high-risk boundary violation) hücresi ile yeni `whatsappCommunicationPurposeMap.ts` arasındaki ilişki henüz kanıtlanmadı/gözden geçirilmedi. Devam çalışması merge edildiğinde bu matrisin ilgili hücrelerinin bir sonraki F0-004-tarzı artımlı güncellemede yeniden doğrulanması gerekir — bkz. [KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §2 ve [evidence/F0-007_KVKK_BASELINE_EVIDENCE.md](evidence/F0-007_KVKK_BASELINE_EVIDENCE.md) §6.

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

## 10. Bağımlılık matrisi (F0-004 — depo-kanıtıyla dolduruldu)

Satır = bağımlı olan domain (kaynak), sütun = bağımlı olunan domain (hedef). Kod açıklamaları için §10.1'deki legend'e bakın.

**Legend:**

- `—` kanıtlanmış bağımlılık yok (bu, aramanın yapılmadığı anlamına gelmez — bkz. evidence doc §2 metodoloji/coverage)
- `P` accepted platform dependency (tenant scope, identity, permissions, audit, config/secrets, observability, shared events/queue, storage, notifications, veya kök tenant varlıkları Clinic/Organization/User'a salt-okunur erişim)
- `R` direct read (bir başka domain'in Prisma modeline doğrudan okuma)
- `W` direct write (bir başka domain'in Prisma modeline doğrudan create/update/upsert/delete)
- `S` service call / import (bir başka domain'in route/service/util dosyasının import edilmesi)
- `X` high-risk boundary violation (bkz. evidence doc §3 — 9 adet, hepsi Messaging→Patients/Appointments doğrudan yazma)
- Bir hücre birden fazla sembol içerebilir (ör. `R/W/X`).

Her dolu hücre, [evidence/F0-004_dependency_inventory.json](evidence/F0-004_dependency_inventory.json) `edges[]` dizisinde en az bir `F0004-Exxxx` kaydına karşılık gelir (833 edge toplamı; 264'ü tek tek incelendi, kalan 569'u belgelenmiş kural-tabanlı varsayılan sınıflandırma kullanır — bkz. evidence doc §2).

### 10.1 Domain kod legend'i

| Code | Domain | Code | Domain |
|---|---|---|---|
| IDA | Identity and Access | WHA | Messaging — WhatsApp |
| ORG | Organization / Clinic / User Membership | IGM | Messaging — Instagram |
| TSC | Tenant Security and Scope | SMS | Messaging — SMS |
| PRM | Permissions / Roles | EML | Messaging — Email |
| AUD | Audit and Activity | AIO | Messaging AI Orchestration |
| PRV | Privacy / Consent / Retention / DSR | REC | Automations / Reminders / Follow-up / Recall |
| SEC | Security Incident Response and Detection | IMG | Imaging — Server Ingest and Viewer |
| CFG | Configuration and Secrets | BRG | Imaging — Device Bridge / Windows Bridge |
| OBS | Observability / Operational Events | INV | Inventory |
| EVQ | Shared Events / Queue Contracts / Idempotency | INS | Insurance |
| STG | Storage Abstraction | FIN | Advanced Finance — Compensation and Payouts |
| NTF | Notifications | RPT | Reporting / Analytics |
| PAD | Platform Administration | LAB | Dental Laboratory / Prosthetics Tracking |
| PAT | Patients | PAI | AI Platform / AI Gateway (planned, not implemented) |
| APT | Appointments and Availability | PIG | Integration Platform / Official Adapters (planned, not implemented) |
| TRC | Treatment Cases | PBL | Billing / Subscription Engine (planned, not implemented) |
| DEN | Dental Chart / Procedures | PCM | Campaign / Health Tourism / Invoicing (planned, not implemented) |
| PUB | Public Booking | | |
| PAY | Basic Payments | | |
| TSK | Tasks and Follow-up | | |

### 10.2 Matris

| Bağımlı ↓ / Bağımlanılan → | IDA | ORG | TSC | PRM | AUD | PRV | SEC | CFG | OBS | EVQ | STG | NTF | PAD | PAT | APT | TRC | DEN | PUB | PAY | TSK | WHA | IGM | SMS | EML | AIO | REC | IMG | BRG | INV | INS | FIN | RPT | LAB | PAI | PIG | PBL | PCM |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| IDA | — | P/R | — | P/S | P/S | — | S | P/S | — | — | — | — | S | — | — | — | — | — | — | — | — | — | — | S | — | — | — | — | — | — | — | — | — | — | — | — | — |
| ORG | P/S/R/W | — | P/S | P/S | P/S | — | — | P/R/W | — | — | — | — | — | R | R/W | — | — | — | — | — | — | — | — | S | — | — | — | — | — | — | — | — | — | — | — | — | — |
| TSC | P/S/R | P/R | — | P/S | — | — | P/S | — | — | — | — | — | — | P/R | P/R | P/R | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| PRM | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| AUD | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| PRV | P/S/R | P/R | P/S | — | P/S/R/W | — | — | P/S | P/R/W | P/S/R/W | P/S | — | — | R/W/S | R/W | R | R | — | R | R | R/W | R/W | — | — | — | — | R/W | — | R | R | — | — | — | — | — | — | — |
| SEC | P/S | — | — | — | — | — | — | — | — | — | — | — | S | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| CFG | P/S | — | P/S | — | P/S | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| OBS | P/S | — | — | P/S | P/R | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | R | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| EVQ | — | — | — | — | — | S | — | — | — | — | — | — | — | — | — | — | — | — | — | — | S/R | — | — | — | — | S | — | S | — | — | — | — | — | — | — | — | — |
| STG | — | — | — | — | — | R | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| NTF | P/S/R | P/S | P/S | — | — | — | — | P/R/W | — | — | — | — | — | — | R | — | — | — | — | R | S | — | — | — | — | — | — | — | — | — | — | — | S/R | — | — | — | — |
| PAD | P/S/R/W | R/W | — | — | — | S | S | P/S | — | — | — | — | — | R | R | — | — | — | — | — | R | — | S/W | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| PAT | P/S | P/S/R | P/S | — | P/S/W | — | — | — | — | — | P/S | — | — | — | R | R | R | — | — | — | R | R | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| APT | P/S/R | P/R/S/W | P/S | P/S | P/S | — | — | — | — | — | — | P/S | — | R/W | — | W | — | — | — | W | W/S | R | — | — | — | S | — | — | R/W | — | — | — | — | — | — | — | — |
| TRC | P/S | P/S | P/S | — | P/S | — | — | — | — | — | — | P/W | — | — | R | — | W | — | — | — | — | — | — | — | — | — | — | — | R/W | — | S | — | — | — | — | — | — |
| DEN | P/S | — | P/S | — | P/W/S | — | — | — | — | — | — | — | — | R | R | R | — | — | — | — | — | — | — | — | — | S | — | — | — | — | — | — | — | — | — | — | — |
| PUB | P/R | P/S/R | — | — | — | — | — | — | — | — | — | — | — | R | R/W | — | — | — | — | — | — | — | — | — | S | — | — | — | — | — | — | — | — | — | — | — | — |
| PAY | P/S | P/S | P/S | — | P/S | — | — | — | — | — | — | — | — | R | — | R | — | — | — | — | — | — | — | — | — | — | — | — | — | — | S | — | — | — | — | — | — |
| TSK | P/S | — | P/S | — | P/S | — | — | — | — | — | — | P/S | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| WHA | P/S/R | P/R | P/S | P/S | P/S | R/S | — | P/S/R | P/S | P/S | — | — | — | S/R/W/X | R/S/W/X | — | — | — | — | — | — | — | — | — | S | — | — | — | — | — | — | — | — | — | — | — | — |
| IGM | P/S/R | P/R | P/S | P/S | P/S | — | — | P/S | P/S | — | — | — | — | R/W/X | W/R/S | — | — | — | — | — | S/W/R | — | — | — | S | — | — | — | — | — | — | — | — | — | — | — | — |
| SMS | P/S | P/R/S | P/S | — | P/S | — | — | P/S | P/S | — | — | — | R | R | R | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| EML | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| AIO | P/R | P/R | — | — | — | — | — | — | — | — | — | — | — | — | R | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| REC | P/R/S | P/S/R | P/S | — | P/S | — | — | P/R/W | — | P/S | — | P/S | — | R | R | R | — | — | R | W | S/R/W | S/R | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| IMG | P/S | — | P/S | — | P/S | — | — | — | — | — | P/S | — | — | R | — | — | — | — | — | — | — | — | — | — | — | — | — | S/R/W | — | — | — | — | — | — | — | — | — |
| BRG | — | P/R | — | — | P/S | — | — | P/S | — | P/S | P/S | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | S/R/W | — | — | — | — | — | — | — | — | — | — |
| INV | P/S | — | P/S | — | P/S | — | — | — | — | — | — | — | — | — | — | R/W | R/W | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| INS | P/S | P/S | P/S | — | P/S | — | — | — | — | — | — | — | — | R | — | R | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| FIN | P/S/R | P/R | P/S | P/S | P/S | — | — | — | — | — | — | — | — | — | R | R | — | — | S/R | — | — | — | — | — | — | — | — | — | — | — | — | S | — | — | — | — | — |
| RPT | P/S/R | P/S/R | P/S | P/S | P/R | — | — | — | — | — | — | — | — | R | S/R | R | — | — | S/R | R | R | — | — | — | — | — | — | — | — | — | R | — | — | — | — | — | — |
| LAB | P/S | — | P/S | — | P/S | — | — | — | — | — | P/S | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| PAI | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| PIG | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| PBL | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| PCM | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |

> `PAI`/`PIG`/`PBL`/`PCM` (planned/not-implemented domains) satır ve sütunlarının tamamen boş olması F0-003'ün "confirmed absent, not merely unverified" bulgusuyla tutarlıdır (bkz. [MODULE_MAP.md § Planned / Not Implemented](MODULE_MAP.md#planned--not-implemented)).

### 10.3 En önemli bulgular (özet — tam detay için evidence doc)

- **9 `X` (HIGH_RISK_BOUNDARY_VIOLATION) edge**, tamamı `WHA`/`IGM` → `PAT`/`APT` hücrelerinde: WhatsApp/Instagram AI akışları doğrudan `Patient.create/update` yazıyor (task talimatının verdiği örnekle birebir örtüşüyor); ayrıca `routes/whatsappInbox.ts`/`routes/whatsapp.ts` doğrudan `Appointment.create/update` yapıyor ve bunu yaparken aynı domain'in başka yerlerinde (publicBooking.ts, appointmentRequestSafety.ts) kullanılan `pg_advisory_xact_lock` eşzamanlılık korumasını kullanmıyor.
- **En yüksek fan-out:** `WHA` (106 edge), `PRV` (97), `RPT` (67), `PAD` (64), `REC` (62) — "god module" imzası, F0-003'ün `whatsapp.ts` (3999 satır) hotspot bulgusuyla tutarlı.
- **En yüksek fan-in:** `ORG` (128), `APT` (116), `IDA` (114), `AUD` (68) — beklenen kök-tenant/platform merkezleri.
- **35 iki-domain döngüsü** tespit edildi (bkz. evidence doc §5); 5'i tek tek incelendi (en önemlisi: `PRV↔WHA` — Privacy'nin KVKK anonimleştirme akışı WhatsApp tablolarına doğrudan yazarken, WhatsApp Privacy'nin consent-gate servisini çağırıyor).
- **16/16 raw-SQL konumu** F0-003 sayımıyla mutabık; 1 tanesi (`patientAnonymization.ts`) cross-domain yazma içeriyor (parametreli, injection-güvenli, ama contract sınırını atlıyor).
- **F0-003 düzeltme adayları (3):** `organizationDashboard.ts`, `encryption.ts`/`secrets.ts`, `treatmentStockDeduction.ts` F0-003'ün committed envanterinde iki domain altında birden listelenmiş — bkz. evidence doc §2.2. Taksonomi sessizce değiştirilmedi; yalnızca F0-004'ün kanıt-çakışması netleştirmek için tek bir kanonik sahip seçmesi gerekti.

Tam kanıt, döngü nedenleri, contract adayları ve raw-SQL detayı için: [evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md](evidence/F0-004_CROSS_MODULE_DEPENDENCY_EVIDENCE.md).
