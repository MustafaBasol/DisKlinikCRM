/**
 * PatientEmergencyContactsPanel.vitest.test.tsx — US-01.2 list/empty/error
 * states and the non-blocking minor-without-legal-decision-maker warning.
 *
 * Mocks patientEmergencyContactService and react-i18next, following the
 * pattern in PatientDetail.vitest.test.tsx / PatientEmergencyContactForm.vitest.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import PatientEmergencyContactsPanel from './PatientEmergencyContactsPanel';
import { patientEmergencyContactService } from '../services/api';
import type { PatientEmergencyContact } from './PatientEmergencyContactForm';

vi.mock('../services/api', () => ({
  patientEmergencyContactService: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const mockT = (key: string, opts?: any) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

const svc = patientEmergencyContactService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const contact = (overrides: Partial<PatientEmergencyContact> = {}): PatientEmergencyContact => ({
  id: 'contact-1',
  contactType: 'PARENT',
  fullName: 'Ayşe Yılmaz',
  phone: '05551234567',
  phoneCountryCode: '+90',
  email: null,
  occupation: null,
  isPrimary: false,
  isLegalDecisionMaker: false,
  ...overrides,
});

describe('PatientEmergencyContactsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty state when there are no contacts', async () => {
    svc.getAll.mockResolvedValue({ data: [] });
    render(<PatientEmergencyContactsPanel patientId="patient-1" canManage={true} isMinor={false} />);
    expect(await screen.findByText('detail.emergencyContacts.empty')).toBeInTheDocument();
  });

  it('renders each contact once the list loads', async () => {
    svc.getAll.mockResolvedValue({
      data: [contact({ id: 'a', fullName: 'Ayşe Yılmaz' }), contact({ id: 'b', fullName: 'Mehmet Yılmaz', contactType: 'SIBLING' })],
    });
    render(<PatientEmergencyContactsPanel patientId="patient-1" canManage={true} isMinor={false} />);
    expect(await screen.findByText('Ayşe Yılmaz')).toBeInTheDocument();
    expect(screen.getByText('Mehmet Yılmaz')).toBeInTheDocument();
  });

  it('shows a generic error state when the list fetch fails', async () => {
    svc.getAll.mockRejectedValue(new Error('network error'));
    render(<PatientEmergencyContactsPanel patientId="patient-1" canManage={true} isMinor={false} />);
    expect(await screen.findByText('common:errorGeneric')).toBeInTheDocument();
  });

  it('shows the primary and legal-decision-maker badges', async () => {
    svc.getAll.mockResolvedValue({ data: [contact({ isPrimary: true, isLegalDecisionMaker: true })] });
    render(<PatientEmergencyContactsPanel patientId="patient-1" canManage={true} isMinor={false} />);
    await screen.findByText('Ayşe Yılmaz');
    expect(screen.getByText('detail.emergencyContacts.primary')).toBeInTheDocument();
    expect(screen.getByText('detail.emergencyContacts.legalDecisionMaker')).toBeInTheDocument();
  });

  it('hides edit/delete actions and the add button when canManage is false', async () => {
    svc.getAll.mockResolvedValue({ data: [contact()] });
    render(<PatientEmergencyContactsPanel patientId="patient-1" canManage={false} isMinor={false} />);
    await screen.findByText('Ayşe Yılmaz');
    expect(screen.queryByText('detail.emergencyContacts.addNew')).not.toBeInTheDocument();
    expect(screen.queryByTitle('detail.emergencyContacts.edit')).not.toBeInTheDocument();
    expect(screen.queryByTitle('detail.emergencyContacts.delete')).not.toBeInTheDocument();
  });

  it('minor warning: shown when isMinor=true and no contact is a legal decision-maker', async () => {
    svc.getAll.mockResolvedValue({ data: [contact({ isLegalDecisionMaker: false })] });
    render(<PatientEmergencyContactsPanel patientId="patient-1" canManage={true} isMinor={true} />);
    expect(await screen.findByText('detail.emergencyContacts.minorWarning')).toBeInTheDocument();
  });

  it('minor warning: not shown when isMinor=true but a legal decision-maker exists', async () => {
    svc.getAll.mockResolvedValue({ data: [contact({ isLegalDecisionMaker: true })] });
    render(<PatientEmergencyContactsPanel patientId="patient-1" canManage={true} isMinor={true} />);
    await screen.findByText('Ayşe Yılmaz');
    expect(screen.queryByText('detail.emergencyContacts.minorWarning')).not.toBeInTheDocument();
  });

  it('minor warning: not shown when the patient is not a minor, regardless of contacts', async () => {
    svc.getAll.mockResolvedValue({ data: [] });
    render(<PatientEmergencyContactsPanel patientId="patient-1" canManage={true} isMinor={false} />);
    await screen.findByText('detail.emergencyContacts.empty');
    expect(screen.queryByText('detail.emergencyContacts.minorWarning')).not.toBeInTheDocument();
  });

  it('minor warning is non-blocking: add/edit/delete controls remain usable while it is shown', async () => {
    svc.getAll.mockResolvedValue({ data: [contact()] });
    render(<PatientEmergencyContactsPanel patientId="patient-1" canManage={true} isMinor={true} />);
    await screen.findByText('detail.emergencyContacts.minorWarning');
    expect(screen.getByText('detail.emergencyContacts.addNew')).toBeEnabled();
  });

  it('delete: confirms, calls remove(), and reloads the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    svc.getAll
      .mockResolvedValueOnce({ data: [contact()] })
      .mockResolvedValueOnce({ data: [] });
    svc.remove.mockResolvedValue({});

    render(<PatientEmergencyContactsPanel patientId="patient-1" canManage={true} isMinor={false} />);
    await screen.findByText('Ayşe Yılmaz');

    fireEvent.click(screen.getByTitle('detail.emergencyContacts.delete'));

    await waitFor(() => expect(svc.remove).toHaveBeenCalledWith('patient-1', 'contact-1'));
    await waitFor(() => expect(screen.getByText('detail.emergencyContacts.empty')).toBeInTheDocument());
  });

  it('delete: skipped entirely when the user cancels the confirm dialog', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    svc.getAll.mockResolvedValue({ data: [contact()] });

    render(<PatientEmergencyContactsPanel patientId="patient-1" canManage={true} isMinor={false} />);
    await screen.findByText('Ayşe Yılmaz');

    fireEvent.click(screen.getByTitle('detail.emergencyContacts.delete'));

    expect(svc.remove).not.toHaveBeenCalled();
  });
});
