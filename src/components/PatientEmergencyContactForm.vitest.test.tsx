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
});
