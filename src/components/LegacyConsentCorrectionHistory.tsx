import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import { communicationPreferencesService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

type CorrectionSummary = {
  id: string;
  fieldName: string;
  previousValue: boolean;
  newValue: boolean;
  previousRecordedAt: string | null;
  evidenceType: string;
  correctedById: string;
  createdAt: string;
};

type CorrectionDetail = CorrectionSummary & {
  correctionReason: string;
  notes: string;
  sourceReference: string | null;
};

interface Props {
  open: boolean;
  patientId: string;
  /** Management-only (OWNER/ORG_ADMIN/CLINIC_MANAGER) — narrower than the general canManage used for the rest of the panel. Detail view is hidden entirely for anyone else. */
  canViewDetail: boolean;
  onClose: () => void;
}

/**
 * KVKK-HIGH-008 correction history — summary list only by default (never
 * correctionReason/notes/sourceReference, see legacyConsentCorrection.ts's
 * list/detail split); a per-row "view details" fetches the management-only
 * detail endpoint on demand.
 */
const LegacyConsentCorrectionHistory: React.FC<Props> = ({ open, patientId, canViewDetail, onClose }) => {
  const { t } = useTranslation('communicationConsent');
  const { formatDate } = useClinicPreferences();
  const [items, setItems] = useState<CorrectionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [detail, setDetail] = useState<CorrectionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setDetailFor(null);
    setDetail(null);
    (async () => {
      setLoading(true);
      try {
        const res = await communicationPreferencesService.getLegacyCorrections(patientId, { limit: 20 });
        setItems(res.data.items ?? []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, patientId]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const viewDetail = async (id: string) => {
    setDetailFor(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await communicationPreferencesService.getLegacyCorrectionDetail(patientId, id);
      setDetail(res.data.correction ?? null);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[95] p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
          <h3 id={titleId} className="font-semibold text-gray-900">{t('legacyCorrectionHistory.title')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label={t('actions.cancel')}>
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-24"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
          ) : items.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">{t('legacyCorrectionHistory.empty')}</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="border border-gray-100 rounded-lg p-3 text-sm space-y-1.5 bg-gray-50">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <span className="font-medium text-gray-800">{t('legacyCorrectionHistory.smsOptOutCorrected')}</span>
                  <span className="text-xs text-gray-400">{formatDate(item.createdAt)}</span>
                </div>
                <div className="text-xs text-gray-500">
                  {t('legacyCorrection.fields.evidenceType')}: {t(`legacyCorrection.evidenceTypes.${item.evidenceType}`, { defaultValue: item.evidenceType })}
                </div>
                {canViewDetail && (
                  detailFor === item.id ? (
                    detailLoading ? (
                      <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 size={12} className="animate-spin" /> {t('legacyCorrectionHistory.loadingDetail')}</div>
                    ) : detail ? (
                      <div className="bg-white rounded p-2 border border-gray-100 space-y-1 text-xs text-gray-700">
                        <div><span className="font-semibold">{t('legacyCorrection.fields.reason')}:</span> {detail.correctionReason}</div>
                        <div><span className="font-semibold">{t('legacyCorrection.fields.notes')}:</span> {detail.notes}</div>
                        {detail.sourceReference && (
                          <div><span className="font-semibold">{t('legacyCorrection.fields.sourceReference')}:</span> {detail.sourceReference}</div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-red-600">{t('legacyCorrectionHistory.detailFailed')}</p>
                    )
                  ) : (
                    <button type="button" onClick={() => viewDetail(item.id)} className="text-xs text-primary-600 hover:underline">
                      {t('legacyCorrectionHistory.viewDetails')}
                    </button>
                  )
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default LegacyConsentCorrectionHistory;
