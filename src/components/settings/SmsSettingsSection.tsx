import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare, Loader2, AlertCircle, CheckCircle2, XCircle, RefreshCw, Info,
} from 'lucide-react';
import { smsService } from '../../services/api';

type SmsStatusPayload = {
  addonActive: boolean;
  addonSource: 'clinic_addon' | 'plan_feature' | null;
  period: string;
  monthlyQuota: number;
  usedThisMonth: number;
  remaining: number;
  regions: {
    tr: { available: boolean };
    eu: { available: boolean };
  };
};

type SmsHistoryEntry = {
  id: string;
  purpose: string;
  recipient: string;
  status: string;
  providerRegion: string | null;
  provider: string | null;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
  patient?: { firstName: string; lastName: string } | null;
  template?: { name: string } | null;
};

const STATUS_BADGE: Record<string, string> = {
  sent: 'badge-green',
  delivered: 'badge-green',
  queued: 'badge-gray',
  failed: 'badge-red',
  blocked_quota: 'badge-yellow',
  blocked_consent: 'badge-yellow',
  blocked_region: 'badge-yellow',
  blocked_template: 'badge-yellow',
};

interface SmsSettingsSectionProps {
  clinicId?: string;
}

const SmsSettingsSection: React.FC<SmsSettingsSectionProps> = ({ clinicId }) => {
  const { t } = useTranslation(['sms', 'common']);
  const [status, setStatus] = useState<SmsStatusPayload | null>(null);
  const [history, setHistory] = useState<SmsHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, historyRes] = await Promise.all([
        smsService.getSettings(clinicId),
        smsService.getHistory(clinicId ? { clinicId, limit: 50 } : { limit: 50 }),
      ]);
      setStatus(settingsRes.data);
      setHistory(historyRes.data);
    } catch {
      setError(t('sms:errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [clinicId, t]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-500" /></div>;
  }

  if (error) {
    return <div className="text-red-500 p-4 bg-red-50 rounded-lg">{error}</div>;
  }

  const quotaPercent = status && status.monthlyQuota > 0
    ? Math.min(100, Math.round((status.usedThisMonth / status.monthlyQuota) * 100))
    : 0;

  return (
    <div className="space-y-6">
      {/* Add-on status + quota */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2">
            <MessageSquare size={20} className="text-gray-400" />
            <div>
              <h2 className="text-lg font-bold">{t('sms:title')}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('sms:subtitle')}</p>
            </div>
          </div>
          <button onClick={load} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50" title={t('common:refresh', { defaultValue: 'Refresh' })}>
            <RefreshCw size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 mb-4">
          {status?.addonActive ? (
            <>
              <CheckCircle2 size={18} className="text-green-600" />
              <span className="text-sm font-medium text-green-700">
                {t('sms:addon.active')}
                {status.addonSource === 'plan_feature' && ` — ${t('sms:addon.viaPlan')}`}
              </span>
            </>
          ) : (
            <>
              <XCircle size={18} className="text-gray-400" />
              <span className="text-sm font-medium text-gray-600">{t('sms:addon.inactive')}</span>
            </>
          )}
        </div>

        {!status?.addonActive && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{t('sms:addon.contactSales')}</span>
          </div>
        )}

        {status?.addonActive && (
          <div>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-600">{t('sms:quota.title', { period: status.period })}</span>
              <span className="font-medium text-gray-900">
                {t('sms:quota.usage', { used: status.usedThisMonth, total: status.monthlyQuota })}
              </span>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${quotaPercent >= 100 ? 'bg-red-500' : quotaPercent >= 80 ? 'bg-amber-500' : 'bg-primary-500'}`}
                style={{ width: `${quotaPercent}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {t('sms:quota.remaining', { count: status.remaining })}
            </p>
            {status.remaining === 0 && (
              <p className="mt-2 text-xs text-red-600 font-medium">{t('sms:quota.exhausted')}</p>
            )}
          </div>
        )}
      </div>

      {/* Provider/routing info — read-only, no clinic-side provider controls */}
      {status?.addonActive && (
        <div className="card p-6">
          <div className="flex items-start gap-2 mb-4">
            <Info size={18} className="text-gray-400 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-base font-bold mb-1">{t('sms:providers.title')}</h3>
              <p className="text-sm text-gray-500">{t('sms:providers.subtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-100 px-3 py-2">
              <span className="block text-xs font-bold text-gray-700 uppercase mb-1">{t('sms:providers.turkey')}</span>
              <span className={`text-sm font-medium ${status.regions.tr.available ? 'text-green-600' : 'text-gray-400'}`}>
                {status.regions.tr.available ? t('sms:providers.regionAvailable') : t('sms:providers.regionUnavailable')}
              </span>
            </div>
            <div className="rounded-lg border border-gray-100 px-3 py-2">
              <span className="block text-xs font-bold text-gray-700 uppercase mb-1">{t('sms:providers.europe')}</span>
              <span className={`text-sm font-medium ${status.regions.eu.available ? 'text-green-600' : 'text-gray-400'}`}>
                {status.regions.eu.available ? t('sms:providers.regionAvailable') : t('sms:providers.regionUnavailable')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold">{t('sms:history.title')}</h3>
          <p className="text-sm text-gray-500">{t('sms:history.subtitle')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500">
                <th className="p-3 font-semibold">{t('sms:history.columns.date')}</th>
                <th className="p-3 font-semibold">{t('sms:history.columns.patient')}</th>
                <th className="p-3 font-semibold">{t('sms:history.columns.purpose')}</th>
                <th className="p-3 font-semibold">{t('sms:history.columns.region')}</th>
                <th className="p-3 font-semibold">{t('sms:history.columns.status')}</th>
                <th className="p-3 font-semibold">{t('sms:history.columns.detail')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {history.map(entry => (
                <tr key={entry.id} className="hover:bg-gray-50/50">
                  <td className="p-3 text-sm text-gray-600 whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3 text-sm text-gray-900">
                    {entry.patient ? `${entry.patient.firstName} ${entry.patient.lastName}` : '—'}
                  </td>
                  <td className="p-3 text-sm text-gray-600">
                    {t(`sms:purposes.${entry.purpose}`, { defaultValue: entry.purpose })}
                  </td>
                  <td className="p-3 text-sm text-gray-600 uppercase">{entry.providerRegion ?? '—'}</td>
                  <td className="p-3">
                    <span className={`badge ${STATUS_BADGE[entry.status] ?? 'badge-gray'}`}>
                      {t(`sms:statuses.${entry.status}`, { defaultValue: entry.status })}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-gray-500 max-w-[240px] truncate" title={entry.errorMessage ?? undefined}>
                    {entry.errorMessage ?? '—'}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500 italic">
                    {t('sms:history.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SmsSettingsSection;
