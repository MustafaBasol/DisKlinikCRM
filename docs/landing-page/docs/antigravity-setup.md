# Antigravity Yapılandırma Rehberi

## Çalışma yaklaşımı

Antigravity’ye görevi tek cümleyle “landing page yap” diye vermek yerine, onu bir frontend/product designer gibi yapılandır. Agent önce mevcut repo yapısını incelemeli, sonra izole bir landing page route’u ve component seti oluşturmalı.

## Agent’a verilecek rol

Sen deneyimli bir Senior Frontend Engineer + Product Designer gibi çalışacaksın. Hedefin, diş klinikleri için geliştirilen CRM/SaaS ürününe modern, güven veren, satış odaklı, responsive bir landing page oluşturmaktır.

## Çalışma kuralları

1. Mevcut çalışan uygulamayı bozma.
2. Global CSS, layout ve theme dosyalarında gereksiz değişiklik yapma.
3. Landing page componentlerini izole tut.
4. Önce repo yapısını incele.
5. Kullanılan framework, routing yapısı, Tailwind config ve component kütüphanesini tespit et.
6. Mevcut tasarım sistemine uyumlu kal; yoksa bu paketteki design tokenları kullan.
7. Landing page’i responsive yap.
8. Desktop, tablet ve mobile düzenlerini kontrol et.
9. TypeScript hatası bırakma.
10. Build/lint/test komutlarını çalıştır ve sonucu raporla.
11. Yeni route ve componentleri net şekilde listele.
12. Dummy veri kullanıyorsan tek bir dosyada tut.
13. CTA formları için ileride API bağlanabilecek temiz yapı bırak.

## Önerilen dosya yapısı

Next.js App Router varsayımıyla:

```txt
src/
  app/
    (marketing)/
      page.tsx
  components/
    landing/
      LandingPage.tsx
      HeroSection.tsx
      ProblemSection.tsx
      FeatureGrid.tsx
      MultiClinicSection.tsx
      WorkflowSection.tsx
      DashboardMockup.tsx
      DemoCtaSection.tsx
      FaqSection.tsx
      LandingHeader.tsx
      LandingFooter.tsx
  data/
    landing.ts
```

Eğer mevcut projede farklı yapı varsa agent bunu adapte etmeli.

## Antigravity’de önerilen işlem sırası

1. Repo analizi
2. Mevcut UI stack tespiti
3. Landing page route planı
4. Component listesi
5. Copy ve design token uyarlaması
6. İlk implementasyon
7. Responsive düzenleme
8. Build/lint kontrolü
9. Son rapor

## Açık kaynak open-design repo kullanımı

`nexu-io/open-design` doğrudan projeye dependency olarak eklenmemeli. Referans olarak kullanılmalı:
- Design systems mantığı
- Landing page layout fikirleri
- SaaS arayüz mockup yaklaşımı
- Component hierarchy
- Visual polish
- Export/prototyping workflow

Ana ürün reposuna gereksiz paket, CLI veya deneysel yapı eklenmemeli.

## Agent’ın kaçınması gerekenler

- Tüm siteyi yeniden tasarlamak
- Auth/dashboard layoutlarını değiştirmek
- Prisma/backend dosyalarına dokunmak
- Rastgele paket yüklemek
- `any` ile TypeScript hatalarını gizlemek
- Sabit renkleri her yerde inline kullanmak
- Tüm metni tek component içine gömmek
- Klinik verisi varmış gibi sahte müşteri iddiası yazmak

## Başarı kriteri

Landing page şu sonucu vermeli:

- İlk ekranda ürünün diş klinikleri için CRM olduğu anlaşılır
- Çoklu klinik yönetimi net şekilde vurgulanır
- CTA görünürdür
- Tasarım modern B2B SaaS kalitesindedir
- Mevcut uygulamaya zarar vermeden merge edilebilir
