import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle, Loader2, UserPlus } from 'lucide-react';
import { patientEmergencyContactService } from '../services/api';

export const EMERGENCY_CONTACT_TYPES = ['SPOUSE', 'PARENT', 'GUARDIAN', 'CHILD', 'SIBLING', 'OTHER'] as const;
export type EmergencyContactType = (typeof EMERGENCY_CONTACT_TYPES)[number];

export interface PatientEmergencyContact {
  id: string;
  contactType: EmergencyContactType;
  fullName: string;
  phone: string;
  phoneCountryCode: string | null;
  email: string | null;
  occupation: string | null;
  isPrimary: boolean;
  isLegalDecisionMaker: boolean;
}

interface Props {
  patientId: string;
  contact?: PatientEmergencyContact | null;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * US-01.2 — shared add/edit form for patient emergency contacts. Used by both
 * "add contact" and "edit contact" flows (single component, per task scope)
 * from PatientEmergencyContactsPanel.
 */
const PatientEmergencyContactForm: React.FC<Props> = ({ patientId, contact, onClose, onSuccess }) => {
  const { t } = useTranslation('patients');
  const isEdit = !!contact;

  const [contactType, setContactType] = useState<EmergencyContactType>(contact?.contactType ?? 'OTHER');
  const [fullName, setFullName] = useState(contact?.fullName ?? '');
  const [phoneCountryCode, setPhoneCountryCode] = useState(contact?.phoneCountryCode ?? '+90');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [occupation, setOccupation] = useState(contact?.occupation ?? '');
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false);
  const [isLegalDecisionMaker, setIsLegalDecisionMaker] = useState(contact?.isLegalDecisionMaker ?? false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError(t('detail.emergencyContacts.form.fullNameRequired'));
      return;
    }
    if (!phone.trim()) {
      setError(t('detail.emergencyContacts.form.phoneRequired'));
      return;
    }

    setSubmitting(true);
    setError('');
    const payload = {
      contactType,
      fullName: fullName.trim(),
      phone: phone.trim(),
      phoneCountryCode: phoneCountryCode.trim() || null,
      email: email.trim() || null,
      occupation: occupation.trim() || null,
      isPrimary,
      isLegalDecisionMaker,
    };

    try {
      if (isEdit && contact) {
        await patientEmergencyContactService.update(patientId, contact.id, payload);
      } else {
        await patientEmergencyContactService.create(patientId, payload);
      }
      onSuccess();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? t('detail.emergencyContacts.form.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !submitting && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <UserPlus size={18} className="text-primary-600" />
            <h3 className="font-semibold text-gray-900">
              {isEdit ? t('detail.emergencyContacts.editTitle') : t('detail.emergencyContacts.addTitle')}
            </h3>
          </div>
          <button type="button" onClick={() => !submitting && onClose()} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('detail.emergencyContacts.form.contactType')}
            </label>
            <select
              value={contactType}
              onChange={(e) => setContactType(e.target.value as EmergencyContactType)}
              className="input-field"
            >
              {EMERGENCY_CONTACT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`detail.emergencyContacts.types.${type}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('detail.emergencyContacts.form.fullName')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input-field"
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('detail.emergencyContacts.form.phoneCountryCode')}
              </label>
              <input
                type="text"
                value={phoneCountryCode}
                onChange={(e) => setPhoneCountryCode(e.target.value)}
                className="input-field"
                placeholder="+90"
                maxLength={5}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('detail.emergencyContacts.form.phone')} <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input-field"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('detail.emergencyContacts.form.email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('detail.emergencyContacts.form.occupation')}
            </label>
            <input
              type="text"
              value={occupation}
              onChange={(e) => setOccupation(e.target.value)}
              className="input-field"
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} className="rounded" />
              {t('detail.emergencyContacts.form.isPrimary')}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={isLegalDecisionMaker}
                onChange={(e) => setIsLegalDecisionMaker(e.target.checked)}
                className="rounded"
              />
              {t('detail.emergencyContacts.form.isLegalDecisionMaker')}
            </label>
          </div>

          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <AlertTriangle size={13} />
              {error}
            </p>
          )}

          <div className="pt-2 flex justify-end gap-3 border-t -mx-5 px-5 pb-1 mt-4">
            <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary">
              {t('common:cancel')}
            </button>
            <button type="submit" disabled={submitting} className="btn-primary flex items-center gap-2">
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {t('common:save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PatientEmergencyContactForm;
