import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Separate from vite.config.ts on purpose — the app's build config
// (manualChunks, dev proxy) has nothing to do with running component tests,
// and keeping them apart means neither can accidentally destabilize the
// other. Component-level tests only (KVKK-HIGH-008) — the repo's existing
// hand-rolled `tsx` pure-logic tests (npm run test:*) are untouched and keep
// running exactly as before; this config/runner is additive.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.vitest.test.{ts,tsx}'],
  },
});
