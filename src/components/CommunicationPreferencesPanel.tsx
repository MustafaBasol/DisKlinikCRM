import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquareHeart, AlertTriangle, Download, Loader2, History, X, Info } from 'lucide-react';
import { communicationPreferencesService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_PURPOSES,
  resolveCellVariant,
  buildMatrixIndex,
  matrixKey,
  CELL_VARIANT_STYLE,
  type MatrixEntry,
} from './communicationConsentMatrixHelpers';

interface Props {
  patientId: string;
  canManage: boolean;
}

type PendingAction = { channel: string; purpose: string; action: 'grant' | 'deny' | 'withdraw' | 'reset' };

type HistoryEvent = {
  id: string;
  previousStatus: string | null;
  newStatus: string;
  source: string;
  evidenceType: string | null;
  noticeVersion: string | null;
  notes: string | null;
  createdAt: string;
};

const EVIDENCE_TYPES = [
  'verbal_staff_record',
  'signed_form',
  'portal_click',
  'inbound_reply',
  'public_booking_checkbox',
] as const;

const SOURCES = ['staff', 'patient_portal', 'public_booking', 'sms_keyword', 'email_unsubscribe', 'api', 'import'] as const;

const CommunicationPreferencesPanel: React.FC<Props> = ({ patientId, canManage }) => {
  const { t } = useTranslation('communicationConsent');
  const { formatDate } = useClinicPreferences();

  const [matrix, setMatrix] = useState<MatrixEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [evidenceType, setEvidenceType] = useState<string>(EVIDENCE_TYPES[0]);
  const [source, setSource] = useState<string>(SOURCES[0]);
  const [noticeVersion, setNoticeVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  const [historyCell, setHistoryCell] = useState<{ channel: string; purpose: string } | null>(null);
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadMatrix = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await communicationPreferencesService.getMatrix(patientId);
      setMatrix(res.data.matrix ?? []);
    } catch {
      setError(t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [patientId, t]);

  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  const index = buildMatrixIndex(matrix);

  const openAction = (channel: string, purpose: string, action: PendingAction['action']) => {
    setPendingAction({ channel, purpose, action });
    setEvidenceType(EVIDENCE_TYPES[0]);
    setSource(SOURCES[0]);
    setNoticeVersion('');
    setNotes('');
    setModalError('');
  };

  const submitAction = async () => {
    if (!pendingAction) return;
    setSubmitting(true);
    setModalError('');
    try {
      await communicationPreferencesService.setPreference(patientId, pendingAction.channel, pendingAction.purpose, {
        action: pendingAction.action,
        source,
        evidenceType: pendingAction.action === 'reset' ? null : evidenceType,
        noticeVersion: noticeVersion.trim() || null,
        notes: notes.trim() || null,
      });
      setPendingAction(null);
      await loadMatrix(); // authoritative reload — no optimistic update
    } catch (err: any) {
      const code = err?.response?.data?.errorCode;
      setModalError(code ? t(`errors.${code}`, { defaultValue: err?.response?.data?.error ?? t('errors.genericSave') }) : t('errors.genericSave'));
    } finally {
      setSubmitting(false);
    }
  };

  const openHistory = async (channel: string, purpose: string) => {
    setHistoryCell({ channel, purpose });
    setHistoryLoading(true);
    try {
      const res = await communicationPreferencesService.getHistory(patientId, { channel, purpose });
      setHistoryEvents(res.data.events ?? []);
    } catch {
      setHistoryEvents([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await communicationPreferencesService.exportEvidence(patientId);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `communication-consent-${patientId}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t('errors.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="p-2 bg-primary-50 rounded-lg">
          <MessageSquareHeart size={20} className="text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900">{t('title')}</h3>
          <p className="text-sm text-gray-500">{t('disclaimer')}</p>
        </div>
        <button onClick={handleExport} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm flex-shrink-0">
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          <span className="hidden sm:inline">{t('actions.export')}</span>
        </button>
      </div>

      {/* Required warning banner — technical record only, not a legal determination */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 text-blue-800 rounded-lg text-sm border border-blue-100">
        <Info size={16} className="flex-shrink-0 mt-0.5" />
        <span>{t('warningBanner')}</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={24} className="animate-spin text-primary-600" />
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <table className="min-w-full text-xs sm:text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white text-left font-semibold text-gray-500 px-2 py-2 border-b border-gray-200">
                  {t('matrix.channelHeader')}
                </th>
                {COMMUNICATION_PURPOSES.map((purpose) => (
                  <th key={purpose} className="px-2 py-2 font-semibold text-gray-500 border-b border-gray-200 whitespace-nowrap text-center">
                    {t(`purposes.${purpose}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMMUNICATION_CHANNELS.map((channel) => (
                <tr key={channel}>
                  <td className="sticky left-0 bg-white font-medium text-gray-800 px-2 py-2 border-b border-gray-100 whitespace-nowrap">
                    {t(`channels.${channel}`)}
                  </td>
                  {COMMUNICATION_PURPOSES.map((purpose) => {
                    const entry = index.get(matrixKey(channel, purpose));
                    const variant = entry ? resolveCellVariant(entry) : 'unknown';
                    const style = CELL_VARIANT_STYLE[variant];
                    const isException = entry?.isPolicyException ?? false;
                    return (
                      <td key={purpose} className="px-1 py-1.5 border-b border-gray-50 text-center align-middle">
                        <button
                          type="button"
                          disabled={isException}
                          onClick={() => !isException && openHistory(channel, purpose)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] font-medium ${style.badgeClass} ${isException ? 'cursor-default opacity-70' : 'hover:opacity-80'}`}
                          title={t(`status.${variant}`)}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${style.dotClass}`} />
                          {t(`status.${variant}`)}
                        </button>
                        {canManage && !isException && (
                          <div className="flex items-center justify-center gap-1 mt-1">
                            <button className="text-[10px] text-green-600 hover:underline" onClick={() => openAction(channel, purpose, 'grant')}>{t('actions.grant')}</button>
                            <span className="text-gray-300">·</span>
                            <button className="text-[10px] text-red-600 hover:underline" onClick={() => openAction(channel, purpose, 'deny')}>{t('actions.deny')}</button>
                            <span className="text-gray-300">·</span>
                            <button className="text-[10px] text-amber-600 hover:underline" onClick={() => openAction(channel, purpose, 'withdraw')}>{t('actions.withdraw')}</button>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation modal — grant/deny/withdraw/reset always require explicit confirmation */}
      {pendingAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-semibold text-gray-900">
                {t(`confirm.${pendingAction.action}Title`, {
                  channel: t(`channels.${pendingAction.channel}`),
                  purpose: t(`purposes.${pendingAction.purpose}`),
                })}
              </h3>
              <button onClick={() => setPendingAction(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-gray-600">{t(`confirm.${pendingAction.action}Body`)}</p>

              {pendingAction.action !== 'reset' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.evidenceType')} <span className="text-red-500">*</span></label>
                    <select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)} className="input-field">
                      {EVIDENCE_TYPES.map((v) => <option key={v} value={v}>{t(`evidenceTypes.${v}`)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.source')}</label>
                    <select value={source} onChange={(e) => setSource(e.target.value)} className="input-field">
                      {SOURCES.map((v) => <option key={v} value={v}>{t(`sources.${v}`)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.noticeVersion')}</label>
                    <input value={noticeVersion} onChange={(e) => setNoticeVersion(e.target.value)} className="input-field" placeholder={t('fields.noticeVersionPlaceholder')} maxLength={64} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.notes')}</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} className="input-field resize-none" placeholder={t('fields.notesPlaceholder')} />
                  </div>
                </>
              )}

              {modalError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertTriangle size={13} />
                  {modalError}
                </p>
              )}
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-3">
              <button onClick={() => setPendingAction(null)} className="btn-secondary">{t('actions.cancel')}</button>
              <button onClick={submitAction} disabled={submitting} className="btn-primary flex items-center gap-2">
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {t('actions.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History timeline */}
      {historyCell && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <History size={16} />
                {t('history.title', { channel: t(`channels.${historyCell.channel}`), purpose: t(`purposes.${historyCell.purpose}`) })}
              </h3>
              <button onClick={() => setHistoryCell(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-2 overflow-y-auto">
              {historyLoading ? (
                <div className="flex items-center justify-center h-24"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
              ) : historyEvents.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">{t('history.empty')}</p>
              ) : (
                historyEvents.map((ev) => (
                  <div key={ev.id} className="border border-gray-100 rounded-lg p-3 text-sm space-y-1 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800">
                        {ev.previousStatus ? t(`status.${ev.previousStatus}`) : t('history.initial')} → {t(`status.${ev.newStatus}`)}
                      </span>
                      <span className="text-xs text-gray-400">{formatDate(ev.createdAt)}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {t('fields.source')}: {t(`sources.${ev.source}`, { defaultValue: ev.source })}
                      {ev.evidenceType && ` · ${t('fields.evidenceType')}: ${t(`evidenceTypes.${ev.evidenceType}`, { defaultValue: ev.evidenceType })}`}
                      {ev.noticeVersion && ` · ${t('fields.noticeVersion')}: ${ev.noticeVersion}`}
                    </div>
                    {ev.notes && <p className="text-xs text-gray-600 bg-white rounded p-1.5 border border-gray-100">{ev.notes}</p>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommunicationPreferencesPanel;
