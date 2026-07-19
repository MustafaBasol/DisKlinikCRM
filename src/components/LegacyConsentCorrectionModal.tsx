import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { communicationPreferencesService } from '../services/api';

const EVIDENCE_TYPES = ['patient_verbal_confirmation', 'signed_form', 'documented_import_error', 'other_verified_source'] as const;

interface Props {
  open: boolean;
  patientId: string;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * KVKK-HIGH-008: confirmation-first workflow for marking a legacy
 * Patient.smsOptOut=true value as stale/incorrect. This is NOT a one-click
 * action — it requires reason + evidence type + notes and shows the
 * current→proposed value explicitly before submitting. It never grants
 * consent and never touches the central preference system; it only corrects
 * the legacy field via the dedicated, audited API.
 */
const LegacyConsentCorrectionModal: React.FC<Props> = ({ open, patientId, onClose, onSuccess }) => {
  const { t } = useTranslation('communicationConsent');
  const [correctionReason, setCorrectionReason] = useState('');
  const [notes, setNotes] = useState('');
  const [evidenceType, setEvidenceType] = useState<string>(EVIDENCE_TYPES[0]);
  const [sourceReference, setSourceReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [inFlight, setInFlight] = useState(false); // duplicate-submit guard, independent of submitting's render timing
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [touched, setTouched] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    // Fresh state (including a fresh idempotency key) every time the modal
    // is opened anew — a stale key from a prior, already-resolved session
    // must never be silently reused.
    setCorrectionReason('');
    setNotes('');
    setEvidenceType(EVIDENCE_TYPES[0]);
    setSourceReference('');
    setError('');
    setSuccess(false);
    setTouched(false);
    setIdempotencyKey(crypto.randomUUID());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTarget = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? dialogRef.current;
    focusTarget?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, submitting]);

  if (!open) return null;

  const reasonInvalid = touched && !correctionReason.trim();
  const notesInvalid = touched && !notes.trim();
  const canSubmit = correctionReason.trim().length > 0 && notes.trim().length > 0;

  const handleSubmit = async () => {
    if (inFlight) return; // duplicate-submit protection — a second click while the first is in flight is a no-op, not a second request
    if (!canSubmit) {
      setTouched(true);
      const target = !correctionReason.trim() ? reasonRef.current : notesRef.current;
      target?.focus();
      target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      return;
    }
    setInFlight(true);
    setSubmitting(true);
    setError('');
    try {
      await communicationPreferencesService.submitLegacySmsOptOutCorrection(patientId, {
        correctionReason: correctionReason.trim(),
        notes: notes.trim(),
        evidenceType,
        sourceReference: sourceReference.trim() || null,
        expectedCurrentValue: true,
        idempotencyKey,
      });
      setSuccess(true);
      onSuccess();
    } catch (err: any) {
      const code = err?.response?.data?.errorCode;
      setError(code ? t(`legacyCorrection.errors.${code}`, { defaultValue: err?.response?.data?.error ?? t('legacyCorrection.errors.generic') }) : t('legacyCorrection.errors.generic'));
    } finally {
      setSubmitting(false);
      setInFlight(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[95] p-4" onClick={() => !submitting && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg outline-none max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
          <h3 id={titleId} className="font-semibold text-gray-900">{t('legacyCorrection.title')}</h3>
          <button onClick={() => !submitting && onClose()} className="text-gray-400 hover:text-gray-600" aria-label={t('actions.cancel')}>
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {success ? (
            <div className="flex items-start gap-2 p-3 bg-green-50 text-green-800 rounded-lg text-sm border border-green-200" role="status">
              {t('legacyCorrection.success')}
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg text-sm border border-amber-200">
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                <span>{t('legacyCorrection.warning')}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-100">
                  <div className="text-[11px] uppercase tracking-wide text-red-500 font-semibold">{t('legacyCorrection.currentValue')}</div>
                  <div className="text-red-700 font-medium">{t('legacyCorrection.smsOptOutActiveValue')}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-green-50 border border-green-100">
                  <div className="text-[11px] uppercase tracking-wide text-green-600 font-semibold">{t('legacyCorrection.proposedValue')}</div>
                  <div className="text-green-700 font-medium">{t('legacyCorrection.smsOptOutCorrectedValue')}</div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" data-autofocus>
                  {t('legacyCorrection.fields.reason')} <span className="text-red-500">*</span>
                </label>
                <textarea
                  ref={reasonRef}
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  className="input-field resize-none"
                  placeholder={t('legacyCorrection.fields.reasonPlaceholder')}
                  aria-invalid={reasonInvalid}
                  aria-describedby={reasonInvalid ? `${titleId}-reason-error` : undefined}
                />
                {reasonInvalid && (
                  <p id={`${titleId}-reason-error`} className="text-xs text-red-600 mt-1">{t('legacyCorrection.fields.reasonRequiredHint')}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('legacyCorrection.fields.evidenceType')} <span className="text-red-500">*</span></label>
                <select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)} className="input-field">
                  {EVIDENCE_TYPES.map((v) => <option key={v} value={v}>{t(`legacyCorrection.evidenceTypes.${v}`)}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('legacyCorrection.fields.notes')} <span className="text-red-500">*</span>
                </label>
                <textarea
                  ref={notesRef}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="input-field resize-none"
                  placeholder={t('legacyCorrection.fields.notesPlaceholder')}
                  aria-invalid={notesInvalid}
                  aria-describedby={notesInvalid ? `${titleId}-notes-error` : undefined}
                />
                {notesInvalid && (
                  <p id={`${titleId}-notes-error`} className="text-xs text-red-600 mt-1">{t('legacyCorrection.fields.notesRequiredHint')}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('legacyCorrection.fields.sourceReference')}</label>
                <input
                  value={sourceReference}
                  onChange={(e) => setSourceReference(e.target.value)}
                  className="input-field"
                  maxLength={500}
                  placeholder={t('legacyCorrection.fields.sourceReferencePlaceholder')}
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertTriangle size={13} />
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t flex justify-end gap-3 flex-shrink-0">
          <button onClick={() => !submitting && onClose()} className="btn-secondary" disabled={submitting}>
            {success ? t('legacyCorrection.close') : t('actions.cancel')}
          </button>
          {!success && (
            <button onClick={handleSubmit} disabled={submitting} className="btn-primary flex items-center gap-2">
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {t('legacyCorrection.confirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LegacyConsentCorrectionModal;
