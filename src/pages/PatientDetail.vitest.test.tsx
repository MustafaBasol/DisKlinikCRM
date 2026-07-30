/**
 * PatientDetail.vitest.test.tsx — regression coverage for US-01.6 Patient 360
 * reconciliation: a single failing secondary fetch (e.g. tasks) must not
 * cascade-abort the rest of the sequential load, and the affected section
 * must surface a distinct error state instead of silently rendering as
 * "empty".
 *
 * Mocks the API services, react-router-dom, react-i18next (t() returns the
 * raw key or its `defaultValue`), permissions and the auth/clinic-preferences
 * contexts, following the pattern established in
 * CommunicationPreferencesPanel.vitest.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import PatientDetail from './PatientDetail';
import {
  patientService,
  taskService,
  treatmentCaseService,
  paymentService,
  paymentPlanService,
  insuranceProvisionService,
  attachmentService,
} from '../services/api';

const { getMockTab, setMockTab } = vi.hoisted(() => {
  let tab = 'overview';
  return {
    getMockTab: () => tab,
    setMockTab: (next: string) => {
      tab = next;
    },
  };
});

vi.mock('../services/api', () => ({
  patientService: { getById: vi.fn() },
  taskService: { getAll: vi.fn() },
  treatmentCaseService: { getAll: vi.fn() },
  paymentService: { getAll: vi.fn() },
  paymentPlanService: { getAll: vi.fn() },
  insuranceProvisionService: { getAll: vi.fn() },
  attachmentService: { getAll: vi.fn() },
  default: { get: vi.fn(() => Promise.reject(new Error('not mocked'))) },
}));

const mockT = (key: string, opts?: any) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'patient-1' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(`?tab=${getMockTab()}`), vi.fn()],
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  Navigate: () => null,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'DENTIST', canAccessAllClinics: false } }),
}));

vi.mock('../context/ClinicPreferencesContext', () => ({
  useClinicPreferences: () => ({
    defaultCurrency: 'TRY',
    locale: 'tr',
    timezone: 'Europe/Istanbul',
    formatCurrency: (v: number) => String(v ?? 0),
    formatNumber: (v: number) => String(v ?? 0),
    formatDate: (d: string) => String(d ?? ''),
    formatTime: (d: string) => String(d ?? ''),
    formatDateTime: (d: string) => String(d ?? ''),
  }),
}));

vi.mock('../utils/permissions', () => ({
  normalizeRole: () => 'DENTIST',
  canViewPatients: () => true,
  canViewImaging: () => false,
  canManageLegalHold: () => false,
}));

const patientSvc = patientService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const taskSvc = taskService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const treatmentSvc = treatmentCaseService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const paymentSvc = paymentService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const planSvc = paymentPlanService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const insuranceSvc = insuranceProvisionService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const attachmentSvc = attachmentService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const BASE_PATIENT = {
  id: 'patient-1',
  firstName: 'Test',
  lastName: 'Patient',
  fullName: 'Test Patient',
  email: 'patient@example.com',
  phone: '5551234567',
  appointments: [],
  activityLogs: [],
  whatsappConversationMessages: [],
  instagramConversationMessages: [],
};

const TREATMENT_CASES = [
  { id: 'tc-1', title: 'Root Canal', stage: 'in_progress', acceptedAmount: 1000, currency: 'TRY' },
];

const PAYMENTS = [
  { id: 'p-1', amount: 500, currency: 'TRY', paymentStatus: 'paid', paidAt: '2026-01-01', createdAt: '2026-01-01' },
];

beforeEach(() => {
  vi.clearAllMocks();
  setMockTab('overview');
  patientSvc.getById.mockResolvedValue({ data: BASE_PATIENT });
  taskSvc.getAll.mockResolvedValue({ data: [] });
  treatmentSvc.getAll.mockResolvedValue({ data: TREATMENT_CASES });
  paymentSvc.getAll.mockResolvedValue({ data: PAYMENTS });
  planSvc.getAll.mockResolvedValue({ data: [] });
  insuranceSvc.getAll.mockResolvedValue({ data: [] });
  attachmentSvc.getAll.mockResolvedValue({ data: [] });
});

describe('PatientDetail — per-section fetch resilience (US-01.6)', () => {
  it('a failing tasks fetch does not block treatment/payment sections from loading', async () => {
    taskSvc.getAll.mockRejectedValue(new Error('network error'));

    render(<PatientDetail />);

    // Financial summary is populated from treatmentCases + payments, both of
    // which are fetched AFTER tasks in the sequential chain — before the fix,
    // an unhandled rejection on tasksService.getAll aborted the chain here
    // and these would never populate.
    await waitFor(() => {
      expect(screen.getByText('Root Canal')).toBeInTheDocument();
    });
    expect(treatmentSvc.getAll).toHaveBeenCalled();
    expect(paymentSvc.getAll).toHaveBeenCalled();
    expect(insuranceSvc.getAll).toHaveBeenCalled();
    expect(attachmentSvc.getAll).toHaveBeenCalled();
  });

  it('shows a distinct error state (not the generic empty state) in the Tasks tab when its fetch fails', async () => {
    setMockTab('tasks');
    taskSvc.getAll.mockRejectedValue(new Error('network error'));

    render(<PatientDetail />);

    await waitFor(() => {
      expect(screen.getByText('common:errorGeneric')).toBeInTheDocument();
    });
  });

  it('shows the attachments loading spinner while the attachments fetch is in flight, then renders the list', async () => {
    let resolveAttachments: (value: { data: any[] }) => void = () => {};
    attachmentSvc.getAll.mockReturnValue(
      new Promise((resolve) => {
        resolveAttachments = resolve;
      }),
    );
    setMockTab('files');

    render(<PatientDetail />);

    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    resolveAttachments({ data: [] });

    await waitFor(() => {
      expect(screen.getByText('patients:detail.files.empty')).toBeInTheDocument();
    });
  });
});
