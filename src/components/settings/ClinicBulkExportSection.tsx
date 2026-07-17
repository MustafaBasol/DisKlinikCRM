import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download, Loader2, ShieldAlert } from 'lucide-react';
import { clinicBulkExportService } from '../../services/api';
import { getErrorMessage } from '../../utils/errors';
import { useClinicBulkExportStatus } from '../../hooks/useClinicBulkExportStatus';
import {
  resolveExplicitClinicId,
  initialClinicBulkExportState,
  isRequestStillCurrent,
  type ClinicOption,
} from './clinicBulkExportSelectionHelpers';

interface ClinicBulkExportSectionProps {
  /** Every clinic the authenticated user can access — the ONLY valid source for the in-section selector below. */
  availableClinics: ClinicOption[];
  /** The global clinic-switcher's current selection: "all" or a specific clinic id. Never used to silently pick a clinic for export. */
  globalSelectedClinicId: string;
  canEdit: boolean;
}

const PURPOSE_OPTIONS = ['regulatory_request', 'clinic_migration', 'contract_termination', 'legal_request', 'other'] as const;

function errorKeyFromResponse(err: unknown): string {
  const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return typeof code === 'string' && code.startsWith('CLINIC_BULK_EXPORT_') ? code : 'generic';
}

/**
 * KVKK-HIGH-004 remediation (P0): the global clinic switcher may be set to
 * "all", and even when it names one clinic, silently trusting it here would
 * let a stale/unrelated global selection drive an irreversible, highly
 * sensitive export. This component therefore owns its OWN explicit clinic
 * selection, seeded (never silently defaulted) from the global selector only
 * when it already names one specific, accessible clinic — otherwise the
 * user must pick one here before anything can be submitted.
 */
const ClinicBulkExportSection: React.FC<ClinicBulkExportSectionProps> = ({ availableClinics, globalSelectedClinicId, canEdit }) => {
  const { t } = useTranslation('clinicBulkExport');

  const [clinicId, setClinicId] = useState<string>(() => resolveExplicitClinicId(globalSelectedClinicId, availableClinics, ''));

  const initial = initialClinicBulkExportState();
  const [enabled, setEnabled] = useState<boolean | null>(initial.enabled);
  const [configError, setConfigError] = useState<string | null>(initial.configError);
  const [purpose, setPurpose] = useState<string>(initial.purpose);
  const [restrictedNote, setRestrictedNote] = useState(initial.restrictedNote);
  const [password, setPassword] = useState(initial.password);
  const [confirmChecked, setConfirmChecked] = useState(initial.confirmChecked);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(initial.submitError);
  const [activeJobId, setActiveJobId] = useState<string | null>(initial.activeJobId);
  const [downloadPassword, setDownloadPassword] = useState(initial.downloadPassword);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(initial.downloadError);

  const objectUrlRef = useRef<string | null>(null);

  /**
   * KVKK-HIGH-004 remediation (P0): a monotonically increasing epoch, bumped
   * every time the explicit clinic selection changes or becomes invalid
   * (never for any other reason). Every in-flight create/token/download
   * async operation captures {clinicId, epoch} at the moment it starts, and
   * re-checks BOTH against the current, live values (via clinicIdRef below,
   * since a plain closure over `clinicId` would be stale) after every
   * `await` before touching any state or triggering a download — a response
   * for a clinic the user has since navigated away from is silently
   * discarded, never applied to the UI. AbortController would additionally
   * cancel the underlying HTTP request, but the epoch guard alone is
   * sufficient for correctness and is what makes this mandatory (see
   * docs/compliance/54-kvkk-secure-clinic-bulk-export.md Section 13).
   */
  const selectionEpochRef = useRef(0);
  const clinicIdRef = useRef(clinicId);
  useEffect(() => {
    clinicIdRef.current = clinicId;
  }, [clinicId]);

  /** Resets every in-flight/sensitive piece of state — called whenever the explicit clinic selection changes. */
  const resetForClinicChange = useCallback(() => {
    const fresh = initialClinicBulkExportState();
    setActiveJobId(fresh.activeJobId);
    setPassword(fresh.password);
    setConfirmChecked(fresh.confirmChecked);
    setDownloadPassword(fresh.downloadPassword);
    setDownloadError(fresh.downloadError);
    setSubmitError(fresh.submitError);
    setPurpose(fresh.purpose);
    setRestrictedNote(fresh.restrictedNote);
    setEnabled(fresh.enabled);
    setConfigError(fresh.configError);
    setSubmitting(false);
    setDownloading(false);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    // Polling state itself lives inside useClinicBulkExportStatus, keyed on
    // [clinicId, activeJobId] — resetting activeJobId to null above (plus
    // clinicId changing) makes that hook's own effect tear down and restart
    // its poll automatically; nothing further to do here.
  }, []);

  useEffect(() => {
    // React to the global switcher changing to a DIFFERENT, still-accessible
    // specific clinic — but never auto-select on "all". If the previously
    // selected clinic simply drops out of the accessible list, clear it
    // rather than silently keeping a now-invalid selection. Reads the
    // current clinicId via a ref (not the `clinicId` state directly) so this
    // effect's own dependency array can stay [globalSelectedClinicId,
    // availableClinics] without re-fighting a manual in-section selection —
    // and, per the P0 state-update-purity fix, the reset is a plain
    // top-level call in the effect body, never nested inside a setState
    // functional updater.
    const next = resolveExplicitClinicId(globalSelectedClinicId, availableClinics, clinicIdRef.current);
    if (next !== clinicIdRef.current) {
      selectionEpochRef.current += 1;
      setClinicId(next);
      resetForClinicChange();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSelectedClinicId, availableClinics]);

  const { job, timedOut } = useClinicBulkExportStatus(clinicId || null, activeJobId);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const handleClinicChange = useCallback(
    (nextClinicId: string) => {
      if (nextClinicId === clinicId) return;
      selectionEpochRef.current += 1;
      setClinicId(nextClinicId);
      resetForClinicChange();
    },
    [clinicId, resetForClinicChange],
  );

  /** True only when the async op's captured {clinicId, epoch} still match the live selection. */
  const isStillCurrentSelection = useCallback((requestClinicId: string, requestEpoch: number) => {
    return isRequestStillCurrent(requestClinicId, requestEpoch, clinicIdRef.current, selectionEpochRef.current);
  }, []);

  useEffect(() => {
    let alive = true;
    if (!clinicId) return;
    clinicBulkExportService
      .getConfig(clinicId)
      .then((res) => {
        if (!alive) return;
        setEnabled(Boolean(res.data?.enabled));
      })
      .catch((err) => {
        if (!alive) return;
        setConfigError(getErrorMessage(err));
        setEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [clinicId]);

  const selectedClinic = availableClinics.find((c) => c.id === clinicId) ?? null;

  const handleCreate = useCallback(async () => {
    if (submitting) return;
    setSubmitError(null);
    if (!clinicId) {
      setSubmitError(t('errors.clinicRequired'));
      return;
    }
    if (!purpose) {
      setSubmitError(t('errors.purposeRequired'));
      return;
    }
    if (!confirmChecked) {
      setSubmitError(t('errors.confirmRequired'));
      return;
    }
    if (!password) {
      setSubmitError(t('errors.passwordRequired'));
      return;
    }

    // Captured now, checked again after every await below (P0 stale-response guard).
    const requestClinicId = clinicId;
    const requestEpoch = selectionEpochRef.current;

    setSubmitting(true);
    try {
      const response = await clinicBulkExportService.createJob(requestClinicId, {
        purpose,
        confirm: true,
        currentPassword: password,
        restrictedNote: restrictedNote.trim() || undefined,
      });
      if (!isStillCurrentSelection(requestClinicId, requestEpoch)) return;
      setActiveJobId(response.data?.jobId ?? null);
      setPassword('');
      setConfirmChecked(false);
    } catch (err) {
      if (!isStillCurrentSelection(requestClinicId, requestEpoch)) return;
      setSubmitError(t(`errors.${errorKeyFromResponse(err)}`, { defaultValue: t('errors.generic') }));
    } finally {
      // P1: the epoch guard must also apply to the finally block — an old
      // clinic-A request's own finally must never clear clinic-B's loading
      // state just because a create for B started (and is possibly still
      // pending) after A's request began but before A's promise settled.
      if (isStillCurrentSelection(requestClinicId, requestEpoch)) setSubmitting(false);
    }
  }, [clinicId, submitting, purpose, confirmChecked, password, restrictedNote, t, isStillCurrentSelection]);

  const handleDownload = useCallback(async () => {
    if (!clinicId || !job || downloading) return;
    setDownloadError(null);
    if (!downloadPassword) {
      setDownloadError(t('errors.passwordRequired'));
      return;
    }

    // Captured now, checked again after every await below (P0 stale-response
    // guard) — including before ever ISSUING the follow-up download request,
    // not just before applying its result.
    const requestClinicId = clinicId;
    const requestEpoch = selectionEpochRef.current;
    const requestJobId = job.jobId;

    setDownloading(true);
    try {
      const tokenResponse = await clinicBulkExportService.requestDownloadToken(requestClinicId, requestJobId, downloadPassword);
      if (!isStillCurrentSelection(requestClinicId, requestEpoch)) return;

      const token = tokenResponse.data?.token;
      setDownloadPassword('');
      if (!token) throw new Error('missing_token');

      const fileResponse = await clinicBulkExportService.download(requestClinicId, requestJobId, token);
      if (!isStillCurrentSelection(requestClinicId, requestEpoch)) return;

      const blob = fileResponse.data as Blob;
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const a = document.createElement('a');
      a.href = url;
      a.download = `clinic-export-${requestClinicId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      objectUrlRef.current = null;
    } catch (err) {
      if (!isStillCurrentSelection(requestClinicId, requestEpoch)) return;
      setDownloadError(t(`errors.${errorKeyFromResponse(err)}`, { defaultValue: t('errors.generic') }));
    } finally {
      // P1: same finally-block epoch guard as handleCreate above — a stale
      // clinic-A download's finally must never re-enable the download
      // button while a clinic-B download is still in flight.
      if (isStillCurrentSelection(requestClinicId, requestEpoch)) setDownloading(false);
    }
  }, [clinicId, job, downloading, downloadPassword, t, isStillCurrentSelection]);

  /**
   * "Start new export" — clears every password/confirmation/download/error
   * field (P0: requirement mirrors resetForClinicChange's list minus the
   * clinic-identity fields) while retaining ONLY the currently selected
   * clinic and its current enabled/configError state. Also bumps the
   * selection epoch so a download/create request still in flight for the
   * export being abandoned can never repopulate state this action just
   * cleared.
   */
  const handleStartNew = useCallback(() => {
    selectionEpochRef.current += 1;
    setActiveJobId(null);
    setPurpose('');
    setRestrictedNote('');
    setPassword('');
    setConfirmChecked(false);
    setDownloadPassword('');
    setDownloadError(null);
    setSubmitError(null);
    setSubmitting(false);
    setDownloading(false);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  if (!canEdit) return null;

  const isPending = job && (job.status === 'queued' || job.status === 'generating');
  const isReady = job?.status === 'ready';

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{t('title')}</h2>
        <p className="text-sm text-gray-600 mt-1">{t('description')}</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('clinicSelectorLabel')}</label>
        <select
          value={clinicId}
          onChange={(e) => handleClinicChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">{t('clinicSelectorPlaceholder')}</option>
          {availableClinics.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinic.name}
            </option>
          ))}
        </select>
        {globalSelectedClinicId === 'all' && !clinicId && (
          <p className="text-sm text-amber-700 mt-1">{t('clinicSelectorAllClinicsNotice')}</p>
        )}
      </div>

      {!clinicId ? null : enabled === null ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="animate-spin" size={18} />
          {t('loading')}
        </div>
      ) : !enabled ? (
        <div className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-lg p-4 text-gray-600 text-sm">
          <ShieldAlert size={20} className="shrink-0 mt-0.5" />
          <span>{configError ?? t('disabledNotice')}</span>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-gray-900">
            {t('selectedClinicPrefix')}: <span className="font-semibold">{selectedClinic?.name}</span>
          </p>

          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" />
            <span>{t('scopeWarning')}</span>
          </div>

          {!job && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('purposeLabel')}</label>
                <select
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">{t('purposePlaceholder')}</option>
                  {PURPOSE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`purposeOptions.${option}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('restrictedNoteLabel')}</label>
                <textarea
                  value={restrictedNote}
                  onChange={(e) => setRestrictedNote(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('passwordLabel')}</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
                {t('confirmLabel', { clinicName: selectedClinic?.name ?? '' })}
              </label>

              {submitError && <p className="text-sm text-red-600">{submitError}</p>}

              <button
                type="button"
                onClick={handleCreate}
                disabled={submitting || !clinicId}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-60"
              >
                {submitting ? t('submitting') : t('submit')}
              </button>
            </div>
          )}

          {job && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-gray-700">{t(`status.${job.status}`)}</p>
              {timedOut && <p className="text-sm text-amber-700">{t('status.timedOut')}</p>}
              {job.status === 'failed' && job.failureCode && (
                <p className="text-sm text-red-600">{t('failureCodePrefix')}: {job.failureCode}</p>
              )}

              {isPending && (
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="animate-spin" size={16} />
                  {t('polling')}
                </div>
              )}

              {isReady && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('downloadPasswordLabel')}</label>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={downloadPassword}
                      onChange={(e) => setDownloadPassword(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  {downloadError && <p className="text-sm text-red-600">{downloadError}</p>}
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={downloading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-60"
                  >
                    {downloading ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                    {t('downloadButton')}
                  </button>
                </div>
              )}

              {(job.status === 'failed' || job.status === 'expired' || isReady) && (
                <button type="button" onClick={handleStartNew} className="text-sm text-primary-600 hover:underline">
                  {t('startNew')}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ClinicBulkExportSection;
