/**
 * Dashboard.vitest.test.tsx — UX-001 Wave 2 role-aware dashboard composition.
 *
 * Covers the two role-aware data-loading changes made to Dashboard.tsx:
 *  - BILLING must never call /dashboard/stats — it redirects to /finance
 *    before the fetch fires (previously the request always fired on mount,
 *    then the redirect happened once loading resolved).
 *  - Non-BILLING roles (e.g. DENTIST) are unaffected and still fetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import Dashboard from './Dashboard';

const mockT = (key: string, opts?: any) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

let mockUser: { id: string; role: string; canAccessAllClinics?: boolean; firstName: string; lastName: string } | null = null;
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('../context/ClinicContext', () => ({
  useClinic: () => ({ selectedClinicId: 'clinic-test' }),
}));

vi.mock('../context/ClinicPreferencesContext', () => ({
  useClinicPreferences: () => ({
    formatCurrency: (v: number) => `₺${v}`,
    formatNumber: (v: number) => String(v),
    formatDate: (v: unknown) => String(v),
    formatTime: (v: unknown) => String(v),
    formatDateTime: (v: unknown) => String(v),
  }),
}));

const getStats = vi.fn();
vi.mock('../services/api', () => ({
  dashboardService: { getStats: (...args: unknown[]) => getStats(...args) },
}));

const DOCTOR_STATS_RESPONSE = {
  data: {
    stats: { todayAppointments: 0, weekAppointments: 0, openTreatments: 0, pendingTasks: 0, overdueTasks: 0 },
    agenda: [],
    activities: [],
    doctorExtras: { upcomingWeek: [], treatmentPipeline: [], recentPatients: [], pendingEarnings: 0 },
    charts: null,
  },
};

beforeEach(() => {
  getStats.mockReset();
  getStats.mockResolvedValue(DOCTOR_STATS_RESPONSE);
  mockUser = null;
});

describe('Dashboard — role-aware data loading', () => {
  it('BILLING never calls /dashboard/stats and redirects straight to /finance', async () => {
    mockUser = { id: 'u-billing', role: 'billing', canAccessAllClinics: false, firstName: 'Bea', lastName: 'Ling' };

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/finance" element={<div>finance-page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('finance-page')).toBeTruthy());
    expect(getStats).not.toHaveBeenCalled();
  });

  it('DENTIST still fetches dashboard stats and renders the practitioner dashboard', async () => {
    mockUser = { id: 'u-dentist', role: 'dentist', canAccessAllClinics: false, firstName: 'Dana', lastName: 'Tist' };

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(getStats).toHaveBeenCalledTimes(1));
    expect(screen.getByText('dashboard:doctor.greeting')).toBeTruthy();
  });
});
