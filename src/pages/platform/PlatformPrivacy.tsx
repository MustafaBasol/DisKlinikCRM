import React, { useEffect, useState } from 'react';
import {
  Loader2, AlertCircle, Shield, Play, Trash2, RefreshCw, CheckCircle2, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';

interface DataRetentionPolicy {
  envCleanupEnabled: boolean;
  runtimeCleanupEnabled: boolean;
  effectiveCleanupEnabled: boolean;
  cleanupEnabledSource: 'env_disabled' | 'runtime_disabled' | 'enabled';
  cron: string;
  conversationMessagesDays: number;
  conversationStateDays: number;
  operationalEventsDays: number;
  inboundEventDays: number;
  resolvedContactRequestDays: number;
  batchSize: number;
}

interface CleanupSummary {
  deletedConversationMessages: number;
  deletedConversationStates: number;
  deletedOperationalEvents: number;
  deletedInboundEvents: number;
  anonymizedContactRequests: number;
  redactedInboxEntries: number;
  skippedCategories: string[];
  errors: string[];
  dryRun: boolean;
}

const PlatformPrivacy: React.FC = () => {
  const { t } = useTranslation(['platform']);
  const api = usePlatformApi();

  const [policy, setPolicy] = useState<DataRetentionPolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState('');

  const [toggleLoading, setToggleLoading] = useState(false);
  const [toggleSuccess, setToggleSuccess] = useState(false);
  const [toggleError, setToggleError] = useState('');

  const [runLoading, setRunLoading] = useState(false);
  const [runResult, setRunResult] = useState<CleanupSummary | null>(null);
  const [runError, setRunError] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);

  // KVKK-HIGH-008-F1: legacy consent correction runtime kill switch —
  // platform-wide, default false. Same PlatformSetting-backed GET/PATCH
  // pattern as the data-retention toggle above, kept as its own small state
  // slice rather than folded into `policy` since the two features are
  // otherwise unrelated.
  const [legacyCorrectionEnabled, setLegacyCorrectionEnabled] = useState(false);
  const [legacyCorrectionLoading, setLegacyCorrectionLoading] = useState(true);
  const [legacyCorrectionToggleLoading, setLegacyCorrectionToggleLoading] = useState(false);
  const [legacyCorrectionToggleSuccess, setLegacyCorrectionToggleSuccess] = useState(false);
  const [legacyCorrectionToggleError, setLegacyCorrectionToggleError] = useState('');

  const fetchPolicy = () => {
    setPolicyLoading(true);
    setPolicyError('');
    api
      .get('/platform/privacy/data-retention/policy')
      .then((res) => setPolicy(res.data))
      .catch(() => setPolicyError(t('platform:privacy.policyLoadFailed')))
      .finally(() => setPolicyLoading(false));
  };

  const fetchLegacyCorrectionSetting = () => {
    setLegacyCorrectionLoading(true);
    api
      .get('/platform/privacy/legacy-consent-correction/policy')
      .then((res) => setLegacyCorrectionEnabled(Boolean(res.data.runtimeEnabled)))
      .catch(() => setLegacyCorrectionEnabled(false))
      .finally(() => setLegacyCorrectionLoading(false));
  };

  useEffect(() => { fetchPolicy(); fetchLegacyCorrectionSetting(); }, []);

  const handleLegacyCorrectionToggle = async () => {
    const next = !legacyCorrectionEnabled;
    setLegacyCorrectionToggleLoading(true);
    setLegacyCorrectionToggleSuccess(false);
    setLegacyCorrectionToggleError('');
    try {
      const res = await api.patch('/platform/privacy/legacy-consent-correction/settings', {
        runtimeEnabled: next,
      });
      setLegacyCorrectionEnabled(Boolean(res.data.runtimeEnabled));
      setLegacyCorrectionToggleSuccess(true);
      setTimeout(() => setLegacyCorrectionToggleSuccess(false), 3000);
    } catch {
      setLegacyCorrectionToggleError(t('platform:privacy.legacyConsentCorrection.saveFailed'));
    } finally {
      setLegacyCorrectionToggleLoading(false);
    }
  };

  const handleToggle = async () => {
    if (!policy) return;
    const next = !policy.runtimeCleanupEnabled;
    setToggleLoading(true);
    setToggleSuccess(false);
    setToggleError('');
    try {
      const res = await api.patch('/platform/privacy/data-retention/settings', {
        runtimeCleanupEnabled: next,
      });
      setPolicy(res.data);
      setToggleSuccess(true);
      setTimeout(() => setToggleSuccess(false), 3000);
    } catch {
      setToggleError(t('platform:privacy.autoCleanup.saveFailed'));
    } finally {
      setToggleLoading(false);
    }
  };

  const runCleanup = async (dryRun: boolean) => {
    setRunLoading(true);
    setRunError('');
    setRunResult(null);
    try {
      const res = await api.post('/platform/privacy/data-retention/run', { dryRun });
      setRunResult(res.data.summary);
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        setRunError(t('platform:privacy.unauthorizedError'));
      } else {
        setRunError(t('platform:privacy.runFailed'));
      }
    } finally {
      setRunLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {t('platform:privacy.title')}
        </h1>
        <button
          onClick={fetchPolicy}
          className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
        >
          <RefreshCw size={14} />
          {t('platform:actions.refresh')}
        </button>
      </div>

      {/* Explanation card */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Shield size={20} className="text-blue-500 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-800 dark:text-blue-300">{t('platform:privacy.explanation')}</p>
        </div>
      </div>

      {/* Policy loading / error */}
      {policyLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={28} className="animate-spin text-blue-500" />
        </div>
      ) : policyError ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
          <AlertCircle size={18} />
          <span>{policyError}</span>
        </div>
      ) : policy ? (
        <>
          {/* ── Automatic Cleanup Control ─────────────────────────────── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">
              {t('platform:privacy.autoCleanup.title')}
            </h2>

            <div className="space-y-3">
              {/* System-level (env) */}
              <div className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-800">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t('platform:privacy.autoCleanup.systemLevel')}
                </span>
                <span className={`text-sm font-medium ${policy.envCleanupEnabled ? 'text-green-600' : 'text-red-500'}`}>
                  {policy.envCleanupEnabled
                    ? t('platform:privacy.autoCleanup.on')
                    : t('platform:privacy.autoCleanup.off')}
                </span>
              </div>

              {/* Runtime toggle */}
              <div className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-800">
                <div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {t('platform:privacy.autoCleanup.runtimeSetting')}
                  </span>
                  {toggleError && (
                    <p className="text-xs text-red-500 mt-0.5">{toggleError}</p>
                  )}
                  {toggleSuccess && (
                    <p className="text-xs text-green-600 mt-0.5">{t('platform:privacy.autoCleanup.saveSuccess')}</p>
                  )}
                </div>
                <button
                  onClick={handleToggle}
                  disabled={!policy.envCleanupEnabled || toggleLoading}
                  title={!policy.envCleanupEnabled ? t('platform:privacy.autoCleanup.envDisabledWarning') : undefined}
                  className="flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                  {toggleLoading ? (
                    <Loader2 size={22} className="animate-spin text-blue-500" />
                  ) : policy.runtimeCleanupEnabled ? (
                    <ToggleRight size={28} className="text-green-500" />
                  ) : (
                    <ToggleLeft size={28} className="text-gray-400" />
                  )}
                  <span className={`text-sm font-medium ${policy.runtimeCleanupEnabled ? 'text-green-600' : 'text-gray-400'}`}>
                    {policy.runtimeCleanupEnabled
                      ? t('platform:privacy.autoCleanup.on')
                      : t('platform:privacy.autoCleanup.off')}
                  </span>
                </button>
              </div>

              {/* Effective status */}
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t('platform:privacy.autoCleanup.effectiveStatus')}
                </span>
                <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-2.5 py-0.5 rounded-full ${
                  policy.effectiveCleanupEnabled
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                }`}>
                  {policy.effectiveCleanupEnabled
                    ? t('platform:privacy.autoCleanup.active')
                    : t('platform:privacy.autoCleanup.passive')}
                </span>
              </div>
            </div>

            {/* Source-specific warnings */}
            {policy.cleanupEnabledSource === 'env_disabled' && (
              <div className="flex items-start gap-3 mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  {t('platform:privacy.autoCleanup.envDisabledWarning')}
                </p>
              </div>
            )}
            {policy.cleanupEnabledSource === 'runtime_disabled' && (
              <div className="flex items-start gap-3 mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  {t('platform:privacy.autoCleanup.runtimeDisabledWarning')}
                </p>
              </div>
            )}
          </div>

          {/* ── Policy values ─────────────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">
              {t('platform:privacy.policyTitle')}
            </h2>
            <div className="grid sm:grid-cols-2 gap-x-8 divide-y divide-gray-50 dark:divide-gray-800 sm:divide-y-0">
              {([
                { label: t('platform:privacy.fields.cron'), value: policy.cron },
                {
                  label: t('platform:privacy.fields.conversationMessages'),
                  value: `${policy.conversationMessagesDays} ${t('platform:privacy.days')}`,
                },
                {
                  label: t('platform:privacy.fields.conversationState'),
                  value: `${policy.conversationStateDays} ${t('platform:privacy.days')}`,
                },
                {
                  label: t('platform:privacy.fields.operationalEvents'),
                  value: `${policy.operationalEventsDays} ${t('platform:privacy.days')}`,
                },
                {
                  label: t('platform:privacy.fields.inboundEvents'),
                  value: `${policy.inboundEventDays} ${t('platform:privacy.days')}`,
                },
                {
                  label: t('platform:privacy.fields.contactRequests'),
                  value: `${policy.resolvedContactRequestDays} ${t('platform:privacy.days')}`,
                },
                { label: t('platform:privacy.fields.batchSize'), value: policy.batchSize },
              ] as { label: string; value: string | number }[]).map(({ label, value }) => (
                <div
                  key={label}
                  className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-800 last:border-0 sm:col-span-1"
                >
                  <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {/* ── Legacy Consent Correction Runtime Toggle (KVKK-HIGH-008-F1) ──── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-2">
          {t('platform:privacy.legacyConsentCorrection.title')}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {t('platform:privacy.legacyConsentCorrection.explanation')}
        </p>
        {legacyCorrectionLoading ? (
          <div className="flex items-center justify-center h-16">
            <Loader2 size={20} className="animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="flex items-center justify-between py-1">
            <div>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {t('platform:privacy.legacyConsentCorrection.runtimeSetting')}
              </span>
              {legacyCorrectionToggleError && (
                <p className="text-xs text-red-500 mt-0.5">{legacyCorrectionToggleError}</p>
              )}
              {legacyCorrectionToggleSuccess && (
                <p className="text-xs text-green-600 mt-0.5">{t('platform:privacy.legacyConsentCorrection.saveSuccess')}</p>
              )}
            </div>
            <button
              onClick={handleLegacyCorrectionToggle}
              disabled={legacyCorrectionToggleLoading}
              className="flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {legacyCorrectionToggleLoading ? (
                <Loader2 size={22} className="animate-spin text-blue-500" />
              ) : legacyCorrectionEnabled ? (
                <ToggleRight size={28} className="text-green-500" />
              ) : (
                <ToggleLeft size={28} className="text-gray-400" />
              )}
              <span className={`text-sm font-medium ${legacyCorrectionEnabled ? 'text-green-600' : 'text-gray-400'}`}>
                {legacyCorrectionEnabled
                  ? t('platform:privacy.autoCleanup.on')
                  : t('platform:privacy.autoCleanup.off')}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-4">
          {t('platform:privacy.actionsTitle')}
        </h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => runCleanup(true)}
            disabled={runLoading}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {runLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Play size={15} />
            )}
            {t('platform:privacy.dryRunBtn')}
          </button>
          <button
            onClick={() => {
              if (policy && !policy.envCleanupEnabled) {
                setRunError(t('platform:privacy.liveRunBlockedEnvDisabled'));
                return;
              }
              setConfirmOpen(true);
            }}
            disabled={runLoading}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Trash2 size={15} />
            {t('platform:privacy.liveRunBtn')}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          {t('platform:privacy.actionsNote')}
        </p>
      </div>

      {/* Run error */}
      {runError && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
          <AlertCircle size={18} />
          <span className="text-sm">{runError}</span>
        </div>
      )}

      {/* Run result */}
      {runResult && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 size={18} className="text-green-500" />
            <h2 className="font-semibold text-gray-900 dark:text-white">
              {runResult.dryRun
                ? t('platform:privacy.dryRunResult')
                : t('platform:privacy.liveRunResult')}
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {([
              {
                label: t('platform:privacy.summary.conversationMessages'),
                value: runResult.deletedConversationMessages,
              },
              {
                label: t('platform:privacy.summary.conversationStates'),
                value: runResult.deletedConversationStates,
              },
              {
                label: t('platform:privacy.summary.operationalEvents'),
                value: runResult.deletedOperationalEvents,
              },
              {
                label: t('platform:privacy.summary.inboundEvents'),
                value: runResult.deletedInboundEvents,
              },
              {
                label: t('platform:privacy.summary.contactRequests'),
                value: runResult.anonymizedContactRequests,
              },
              {
                label: t('platform:privacy.summary.inboxEntries'),
                value: runResult.redactedInboxEntries,
              },
            ] as { label: string; value: number }[]).map(({ label, value }) => (
              <div
                key={label}
                className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
              >
                <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
                <span className="font-bold text-gray-900 dark:text-white">{value}</span>
              </div>
            ))}
          </div>
          {runResult.errors.length > 0 && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">
                {t('platform:privacy.summary.errorsLabel')} ({runResult.errors.length})
              </p>
              <p className="text-xs text-red-600 dark:text-red-400">
                {t('platform:privacy.summary.errorsNote')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Confirmation modal */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 max-w-md w-full shadow-xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white text-lg">
                {t('platform:privacy.confirmTitle')}
              </h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              {t('platform:privacy.confirmWarning')}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {t('platform:actions.cancel')}
              </button>
              <button
                onClick={() => { setConfirmOpen(false); runCleanup(false); }}
                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                {t('platform:privacy.confirmBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlatformPrivacy;
