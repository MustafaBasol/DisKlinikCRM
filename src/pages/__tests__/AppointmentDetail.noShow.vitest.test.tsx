/**
 * AppointmentDetail.noShow.vitest.test.tsx — US-03.2 no-show gap closure
 * regression coverage.
 *
 * Renders the real AppointmentDetail component and exercises the actual
 * "Mark No Show" button click, asserting on the real service calls it
 * triggers. Replaces appointmentNoShowAction.test.ts, which only re-declared
 * handleStatusUpdate's routing ternary inline and therefore could not detect
 * a regression in the component itself (see PR #265 review discussion).
 *
 * Mocks: react-router-dom (route params/navigation/Link), AuthContext,
 * ClinicPreferencesContext, react-i18next, the API service module, and the
 * child form/modal components not under test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import AppointmentDetail from '../AppointmentDetail';
import { appointmentService, taskService, treatmentCaseService, noShowService } from '../../services/api';

const APPOINTMENT_ID = 'appt-1';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: () => ({ id: APPOINTMENT_ID }),
    useNavigate: () => vi.fn(),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

vi.mock('../../services/api', () => ({
  appointmentService: {
    getById: vi.fn(),
    updateStatus: vi.fn(),
  },
  taskService: {
    getAll: vi.fn(),
  },
  treatmentCaseService: {
    getAll: vi.fn(),
  },
  noShowService: {
    markNoShow: vi.fn(),
  },
}));

const mockT = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('../../context/ClinicPreferencesContext', () => ({
  useClinicPreferences: () => ({
    formatCurrency: (amount: number) => String(amount),
    formatDate: (d: string) => d,
    formatTime: (d: string) => d,
    formatDateTime: (d: string) => d,
  }),
}));

let mockUser: { role: string; canAccessAllClinics?: boolean } | null = null;
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('../../components/TaskForm', () => ({ default: () => null }));
vi.mock('../../components/TreatmentCaseForm', () => ({ default: () => null }));
vi.mock('../../components/PrepareMessageModal', () => ({ default: () => null }));
vi.mock('../../components/AppointmentForm', () => ({ default: () => null }));

const appointmentSvc = appointmentService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const taskSvc = taskService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const treatmentSvc = treatmentCaseService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const noShowSvc = noShowService as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeAppointment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: APPOINTMENT_ID,
    patientId: 'patient-1',
    clinicId: 'clinic-1',
    status: 'confirmed',
    startTime: '2026-08-01T10:00:00.000Z',
    endTime: '2026-08-01T10:30:00.000Z',
    notes: '',
    patient: { firstName: 'Ada', lastName: 'Yilmaz' },
    practitioner: { firstName: 'Deniz', lastName: 'Kaya' },
    appointmentType: { name: 'Check-up' },
    activityLogs: [],
    ...overrides,
  };
}

async function renderDetail(role: string, appointmentOverrides: Partial<Record<string, unknown>> = {}) {
  mockUser = { role, canAccessAllClinics: false };
  appointmentSvc.getById.mockResolvedValue({ data: makeAppointment(appointmentOverrides) });
  taskSvc.getAll.mockResolvedValue({ data: [] });
  treatmentSvc.getAll.mockResolvedValue({ data: [] });
  render(<AppointmentDetail />);
  return screen.findByText('appointments:appointmentDetails');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = null;
});

describe('AppointmentDetail — no-show action routing', () => {
  it('an authorized role (receptionist) sees the Mark No Show action, and clicking it calls the dedicated no-show service', async () => {
    noShowSvc.markNoShow.mockResolvedValue({ data: {} });
    await renderDetail('receptionist');

    const button = await screen.findByRole('button', { name: 'appointments:actions.noShow' });
    await userEvent.click(button);

    expect(noShowSvc.markNoShow).toHaveBeenCalledWith(APPOINTMENT_ID);
    expect(appointmentSvc.updateStatus).not.toHaveBeenCalledWith(APPOINTMENT_ID, 'no_show');
    expect(appointmentSvc.updateStatus).not.toHaveBeenCalled();
  });

  it('a DENTIST role sees and can use the Mark No Show action, matching the backend role allow-list', async () => {
    noShowSvc.markNoShow.mockResolvedValue({ data: {} });
    await renderDetail('dentist');

    const button = await screen.findByRole('button', { name: 'appointments:actions.noShow' });
    await userEvent.click(button);

    expect(noShowSvc.markNoShow).toHaveBeenCalledWith(APPOINTMENT_ID);
    expect(appointmentSvc.updateStatus).not.toHaveBeenCalled();
  });

  it('a role not allowed by canManageNoShows (billing) never sees the Mark No Show action', async () => {
    await renderDetail('billing');
    expect(screen.queryByRole('button', { name: 'appointments:actions.noShow' })).not.toBeInTheDocument();
  });

  it('a role not allowed by canManageNoShows (assistant) never sees the Mark No Show action', async () => {
    await renderDetail('assistant');
    expect(screen.queryByRole('button', { name: 'appointments:actions.noShow' })).not.toBeInTheDocument();
  });

  it('a non-no-show status action (confirm) still uses the generic appointment status endpoint, not the no-show service', async () => {
    appointmentSvc.updateStatus.mockResolvedValue({ data: {} });
    await renderDetail('receptionist', { status: 'scheduled' });

    const confirmButton = await screen.findByRole('button', { name: 'appointments:actions.confirm' });
    await userEvent.click(confirmButton);

    expect(appointmentSvc.updateStatus).toHaveBeenCalledWith(APPOINTMENT_ID, 'confirmed');
    expect(noShowSvc.markNoShow).not.toHaveBeenCalled();
  });
});
