import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// jsdom does not implement ResizeObserver at all, and does not compute real
// layout (scrollWidth/clientWidth are always 0 unless a test stubs them
// explicitly) — see PatientDetailTabs.vitest.test.tsx for how each test
// simulates a specific overflow/no-overflow scenario. This global stub only
// prevents "ResizeObserver is not defined" from crashing every test that
// merely mounts the component; it does not simulate real observation.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

if (typeof (globalThis as any).crypto === 'undefined' || typeof (globalThis as any).crypto.randomUUID !== 'function') {
  const nodeCrypto = await import('node:crypto');
  (globalThis as any).crypto = { ...(globalThis as any).crypto, randomUUID: () => nodeCrypto.randomUUID() };
}

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof Element.prototype.scrollBy !== 'function') {
  (Element.prototype as any).scrollBy = () => {};
}
