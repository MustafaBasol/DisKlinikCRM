# Dental Clinic CRM Landing Page Pack

Bu paket, diş klinik CRM ürünün için Antigravity/Codex/AI agent ile geliştirilecek landing page çalışmasına başlangıç dosyaları içerir.

## Dosyalar

- `docs/landing-page-strategy.md` — Sayfa stratejisi, bölümler, mesajlaşma ve dönüşüm hedefleri
- `docs/antigravity-setup.md` — Antigravity çalışma biçimi, agent kuralları ve uygulanacak adımlar
- `prompts/01-build-landing-page.md` — Antigravity’ye verilecek ana geliştirme promptu
- `prompts/02-open-design-usage.md` — open-design reposunu referans olarak kullanma promptu
- `design/design-tokens.css` — Önerilen renk, tipografi, spacing ve component tokenları
- `copy/landing-page-copy-tr.md` — Türkçe landing page metin taslağı
- `implementation/component-map.md` — Next.js/Tailwind component yapısı önerisi
- `implementation/acceptance-checklist.md` — Teslim kontrol listesi

## Önerilen kullanım

1. Bu paketi mevcut CRM reposunun içine `docs/landing-page/` veya `landing-brief/` klasörü olarak kopyala.
2. Antigravity’ye önce `docs/antigravity-setup.md` ve `prompts/01-build-landing-page.md` dosyalarını okut.
3. Eğer görsel kaliteyi artırmak istersen `prompts/02-open-design-usage.md` dosyasını ayrıca okut.
4. Landing page’i mümkünse izole bir route olarak başlat: `/`, `/landing`, `/tr`, veya `/dental-crm`.
5. Mevcut app’e merge etmeden önce `implementation/acceptance-checklist.md` ile kontrol et.
