/**
 * TreatmentCaseDetail.procedureStatus.vitest.test.tsx — ClickUp 86eyg85a3.
 *
 * Renders the real TreatmentCaseDetail component and exercises the actual
 * procedure add/edit modal's status picker, asserting that clicking
 * "Cancelled" produces a visually and programmatically distinct selected
 * state (aria-pressed) and that the outgoing save payload carries
 * status: "cancelled" for both the create and edit flows.
 *
 * Mocks: react-router-dom (route params/navigation/Link), AuthContext,
 * ClinicPreferencesContext, react-i18next, the API service module, and the
 * child form/modal components not under test — same pattern as
 * TreatmentCaseDetail.proposal.vitest.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import TreatmentCaseDetail from '../TreatmentCaseDetail';
import {
  treatmentCaseService,
  paymentService,
  insuranceProvisionService,
  treatmentPlanProceduresService,
  serviceService,
  inventoryService,
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
  },
  paymentService: { getAll: vi.fn() },
  insuranceProvisionService: { getAll: vi.fn() },
  treatmentPlanProceduresService: {
    getByCaseId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
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

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', canAccessAllClinics: false } }),
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

const CANCELLED_PROC = {
  id: 'proc-1',
  procedureName: 'Root canal — molar',
  serviceId: null,
  toothFdi: null,
  status: 'cancelled',
  estimatedCost: null,
  notes: null,
  scheduledDate: null,
};

async function renderDetail(procedures: any[] = []) {
  treatmentSvc.getById.mockResolvedValue({ data: makeCase() });
  treatmentSvc.getMaterials.mockResolvedValue({ data: [] });
  procSvc.getByCaseId.mockResolvedValue({ data: procedures });
  paymentSvc.getAll.mockResolvedValue({ data: [] });
  insuranceSvc.getAll.mockResolvedValue({ data: [] });
  svcSvc.getAll.mockResolvedValue({ data: [] });
  invSvc.getAll.mockResolvedValue({ data: [] });
  render(<TreatmentCaseDetail />);
  return screen.findByText('Root canal plan');
}

// The page reuses generic i18n keys (common:edit, common:save, common:add, ...)
// for several unrelated buttons (case edit, materials, package modal, ...), and
// the mocked t() returns those raw keys — so queries must be scoped to the
// specific panel/modal under test rather than searched globally.
function getProceduresPanel() {
  return screen.getByText('treatmentCases:procedures.title').closest('.card') as HTMLElement;
}

function getProcModal() {
  return screen
    .getByPlaceholderText('treatmentCases:procedures.placeholders.name')
    .closest('.card') as HTMLElement;
}

function statusButton(name: string) {
  return within(getProcModal()).getByRole('button', { name });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TreatmentCaseDetail — procedure status picker (ClickUp 86eyg85a3)', () => {
  it('create modal: clicking Cancelled selects it and marks it aria-pressed, leaving other statuses unpressed', async () => {
    await renderDetail([]);

    await userEvent.click(within(getProceduresPanel()).getByRole('button', { name: 'treatmentCases:procedures.add' }));
    await screen.findByPlaceholderText('treatmentCases:procedures.placeholders.name');

    const cancelledBtn = statusButton('cancelled');
    expect(cancelledBtn).toHaveAttribute('aria-pressed', 'false');
    // Unselected state: plain gray, no dedicated "selected" border/background yet.
    expect(cancelledBtn.className).toContain('border-gray-200');
    expect(cancelledBtn.className).not.toContain('border-gray-400');

    await userEvent.click(cancelledBtn);

    expect(cancelledBtn).toHaveAttribute('aria-pressed', 'true');
    expect(statusButton('planned')).toHaveAttribute('aria-pressed', 'false');
    expect(statusButton('in_progress')).toHaveAttribute('aria-pressed', 'false');
    expect(statusButton('completed')).toHaveAttribute('aria-pressed', 'false');

    // Regression guard for the actual production bug: the selected style must be
    // visually distinct from the unselected one, not just aria-pressed=true.
    // These are the dedicated PROC_STATUS.cancelled.selected classes.
    expect(cancelledBtn.className).toContain('bg-gray-100');
    expect(cancelledBtn.className).toContain('text-gray-700');
    expect(cancelledBtn.className).toContain('border-gray-400');
    // The old conflicting-utility selected style (`${badge} border-current`) must be gone.
    expect(cancelledBtn.className).not.toContain('border-current');
  });

  it('create modal: saving after selecting Cancelled sends status: "cancelled" to the API', async () => {
    procSvc.create.mockResolvedValue({ data: { ...CANCELLED_PROC } });
    await renderDetail([]);

    await userEvent.click(within(getProceduresPanel()).getByRole('button', { name: 'treatmentCases:procedures.add' }));
    await userEvent.type(
      screen.getByPlaceholderText('treatmentCases:procedures.placeholders.name'),
      'Root canal — molar',
    );
    await userEvent.click(statusButton('cancelled'));
    await userEvent.click(within(getProcModal()).getByRole('button', { name: 'common:add' }));

    await waitFor(() =>
      expect(procSvc.create).toHaveBeenCalledWith(
        CASE_ID,
        expect.objectContaining({ status: 'cancelled' }),
      ),
    );
  });

  it('edit modal: opening an existing cancelled procedure shows Cancelled already selected', async () => {
    await renderDetail([CANCELLED_PROC]);

    await userEvent.click(within(getProceduresPanel()).getByRole('button', { name: 'common:edit' }));
    await screen.findByPlaceholderText('treatmentCases:procedures.placeholders.name');

    await waitFor(() => expect(statusButton('cancelled')).toHaveAttribute('aria-pressed', 'true'));
    expect(statusButton('planned')).toHaveAttribute('aria-pressed', 'false');
  });

  it('edit modal: saving an existing cancelled procedure without changes preserves status: "cancelled"', async () => {
    procSvc.update.mockResolvedValue({ data: { ...CANCELLED_PROC } });
    await renderDetail([CANCELLED_PROC]);

    await userEvent.click(within(getProceduresPanel()).getByRole('button', { name: 'common:edit' }));
    await screen.findByPlaceholderText('treatmentCases:procedures.placeholders.name');
    await waitFor(() => expect(statusButton('cancelled')).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(within(getProcModal()).getByRole('button', { name: 'common:save' }));

    await waitFor(() =>
      expect(procSvc.update).toHaveBeenCalledWith(
        CASE_ID,
        CANCELLED_PROC.id,
        expect.objectContaining({ status: 'cancelled' }),
      ),
    );
  });

  it('regression: selecting In Progress still selects it and saves status: "in_progress"', async () => {
    procSvc.create.mockResolvedValue({ data: { ...CANCELLED_PROC, status: 'in_progress' } });
    await renderDetail([]);

    await userEvent.click(within(getProceduresPanel()).getByRole('button', { name: 'treatmentCases:procedures.add' }));
    await userEvent.type(
      screen.getByPlaceholderText('treatmentCases:procedures.placeholders.name'),
      'Filling',
    );

    const inProgressBtn = statusButton('in_progress');
    await userEvent.click(inProgressBtn);
    expect(inProgressBtn).toHaveAttribute('aria-pressed', 'true');
    expect(statusButton('planned')).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(within(getProcModal()).getByRole('button', { name: 'common:add' }));

    await waitFor(() =>
      expect(procSvc.create).toHaveBeenCalledWith(
        CASE_ID,
        expect.objectContaining({ status: 'in_progress' }),
      ),
    );
  });
});
