import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertTriangle, Plus, Edit2, Trash2, Star, ShieldCheck, Mail, Briefcase, Phone, Users } from 'lucide-react';
import { patientEmergencyContactService } from '../services/api';
import PatientEmergencyContactForm, { type PatientEmergencyContact } from './PatientEmergencyContactForm';

interface Props {
  patientId: string;
  canManage: boolean;
  /** US-01.2: true when the patient is under 18 (see isMinorPatient in patientDetailTabsHelpers.ts). The "no legal decision-maker on record" check against loaded contacts happens inside this component. */
  isMinor: boolean;
}

/**
 * US-01.2 — Patient Detail "Emergency Contacts" tab: list existing contacts,
 * add/edit via the shared PatientEmergencyContactForm, delete with
 * confirmation. The single-primary invariant and BILLING exclusion are
 * enforced server-side (server/src/routes/patientEmergencyContacts.ts) —
 * this panel only reflects what the API returns/accepts.
 */
const PatientEmergencyContactsPanel: React.FC<Props> = ({ patientId, canManage, isMinor }) => {
  const { t } = useTranslation('patients');
  const [contacts, setContacts] = useState<PatientEmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [formState, setFormState] = useState<{ mode: 'add' } | { mode: 'edit'; contact: PatientEmergencyContact } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await patientEmergencyContactService.getAll(patientId);
      setContacts(res.data ?? []);
    } catch {
      setContacts([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  const showMinorWarning = !loading && !loadError && isMinor && !contacts.some((c) => c.isLegalDecisionMaker);

  const handleDelete = async (contact: PatientEmergencyContact) => {
    if (!window.confirm(t('detail.emergencyContacts.deleteConfirm'))) return;
    setDeletingId(contact.id);
    setDeleteError('');
    try {
      await patientEmergencyContactService.remove(patientId, contact.id);
      await loadContacts();
    } catch {
      setDeleteError(t('detail.emergencyContacts.deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-lg flex items-center gap-2">
          <Users size={18} className="text-primary-600" />
          {t('detail.emergencyContacts.title')}
        </h3>
        {canManage && (
          <button onClick={() => setFormState({ mode: 'add' })} className="btn-primary py-1.5 text-xs">
            <Plus size={16} />
            {t('detail.emergencyContacts.addNew')}
          </button>
        )}
      </div>

      {showMinorWarning && (
        <div role="alert" className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{t('detail.emergencyContacts.minorWarning')}</span>
        </div>
      )}

      {deleteError && (
        <div role="alert" className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">
          <AlertTriangle size={15} />
          {deleteError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 size={24} className="animate-spin text-primary-600" />
        </div>
      ) : loadError ? (
        <div role="alert" className="text-center py-12 text-red-500 bg-gray-50 rounded-xl border-2 border-dashed">
          {t('common:errorGeneric')}
        </div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed">
          {t('detail.emergencyContacts.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {contacts.map((contact) => (
            <div key={contact.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-900 truncate">{contact.fullName}</p>
                    <span className="badge badge-gray text-xs">
                      {t(`detail.emergencyContacts.types.${contact.contactType}`)}
                    </span>
                    {contact.isPrimary && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                        <Star size={11} />
                        {t('detail.emergencyContacts.primary')}
                      </span>
                    )}
                    {contact.isLegalDecisionMaker && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                        <ShieldCheck size={11} />
                        {t('detail.emergencyContacts.legalDecisionMaker')}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <Phone size={14} className="text-gray-400 flex-shrink-0" />
                      <span>{[contact.phoneCountryCode, contact.phone].filter(Boolean).join(' ')}</span>
                    </div>
                    {contact.email && (
                      <div className="flex items-center gap-2">
                        <Mail size={14} className="text-gray-400 flex-shrink-0" />
                        <span className="truncate">{contact.email}</span>
                      </div>
                    )}
                    {contact.occupation && (
                      <div className="flex items-center gap-2">
                        <Briefcase size={14} className="text-gray-400 flex-shrink-0" />
                        <span className="truncate">{contact.occupation}</span>
                      </div>
                    )}
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setFormState({ mode: 'edit', contact })}
                      className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                      title={t('detail.emergencyContacts.edit') as string}
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(contact)}
                      disabled={deletingId === contact.id}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      title={t('detail.emergencyContacts.delete') as string}
                    >
                      {deletingId === contact.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {formState && (
        <PatientEmergencyContactForm
          patientId={patientId}
          contact={formState.mode === 'edit' ? formState.contact : null}
          observedCurrentPrimaryContactId={contacts.find((c) => c.isPrimary)?.id ?? null}
          onClose={() => setFormState(null)}
          onSuccess={() => {
            setFormState(null);
            loadContacts();
          }}
        />
      )}
    </div>
  );
};

export default PatientEmergencyContactsPanel;
