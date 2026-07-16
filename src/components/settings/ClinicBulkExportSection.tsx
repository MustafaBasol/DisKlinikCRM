import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download, Loader2, ShieldAlert } from 'lucide-react';
import { clinicBulkExportService } from '../../services/api';
import { getErrorMessage } from '../../utils/errors';
import { useClinicBulkExportStatus } from '../../hooks/useClinicBulkExportStatus';
import { resolveExplicitClinicId, initialClinicBulkExportState, type ClinicOption } from './clinicBulkExportSelectionHelpers';

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
  }, []);

  useEffect(() => {
    // React to the global switcher changing to a DIFFERENT, still-accessible
    // specific clinic — but never auto-select on "all". If the previously
    // selected clinic simply drops out of the accessible list, clear it
    // rather than silently keeping a now-invalid selection. Either way,
    // every piece of transient/sensitive state is reset alongside the id.
    setClinicId((current) => {
      const next = resolveExplicitClinicId(globalSelectedClinicId, availableClinics, current);
      if (next !== current) resetForClinicChange();
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSelectedClinicId, availableClinics]);

  const { job, timedOut } = useClinicBulkExportStatus(clinicId || null, activeJobId);

  const objectUrlRef = useRef<string | null>(null);

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
      setClinicId(nextClinicId);
      resetForClinicChange();
    },
    [clinicId, resetForClinicChange],
  );

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

    setSubmitting(true);
    try {
      const response = await clinicBulkExportService.createJob(clinicId, {
        purpose,
        confirm: true,
        currentPassword: password,
        restrictedNote: restrictedNote.trim() || undefined,
      });
      setActiveJobId(response.data?.jobId ?? null);
      setPassword('');
      setConfirmChecked(false);
    } catch (err) {
      setSubmitError(t(`errors.${errorKeyFromResponse(err)}`, { defaultValue: t('errors.generic') }));
    } finally {
      setSubmitting(false);
    }
  }, [clinicId, submitting, purpose, confirmChecked, password, restrictedNote, t]);

  const handleDownload = useCallback(async () => {
    if (!clinicId || !job || downloading) return;
    setDownloadError(null);
    if (!downloadPassword) {
      setDownloadError(t('errors.passwordRequired'));
      return;
    }

    setDownloading(true);
    try {
      const tokenResponse = await clinicBulkExportService.requestDownloadToken(clinicId, job.jobId, downloadPassword);
      const token = tokenResponse.data?.token;
      setDownloadPassword('');
      if (!token) throw new Error('missing_token');

      const fileResponse = await clinicBulkExportService.download(clinicId, job.jobId, token);
      const blob = fileResponse.data as Blob;
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const a = document.createElement('a');
      a.href = url;
      a.download = `clinic-export-${clinicId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      objectUrlRef.current = null;
    } catch (err) {
      setDownloadError(t(`errors.${errorKeyFromResponse(err)}`, { defaultValue: t('errors.generic') }));
    } finally {
      setDownloading(false);
    }
  }, [clinicId, job, downloading, downloadPassword, t]);

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
                <button
                  type="button"
                  onClick={() => {
                    setActiveJobId(null);
                    setPurpose('');
                    setRestrictedNote('');
                  }}
                  className="text-sm text-primary-600 hover:underline"
                >
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
