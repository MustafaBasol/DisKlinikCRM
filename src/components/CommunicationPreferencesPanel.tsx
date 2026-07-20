import React, { useCallback, useEffect, useMemo, useRef, useState, useId } from 'react';
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
  computeConsentActionValidation,
  type MatrixEntry,
  type MatrixCellVariantWithConflict,
  type ConsentActionValidationField,
} from './communicationConsentMatrixHelpers';
import LegacyConsentCorrectionModal from './LegacyConsentCorrectionModal';
import LegacyConsentCorrectionHistory from './LegacyConsentCorrectionHistory';

interface Props {
  patientId: string;
  canManage: boolean;
  /**
   * Management-only capability for the KVKK-HIGH-008 legacy correction
   * workflow (OWNER/ORG_ADMIN/CLINIC_MANAGER) — deliberately NARROWER than
   * `canManage` above, which also includes RECEPTIONIST/DENTIST. Using
   * `canManage` to gate the correction controls would let roles the backend
   * would 403 see a client-only-gated action. Defaults to `canManage` only if
   * the caller genuinely has nothing narrower to pass (keeps this prop
   * optional for any other embedding of this panel), but PatientDetail always
   * passes the real, narrower value.
   */
  canCorrectLegacyConsent?: boolean;
  /** Legacy Patient fields — historical/pre-migration signals only, never the current source of truth. Rendered as a collapsed, authorized-role-only disclosure. */
  legacySignals?: {
    communicationConsent: boolean;
    marketingConsent: boolean;
    smsOptOut: boolean;
  };
  /** Refetched by the parent after a legacy correction succeeds, so the tri-state legacy display reflects the new value. */
  onLegacySignalsChanged?: () => void;
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

const VARIANT_ICON: Record<MatrixCellVariantWithConflict, LucideIcon> = {
  allowed: CheckCircle2,
  denied: XCircle,
  withdrawn: Undo2,
  unknown: HelpCircle,
  not_required: ShieldCheck,
  conflict: AlertTriangle,
};

const CommunicationPreferencesPanel: React.FC<Props> = ({
  patientId, canManage, canCorrectLegacyConsent = canManage, legacySignals, onLegacySignalsChanged,
}) => {
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
  // Fields the user has already attempted to submit with invalid content —
  // an inline error only appears here, not before the first submit attempt,
  // and clears the moment the field becomes valid (see the effect below).
  const [touchedInvalidFields, setTouchedInvalidFields] = useState<Set<ConsentActionValidationField>>(new Set());
  const modalDialogRef = useRef<HTMLDivElement>(null);
  const modalPreviouslyFocusedRef = useRef<HTMLElement | null>(null);
  const noticeVersionInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef = useRef<HTMLTextAreaElement>(null);
  const modalTitleId = useId();

  const [legacyCorrectionModalOpen, setLegacyCorrectionModalOpen] = useState(false);
  const [legacyCorrectionHistoryOpen, setLegacyCorrectionHistoryOpen] = useState(false);
  // KVKK-HIGH-008-F1: platform-wide runtime kill switch, read from the matrix
  // response. Defaults to false (fail-closed) until the first successful
  // load — hiding the action is purely supplementary UX; the backend route
  // is the authoritative gate regardless of this value.
  const [legacyCorrectionRuntimeEnabled, setLegacyCorrectionRuntimeEnabled] = useState(false);
  const [latestSmsOptOutCorrection, setLatestSmsOptOutCorrection] = useState<{ createdAt: string; evidenceType: string } | null>(null);

  // Fetched lazily (canManage-gated, list-only fields — see §6 of the
  // KVKK-HIGH-008 design) whenever the legacy-signals section is opened, so
  // the tri-state smsOptOut summary can show "corrected on <date>" instead of
  // just "not currently active".
  useEffect(() => {
    if (!legacyOpen || !canManage) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await communicationPreferencesService.getLegacyCorrections(patientId, { limit: 1 });
        const latest = res.data.items?.[0];
        if (!cancelled) setLatestSmsOptOutCorrection(latest ? { createdAt: latest.createdAt, evidenceType: latest.evidenceType } : null);
      } catch {
        if (!cancelled) setLatestSmsOptOutCorrection(null);
      }
    })();
    return () => { cancelled = true; };
  }, [legacyOpen, canManage, patientId]);

  const refreshAfterLegacyCorrection = async () => {
    await loadMatrix();
    onLegacySignalsChanged?.();
    try {
      const res = await communicationPreferencesService.getLegacyCorrections(patientId, { limit: 1 });
      const latest = res.data.items?.[0];
      setLatestSmsOptOutCorrection(latest ? { createdAt: latest.createdAt, evidenceType: latest.evidenceType } : null);
    } catch {
      // best-effort refresh only — the correction itself already succeeded
    }
  };

  const validation = computeConsentActionValidation({ action: pendingCell?.action ?? null, source, noticeVersion, notes });
  const { noticeVersionRequired, notesRequired, canSubmit } = validation;
  const fieldRefs: Record<ConsentActionValidationField, React.RefObject<HTMLElement | null>> = {
    noticeVersion: noticeVersionInputRef,
    notes: notesInputRef,
  };
  const fieldErrorHintKey: Record<ConsentActionValidationField, string> = {
    noticeVersion: 'fields.noticeVersionRequiredHint',
    notes: 'fields.notesRequiredHint',
  };
  // Stale errors clear the moment a field becomes valid, without waiting for
  // another submit attempt.
  useEffect(() => {
    setTouchedInvalidFields((prev) => {
      const next = new Set([...prev].filter((f) => validation.invalidFields.includes(f)));
      return next.size === prev.size && [...next].every((f) => prev.has(f)) ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeVersion, notes, pendingCell?.action, source]);

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
      setLegacyCorrectionRuntimeEnabled(Boolean(res.data.legacyConsentCorrectionRuntimeEnabled));
    } catch {
      setError(t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [patientId, t]);

  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  // Action modal dialog semantics: focus trap entry, Escape-to-close, body
  // scroll lock, and focus restore on close — modeled directly on
  // src/components/common/ConfirmDialog.tsx (reused pattern, not reinvented).
  useEffect(() => {
    if (!pendingCell) return;

    modalPreviouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTarget = modalDialogRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? modalDialogRef.current;
    focusTarget?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) setPendingCell(null);
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      modalPreviouslyFocusedRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCell != null, submitting]);

  const index = buildMatrixIndex(matrix);
  const summary = useMemo(() => computeConsentSummary(matrix), [matrix]);

  const openActionMenu = (channel: string, purpose: string, isConflict: boolean) => {
    setPendingCell({ channel, purpose, action: null, isConflict });
    setEvidenceType(EVIDENCE_TYPES[0]);
    setSource(SOURCES[0]);
    setNoticeVersion('');
    setNotes('');
    setModalError('');
    setTouchedInvalidFields(new Set());
  };

  const submitAction = async () => {
    if (!pendingCell?.action) return;

    // Validate on submit — Confirm stays enabled at all times (per the
    // required UX pattern); an invalid submit populates inline errors, moves
    // focus to the first invalid field, and never silently no-ops.
    if (!canSubmit) {
      setTouchedInvalidFields(new Set(validation.invalidFields));
      const target = validation.firstInvalidField ? fieldRefs[validation.firstInvalidField].current : null;
      target?.focus();
      target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      return;
    }

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
                <div className="px-4 py-3 space-y-3 bg-white">
                  <p className="text-xs text-amber-700">{t('legacySignals.disclaimer')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    <LegacyField label={t('legacySignals.communicationConsent')} value={legacySignals.communicationConsent} neutral />
                    <LegacyField label={t('legacySignals.marketingConsent')} value={legacySignals.marketingConsent} neutral />
                    <SmsOptOutLegacyField
                      active={legacySignals.smsOptOut}
                      correction={!legacySignals.smsOptOut ? latestSmsOptOutCorrection : null}
                      correctionLabel={latestSmsOptOutCorrection ? t(`legacyCorrection.evidenceTypes.${latestSmsOptOutCorrection.evidenceType}`, { defaultValue: latestSmsOptOutCorrection.evidenceType }) : ''}
                      formatDate={formatDate}
                      t={t}
                    />
                  </div>
                  <p className="text-[11px] text-gray-400">{t('legacySignals.notCentralConsent')}</p>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setLegacyCorrectionHistoryOpen(true)}
                      className="text-xs text-primary-600 hover:underline"
                    >
                      {t('legacySignals.viewCorrectionHistory')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Action menu modal — pick an action, then supply evidence */}
      {pendingCell && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !submitting && setPendingCell(null)}>
          <div
            ref={modalDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            tabIndex={-1}
            className="bg-white rounded-xl shadow-2xl w-full max-w-md outline-none max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
              <h3 id={modalTitleId} className="font-semibold text-gray-900">
                {t('actions.manageTitle', { channel: t(`channels.${pendingCell.channel}`), purpose: t(`purposes.${pendingCell.purpose}`) })}
              </h3>
              <button onClick={() => setPendingCell(null)} className="text-gray-400 hover:text-gray-600" aria-label={t('actions.cancel')}>
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              {pendingCell.isConflict && (
                <div className="flex flex-col gap-2 p-3 bg-orange-50 text-orange-800 rounded-lg text-sm border border-orange-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                    <span>{t('conflict.modalNote')}</span>
                  </div>
                  {canCorrectLegacyConsent && legacyCorrectionRuntimeEnabled && (
                    <button
                      type="button"
                      onClick={() => { setPendingCell(null); setLegacyCorrectionModalOpen(true); }}
                      className="self-start text-xs font-semibold text-orange-900 underline hover:no-underline"
                    >
                      {t('conflict.correctLegacyAction')}
                    </button>
                  )}
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
                    <label htmlFor="consent-notice-version" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.noticeVersion')} {noticeVersionRequired && <span className="text-red-500">*</span>}
                    </label>
                    <input
                      id="consent-notice-version"
                      ref={noticeVersionInputRef}
                      value={noticeVersion}
                      onChange={(e) => setNoticeVersion(e.target.value)}
                      className="input-field"
                      placeholder={noticeVersionRequired ? t('fields.noticeVersionRequiredPlaceholder') : t('fields.noticeVersionPlaceholder')}
                      maxLength={64}
                      aria-invalid={touchedInvalidFields.has('noticeVersion')}
                      aria-describedby={touchedInvalidFields.has('noticeVersion') ? 'consent-notice-version-error' : undefined}
                    />
                    {touchedInvalidFields.has('noticeVersion') && (
                      <p id="consent-notice-version-error" className="text-xs text-red-600 mt-1 flex items-center gap-1">
                        <AlertTriangle size={11} /> {t(fieldErrorHintKey.noticeVersion)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="consent-notes" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('fields.notes')} {notesRequired && <span className="text-red-500">*</span>}
                    </label>
                    <textarea
                      id="consent-notes"
                      ref={notesInputRef}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      maxLength={1000}
                      className="input-field resize-none"
                      placeholder={notesRequired ? t('fields.notesRequiredPlaceholder') : t('fields.notesPlaceholder')}
                      aria-invalid={touchedInvalidFields.has('notes')}
                      aria-describedby={touchedInvalidFields.has('notes') ? 'consent-notes-error' : undefined}
                    />
                    {touchedInvalidFields.has('notes') && (
                      <p id="consent-notes-error" className="text-xs text-red-600 mt-1 flex items-center gap-1">
                        <AlertTriangle size={11} /> {t(fieldErrorHintKey.notes)}
                      </p>
                    )}
                  </div>
                </>
              )}

              {touchedInvalidFields.size > 1 && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2" role="alert">
                  {t('errors.validationSummary', { count: touchedInvalidFields.size })}
                </p>
              )}

              {modalError && (
                <p className="text-sm text-red-600 flex items-center gap-1" role="alert">
                  <AlertTriangle size={13} />
                  {modalError}
                </p>
              )}
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setPendingCell(null)} className="btn-secondary" disabled={submitting}>{t('actions.cancel')}</button>
              <button onClick={submitAction} disabled={submitting} className="btn-primary flex items-center gap-2">
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {t('actions.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      <LegacyConsentCorrectionModal
        open={legacyCorrectionModalOpen}
        patientId={patientId}
        onClose={() => setLegacyCorrectionModalOpen(false)}
        // Deliberately does NOT close the modal — the modal shows its own
        // success confirmation and a "Kapat" button; auto-closing here would
        // remove that confirmation before the user ever sees it.
        onSuccess={refreshAfterLegacyCorrection}
      />
      <LegacyConsentCorrectionHistory
        open={legacyCorrectionHistoryOpen}
        patientId={patientId}
        canViewDetail={canCorrectLegacyConsent}
        onClose={() => setLegacyCorrectionHistoryOpen(false)}
      />

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

/**
 * Generic legacy boolean field (communicationConsent/marketingConsent) — a
 * default `false` is never rendered as an explicit patient denial (KVKK-HIGH-008
 * requirement); both states use neutral gray wording, since neither value is
 * the current source of truth for consent.
 */
const LegacyField: React.FC<{ label: string; value: boolean; neutral?: boolean }> = ({ label, value }) => (
  <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100">
    <span className="text-xs text-gray-600 break-words pr-2">{label}</span>
    <span className="text-xs font-medium flex-shrink-0 text-gray-500">
      {value ? 'İşaretli' : 'Kayıtlı değil'}
    </span>
  </div>
);

/**
 * Tri-state smsOptOut display (KVKK-HIGH-008 §G): active restrictive legacy
 * signal / corrected historical signal / not present. Never shows a plain
 * "Evet"/"Hayır" — the whole point is to distinguish "still restricting" from
 * "was restricting, now corrected" from "never was set".
 */
const SmsOptOutLegacyField: React.FC<{
  active: boolean;
  correction: { createdAt: string; evidenceType: string } | null;
  correctionLabel: string;
  formatDate: (d: string) => string;
  t: (key: string, opts?: any) => string;
}> = ({ active, correction, correctionLabel, formatDate, t }) => {
  const label = t('legacySignals.smsOptOut');
  if (active) {
    return (
      <div className="flex items-center justify-between p-2 rounded-lg bg-red-50 border border-red-100">
        <span className="text-xs text-gray-700 break-words pr-2">{label}</span>
        <span className="text-xs font-bold flex-shrink-0 text-red-600">{t('legacySignals.smsOptOutActive')}</span>
      </div>
    );
  }
  if (correction) {
    return (
      <div className="flex items-center justify-between p-2 rounded-lg bg-green-50 border border-green-100" title={`${formatDate(correction.createdAt)} — ${correctionLabel}`}>
        <span className="text-xs text-gray-700 break-words pr-2">{label}</span>
        <span className="text-xs font-bold flex-shrink-0 text-green-700">{t('legacySignals.smsOptOutCorrected')}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100">
      <span className="text-xs text-gray-600 break-words pr-2">{label}</span>
      <span className="text-xs font-medium flex-shrink-0 text-gray-400">{t('legacySignals.smsOptOutNotPresent')}</span>
    </div>
  );
};

export default CommunicationPreferencesPanel;
