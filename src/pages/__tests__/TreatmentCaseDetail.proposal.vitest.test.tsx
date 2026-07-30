/**
 * TreatmentCaseDetail.proposal.vitest.test.tsx — US-02.2 Phase 1 frontend coverage.
 *
 * Renders the real TreatmentCaseDetail component and exercises the actual
 * "Download Treatment Proposal" button, asserting on the real blob-download
 * flow it triggers (service call, object URL create/revoke, error rendering,
 * disabled-while-pending state, role gating).
 *
 * Mocks: react-router-dom (route params/navigation/Link), AuthContext,
 * ClinicPreferencesContext, react-i18next, the API service module, and the
 * child form/modal components not under test — same pattern as
 * AppointmentDetail.noShow.vitest.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import TreatmentCaseDetail from '../TreatmentCaseDetail';
import {
  treatmentCaseService,
  paymentService,
  insuranceProvisionService,
  treatmentPlanProceduresService,
  appointmentService,
  inventoryService,
  serviceService,
  treatmentPackageService,
} from '../../services/api';

const CASE_ID = 'case-1';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: () => ({ id: CASE_ID }),
    useNavigate: () => vi.fn(),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

vi.mock('../../services/api', () => ({
  treatmentCaseService: {
    getById: vi.fn(),
    getMaterials: vi.fn(),
    getProposalPdf: vi.fn(),
  },
  paymentService: { getAll: vi.fn() },
  insuranceProvisionService: { getAll: vi.fn() },
  treatmentPlanProceduresService: { getByCaseId: vi.fn() },
  appointmentService: { getAll: vi.fn() },
  inventoryService: { getAll: vi.fn() },
  serviceService: { getAll: vi.fn() },
  treatmentPackageService: { getAll: vi.fn() },
}));

const mockT = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('../../context/ClinicPreferencesContext', () => ({
  useClinicPreferences: () => ({
    defaultCurrency: 'USD',
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

vi.mock('../../components/TreatmentCaseForm', () => ({ default: () => null }));
vi.mock('../../components/TaskForm', () => ({ default: () => null }));
vi.mock('../../components/PaymentForm', () => ({ default: () => null }));
vi.mock('../../components/PrepareMessageModal', () => ({ default: () => null }));
vi.mock('../../components/InsuranceProvisionForm', () => ({ default: () => null }));
vi.mock('../../components/AppointmentForm', () => ({ default: () => null }));

const treatmentSvc = treatmentCaseService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const paymentSvc = paymentService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const insuranceSvc = insuranceProvisionService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const procSvc = treatmentPlanProceduresService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const invSvc = inventoryService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const svcSvc = serviceService as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeCase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CASE_ID,
    title: 'Root canal plan',
    stage: 'quote_sent',
    currency: 'USD',
    patient: { firstName: 'Ada', lastName: 'Yilmaz' },
    practitioner: { firstName: 'Deniz', lastName: 'Kaya' },
    appointments: [],
    payments: [],
    ...overrides,
  };
}

async function renderDetail(role: string) {
  mockUser = { role, canAccessAllClinics: false };
  treatmentSvc.getById.mockResolvedValue({ data: makeCase() });
  treatmentSvc.getMaterials.mockResolvedValue({ data: [] });
  procSvc.getByCaseId.mockResolvedValue({ data: [] });
  paymentSvc.getAll.mockResolvedValue({ data: [] });
  insuranceSvc.getAll.mockResolvedValue({ data: [] });
  svcSvc.getAll.mockResolvedValue({ data: [] });
  invSvc.getAll.mockResolvedValue({ data: [] });
  render(<TreatmentCaseDetail />);
  return screen.findByText('Root canal plan');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = null;
  (globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:mock-proposal-url');
  (globalThis as any).URL.revokeObjectURL = vi.fn();
  // jsdom attempts a real navigation on <a>.click() with an (unrecognized, mocked)
  // "blob:" href — stub it out since only the create/revoke calls are under test here.
  HTMLAnchorElement.prototype.click = vi.fn();
});

describe('TreatmentCaseDetail — treatment proposal PDF download', () => {
  it('an authorized role (owner) sees the download action, and clicking it calls the blob endpoint and creates+revokes an object URL', async () => {
    const blob = new Blob(['%PDF-fake'], { type: 'application/pdf' });
    treatmentSvc.getProposalPdf.mockResolvedValue({ data: blob });
    await renderDetail('owner');

    const button = await screen.findByRole('button', { name: 'treatmentCases:proposal.download' });
    await userEvent.click(button);

    await waitFor(() => expect(treatmentSvc.getProposalPdf).toHaveBeenCalledWith(CASE_ID));
    await waitFor(() => expect((globalThis as any).URL.createObjectURL).toHaveBeenCalledWith(blob));
    await waitFor(() => expect((globalThis as any).URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-proposal-url'));
  });

  it('a failed download renders a string error, not an object', async () => {
    treatmentSvc.getProposalPdf.mockRejectedValue({ response: { data: { error: 'Sunucu hatası oluştu' } } });
    await renderDetail('owner');

    const button = await screen.findByRole('button', { name: 'treatmentCases:proposal.download' });
    await userEvent.click(button);

    const errorNode = await screen.findByText('Sunucu hatası oluştu');
    expect(errorNode.textContent).toEqual(expect.any(String));
  });

  it('duplicate clicks are disabled while the request is pending', async () => {
    let resolveRequest: (value: { data: Blob }) => void = () => {};
    treatmentSvc.getProposalPdf.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    await renderDetail('owner');

    const button = await screen.findByRole('button', { name: 'treatmentCases:proposal.download' });
    await userEvent.click(button);

    const pendingButton = await screen.findByRole('button', { name: 'treatmentCases:proposal.preparing' });
    expect(pendingButton).toBeDisabled();

    await userEvent.click(pendingButton);
    expect(treatmentSvc.getProposalPdf).toHaveBeenCalledTimes(1);

    resolveRequest({ data: new Blob(['%PDF-fake'], { type: 'application/pdf' }) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'treatmentCases:proposal.download' })).not.toBeDisabled());
  });

  it('a role not allowed to download proposals (billing) never sees the action', async () => {
    await renderDetail('billing');
    expect(screen.queryByRole('button', { name: 'treatmentCases:proposal.download' })).not.toBeInTheDocument();
  });

  it('a role allowed to download proposals (dentist) sees the action', async () => {
    await renderDetail('dentist');
    expect(await screen.findByRole('button', { name: 'treatmentCases:proposal.download' })).toBeInTheDocument();
  });
});
