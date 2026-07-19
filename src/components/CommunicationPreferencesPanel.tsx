import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquareHeart, AlertTriangle, Download, Loader2, History, X, Info,
  CheckCircle2, XCircle, Undo2, HelpCircle, ShieldCheck, ChevronDown, ChevronUp,
  Table2, LayoutList, Filter,
  type LucideIcon,
} from 'lucide-react';
import { communicationPreferencesService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import {
  COMMUNICATION_CHANNELS,
  COMMUNICATION_PURPOSES,
  PURPOSE_GROUPS,
  resolveCellVariant,
  computeConsentSummary,
  buildMatrixIndex,
  matrixKey,
  CELL_VARIANT_STYLE,
  shouldShowLegacySignals,
  isCellActionable,
  type MatrixEntry,
  type MatrixCellVariantWithConflict,
} from './communicationConsentMatrixHelpers';

interface Props {
  patientId: string;
  canManage: boolean;
  /** Legacy Patient fields — historical/pre-migration signals only, never the current source of truth. Rendered as a collapsed, authorized-role-only disclosure. */
  legacySignals?: {
    communicationConsent: boolean;
    marketingConsent: boolean;
    smsOptOut: boolean;
  };
}

type SetPreferenceAction = 'grant' | 'deny' | 'withdraw' | 'reset';
type PendingCell = { channel: string; purpose: string; action: SetPreferenceAction | null; isConflict: boolean };

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
const HISTORY_STATUSES = ['granted', 'denied', 'withdrawn', 'unknown'] as const;
const ACTIONS: readonly SetPreferenceAction[] = ['grant', 'deny', 'withdraw', 'reset'];

// Mirrors the backend notice-version/evidence matrix in
// communicationConsentAdmin.ts (DIGITAL_GRANT_SOURCES / staff-source check) —
// client-side hints only, the server remains the source of truth.
const DIGITAL_GRANT_SOURCES = ['patient_portal', 'public_booking', 'whatsapp', 'sms_keyword', 'email_unsubscribe'];

const VARIANT_ICON: Record<MatrixCellVariantWithConflict, LucideIcon> = {
  allowed: CheckCircle2,
  denied: XCircle,
  withdrawn: Undo2,
  unknown: HelpCircle,
  not_required: ShieldCheck,
  conflict: AlertTriangle,
};

const CommunicationPreferencesPanel: React.FC<Props> = ({ patientId, canManage, legacySignals }) => {
  const { t } = useTranslation('communicationConsent');
  const { formatDate } = useClinicPreferences();

  const [matrix, setMatrix] = useState<MatrixEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [viewMode, setViewMode] = useState<'grouped' | 'matrix'>('grouped');
  const [activeChannel, setActiveChannel] = useState<string>(COMMUNICATION_CHANNELS[0]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [legacyOpen, setLegacyOpen] = useState(false);

  const [pendingCell, setPendingCell] = useState<PendingCell | null>(null);
  const [evidenceType, setEvidenceType] = useState<string>(EVIDENCE_TYPES[0]);
  const [source, setSource] = useState<string>(SOURCES[0]);
  const [noticeVersion, setNoticeVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  const [historyCell, setHistoryCell] = useState<{ channel: string; purpose: string } | null>(null);
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false);
  const [historyFilters, setHistoryFilters] = useState<{ channel: string; purpose: string; status: string; source: string }>({
    channel: '', purpose: '', status: '', source: '',
  });

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
  const summary = useMemo(() => computeConsentSummary(matrix), [matrix]);

  const isGrant = pendingCell?.action === 'grant';
  const noticeVersionRequired = isGrant && DIGITAL_GRANT_SOURCES.includes(source);
  const sourceDescriptionRequired = isGrant && source === 'staff';
  const canSubmit = pendingCell?.action != null &&
    (!noticeVersionRequired || noticeVersion.trim().length > 0) &&
    (!sourceDescriptionRequired || notes.trim().length > 0);

  const openActionMenu = (channel: string, purpose: string, isConflict: boolean) => {
    setPendingCell({ channel, purpose, action: null, isConflict });
    setEvidenceType(EVIDENCE_TYPES[0]);
    setSource(SOURCES[0]);
    setNoticeVersion('');
    setNotes('');
    setModalError('');
  };

  const submitAction = async () => {
    if (!pendingCell?.action) return;
    setSubmitting(true);
    setModalError('');
    try {
      await communicationPreferencesService.setPreference(patientId, pendingCell.channel, pendingCell.purpose, {
        action: pendingCell.action,
        source,
        evidenceType: pendingCell.action === 'reset' ? null : evidenceType,
        noticeVersion: noticeVersion.trim() || null,
        notes: notes.trim() || null,
      });
      setPendingCell(null);
      await loadMatrix(); // authoritative reload — no optimistic update
    } catch (err: any) {
      const code = err?.response?.data?.errorCode;
      setModalError(code ? t(`errors.${code}`, { defaultValue: err?.response?.data?.error ?? t('errors.genericSave') }) : t('errors.genericSave'));
    } finally {
      setSubmitting(false);
    }
  };

  const fetchHistory = async (filters: { channel?: string; purpose?: string; status?: string; source?: string }) => {
    setHistoryLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filters.channel) params.channel = filters.channel;
      if (filters.purpose) params.purpose = filters.purpose;
      if (filters.status) params.status = filters.status;
      if (filters.source) params.source = filters.source;
      const res = await communicationPreferencesService.getHistory(patientId, params);
      setHistoryEvents(res.data.events ?? []);
    } catch {
      setHistoryEvents([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openCellHistory = async (channel: string, purpose: string) => {
    setHistoryCell({ channel, purpose });
    setHistoryFiltersOpen(false);
    await fetchHistory({ channel, purpose });
  };

  const openFullHistory = async () => {
    setHistoryCell({ channel: '', purpose: '' });
    setHistoryFilters({ channel: '', purpose: '', status: '', source: '' });
    setHistoryFiltersOpen(true);
    await fetchHistory({});
  };

  const applyHistoryFilters = async () => {
    await fetchHistory(historyFilters);
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

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderStatusBadge = (variant: MatrixCellVariantWithConflict, entry: MatrixEntry | undefined, onOpenHistory: () => void) => {
    const style = CELL_VARIANT_STYLE[variant];
    const Icon = VARIANT_ICON[variant];
    const isException = entry?.isPolicyException ?? false;
    return (
      <button
        type="button"
        disabled={isException}
        onClick={() => !isException && onOpenHistory()}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${style.badgeClass} ${isException ? 'cursor-default opacity-70' : 'hover:opacity-80'}`}
        title={t(`status.${variant}`)}
      >
        <Icon size={13} />
        <span>{t(`status.${variant}`)}</span>
      </button>
    );
  };

  const renderPurposeRow = (channel: string, purpose: string) => {
    const entry = index.get(matrixKey(channel, purpose));
    const variant = entry ? resolveCellVariant(entry) : 'unknown';
    const actionable = isCellActionable(canManage, { isPolicyException: entry?.isPolicyException ?? false });
    const isConflict = variant === 'conflict';
    return (
      <div key={purpose} className="flex items-center justify-between gap-3 py-2 px-1 border-b border-gray-50 last:border-0">
        <span className="text-sm text-gray-700 min-w-0 break-words">{t(`purposes.${purpose}`)}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {renderStatusBadge(variant, entry, () => openCellHistory(channel, purpose))}
          {actionable && (
            <button
              type="button"
              onClick={() => openActionMenu(channel, purpose, isConflict)}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              title={t('actions.manage')}
              aria-label={t('actions.manage')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="p-2 bg-primary-50 rounded-lg">
          <MessageSquareHeart size={20} className="text-primary-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900">{t('title')}</h3>
          <p className="text-sm text-gray-500">{t('disclaimer')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} disabled={exporting} className="btn-secondary flex items-center gap-2 text-sm flex-shrink-0" title={t('export.explanation')}>
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            <span className="hidden sm:inline">{t('actions.export')}</span>
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-400 -mt-4">{t('export.explanation')}</p>

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
        <>
          {/* Compact authoritative summary — the one thing staff need without reading the whole matrix */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="consent-summary-bar">
            <SummaryTile icon={CheckCircle2} colorClass="text-green-600 bg-green-50" label={t('summary.allowed')} count={summary.allowed} />
            <SummaryTile icon={XCircle} colorClass="text-red-600 bg-red-50" label={t('summary.deniedOrWithdrawn')} count={summary.deniedOrWithdrawn} />
            <SummaryTile icon={HelpCircle} colorClass="text-gray-500 bg-gray-100" label={t('summary.unknown')} count={summary.unknown} />
            <SummaryTile icon={ShieldCheck} colorClass="text-blue-600 bg-blue-50" label={t('summary.notRequired')} count={summary.notRequired} />
            {summary.conflict > 0 && (
              <SummaryTile icon={AlertTriangle} colorClass="text-orange-700 bg-orange-50" label={t('summary.conflict')} count={summary.conflict} emphasize />
            )}
          </div>

          {/* Help copy — what these states mean */}
          <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
            <span>{t('help.unknownNotConsent')}</span>
            <span>{t('help.deniedVsWithdrawn')}</span>
            <span>{t('help.notRequiredMeaning')}</span>
          </div>

          {/* View toggle */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setViewMode('grouped')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'grouped' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
              >
                <LayoutList size={14} /> {t('actions.groupedView')}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('matrix')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'matrix' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
              >
                <Table2 size={14} /> {t('actions.matrixView')}
              </button>
            </div>
            <button type="button" onClick={openFullHistory} className="btn-secondary flex items-center gap-2 text-xs">
              <History size={13} /> {t('actions.viewHistory')}
            </button>
          </div>

          {viewMode === 'grouped' ? (
            <div className="space-y-4">
              {/* Channel tabs — the primary dimension */}
              <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
                {COMMUNICATION_CHANNELS.map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    onClick={() => setActiveChannel(channel)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${activeChannel === channel ? 'bg-primary-50 text-primary-700 border border-primary-200' : 'text-gray-500 border border-transparent hover:bg-gray-50'}`}
                  >
                    {t(`channels.${channel}`)}
                  </button>
                ))}
              </div>

              {/* Purpose-group accordion cards */}
              <div className="space-y-3">
                {PURPOSE_GROUPS.map((group) => {
                  const isCollapsed = collapsedGroups.has(group.key);
                  return (
                    <div key={group.key} className="border border-gray-100 rounded-xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-left"
                      >
                        <span className="text-sm font-semibold text-gray-800">{t(`purposeGroups.${group.key}`)}</span>
                        {isCollapsed ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronUp size={16} className="text-gray-400" />}
                      </button>
                      {!isCollapsed && (
                        <div className="px-3 py-1">
                          {group.purposes.map((purpose) => renderPurposeRow(activeChannel, purpose))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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
                        const isConflict = variant === 'conflict';
                        const Icon = VARIANT_ICON[variant];
                        return (
                          <td key={purpose} className="px-1 py-1.5 border-b border-gray-50 text-center align-middle">
                            <button
                              type="button"
                              disabled={isException}
                              onClick={() => !isException && openCellHistory(channel, purpose)}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] font-medium ${style.badgeClass} ${isException ? 'cursor-default opacity-70' : 'hover:opacity-80'}`}
                              title={t(`status.${variant}`)}
                            >
                              <Icon size={11} />
                              {t(`status.${variant}`)}
                            </button>
                            {isCellActionable(canManage, { isPolicyException: isException }) && (
                              <div className="flex items-center justify-center mt-1">
                                <button
                                  type="button"
                                  onClick={() => openActionMenu(channel, purpose, isConflict)}
                                  className="text-[10px] text-gray-500 hover:underline"
                                >
                                  {t('actions.manage')}
                                </button>
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

          {/* Legacy signal disclosure — never the current source of truth, authorized roles only */}
          {shouldShowLegacySignals(canManage, legacySignals) && legacySignals && (
            <div className="border border-amber-100 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setLegacyOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-amber-50 hover:bg-amber-100 text-left"
              >
                <span className="text-sm font-semibold text-amber-800">{t('legacySignals.title')}</span>
                {legacyOpen ? <ChevronUp size={16} className="text-amber-500" /> : <ChevronDown size={16} className="text-amber-500" />}
              </button>
              {legacyOpen && (
                <div className="px-4 py-3 space-y-2 bg-white">
                  <p className="text-xs text-amber-700">{t('legacySignals.disclaimer')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    <LegacyField label={t('legacySignals.communicationConsent')} value={legacySignals.communicationConsent} />
                    <LegacyField label={t('legacySignals.marketingConsent')} value={legacySignals.marketingConsent} />
                    <LegacyField label={t('legacySignals.smsOptOut')} value={legacySignals.smsOptOut} isRestrictive />
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Action menu modal — pick an action, then supply evidence */}
      {pendingCell && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-semibold text-gray-900">
                {t('actions.manageTitle', { channel: t(`channels.${pendingCell.channel}`), purpose: t(`purposes.${pendingCell.purpose}`) })}
              </h3>
              <button onClick={() => setPendingCell(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {pendingCell.isConflict && (
                <div className="flex items-start gap-2 p-3 bg-orange-50 text-orange-800 rounded-lg text-sm border border-orange-200">
                  <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                  <span>{t('conflict.modalNote')}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('actions.chooseAction')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {ACTIONS.map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => setPendingCell((prev) => (prev ? { ...prev, action } : prev))}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium ${pendingCell.action === action ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                    >
                      {t(`actions.${action}`)}
                    </button>
                  ))}
                </div>
              </div>

              {pendingCell.action && (
                <p className="text-sm text-gray-600">{t(`confirm.${pendingCell.action}Body`)}</p>
              )}

              {pendingCell.action && pendingCell.action !== 'reset' && (
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.noticeVersion')} {noticeVersionRequired && <span className="text-red-500">*</span>}
                    </label>
                    <input value={noticeVersion} onChange={(e) => setNoticeVersion(e.target.value)} className="input-field" placeholder={t('fields.noticeVersionPlaceholder')} maxLength={64} />
                    {noticeVersionRequired && !noticeVersion.trim() && (
                      <p className="text-xs text-amber-600 mt-1">{t('fields.noticeVersionRequiredHint')}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.notes')} {sourceDescriptionRequired && <span className="text-red-500">*</span>}
                    </label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} className="input-field resize-none" placeholder={t('fields.notesPlaceholder')} />
                    {sourceDescriptionRequired && !notes.trim() && (
                      <p className="text-xs text-amber-600 mt-1">{t('fields.sourceDescriptionRequiredHint')}</p>
                    )}
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
              <button onClick={() => setPendingCell(null)} className="btn-secondary">{t('actions.cancel')}</button>
              <button onClick={submitAction} disabled={submitting || !canSubmit} className="btn-primary flex items-center gap-2">
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {t('actions.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History timeline — per-cell or full, with filters */}
      {historyCell && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <History size={16} />
                {historyCell.channel
                  ? t('history.title', { channel: t(`channels.${historyCell.channel}`), purpose: t(`purposes.${historyCell.purpose}`) })
                  : t('history.allTitle')}
              </h3>
              <div className="flex items-center gap-2">
                {!historyCell.channel && (
                  <button onClick={() => setHistoryFiltersOpen((v) => !v)} className="text-gray-400 hover:text-gray-600" title={t('history.filters.toggle')}>
                    <Filter size={16} />
                  </button>
                )}
                <button onClick={() => setHistoryCell(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>
            </div>

            {historyFiltersOpen && !historyCell.channel && (
              <div className="px-5 py-3 border-b bg-gray-50 grid grid-cols-2 gap-2">
                <select value={historyFilters.channel} onChange={(e) => setHistoryFilters((f) => ({ ...f, channel: e.target.value }))} className="input-field text-xs">
                  <option value="">{t('history.filters.anyChannel')}</option>
                  {COMMUNICATION_CHANNELS.map((c) => <option key={c} value={c}>{t(`channels.${c}`)}</option>)}
                </select>
                <select value={historyFilters.purpose} onChange={(e) => setHistoryFilters((f) => ({ ...f, purpose: e.target.value }))} className="input-field text-xs">
                  <option value="">{t('history.filters.anyPurpose')}</option>
                  {COMMUNICATION_PURPOSES.map((p) => <option key={p} value={p}>{t(`purposes.${p}`)}</option>)}
                </select>
                <select value={historyFilters.status} onChange={(e) => setHistoryFilters((f) => ({ ...f, status: e.target.value }))} className="input-field text-xs">
                  <option value="">{t('history.filters.anyStatus')}</option>
                  {HISTORY_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s === 'granted' ? 'allowed' : s}`)}</option>)}
                </select>
                <select value={historyFilters.source} onChange={(e) => setHistoryFilters((f) => ({ ...f, source: e.target.value }))} className="input-field text-xs">
                  <option value="">{t('history.filters.anySource')}</option>
                  {SOURCES.map((s) => <option key={s} value={s}>{t(`sources.${s}`)}</option>)}
                </select>
                <button onClick={applyHistoryFilters} className="btn-primary text-xs col-span-2">{t('history.filters.apply')}</button>
              </div>
            )}

            <div className="px-5 py-4 space-y-2 overflow-y-auto">
              {historyLoading ? (
                <div className="flex items-center justify-center h-24"><Loader2 size={20} className="animate-spin text-primary-600" /></div>
              ) : historyEvents.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">{t('history.empty')}</p>
              ) : (
                historyEvents.map((ev) => (
                  <div key={ev.id} className="border border-gray-100 rounded-lg p-3 text-sm space-y-1 bg-gray-50">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="font-medium text-gray-800">
                        {ev.previousStatus ? t(`status.${ev.previousStatus === 'granted' ? 'allowed' : ev.previousStatus}`) : t('history.initial')} → {t(`status.${ev.newStatus === 'granted' ? 'allowed' : ev.newStatus}`)}
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

const SummaryTile: React.FC<{ icon: LucideIcon; colorClass: string; label: string; count: number; emphasize?: boolean }> = ({ icon: Icon, colorClass, label, count, emphasize }) => (
  <div className={`rounded-xl border p-3 flex items-center gap-2 ${emphasize ? 'border-orange-300' : 'border-gray-100'}`}>
    <div className={`p-1.5 rounded-lg ${colorClass}`}>
      <Icon size={15} />
    </div>
    <div className="min-w-0">
      <div className="text-lg font-bold text-gray-900 leading-none">{count}</div>
      <div className="text-[11px] text-gray-500 truncate">{label}</div>
    </div>
  </div>
);

const LegacyField: React.FC<{ label: string; value: boolean; isRestrictive?: boolean }> = ({ label, value, isRestrictive }) => (
  <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100">
    <span className="text-xs text-gray-600 break-words pr-2">{label}</span>
    <span className={`text-xs font-bold flex-shrink-0 ${value && isRestrictive ? 'text-red-600' : value ? 'text-gray-500' : 'text-gray-400'}`}>
      {value ? 'Evet' : 'Hayır'}
    </span>
  </div>
);

export default CommunicationPreferencesPanel;
