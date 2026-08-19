/**
 * GlobalSearch.vitest.test.tsx — UX-001 Ctrl+K palette: grouped Pages/Actions
 * sections must be gated by the same permission functions MainLayout uses,
 * and arrow-key navigation must move through all groups as one continuous
 * list. Hard security requirement: BILLING must never see a clinical-workflow
 * shortcut (New Patient / New Appointment) through the command palette.
 *
 * UX-001 R1: entity search (patients/appointments/treatment cases) must be
 * permission-aware at the *request* level, not just the rendered-result
 * level — an unauthorized role must never call the underlying service.
 *
 * UX-001-PROD-SMOKE-R2: three production smoke findings.
 *  1. BILLING must be able to find an existing patient through the existing
 *     finance-safe /patients contract (patientListSelect — identity/contact
 *     only, no clinical fields), routed to /payments?patientId=, never to
 *     the clinical /patients/:id detail route.
 *  2. (root cause is backend — see server/src/tests/treatmentCaseSearchScope.test.ts
 *     for the DENTIST-unrelated-result regression coverage.)
 *  3. Ctrl+K must close and clear itself immediately when auth transitions
 *     authenticated -> unauthenticated, and an in-flight entity search from
 *     the ended session must never populate results afterward.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import GlobalSearch from './GlobalSearch';
import { patientService, appointmentService, treatmentCaseService } from '../services/api';

const mockT = (key: string, opts?: any) => {
  if (opts && typeof opts === 'object' && 'query' in opts) {
    return `${key} ${opts.query}`;
  }
  return key;
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

let mockUser: { role: string; canAccessAllClinics?: boolean } | null = null;
let mockIsAuthenticated = true;
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, isAuthenticated: mockIsAuthenticated }),
}));

vi.mock('../context/ClinicPreferencesContext', () => ({
  useClinicPreferences: () => ({ formatDate: (d: string) => d }),
}));

vi.mock('../services/api', () => ({
  patientService: { getAll: vi.fn(() => Promise.resolve({ data: [] })) },
  appointmentService: { getAll: vi.fn(() => Promise.resolve({ data: [] })) },
  treatmentCaseService: { getAll: vi.fn(() => Promise.resolve({ data: [] })) },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const noop = () => {};

beforeEach(() => {
  mockNavigate.mockClear();
  mockUser = null;
  mockIsAuthenticated = true;
  (patientService.getAll as any).mockReset().mockImplementation(() => Promise.resolve({ data: [] }));
  (appointmentService.getAll as any).mockReset().mockImplementation(() => Promise.resolve({ data: [] }));
  (treatmentCaseService.getAll as any).mockReset().mockImplementation(() => Promise.resolve({ data: [] }));
});

describe('GlobalSearch', () => {
  it('a BILLING user does not see New Patient or New Appointment actions', () => {
    mockUser = { role: 'billing', canAccessAllClinics: false };
    render(<GlobalSearch isOpen onClose={noop} />);

    expect(screen.queryByText('globalSearch.actions.newPatient')).toBeNull();
    expect(screen.queryByText('globalSearch.actions.newAppointment')).toBeNull();
  });

  it('a BILLING user does see Open Finance (permitted) but no Patients/Appointments pages', () => {
    mockUser = { role: 'billing', canAccessAllClinics: false };
    render(<GlobalSearch isOpen onClose={noop} />);

    expect(screen.getByText('globalSearch.actions.openFinance')).toBeTruthy();
    expect(screen.queryByText('patients')).toBeNull();
    expect(screen.queryByText('appointments')).toBeNull();
  });

  it('a RECEPTIONIST sees New Patient, New Appointment and permitted page destinations, but not Reports', () => {
    mockUser = { role: 'receptionist', canAccessAllClinics: false };
    render(<GlobalSearch isOpen onClose={noop} />);

    expect(screen.getByText('globalSearch.actions.newPatient')).toBeTruthy();
    expect(screen.getByText('globalSearch.actions.newAppointment')).toBeTruthy();
    expect(screen.getByText('patients')).toBeTruthy();
    expect(screen.getByText('appointments')).toBeTruthy();
    // canViewReports excludes RECEPTIONIST (OWNER/ORG_ADMIN/CLINIC_MANAGER/BILLING only)
    expect(screen.queryByText('reports')).toBeNull();
  });

  it('moves the active selection across group boundaries without resetting to index 0', () => {
    mockUser = { role: 'owner', canAccessAllClinics: true };
    render(<GlobalSearch isOpen onClose={noop} />);

    const input = screen.getByPlaceholderText('globalSearch.placeholder');

    // Default (empty-query) list starts with the Pages group. Arrow down enough
    // times to cross into the Actions group, then confirm one more ArrowDown
    // moves forward (not back to the first Pages row) by checking the newly
    // highlighted row via Enter -> navigate target.
    const pagesButtons = screen.getAllByRole('option').filter((b) =>
      b.textContent?.includes('dashboard') || b.textContent?.includes('patients'),
    );
    expect(pagesButtons.length).toBeGreaterThan(0);

    // Press ArrowDown repeatedly past the Pages group into Actions.
    for (let i = 0; i < 8; i += 1) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    }
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    // The selected target should be one of the known action/page routes, and
    // specifically NOT the very first Pages item (/dashboard), proving the
    // highlighted index advanced past the group boundary instead of resetting.
    const navigatedTo = mockNavigate.mock.calls[0][0];
    expect(navigatedTo).not.toBe('/dashboard');
  });

  it('Escape closes the palette', () => {
    mockUser = { role: 'owner', canAccessAllClinics: true };
    const onClose = vi.fn();
    render(<GlobalSearch isOpen onClose={onClose} />);

    const input = screen.getByPlaceholderText('globalSearch.placeholder');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('permission-aware entity search requests', () => {
    it('BILLING: does not call appointment or treatment-case search APIs for a 2+ char query (finding 1 regression guard)', async () => {
      mockUser = { role: 'billing', canAccessAllClinics: false };
      render(<GlobalSearch isOpen onClose={noop} />);
      // Permitted Actions (e.g. Open Finance) are reachable on open, before
      // any query narrows the Pages/Actions groups by label text.
      expect(screen.getByText('globalSearch.actions.openFinance')).toBeTruthy();

      const input = screen.getByPlaceholderText('globalSearch.placeholder');
      fireEvent.change(input, { target: { value: 'ja' } });
      // Let the 300ms debounce (and any request it would fire) settle.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });

      expect(appointmentService.getAll).not.toHaveBeenCalled();
      expect(treatmentCaseService.getAll).not.toHaveBeenCalled();
    });

    it('BILLING: finds an existing patient through the finance-safe /patients contract and routes to /payments, never /patients/:id (finding 1 fix)', async () => {
      mockUser = { role: 'billing', canAccessAllClinics: false };
      (patientService.getAll as any).mockImplementation(() =>
        // Shape matches server/src/utils/prismaSelects.ts patientListSelect —
        // identity/contact + admin metadata only, no clinical fields.
        Promise.resolve({
          data: [{
            id: 'p1',
            firstName: 'Mustafa',
            lastName: 'Basol',
            phone: '5551234567',
            email: 'mustafa@example.com',
            clinicId: 'clinic-A',
            patientStatus: 'active',
          }],
        }),
      );
      render(<GlobalSearch isOpen onClose={noop} />);
      const input = screen.getByPlaceholderText('globalSearch.placeholder');

      fireEvent.change(input, { target: { value: 'mustafa' } });

      await waitFor(() => expect(patientService.getAll).toHaveBeenCalledTimes(1));
      const resultButton = await screen.findByText('Mustafa Basol');
      expect(resultButton).toBeTruthy();

      fireEvent.click(resultButton);
      expect(mockNavigate).toHaveBeenCalledWith('/payments?patientId=p1');
      expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringMatching(/^\/patients\//));
    });

    it('OWNER/management still routes patient results to the clinical /patients/:id detail route', async () => {
      mockUser = { role: 'owner', canAccessAllClinics: true };
      (patientService.getAll as any).mockImplementation(() =>
        Promise.resolve({ data: [{ id: 'p1', firstName: 'Mustafa', lastName: 'Basol' }] }),
      );
      render(<GlobalSearch isOpen onClose={noop} />);
      const input = screen.getByPlaceholderText('globalSearch.placeholder');

      fireEvent.change(input, { target: { value: 'mustafa' } });
      const resultButton = await screen.findByText('Mustafa Basol');
      fireEvent.click(resultButton);

      expect(mockNavigate).toHaveBeenCalledWith('/patients/p1');
    });

    it('RECEPTIONIST: calls patient, appointment, and treatment-case search (all permitted workflows)', async () => {
      mockUser = { role: 'receptionist', canAccessAllClinics: false };
      render(<GlobalSearch isOpen onClose={noop} />);
      const input = screen.getByPlaceholderText('globalSearch.placeholder');

      fireEvent.change(input, { target: { value: 'ja' } });

      await waitFor(() => {
        expect(patientService.getAll).toHaveBeenCalledTimes(1);
        expect(appointmentService.getAll).toHaveBeenCalledTimes(1);
        expect(treatmentCaseService.getAll).toHaveBeenCalledTimes(1);
      });
    });

    it('OWNER/management: calls patient, appointment, and treatment-case search', async () => {
      mockUser = { role: 'owner', canAccessAllClinics: true };
      render(<GlobalSearch isOpen onClose={noop} />);
      const input = screen.getByPlaceholderText('globalSearch.placeholder');

      fireEvent.change(input, { target: { value: 'ja' } });

      await waitFor(() => {
        expect(patientService.getAll).toHaveBeenCalledTimes(1);
        expect(appointmentService.getAll).toHaveBeenCalledTimes(1);
        expect(treatmentCaseService.getAll).toHaveBeenCalledTimes(1);
      });
    });

    it('does not let a slower in-flight search response overwrite a newer query\'s results (stale-response race)', async () => {
      mockUser = { role: 'owner', canAccessAllClinics: true };

      let resolveSlow: (value: any) => void = () => {};
      const slow = new Promise((resolve) => {
        resolveSlow = resolve;
      });
      (patientService.getAll as any)
        .mockImplementationOnce(() => slow)
        .mockImplementationOnce(() =>
          Promise.resolve({ data: [{ id: 'new-1', firstName: 'New', lastName: 'Result' }] }),
        );

      render(<GlobalSearch isOpen onClose={noop} />);
      const input = screen.getByPlaceholderText('globalSearch.placeholder');

      fireEvent.change(input, { target: { value: 'ab' } });
      await waitFor(() => expect(patientService.getAll).toHaveBeenCalledTimes(1));

      fireEvent.change(input, { target: { value: 'abc' } });
      await waitFor(() => expect(patientService.getAll).toHaveBeenCalledTimes(2));

      // Resolve the OLDER request only after the NEWER one has already been
      // issued — it must not clobber the newer results once it lands late.
      await act(async () => {
        resolveSlow({ data: [{ id: 'old-1', firstName: 'Old', lastName: 'Result' }] });
        await Promise.resolve();
      });

      await waitFor(() => expect(screen.queryByText('New Result')).toBeTruthy());
      expect(screen.queryByText('Old Result')).toBeNull();
    });
  });

  describe('logout / auth-boundary behavior (finding 3)', () => {
    it('closes immediately and clears the query/results when auth transitions to unauthenticated', async () => {
      mockUser = { role: 'owner', canAccessAllClinics: true };
      mockIsAuthenticated = true;
      (patientService.getAll as any).mockImplementation(() =>
        Promise.resolve({ data: [{ id: 'p1', firstName: 'Mustafa', lastName: 'Basol' }] }),
      );
      const onClose = vi.fn();
      const { rerender } = render(<GlobalSearch isOpen onClose={onClose} />);
      const input = screen.getByPlaceholderText('globalSearch.placeholder');

      fireEvent.change(input, { target: { value: 'mustafa' } });
      await screen.findByText('Mustafa Basol');
      expect((input as HTMLInputElement).value).toBe('mustafa');

      // Simulate logout: AuthContext flips isAuthenticated false while the
      // modal is still open (App.tsx would unmount it on the next render via
      // onClose -> setSearchOpen(false), but this proves GlobalSearch itself
      // reacts at the auth boundary, independent of that outer wiring).
      mockIsAuthenticated = false;
      rerender(<GlobalSearch isOpen onClose={onClose} />);

      expect(onClose).toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText('Mustafa Basol')).toBeNull());
      expect((input as HTMLInputElement).value).toBe('');
    });

    it('an in-flight entity search from the ended session cannot populate results after logout (stale post-logout response)', async () => {
      mockUser = { role: 'owner', canAccessAllClinics: true };
      mockIsAuthenticated = true;
      let resolveSearch: (value: any) => void = () => {};
      (patientService.getAll as any).mockImplementation(
        () => new Promise((resolve) => { resolveSearch = resolve; }),
      );
      const onClose = vi.fn();
      const { rerender } = render(<GlobalSearch isOpen onClose={onClose} />);
      const input = screen.getByPlaceholderText('globalSearch.placeholder');

      fireEvent.change(input, { target: { value: 'mustafa' } });
      await waitFor(() => expect(patientService.getAll).toHaveBeenCalledTimes(1));

      // Session ends while that request is still in flight.
      mockIsAuthenticated = false;
      rerender(<GlobalSearch isOpen onClose={onClose} />);

      // The stale request from the ended session resolves late.
      await act(async () => {
        resolveSearch({ data: [{ id: 'p1', firstName: 'Mustafa', lastName: 'Basol' }] });
        await Promise.resolve();
      });

      expect(screen.queryByText('Mustafa Basol')).toBeNull();
    });

    it('reopening after a subsequent login starts a fresh, unauthenticated-free search (no reopen regression)', async () => {
      mockUser = { role: 'owner', canAccessAllClinics: true };
      mockIsAuthenticated = true;
      (patientService.getAll as any).mockImplementation(() =>
        Promise.resolve({ data: [{ id: 'p2', firstName: 'Fresh', lastName: 'Login' }] }),
      );
      const onClose = vi.fn();
      const { rerender } = render(<GlobalSearch isOpen onClose={onClose} />);

      // Logout closes it (App.tsx would unmount GlobalSearch on isOpen=false;
      // simulate the reopen after a fresh login by rerendering isOpen again).
      mockIsAuthenticated = false;
      rerender(<GlobalSearch isOpen onClose={onClose} />);

      // Next login — reopen the palette and confirm search still works.
      mockIsAuthenticated = true;
      rerender(<GlobalSearch isOpen={false} onClose={onClose} />);
      rerender(<GlobalSearch isOpen onClose={onClose} />);

      const input = screen.getByPlaceholderText('globalSearch.placeholder');
      fireEvent.change(input, { target: { value: 'fresh' } });
      await screen.findByText('Fresh Login');
    });
  });
});
