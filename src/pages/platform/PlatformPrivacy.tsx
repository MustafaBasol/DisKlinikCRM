import React, { useEffect, useState } from 'react';
import {
  Loader2, AlertCircle, Shield, Play, Trash2, RefreshCw, CheckCircle2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';

interface DataRetentionPolicy {
  cleanupEnabled: boolean;
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

  const [runLoading, setRunLoading] = useState(false);
  const [runResult, setRunResult] = useState<CleanupSummary | null>(null);
  const [runError, setRunError] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchPolicy = () => {
    setPolicyLoading(true);
    setPolicyError('');
    api
      .get('/platform/privacy/data-retention/policy')
      .then((res) => setPolicy(res.data))
      .catch(() => setPolicyError(t('platform:privacy.policyLoadFailed')))
      .finally(() => setPolicyLoading(false));
  };

  useEffect(() => { fetchPolicy(); }, []);

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

      {/* Policy card */}
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
          {/* Disabled warning */}
          {!policy.cleanupEnabled && (
            <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
              <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800 dark:text-amber-300">
                {t('platform:privacy.disabledWarning')}
              </p>
            </div>
          )}

          {/* Policy values */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">
              {t('platform:privacy.policyTitle')}
            </h2>
            <div className="grid sm:grid-cols-2 gap-x-8 divide-y divide-gray-50 dark:divide-gray-800 sm:divide-y-0">
              {([
                {
                  label: t('platform:privacy.fields.enabled'),
                  value: policy.cleanupEnabled
                    ? t('platform:statuses.active')
                    : t('platform:statuses.inactive'),
                },
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

      {/* Actions */}
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
            onClick={() => setConfirmOpen(true)}
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
