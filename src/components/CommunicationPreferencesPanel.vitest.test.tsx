/**
 * CommunicationPreferencesPanel.vitest.test.tsx — KVKK-HIGH-008 consent-action
 * modal validation UX + conflict correction workflow tests.
 *
 * Mocks the API service, react-i18next (t() returns the raw key or its
 * `defaultValue`, so assertions target stable keys rather than
 * locale-specific copy) and the clinic-preferences context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import CommunicationPreferencesPanel from './CommunicationPreferencesPanel';
import { communicationPreferencesService } from '../services/api';

vi.mock('../services/api', () => ({
  communicationPreferencesService: {
    getMatrix: vi.fn(),
    getHistory: vi.fn(),
    exportEvidence: vi.fn(),
    setPreference: vi.fn(),
    bulkSetPreferences: vi.fn(),
    submitLegacySmsOptOutCorrection: vi.fn(),
    getLegacyCorrections: vi.fn(),
    getLegacyCorrectionDetail: vi.fn(),
  },
}));

// A stable `t` reference matters here, not just convenience: the real
// react-i18next memoizes `t` across re-renders (same language/namespace), and
// CommunicationPreferencesPanel depends on that stability (`t` is a
// loadMatrix/useCallback dependency). A mock that returns a fresh function
// identity on every call would retrigger the load effect on every render —
// an infinite fetch loop — which is exactly what happened before this was
// hoisted out to a module-level constant.
const mockT = (key: string, opts?: any) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('../context/ClinicPreferencesContext', () => ({
  useClinicPreferences: () => ({ formatDate: (d: string) => d }),
}));

const svc = communicationPreferencesService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const CONFLICT_MATRIX = [
  {
    channel: 'sms', purpose: 'marketing', isPolicyException: false,
    decision: { allowed: false, reasonCode: 'legacy_central_conflict' },
    preference: { id: 'p1', status: 'granted', effectiveAt: '', grantedAt: '', withdrawnAt: null, source: 'staff', evidenceType: null, noticeVersion: null, actorUserId: null, actorPlatformAdminId: null, updatedAt: '' },
    legacyConflict: { detected: true, reasonCode: 'legacy_central_conflict' },
  },
];

function renderPanel(props: Partial<React.ComponentProps<typeof CommunicationPreferencesPanel>> = {}) {
  return render(
    <CommunicationPreferencesPanel
      patientId="patient-1"
      canManage
      canCorrectLegacyConsent
      legacySignals={{ communicationConsent: false, marketingConsent: false, smsOptOut: true }}
      onLegacySignalsChanged={vi.fn()}
      {...props}
    />,
  );
}

async function waitForLoaded() {
  // The summary bar only renders once `loading` becomes false — a reliable
  // signal that the matrix has finished its initial fetch, unlike the header
  // title (always present, loading or not).
  await screen.findByTestId('consent-summary-bar');
}

async function openManageMenuFor(purposeKey: string) {
  const row = screen.getByText(`purposes.${purposeKey}`).closest('div')!;
  await userEvent.click(within(row).getByRole('button', { name: 'actions.manage' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  svc.getMatrix.mockResolvedValue({ data: { matrix: CONFLICT_MATRIX } });
  svc.getLegacyCorrections.mockResolvedValue({ data: { items: [], pageInfo: { hasMore: false, nextCursor: null } } });
});

describe('CommunicationPreferencesPanel — consent-action modal validation', () => {
  it('a grant with the default (staff) source dynamically shows Notes as required — label and placeholder never say optional', async () => {
    const { container } = renderPanel();
    await waitForLoaded();
    await openManageMenuFor('survey');
    await userEvent.click(screen.getByRole('button', { name: 'actions.grant' }));

    // Label text itself is stable ("fields.notes") — required-ness is
    // signaled only by the adjacent asterisk, never a second/duplicated
    // "required" label string (regression guard for a real double-asterisk
    // bug this exact assertion caught: the label used to read "Notlar * *").
    const notesLabel = container.querySelector('label[for="consent-notes"]');
    expect(notesLabel?.textContent).toBe('fields.notes *');
    const notesField = screen.getByPlaceholderText('fields.notesRequiredPlaceholder');
    expect(notesField).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('fields.notesPlaceholder')).not.toBeInTheDocument();
  });

  it('submitting with empty required Notes shows an inline error and moves focus to Notes, preserving other entered values', async () => {
    renderPanel();
    await waitForLoaded();
    await openManageMenuFor('survey');
    await userEvent.click(screen.getByRole('button', { name: 'actions.grant' }));

    const noticeVersionField = screen.getByPlaceholderText('fields.noticeVersionPlaceholder') as HTMLInputElement;
    await userEvent.type(noticeVersionField, 'kept-value');

    await userEvent.click(screen.getByRole('button', { name: 'actions.confirm' }));

    const notesField = screen.getByPlaceholderText('fields.notesRequiredPlaceholder');
    expect(screen.getByText('fields.notesRequiredHint')).toBeInTheDocument();
    expect(notesField).toHaveFocus();
    expect(notesField).toHaveAttribute('aria-invalid', 'true');
    expect(noticeVersionField.value).toBe('kept-value');
    expect(svc.setPreference).not.toHaveBeenCalled();
  });

  it('a grant from a digital source (patient_portal) requires noticeVersion, not notes', async () => {
    const { container } = renderPanel();
    await waitForLoaded();
    await openManageMenuFor('survey');
    await userEvent.click(screen.getByRole('button', { name: 'actions.grant' }));

    const sourceSelect = screen.getAllByRole('combobox')[1] as HTMLSelectElement; // [0] evidenceType, [1] source
    await userEvent.selectOptions(sourceSelect, 'patient_portal');

    // No longer required — no asterisk next to the (unchanged) label text.
    expect(container.querySelector('label[for="consent-notes"]')?.textContent?.trim()).toBe('fields.notes');

    await userEvent.click(screen.getByRole('button', { name: 'actions.confirm' }));
    const noticeVersionField = screen.getByPlaceholderText('fields.noticeVersionRequiredPlaceholder');
    expect(noticeVersionField).toHaveFocus();
    expect(screen.getByText('fields.noticeVersionRequiredHint')).toBeInTheDocument();
  });

  it('deny/withdraw never require noticeVersion and submit immediately with empty fields', async () => {
    svc.setPreference.mockResolvedValue({ data: {} });
    renderPanel();
    await waitForLoaded();
    await openManageMenuFor('survey');
    await userEvent.click(screen.getByRole('button', { name: 'actions.deny' }));

    await userEvent.click(screen.getByRole('button', { name: 'actions.confirm' }));

    await waitFor(() => expect(svc.setPreference).toHaveBeenCalledTimes(1));
    expect(svc.setPreference.mock.calls[0][3].action).toBe('deny');
  });

  it('switching the action updates required indicators immediately, and stale errors clear once the field becomes valid', async () => {
    const { container } = renderPanel();
    await waitForLoaded();
    await openManageMenuFor('survey');

    const notesLabel = () => container.querySelector('label[for="consent-notes"]')?.textContent;

    await userEvent.click(screen.getByRole('button', { name: 'actions.deny' }));
    expect(notesLabel()?.trim()).toBe('fields.notes');

    await userEvent.click(screen.getByRole('button', { name: 'actions.grant' }));
    expect(notesLabel()).toBe('fields.notes *');

    await userEvent.click(screen.getByRole('button', { name: 'actions.confirm' }));
    expect(screen.getByText('fields.notesRequiredHint')).toBeInTheDocument();

    const notesField = screen.getByPlaceholderText('fields.notesRequiredPlaceholder');
    await userEvent.type(notesField, 'Patient confirmed verbally.');
    await waitFor(() => expect(screen.queryByText('fields.notesRequiredHint')).not.toBeInTheDocument());
  });

  it('is a real dialog (role, aria-modal) and closes on Escape', async () => {
    renderPanel();
    await waitForLoaded();
    await openManageMenuFor('survey');

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('CommunicationPreferencesPanel — legacy consent correction workflow (conflict UX)', () => {
  it('the "correct legacy signal" action is management-only (hidden when canCorrectLegacyConsent is false)', async () => {
    renderPanel({ canCorrectLegacyConsent: false });
    await waitForLoaded();
    await openManageMenuFor('marketing');
    expect(screen.queryByText('conflict.correctLegacyAction')).not.toBeInTheDocument();
  });

  it('the "correct legacy signal" action is visible for canCorrectLegacyConsent=true management users', async () => {
    renderPanel({ canCorrectLegacyConsent: true });
    await waitForLoaded();
    await openManageMenuFor('marketing');
    expect(screen.getByText('conflict.correctLegacyAction')).toBeInTheDocument();
  });

  it('is not a one-click action — opening the correction modal never calls the API until the form is filled and confirmed', async () => {
    renderPanel();
    await waitForLoaded();
    await openManageMenuFor('marketing');
    await userEvent.click(screen.getByText('conflict.correctLegacyAction'));

    expect(await screen.findByText('legacyCorrection.title')).toBeInTheDocument();
    expect(svc.submitLegacySmsOptOutCorrection).not.toHaveBeenCalled();
  });

  it('submitting empty required fields shows inline errors and moves focus to the reason field; filling them in and confirming calls the API exactly once (duplicate-submit guard)', async () => {
    let resolveSubmit: (v: any) => void;
    svc.submitLegacySmsOptOutCorrection.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve; }));

    renderPanel();
    await waitForLoaded();
    await openManageMenuFor('marketing');
    await userEvent.click(screen.getByText('conflict.correctLegacyAction'));
    await screen.findByText('legacyCorrection.title');

    await userEvent.click(screen.getByRole('button', { name: 'legacyCorrection.confirm' }));
    expect(screen.getByText('legacyCorrection.fields.reasonRequiredHint')).toBeInTheDocument();
    expect(svc.submitLegacySmsOptOutCorrection).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText('legacyCorrection.fields.reasonPlaceholder'), 'Legacy import mis-set this flag.');
    await userEvent.type(screen.getByPlaceholderText('legacyCorrection.fields.notesPlaceholder'), 'Confirmed by phone with the patient.');

    const confirmButton = screen.getByRole('button', { name: 'legacyCorrection.confirm' });
    // Rapid double-click while the request is in flight must not submit twice.
    await userEvent.click(confirmButton);
    await userEvent.click(confirmButton);

    expect(svc.submitLegacySmsOptOutCorrection).toHaveBeenCalledTimes(1);
    resolveSubmit!({ data: { replay: false, correction: { id: 'c1' } } });
  });

  it('success refreshes the matrix and notifies the parent to refresh legacy signals', async () => {
    svc.submitLegacySmsOptOutCorrection.mockResolvedValue({ data: { replay: false, correction: { id: 'c1' } } });
    const onLegacySignalsChanged = vi.fn();
    renderPanel({ onLegacySignalsChanged });
    await waitForLoaded();

    const initialMatrixCalls = svc.getMatrix.mock.calls.length;
    await openManageMenuFor('marketing');
    await userEvent.click(screen.getByText('conflict.correctLegacyAction'));
    await screen.findByText('legacyCorrection.title');
    await userEvent.type(screen.getByPlaceholderText('legacyCorrection.fields.reasonPlaceholder'), 'Legacy import mis-set this flag.');
    await userEvent.type(screen.getByPlaceholderText('legacyCorrection.fields.notesPlaceholder'), 'Confirmed by phone with the patient.');
    await userEvent.click(screen.getByRole('button', { name: 'legacyCorrection.confirm' }));

    await waitFor(() => expect(screen.getByText('legacyCorrection.success')).toBeInTheDocument());
    await waitFor(() => expect(svc.getMatrix.mock.calls.length).toBeGreaterThan(initialMatrixCalls));
    expect(onLegacySignalsChanged).toHaveBeenCalled();
  });

  it('renders correction history for management users, using only list-safe fields', async () => {
    svc.getLegacyCorrections.mockResolvedValue({
      data: {
        items: [{ id: 'c1', fieldName: 'SMS_OPT_OUT', previousValue: true, newValue: false, previousRecordedAt: null, evidenceType: 'patient_verbal_confirmation', correctedById: 'u1', createdAt: '2026-07-18T00:00:00.000Z' }],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    });
    renderPanel();
    await waitForLoaded();
    await userEvent.click(screen.getByText('legacySignals.title'));
    await userEvent.click(await screen.findByText('legacySignals.viewCorrectionHistory'));

    expect(await screen.findByText('legacyCorrectionHistory.smsOptOutCorrected')).toBeInTheDocument();
    expect(screen.queryByText('c1')).not.toBeInTheDocument(); // internal id never shown
  });
});
