/**
 * PatientDetail.vitest.test.tsx — regression coverage for US-01.6 Patient 360
 * reconciliation: a single failing secondary fetch (e.g. tasks) must not
 * cascade-abort the rest of the sequential load, and the affected section
 * must surface a distinct error state instead of silently rendering as
 * "empty".
 *
 * True progressive loading (making an in-flight secondary section visibly
 * "loading" while the rest of the page is already interactive) is out of
 * scope here and deferred — the page still gates all content behind one
 * top-level `if (loading)` full-page spinner, and requests remain
 * sequential. These tests only cover the per-section *error* states that
 * become visible once the full-page load finishes.
 *
 * The combined overview financial-summary card intentionally shows the
 * generic error whenever EITHER `paymentsError` or `treatmentCasesError` is
 * set, even if the other request succeeded: the card computes a derived
 * balance (treatment total vs. paid total) from both sources, so a partial
 * result would render a misleading number rather than an honest error.
 *
 * Mocks the API services, react-router-dom, react-i18next (t() returns the
 * raw key or its `defaultValue`), permissions and the auth/clinic-preferences
 * contexts, following the pattern established in
 * CommunicationPreferencesPanel.vitest.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  patientEmergencyContactService,
  patientContactPointService,
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

const { setSearchParamsMock } = vi.hoisted(() => ({ setSearchParamsMock: vi.fn() }));

const { getMockUserRole, setMockUserRole } = vi.hoisted(() => {
  let role = 'DENTIST';
  return {
    getMockUserRole: () => role,
    setMockUserRole: (next: string) => {
      role = next;
    },
  };
});

let mockCanViewImaging = false;

vi.mock('../services/api', () => ({
  patientService: { getById: vi.fn(), getIdentity: vi.fn() },
  taskService: { getAll: vi.fn() },
  treatmentCaseService: { getAll: vi.fn() },
  paymentService: { getAll: vi.fn() },
  paymentPlanService: { getAll: vi.fn() },
  insuranceProvisionService: { getAll: vi.fn() },
  attachmentService: { getAll: vi.fn() },
  patientEmergencyContactService: { getAll: vi.fn(), remove: vi.fn() },
  // F3-DATA-MIG-TODAY-001-R10: the profile card now also loads the secondary
  // phone (contact-point) sub-resource; without this the explicit factory
  // mock would throw "No export is defined" on the real module.
  patientContactPointService: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  default: { get: vi.fn(() => Promise.reject(new Error('not mocked'))) },
}));

const mockT = (key: string, opts?: any) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'patient-1' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(`?tab=${getMockTab()}`), setSearchParamsMock],
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  Navigate: () => null,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: getMockUserRole(), canAccessAllClinics: false } }),
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

// Partial mock: real exports (e.g. canManagePatientIdentity) pass through
// untouched from the actual module so newly-added permission gates don't need
// a mock update on every PatientDetail permission addition — only the four
// checks this suite intentionally controls are overridden. canManagePatientIdentity
// is role-driven off the REAL user.role from the AuthContext mock above
// (getMockUserRole()), independent of the normalizeRole override below, which
// only affects the exported binding — canManagePatientIdentity's internal role
// resolution is a private module-level helper, not this mocked export.
vi.mock('../utils/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/permissions')>();
  return {
    ...actual,
    normalizeRole: () => 'DENTIST',
    canViewPatients: () => true,
    canViewImaging: () => mockCanViewImaging,
    canManageLegalHold: () => false,
  };
});

const patientSvc = patientService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const taskSvc = taskService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const treatmentSvc = treatmentCaseService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const paymentSvc = paymentService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const planSvc = paymentPlanService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const insuranceSvc = insuranceProvisionService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const attachmentSvc = attachmentService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const emergencyContactSvc = patientEmergencyContactService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const contactPointSvc = patientContactPointService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const BASE_PATIENT = {
  id: 'patient-1',
  firstName: 'Test',
  lastName: 'Patient',
  fullName: 'Test Patient',
  email: 'patient@example.com',
  phone: '5551234567',
  // F3-DATA-MIG-TODAY-001-R8. Synthetic. Present so the profile block's
  // blood-group row has something to render; every other test in this file
  // is unaffected by it.
  bloodGroup: 'O_NEGATIVE',
  appointments: [],
  activityLogs: [],
  whatsappConversationMessages: [],
  instagramConversationMessages: [],
};

const TREATMENT_CASES = [
  { id: 'tc-1', title: 'Root Canal', stage: 'in_progress', acceptedAmount: 1000, currency: 'TRY' },
];

const PAYMENTS = [
  { id: 'p-1', amount: 500, currency: 'TRY', paymentStatus: 'paid', paymentMethod: 'cash', paidAt: '2026-01-01', createdAt: '2026-01-01' },
];

// Every test starts from this all-succeed baseline; each test then overrides
// exactly one service mock to exercise its error path. Renders the real
// PatientDetail component — no production decision logic is duplicated here.
beforeEach(() => {
  vi.clearAllMocks();
  setMockTab('overview');
  setMockUserRole('DENTIST');
  mockCanViewImaging = false;
  patientSvc.getById.mockResolvedValue({ data: BASE_PATIENT });
  patientSvc.getIdentity.mockResolvedValue({ data: { present: false, type: 'TCKN', maskedValue: null } });
  taskSvc.getAll.mockResolvedValue({ data: [] });
  treatmentSvc.getAll.mockResolvedValue({ data: TREATMENT_CASES });
  paymentSvc.getAll.mockResolvedValue({ data: PAYMENTS });
  planSvc.getAll.mockResolvedValue({ data: [] });
  insuranceSvc.getAll.mockResolvedValue({ data: [] });
  attachmentSvc.getAll.mockResolvedValue({ data: [] });
  emergencyContactSvc.getAll.mockResolvedValue({ data: [] });
  contactPointSvc.getAll.mockResolvedValue({ data: { contactPoints: [] } });
});

function renderPatientDetail() {
  return render(<PatientDetail />);
}

// The page gates ALL content behind a single top-level `if (loading) return
// <spinner>` that renders nothing else while true, so waiting for that
// spinner to disappear is equivalent to waiting for the full-page loading
// state to finish, without asserting on any section-specific behavior.
async function waitForFullPageLoad() {
  await waitFor(() => {
    expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
  });
}

describe('PatientDetail — per-section fetch resilience (US-01.6)', () => {
  it('cascade isolation: a failing tasks fetch does not block treatment/payment/insurance/attachment sections from loading', async () => {
    taskSvc.getAll.mockRejectedValue(new Error('network error'));

    renderPatientDetail();

    // Financial summary is populated from treatmentCases + payments, both of
    // which are fetched AFTER tasks in the sequential chain — before the fix,
    // an unhandled rejection on taskService.getAll aborted the chain here
    // and these would never populate.
    await waitFor(() => {
      expect(screen.getByText('Root Canal')).toBeInTheDocument();
    });
    expect(treatmentSvc.getAll).toHaveBeenCalled();
    expect(paymentSvc.getAll).toHaveBeenCalled();
    expect(insuranceSvc.getAll).toHaveBeenCalled();
    expect(attachmentSvc.getAll).toHaveBeenCalled();
  });

  it('tasks error: Tasks tab renders common:errorGeneric, not the empty-state message', async () => {
    setMockTab('tasks');
    taskSvc.getAll.mockRejectedValue(new Error('network error'));

    renderPatientDetail();
    await waitForFullPageLoad();

    // 'common:noData' is reused elsewhere on the page (e.g. missing profile
    // fields), so the empty-state check is scoped to this section's own
    // container rather than a page-wide text search.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('common:errorGeneric');
    expect(within(alert.parentElement as HTMLElement).queryByText('common:noData')).not.toBeInTheDocument();
  });

  it('treatment cases error: Treatment Cases tab renders common:errorGeneric, not the create-case empty-state hint', async () => {
    setMockTab('treatments');
    treatmentSvc.getAll.mockRejectedValue(new Error('network error'));

    renderPatientDetail();
    await waitForFullPageLoad();

    // 'common:noData' is reused elsewhere on the page (e.g. missing profile
    // fields), so the empty-state check is scoped to this section's own
    // container rather than a page-wide text search.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('common:errorGeneric');
    expect(within(alert.parentElement as HTMLElement).queryByText('common:noData')).not.toBeInTheDocument();
    expect(screen.queryByText('patients:detail.createTreatmentCaseHint')).not.toBeInTheDocument();
  });

  it('payments error: Payments tab renders common:errorGeneric, not the ordinary payments-empty state', async () => {
    setMockTab('payments');
    paymentSvc.getAll.mockRejectedValue(new Error('network error'));

    renderPatientDetail();
    await waitForFullPageLoad();

    // The Payments tab's summary cards independently reduce over `payments`
    // (defaulted to [] on error), so the dedicated table row is the signal.
    expect(screen.getByRole('alert')).toHaveTextContent('common:errorGeneric');
    expect(screen.queryByText('payments:empty')).not.toBeInTheDocument();
  });

  it('insurance error: Insurance tab renders common:errorGeneric, not the ordinary no-data state', async () => {
    setMockTab('insurance');
    insuranceSvc.getAll.mockRejectedValue(new Error('network error'));

    renderPatientDetail();
    await waitForFullPageLoad();

    // Scoped for the same reason as the tasks-error case above: 'common:noData'
    // also appears in the always-rendered profile card.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('common:errorGeneric');
    expect(within(alert.parentElement as HTMLElement).queryByText('common:noData')).not.toBeInTheDocument();
  });

  it('attachments error: Files tab renders a section-scoped common:errorGeneric, not the empty-files state', async () => {
    setMockTab('files');
    attachmentSvc.getAll.mockRejectedValue(new Error('network error'));

    renderPatientDetail();
    await waitForFullPageLoad();

    // Scoped to the section's own alert role rather than a page-wide text
    // search, so this would fail if the error surfaced somewhere unrelated.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('common:errorGeneric');
    expect(screen.queryByText('patients:detail.files.empty')).not.toBeInTheDocument();
  });
});

describe('PatientDetail — combined overview financial-summary guard', () => {
  // The overview card's balance is derived from BOTH treatmentCases and
  // payments; if either source failed to load, the derived total is
  // unreliable, so the card must show the generic error rather than a
  // partial (and misleading) number. This is accepted scope for this
  // bounded PR — see PR description for the full rationale.
  it('shows common:errorGeneric in the financial summary when payments fails but treatment cases succeeds', async () => {
    paymentSvc.getAll.mockRejectedValue(new Error('network error'));

    renderPatientDetail();
    await waitForFullPageLoad();

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    alerts.forEach((alert) => expect(alert).toHaveTextContent('common:errorGeneric'));
    expect(screen.queryByText('patients:detail.overview.noPayments')).not.toBeInTheDocument();
  });

  it('shows common:errorGeneric in the financial summary when treatment cases fails but payments succeeds', async () => {
    treatmentSvc.getAll.mockRejectedValue(new Error('network error'));

    renderPatientDetail();
    await waitForFullPageLoad();

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    alerts.forEach((alert) => expect(alert).toHaveTextContent('common:errorGeneric'));
    expect(screen.queryByText('patients:detail.overview.noPayments')).not.toBeInTheDocument();
  });

  it('still renders valid payment data on the dedicated Payments tab when treatment cases alone failed', async () => {
    setMockTab('payments');
    treatmentSvc.getAll.mockRejectedValue(new Error('network error'));

    renderPatientDetail();
    await waitForFullPageLoad();

    // The combined overview card's error guard must not bleed into the
    // Payments tab, which has its own paymentsError (unset here — payments
    // succeeded) and renders its data independently of treatmentCasesError.
    expect(screen.getAllByText('500').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('PatientDetail — US-01.X scalable tab navigation contract', () => {
  it('every visible tab key is reachable: primary row + More menu together account for all of them, none lost', async () => {
    renderPatientDetail();
    await waitForFullPageLoad();

    // canViewImaging is false by default here, so 13 of the 14 declared tab
    // keys are visible: 5 in the primary row, and the remaining 8 collapsed
    // into the More menu (the More trigger itself is a plain button, not a
    // tab, so it is not counted here).
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: /^More$/ }));
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(8);
  });

  it('role-hidden tab: imaging never appears in the primary row or the More menu when canViewImaging is false', async () => {
    renderPatientDetail();
    await waitForFullPageLoad();

    expect(screen.queryByText('imaging:tab')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^More$/ }));
    expect(screen.queryByText('imaging:tab')).not.toBeInTheDocument();
  });

  it('role visibility: imaging appears in the More menu once canViewImaging becomes true', async () => {
    mockCanViewImaging = true;
    renderPatientDetail();
    await waitForFullPageLoad();

    await userEvent.click(screen.getByRole('button', { name: /^More$/ }));
    expect(screen.getByRole('menuitemradio', { name: 'imaging:tab' })).toBeInTheDocument();
  });

  it('emergencyContacts deep link (?tab=emergencyContacts) renders the Emergency Contacts panel directly', async () => {
    setMockTab('emergencyContacts');
    renderPatientDetail();
    await waitForFullPageLoad();

    await waitFor(() => {
      expect(emergencyContactSvc.getAll).toHaveBeenCalledWith('patient-1');
    });
    expect(screen.getByText('detail.emergencyContacts.empty')).toBeInTheDocument();
    // The active tab (in the More group) gets its own real role="tab"
    // element showing its own label — never hidden behind the generic
    // "More" trigger, which keeps showing the generic label unchanged.
    expect(screen.getByRole('tab', { name: 'patients:detail.emergencyContacts.title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^More$/ })).toBeInTheDocument();
  });

  it('invalid ?tab= value falls back to rendering the Overview tab', async () => {
    setMockTab('not-a-real-tab');
    renderPatientDetail();
    await waitForFullPageLoad();

    expect(screen.getAllByText('patients:detail.overview.clinicalAlerts').length).toBeGreaterThan(0);
  });

  it('clicking an overflow tab in the More menu navigates via setSearchParams (single URL writer, deep-link/back-forward preserved)', async () => {
    renderPatientDetail();
    await waitForFullPageLoad();

    await userEvent.click(screen.getByRole('button', { name: /^More$/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'patients:detail.emergencyContacts.title' }));

    expect(setSearchParamsMock).toHaveBeenCalled();
    const forwardedParams = setSearchParamsMock.mock.calls[0]![0] as URLSearchParams;
    expect(forwardedParams.get('tab')).toBe('emergencyContacts');
  });

  it('keyboard: ArrowRight from the last primary tab clamps in place — it never moves focus to the More trigger', async () => {
    renderPatientDetail();
    await waitForFullPageLoad();

    const lastPrimaryTab = screen.getByRole('tab', { name: 'patients:detail.filesTab' });
    lastPrimaryTab.focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(lastPrimaryTab).toHaveFocus();
    expect(screen.getByRole('button', { name: /^More$/ })).not.toHaveFocus();
  });

  it('keyboard: the More trigger is reachable via normal Tab order after the last primary tab', async () => {
    renderPatientDetail();
    await waitForFullPageLoad();

    const lastPrimaryTab = screen.getByRole('tab', { name: 'patients:detail.filesTab' });
    lastPrimaryTab.focus();
    await userEvent.tab();

    expect(screen.getByRole('button', { name: /^More$/ })).toHaveFocus();
  });
});

describe('PatientDetail — patient identity (F3-DATA-MIG-TODAY-001-UI-001-R1/R3)', () => {
  it('unauthorized role (DENTIST): never requests the identity endpoint and never renders the identity row', async () => {
    renderPatientDetail();
    await waitForFullPageLoad();

    expect(patientSvc.getIdentity).not.toHaveBeenCalled();
    expect(screen.queryByText(/patients:form\.identity\.label/)).not.toBeInTheDocument();
  });

  it('authorized role (RECEPTIONIST): requests the identity endpoint and renders the masked value', async () => {
    setMockUserRole('RECEPTIONIST');
    patientSvc.getIdentity.mockResolvedValue({ data: { present: true, type: 'TCKN', maskedValue: '*******1234' } });

    renderPatientDetail();
    await waitForFullPageLoad();

    expect(patientSvc.getIdentity).toHaveBeenCalledWith('patient-1');
    // Both the desktop and mobile profile blocks render this row.
    const identityRows = screen.getAllByText(/patients:form\.identity\.label/);
    expect(identityRows.length).toBeGreaterThan(0);
    identityRows.forEach((row) => expect(row).toHaveTextContent('*******1234'));
  });
});

describe('PatientDetail - structured blood group (F3-DATA-MIG-TODAY-001-R8)', () => {
  it('renders the stored blood group as a localized label in the profile block', async () => {
    renderPatientDetail();
    await waitForFullPageLoad();

    // t() is mocked to return `defaultValue` when one is given, and the page
    // passes the raw stored token as the defaultValue on purpose: a value this
    // build has no translation for must still be SHOWN to the clinician rather
    // than collapsing to "no data". So the token is what renders here, and
    // that fallback is exactly what this asserts.
    const rows = screen.getAllByText(/patients:form\.bloodGroup/);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => expect(row).toHaveTextContent('O_NEGATIVE'));
  });

  it('shows "no data" rather than an empty row when no blood group is recorded', async () => {
    patientSvc.getById.mockResolvedValue({ data: { ...BASE_PATIENT, bloodGroup: null } });

    renderPatientDetail();
    await waitForFullPageLoad();

    const rows = screen.getAllByText(/patients:form\.bloodGroup/);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => expect(row).toHaveTextContent('common:noData'));
  });
});
