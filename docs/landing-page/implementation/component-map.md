# Component Map

## LandingPage

Ana wrapper component. Tüm sectionları sırayla çağırır.

```tsx
export function LandingPage() {
  return (
    <main>
      <LandingHeader />
      <HeroSection />
      <ProblemSection />
      <FeatureGrid />
      <MultiClinicSection />
      <WorkflowSection />
      <TrustSection />
      <DemoCtaSection />
      <FaqSection />
      <LandingFooter />
    </main>
  )
}
```

## LandingHeader

- Sticky veya normal header
- Logo/product adı
- Anchor nav
- CTA button

## HeroSection

- Sol tarafta başlık/metin/CTA
- Sağ tarafta DashboardMockup
- Mobilde mockup başlığın altına iner

## DashboardMockup

Gerçek veri gibi görünen ama dummy olan dashboard UI.

Önerilen kartlar:
- Bugünkü Randevular: 42
- Yeni Hastalar: 12
- Tahsilat: ₺86.400
- No-show: %7.8
- Klinik karşılaştırması: 3 şube

## ProblemSection

- 3–5 problem kartı
- Kısa, net metinler

## FeatureGrid

- 6 özellik kartı
- Her kart: ikon, başlık, açıklama

## MultiClinicSection

Bu bölüm landing page’in farklılaşma noktası.

İçerik:
- Sol: metin ve madde listesi
- Sağ: 3 klinik karşılaştırma mockup’ı

Örnek klinikler:
- Merkez Klinik
- Ataşehir Şube
- Bakırköy Şube

Örnek metrikler:
- Randevu
- Yeni hasta
- Tahsilat
- No-show
- Doluluk

## WorkflowSection

3 adımlı süreç.

## TrustSection

KVKK/GDPR ifadesinde dikkatli ol:
“uyumludur” demek yerine “uyum süreçlerine göre yapılandırılabilir” de.

## DemoCtaSection

- CTA panel
- Opsiyonel form mockup
- İleride API’ye bağlanabilir yapı

## FaqSection

Accordion varsa mevcut UI componentini kullan. Yoksa basit semantic details/summary kullanılabilir.

## LandingFooter

Minimal footer.
