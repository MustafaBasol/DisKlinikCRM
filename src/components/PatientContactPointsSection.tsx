import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Edit2, Loader2, Phone, Plus, Trash2, X } from 'lucide-react';
import { patientContactPointService } from '../services/api';

export const PATIENT_CONTACT_POINT_TYPES = ['mobile', 'home', 'work', 'other'] as const;
export type PatientContactPointType = (typeof PATIENT_CONTACT_POINT_TYPES)[number];

export interface PatientContactPoint {
  id: string;
  contactType: PatientContactPointType;
  value: string;
  normalizedValue: string | null;
  label: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Defensive label resolution, same shape as PatientDetail's genderLabel /
 * bloodGroupLabel: a contactType this build has no label for still renders
 * (as "other") instead of leaking a raw i18n key into the UI.
 */
export function contactPointTypeLabelKey(contactType: string): string {
  const known = (PATIENT_CONTACT_POINT_TYPES as readonly string[]).includes(contactType);
  return `patients:form.secondaryPhones.types.${known ? contactType : 'other'}`;
}

interface Props {
  /**
   * F3-DATA-MIG-TODAY-001-R10 — CREATE-mode decision: `null` means "this
   * patient does not exist yet". There is no id to POST
   * /patients/:patientId/contact-points against, so the section renders a
   * disabled placeholder with an explanatory hint instead of buffering rows
   * locally. Buffering would require a partial-failure story (patient
   * created, contact-point POSTs rejected) that this codebase has no
   * primitive for — no toast layer, no rollback — and would silently drop
   * user input. Secondary numbers are added on the follow-up edit.
   */
  patientId: string | null;
}

type Draft = { contactType: PatientContactPointType; value: string; label: string };

const EMPTY_DRAFT: Draft = { contactType: 'mobile', value: '', label: '' };

/**
 * F3-DATA-MIG-TODAY-001-R10 — "secondary phone numbers" sub-section of
 * PatientForm. Deliberately NOT a <form> element: it is rendered INSIDE
 * PatientForm's <form>, and nested forms are invalid HTML. Every control is
 * type="button" and Enter inside a field is intercepted so it commits the
 * row instead of submitting (and closing) the whole patient modal.
 *
 * Rows are persisted immediately against the contact-points sub-resource —
 * they are not part of the patient PUT payload, exactly like the identity
 * sub-resource.
 */
const PatientContactPointsSection: React.FC<Props> = ({ patientId }) => {
  const { t } = useTranslation(['patients', 'common']);
  const [contactPoints, setContactPoints] = useState<PatientContactPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  // Inline (in-row) delete confirmation — see the removal-UX note in the
  // component header of PatientForm.tsx.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!patientId) {
      setContactPoints([]);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const res = await patientContactPointService.getAll(patientId);
      setContactPoints(res.data?.contactPoints ?? []);
    } catch {
      setContactPoints([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  const resetAdd = () => { setAddOpen(false); setAddDraft(EMPTY_DRAFT); };
  const resetEdit = () => { setEditingId(null); setEditDraft(EMPTY_DRAFT); };

  const handleAdd = async () => {
    if (!patientId) return;
    if (!addDraft.value.trim()) {
      setError(t('patients:form.secondaryPhones.valueRequired'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await patientContactPointService.create(patientId, {
        contactType: addDraft.contactType,
        value: addDraft.value.trim(),
        label: addDraft.label.trim() || null,
      });
      resetAdd();
      await load();
    } catch (err: any) {
      setError(
        typeof err?.response?.data?.error === 'string'
          ? err.response.data.error
          : t('patients:form.secondaryPhones.saveFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (contactPointId: string) => {
    if (!patientId) return;
    if (!editDraft.value.trim()) {
      setError(t('patients:form.secondaryPhones.valueRequired'));
      return;
    }
    setBusyId(contactPointId);
    setError('');
    try {
      await patientContactPointService.update(patientId, contactPointId, {
        contactType: editDraft.contactType,
        value: editDraft.value.trim(),
        label: editDraft.label.trim() || null,
      });
      resetEdit();
      await load();
    } catch (err: any) {
      setError(
        typeof err?.response?.data?.error === 'string'
          ? err.response.data.error
          : t('patients:form.secondaryPhones.saveFailed'),
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (contactPointId: string) => {
    if (!patientId) return;
    setBusyId(contactPointId);
    setError('');
    try {
      await patientContactPointService.remove(patientId, contactPointId);
      setConfirmDeleteId(null);
      await load();
    } catch {
      setError(t('patients:form.secondaryPhones.deleteFailed'));
    } finally {
      setBusyId(null);
    }
  };

  // Enter must never bubble to PatientForm's <form> onSubmit: inside this
  // sub-section it commits the row being edited, and Escape backs out.
  const draftKeyDown = (e: React.KeyboardEvent, onEnter: () => void, onEscape: () => void) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onEnter(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); }
  };

  const typeSelect = (draft: Draft, setDraft: (d: Draft) => void, id: string) => (
    <div>
      <label className="label" htmlFor={id}>{t('patients:form.secondaryPhones.contactType')}</label>
      <select
        id={id}
        value={draft.contactType}
        onChange={(e) => setDraft({ ...draft, contactType: e.target.value as PatientContactPointType })}
        className="input-field"
      >
        {PATIENT_CONTACT_POINT_TYPES.map((type) => (
          <option key={type} value={type}>{t(contactPointTypeLabelKey(type))}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="pt-6 border-t border-gray-50 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Phone size={16} className="text-gray-400" />
            {t('patients:form.secondaryPhones.title')}
          </h3>
          <p className="text-xs text-gray-400 mt-1">{t('patients:form.secondaryPhones.description')}</p>
        </div>
        {patientId && !addOpen && (
          <button
            type="button"
            onClick={() => { setAddOpen(true); setError(''); }}
            className="btn-secondary py-1.5 text-xs shrink-0"
          >
            <Plus size={14} />
            {t('patients:form.secondaryPhones.addNew')}
          </button>
        )}
      </div>

      {!patientId ? (
        <p className="text-xs text-gray-500 bg-gray-50 border border-dashed border-gray-200 rounded-xl p-3">
          {t('patients:form.secondaryPhones.availableAfterCreate')}
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="text-xs text-red-500 flex items-center gap-1">
              <AlertTriangle size={13} className="shrink-0" />
              {error}
            </p>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={18} className="animate-spin text-primary-600" />
            </div>
          ) : loadError ? (
            <p role="alert" className="text-xs text-red-500">{t('patients:form.secondaryPhones.loadFailed')}</p>
          ) : contactPoints.length === 0 && !addOpen ? (
            <p className="text-xs text-gray-400 italic">{t('patients:form.secondaryPhones.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {contactPoints.map((cp) => (
                <li key={cp.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  {editingId === cp.id ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {typeSelect(editDraft, setEditDraft, `contact-point-type-${cp.id}`)}
                        <div>
                          <label className="label" htmlFor={`contact-point-value-${cp.id}`}>
                            {t('patients:form.secondaryPhones.value')}
                          </label>
                          <input
                            id={`contact-point-value-${cp.id}`}
                            value={editDraft.value}
                            onChange={(e) => setEditDraft({ ...editDraft, value: e.target.value })}
                            onKeyDown={(e) => draftKeyDown(e, () => handleUpdate(cp.id), resetEdit)}
                            className="input-field"
                            placeholder={t('patients:form.secondaryPhones.valuePlaceholder')}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="label" htmlFor={`contact-point-label-${cp.id}`}>
                          {t('patients:form.secondaryPhones.label')}
                        </label>
                        <input
                          id={`contact-point-label-${cp.id}`}
                          value={editDraft.label}
                          onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })}
                          onKeyDown={(e) => draftKeyDown(e, () => handleUpdate(cp.id), resetEdit)}
                          className="input-field"
                          placeholder={t('patients:form.secondaryPhones.labelPlaceholder')}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleUpdate(cp.id)}
                          disabled={busyId === cp.id}
                          className="btn-primary py-1.5 text-xs disabled:opacity-50"
                        >
                          {busyId === cp.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          {t('common:save')}
                        </button>
                        <button type="button" onClick={resetEdit} className="btn-secondary py-1.5 text-xs">
                          {t('common:cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="badge badge-gray text-xs">{t(contactPointTypeLabelKey(cp.contactType))}</span>
                          <span className="font-medium text-gray-900 truncate">{cp.value}</span>
                        </div>
                        {cp.label && <p className="text-xs text-gray-500 mt-1 truncate">{cp.label}</p>}
                      </div>
                      {confirmDeleteId === cp.id ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-gray-600">{t('patients:form.secondaryPhones.deleteConfirm')}</span>
                          <button
                            type="button"
                            onClick={() => handleDelete(cp.id)}
                            disabled={busyId === cp.id}
                            className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            {busyId === cp.id ? t('common:loading') : t('patients:form.secondaryPhones.deleteConfirmYes')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-gray-500 hover:text-gray-700"
                          >
                            {t('common:cancel')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setError('');
                              setConfirmDeleteId(null);
                              setEditingId(cp.id);
                              setEditDraft({
                                contactType: cp.contactType,
                                value: cp.value ?? '',
                                label: cp.label ?? '',
                              });
                            }}
                            className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                            title={t('patients:form.secondaryPhones.edit') as string}
                            aria-label={t('patients:form.secondaryPhones.edit') as string}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setError(''); setEditingId(null); setConfirmDeleteId(cp.id); }}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title={t('patients:form.secondaryPhones.delete') as string}
                            aria-label={t('patients:form.secondaryPhones.delete') as string}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {addOpen && (
            <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">{t('patients:form.secondaryPhones.addTitle')}</p>
                <button
                  type="button"
                  onClick={resetAdd}
                  className="p-1 text-gray-400 hover:text-gray-600"
                  aria-label={t('common:cancel') as string}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {typeSelect(addDraft, setAddDraft, 'contact-point-type-new')}
                <div>
                  <label className="label" htmlFor="contact-point-value-new">
                    {t('patients:form.secondaryPhones.value')}
                  </label>
                  <input
                    id="contact-point-value-new"
                    value={addDraft.value}
                    onChange={(e) => setAddDraft({ ...addDraft, value: e.target.value })}
                    onKeyDown={(e) => draftKeyDown(e, handleAdd, resetAdd)}
                    className="input-field"
                    placeholder={t('patients:form.secondaryPhones.valuePlaceholder')}
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="contact-point-label-new">
                  {t('patients:form.secondaryPhones.label')}
                </label>
                <input
                  id="contact-point-label-new"
                  value={addDraft.label}
                  onChange={(e) => setAddDraft({ ...addDraft, label: e.target.value })}
                  onKeyDown={(e) => draftKeyDown(e, handleAdd, resetAdd)}
                  className="input-field"
                  placeholder={t('patients:form.secondaryPhones.labelPlaceholder')}
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={saving}
                  className="btn-primary py-1.5 text-xs disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {t('patients:form.secondaryPhones.add')}
                </button>
                <button type="button" onClick={resetAdd} className="btn-secondary py-1.5 text-xs">
                  {t('common:cancel')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PatientContactPointsSection;
