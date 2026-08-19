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
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
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
    it('BILLING: does not call patient, appointment, or treatment-case search APIs for a 2+ char query', async () => {
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

      expect(patientService.getAll).not.toHaveBeenCalled();
      expect(appointmentService.getAll).not.toHaveBeenCalled();
      expect(treatmentCaseService.getAll).not.toHaveBeenCalled();
    });

    it('BILLING: unauthorized entity results cannot appear even if the underlying service would return data', async () => {
      mockUser = { role: 'billing', canAccessAllClinics: false };
      (patientService.getAll as any).mockImplementation(() =>
        Promise.resolve({ data: [{ id: 'p1', firstName: 'Jane', lastName: 'Doe' }] }),
      );
      render(<GlobalSearch isOpen onClose={noop} />);
      const input = screen.getByPlaceholderText('globalSearch.placeholder');

      fireEvent.change(input, { target: { value: 'ja' } });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });

      expect(patientService.getAll).not.toHaveBeenCalled();
      expect(screen.queryByText('Jane Doe')).toBeNull();
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
});
