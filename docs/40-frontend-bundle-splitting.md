# Frontend Bundle Splitting

Status: implemented and verified on 2026-06-03.

## Goal

Reduce Vite's large chunk warning and improve first-load performance by moving
route screens and heavy libraries out of the initial application bundle.

## Changes

- Converted route page/layout imports in `src/App.tsx` to `React.lazy`.
- Added route-level `Suspense` fallback for page transitions.
- Changed global search to load only when opened.
- Added Vite manual chunk rules:
  - `charts`
  - `calendar`
  - `i18n`
  - `vendor`

## Verification

- Frontend production build: passed.
- Vite large chunk warning: resolved.
- Manual chunk circular dependency warning: resolved after keeping React inside
  the general vendor chunk.
- Rendered browser smoke test: not run in this Codex session because starting a
  local dev server and connecting the in-app browser were blocked by the
  current sandbox permissions.

Build comparison:

- Before: single main app JS around `2,177.65 kB` raw / `567.50 kB` gzip.
- After: initial app JS `448.48 kB` raw / `144.09 kB` gzip.
- Large deferred chunks now load on demand:
  - `vendor`: `414.56 kB` raw / `133.06 kB` gzip
  - `charts`: `249.05 kB` raw / `64.73 kB` gzip
  - `calendar`: `242.42 kB` raw / `69.10 kB` gzip
  - individual route chunks: mostly small page-level bundles.

## Notes

- This is a performance optimization, not a security fix.
- The goal is not to hide the warning by raising `chunkSizeWarningLimit`; the
  goal is to reduce initial JavaScript by splitting rarely used screens and
  heavy vendor libraries.
- Backend tests were not rerun because this change only touches frontend
  bundling and route loading.
