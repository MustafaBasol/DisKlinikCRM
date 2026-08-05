/**
 * PatientEmergencyContactForm.vitest.test.tsx — US-01.2 shared add/edit form.
 *
 * Mocks patientEmergencyContactService and react-i18next (t() returns the raw
 * key, since this form has no `defaultValue` fallbacks — see
 * PatientDetail.vitest.test.tsx for the same pattern), following the
 * established component-test convention in this repo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import PatientEmergencyContactForm, { type PatientEmergencyContact } from './PatientEmergencyContactForm';
import { patientEmergencyContactService } from '../services/api';

vi.mock('../services/api', () => ({
  patientEmergencyContactService: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const mockT = (key: string, opts?: any) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

const svc = patientEmergencyContactService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const existingContact: PatientEmergencyContact = {
  id: 'contact-1',
  contactType: 'PARENT',
  fullName: 'Ayşe Yılmaz',
  phone: '05551234567',
  phoneCountryCode: '+90',
  email: 'ayse@example.com',
  occupation: 'Teacher',
  isPrimary: true,
  isLegalDecisionMaker: true,
};

describe('PatientEmergencyContactForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('add mode: blocks submit and shows an error when fullName is empty', async () => {
    const onSuccess = vi.fn();
    render(<PatientEmergencyContactForm patientId="patient-1" onClose={() => {}} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByText('common:save'));

    expect(await screen.findByText('detail.emergencyContacts.form.fullNameRequired')).toBeInTheDocument();
    expect(svc.create).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('add mode: blocks submit and shows an error when phone is empty but fullName is filled', async () => {
    render(<PatientEmergencyContactForm patientId="patient-1" onClose={() => {}} onSuccess={() => {}} />);

    const inputs = screen.getAllByRole('textbox');
    // fullName is the first plain text input after the contactType select.
    fireEvent.change(inputs[0], { target: { value: 'Ali Veli' } });
    fireEvent.click(screen.getByText('common:save'));

    expect(await screen.findByText('detail.emergencyContacts.form.phoneRequired')).toBeInTheDocument();
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('add mode: submits a valid contact and calls onSuccess', async () => {
    svc.create.mockResolvedValue({ data: { id: 'new-1' } });
    const onSuccess = vi.fn();
    render(<PatientEmergencyContactForm patientId="patient-1" onClose={() => {}} onSuccess={onSuccess} />);

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'Ali Veli' } });
    // phone input is type="tel" — not included in getAllByRole('textbox') on some jsdom versions, so query directly.
    const phoneInput = document.querySelector('input[type="tel"]') as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: '05559998877' } });

    fireEvent.click(screen.getByText('common:save'));

    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    expect(svc.create).toHaveBeenCalledWith('patient-1', expect.objectContaining({ fullName: 'Ali Veli', phone: '05559998877' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('edit mode: pre-fills fields from the existing contact', () => {
    render(<PatientEmergencyContactForm patientId="patient-1" contact={existingContact} onClose={() => {}} onSuccess={() => {}} />);
    expect(screen.getByDisplayValue('Ayşe Yılmaz')).toBeInTheDocument();
    expect(screen.getByDisplayValue('05551234567')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ayse@example.com')).toBeInTheDocument();
    expect(screen.getByText('detail.emergencyContacts.editTitle')).toBeInTheDocument();
  });

  it('edit mode: submits via update(), not create()', async () => {
    svc.update.mockResolvedValue({ data: { id: 'contact-1' } });
    const onSuccess = vi.fn();
    render(<PatientEmergencyContactForm patientId="patient-1" contact={existingContact} onClose={() => {}} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByText('common:save'));

    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    expect(svc.update).toHaveBeenCalledWith('patient-1', 'contact-1', expect.objectContaining({ fullName: 'Ayşe Yılmaz' }));
    expect(svc.create).not.toHaveBeenCalled();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows the server-provided error message when the API call fails', async () => {
    svc.update.mockRejectedValue({ response: { data: { error: 'phone is required when fullName is provided' } } });
    render(<PatientEmergencyContactForm patientId="patient-1" contact={existingContact} onClose={() => {}} onSuccess={() => {}} />);

    fireEvent.click(screen.getByText('common:save'));

    expect(await screen.findByText('phone is required when fullName is provided')).toBeInTheDocument();
  });

  // ─── F1-004-P1-R2-R3: expectedCurrentPrimaryContactId precondition ───────

  it('add mode + isPrimary checked: sends expectedCurrentPrimaryContactId matching the observed current primary', async () => {
    svc.create.mockResolvedValue({ data: { id: 'new-1' } });
    render(
      <PatientEmergencyContactForm
        patientId="patient-1"
        observedCurrentPrimaryContactId="old-primary-id"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Ali Veli' } });
    fireEvent.change(document.querySelector('input[type="tel"]') as HTMLInputElement, { target: { value: '05559998877' } });
    fireEvent.click(screen.getAllByRole('checkbox')[0]); // isPrimary
    fireEvent.click(screen.getByText('common:save'));

    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    expect(svc.create).toHaveBeenCalledWith(
      'patient-1',
      expect.objectContaining({ isPrimary: true, expectedCurrentPrimaryContactId: 'old-primary-id' }),
    );
  });

  it('add mode + isPrimary checked + no observed primary: sends expectedCurrentPrimaryContactId: null explicitly', async () => {
    svc.create.mockResolvedValue({ data: { id: 'new-1' } });
    render(<PatientEmergencyContactForm patientId="patient-1" onClose={() => {}} onSuccess={() => {}} />);

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Ali Veli' } });
    fireEvent.change(document.querySelector('input[type="tel"]') as HTMLInputElement, { target: { value: '05559998877' } });
    fireEvent.click(screen.getAllByRole('checkbox')[0]); // isPrimary
    fireEvent.click(screen.getByText('common:save'));

    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    const payload = svc.create.mock.calls[0][1];
    expect('expectedCurrentPrimaryContactId' in payload).toBe(true);
    expect(payload.expectedCurrentPrimaryContactId).toBeNull();
  });

  it('add mode + isPrimary left unchecked: never sends expectedCurrentPrimaryContactId', async () => {
    svc.create.mockResolvedValue({ data: { id: 'new-1' } });
    render(
      <PatientEmergencyContactForm
        patientId="patient-1"
        observedCurrentPrimaryContactId="old-primary-id"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Ali Veli' } });
    fireEvent.change(document.querySelector('input[type="tel"]') as HTMLInputElement, { target: { value: '05559998877' } });
    fireEvent.click(screen.getByText('common:save'));

    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    const payload = svc.create.mock.calls[0][1];
    expect('expectedCurrentPrimaryContactId' in payload).toBe(false);
  });

  it('edit mode: a non-primary contact being promoted sends expectedCurrentPrimaryContactId from the observed primary', async () => {
    svc.update.mockResolvedValue({ data: { id: 'contact-2' } });
    const nonPrimaryContact: PatientEmergencyContact = { ...existingContact, id: 'contact-2', isPrimary: false };
    render(
      <PatientEmergencyContactForm
        patientId="patient-1"
        contact={nonPrimaryContact}
        observedCurrentPrimaryContactId="contact-1"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );

    fireEvent.click(screen.getAllByRole('checkbox')[0]); // isPrimary: false -> true
    fireEvent.click(screen.getByText('common:save'));

    await waitFor(() => expect(svc.update).toHaveBeenCalledTimes(1));
    expect(svc.update).toHaveBeenCalledWith(
      'patient-1',
      'contact-2',
      expect.objectContaining({ isPrimary: true, expectedCurrentPrimaryContactId: 'contact-1' }),
    );
  });
});
