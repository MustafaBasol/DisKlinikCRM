/**
 * lastRoute.vitest.test.ts — UX-001 Wave 2: unified /inbox route addition
 * to the ROUTE_CHECKS table.
 *
 * Pre-existing behavior (record/restore round trip, entry-point exclusion,
 * stale detail-route collapse, permission re-check, user/clinic isolation,
 * malformed storage) is already covered by
 * src/utils/__tests__/lastRoute.test.ts (`npm run test:last-route-helpers`)
 * — this file only adds coverage for the new /inbox entry, not a second
 * copy of that suite.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { recordLastRoute, getValidatedLastRoute } from './lastRoute';

type RouteUser = { role: string; canAccessAllClinics?: boolean };

const OWNER: RouteUser = { role: 'owner', canAccessAllClinics: true };
const RECEPTIONIST: RouteUser = { role: 'receptionist' };
const DENTIST: RouteUser = { role: 'dentist' };
const BILLING: RouteUser = { role: 'billing' };

beforeEach(() => {
  window.localStorage.clear();
});

describe('unified /inbox route (UX-001 Wave 2)', () => {
  it('restores /inbox/whatsapp with its query string for a RECEPTIONIST', () => {
    recordLastRoute('user-1', 'clinic-1', '/inbox/whatsapp', '?filter=open');
    expect(getValidatedLastRoute('user-1', 'clinic-1', RECEPTIONIST)).toBe('/inbox/whatsapp?filter=open');
  });

  it('restores bare /inbox for a role permitted on either channel', () => {
    recordLastRoute('user-1', 'clinic-1', '/inbox', '');
    expect(getValidatedLastRoute('user-1', 'clinic-1', OWNER)).toBe('/inbox');
  });

  it('does not restore /inbox for a role with neither WhatsApp nor Instagram access (DENTIST)', () => {
    recordLastRoute('user-1', 'clinic-1', '/inbox/whatsapp', '');
    expect(getValidatedLastRoute('user-1', 'clinic-1', DENTIST)).toBeNull();
  });

  it('does not restore /inbox for BILLING', () => {
    recordLastRoute('user-1', 'clinic-1', '/inbox/instagram', '');
    expect(getValidatedLastRoute('user-1', 'clinic-1', BILLING)).toBeNull();
  });

  it('legacy /whatsapp-inbox route keeps working independently of /inbox', () => {
    recordLastRoute('user-1', 'clinic-1', '/whatsapp-inbox', '');
    expect(getValidatedLastRoute('user-1', 'clinic-1', RECEPTIONIST)).toBe('/whatsapp-inbox');
    expect(getValidatedLastRoute('user-1', 'clinic-1', DENTIST)).toBeNull();
  });
});
