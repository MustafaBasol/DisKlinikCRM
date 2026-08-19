/**
 * GlobalSearch.vitest.test.tsx — UX-001 Ctrl+K palette: grouped Pages/Actions
 * sections must be gated by the same permission functions MainLayout uses,
 * and arrow-key navigation must move through all groups as one continuous
 * list. Hard security requirement: BILLING must never see a clinical-workflow
 * shortcut (New Patient / New Appointment) through the command palette.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import GlobalSearch from './GlobalSearch';

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
});
