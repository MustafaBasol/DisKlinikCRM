/**
 * lastRouteRestoreGuard.vitest.test.ts — UX-001 closure audit regression.
 *
 * Reproduces the bug found in the closure audit: DashboardEntry's one-shot
 * last-route restore used to be gated by a plain module-level flag that was
 * only ever set to `true`, never reset. Because login/logout in this app
 * navigate client-side (no full page reload), that silently disabled the
 * restore feature for every login after the first one in a browser tab —
 * e.g. a shared reception-desk machine, or the same user re-logging in
 * after a session timeout.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { consumeLastRouteRestoreAttempt, resetLastRouteRestoreGuard } from './lastRouteRestoreGuard';

beforeEach(() => {
  resetLastRouteRestoreGuard();
});

describe('lastRouteRestoreGuard', () => {
  it('allows exactly one attempt per session', () => {
    expect(consumeLastRouteRestoreAttempt()).toBe(true);
    expect(consumeLastRouteRestoreAttempt()).toBe(false);
    expect(consumeLastRouteRestoreAttempt()).toBe(false);
  });

  it('reproduces the bug: without a reset, a second login in the same tab never gets an attempt', () => {
    // Session 1 (first login in the tab): restore fires once, as intended.
    expect(consumeLastRouteRestoreAttempt()).toBe(true);

    // Session 2 (logout, then a second login in the same tab) without
    // resetting the guard in between — this is the pre-fix behavior.
    expect(consumeLastRouteRestoreAttempt()).toBe(false);
  });

  it('fix: resetting the guard on logout restores the one-shot attempt for the next session', () => {
    // Session 1
    expect(consumeLastRouteRestoreAttempt()).toBe(true);
    expect(consumeLastRouteRestoreAttempt()).toBe(false);

    // Logout boundary — AuthSessionBoundaryWatcher in App.tsx calls this on
    // the isAuthenticated: true -> false transition.
    resetLastRouteRestoreGuard();

    // Session 2 (next login in the same tab) gets its own attempt again.
    expect(consumeLastRouteRestoreAttempt()).toBe(true);
    expect(consumeLastRouteRestoreAttempt()).toBe(false);
  });
});
