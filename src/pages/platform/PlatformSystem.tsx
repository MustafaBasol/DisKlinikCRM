import React, { useEffect, useState } from 'react';
import {
  Loader2, AlertCircle, CheckCircle2, XCircle, RefreshCw,
  Database, Server, MessageCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';

interface SystemStatus {
  status: 'healthy' | 'degraded';
  database: { status: 'ok' | 'error'; error?: string };
  api: { status: string };
  whatsapp: { evolution: number; meta: number; connected: number };
  recentFailedMessages: number;
  timestamp: string;
}

const StatusDot: React.FC<{ ok: boolean }> = ({ ok }) =>
  ok ? (
    <CheckCircle2 size={18} className="text-green-500" />
  ) : (
    <XCircle size={18} className="text-red-500" />
  );

const InfoRow: React.FC<{ label: string; value: React.ReactNode; sub?: string }> = ({
  label,
  value,
  sub,
}) => (
  <div className="flex items-center justify-between py-3 border-b border-gray-50 dark:border-gray-800 last:border-0">
    <div>
      <p className="text-sm text-gray-700 dark:text-gray-300">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
    <div className="text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
  </div>
);

const PlatformSystem: React.FC = () => {
  const { t, i18n } = useTranslation(['platform']);
  const api = usePlatformApi();
  const [data, setData] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = () => {
    setLoading(true);
    setError('');
    api
      .get('/platform/system')
      .then((res) => setData(res.data))
      .catch(() => setError(t('platform:errors.systemLoadFailed')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('platform:system.title')}</h1>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
        >
          <RefreshCw size={14} />
          {t('platform:actions.refresh')}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={28} className="animate-spin text-blue-500" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* Overall badge */}
          <div
            className={`flex items-center gap-3 px-5 py-4 rounded-xl border ${
              data.status === 'healthy'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
            }`}
          >
            <StatusDot ok={data.status === 'healthy'} />
            <span className="font-semibold">
              {data.status === 'healthy' ? t('platform:statuses.healthy') : t('platform:statuses.degraded')}
            </span>
            <span className="ml-auto text-xs opacity-70">
              {new Date(data.timestamp).toLocaleString(i18n.language || 'tr')}
            </span>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {/* Database */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Database size={18} className="text-blue-500" />
                <h2 className="font-semibold text-gray-900 dark:text-white">{t('platform:system.database')}</h2>
                <StatusDot ok={data.database.status === 'ok'} />
              </div>
              <InfoRow label={t('platform:system.status')} value={data.database.status === 'ok' ? t('platform:statuses.ok') : t('platform:statuses.error')} />
              {data.database.error && (
                <p className="text-xs text-red-500 mt-2 bg-red-50 dark:bg-red-900/20 rounded p-2">
                  {data.database.error}
                </p>
              )}
            </div>

            {/* API */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Server size={18} className="text-purple-500" />
                <h2 className="font-semibold text-gray-900 dark:text-white">API</h2>
                <StatusDot ok={data.api.status === 'ok'} />
              </div>
              <InfoRow label={t('platform:system.status')} value={data.api.status.toUpperCase()} />
              <InfoRow label={t('platform:system.failedMessages')} value={data.recentFailedMessages} sub={t('platform:system.failedMessagesSub')} />
            </div>

            {/* WhatsApp */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
              <div className="flex items-center gap-2 mb-4">
                <MessageCircle size={18} className="text-green-500" />
                <h2 className="font-semibold text-gray-900 dark:text-white">WhatsApp</h2>
              </div>
              <InfoRow label="Evolution API" value={data.whatsapp.evolution} />
              <InfoRow label="Meta Cloud API" value={data.whatsapp.meta} />
              <InfoRow label={t('platform:system.connected')} value={data.whatsapp.connected} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PlatformSystem;
