/*
 * theme-init.js — F3-DATA-MIG-TODAY-001-R12.
 *
 * Applies the stored (or system) colour scheme to <html> BEFORE React renders,
 * so the app never paints a light frame and then flips to dark.
 *
 * WHY IT IS A FILE AND NOT AN INLINE <script>. It used to be inline in
 * index.html, which every Content-Security-Policy without `unsafe-inline`
 * blocks — and the production CSP does, so this is one of the two console
 * violations the Platform Admin sees on the migration screens. The fix is to
 * make the script an ordinary same-origin asset that `script-src 'self'`
 * already allows, NOT to widen the policy: `unsafe-inline` would re-enable
 * every injected inline script in the product to remove one console line.
 *
 * IT MUST STAY A CLASSIC, NON-DEFERRED SCRIPT IN <head>. `type="module"` and
 * `defer` both postpone execution until after the document is parsed, which is
 * after the first paint — the flash this file exists to prevent. It is served
 * from /public, so Vite copies it to the build output untouched and it is NOT
 * bundled or hashed; the <head> reference is a stable absolute path.
 *
 * No dependencies, no exports, no globals: an IIFE that touches exactly one
 * class on one element.
 */
(function () {
  try {
    var stored = localStorage.getItem('theme');
    if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch (err) {
    /*
     * localStorage throws in a privacy-restricted context (Safari private mode,
     * a blocked third-party frame). The theme is a preference, not a
     * correctness concern: fall through to the default light frame rather than
     * letting an unhandled error in <head> abort parsing.
     */
  }
})();
