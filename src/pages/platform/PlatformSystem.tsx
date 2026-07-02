import React, { useEffect, useState } from 'react';
import {
  Loader2, AlertCircle, CheckCircle2, XCircle, RefreshCw,
  Database, Server, MessageCircle, ShieldCheck,
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

      <MfaSection />
    </div>
  );
};

/**
 * Platform admin hesabı için TOTP (MFA) kaydı/yönetimi.
 * Akış: setup → authenticator'a secret girilir → kodla verify → etkin.
 */
const MfaSection: React.FC = () => {
  const { t } = useTranslation(['platform']);
  const api = usePlatformApi();
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api.get('/platform/me')
      .then((res) => setMfaEnabled(!!res.data.mfaEnabled))
      .catch(() => setMfaEnabled(null));
  }, [api]);

  const startSetup = async () => {
    setBusy(true); setMessage(null);
    try {
      const { data } = await api.post('/platform/auth/mfa/setup');
      setSetup(data);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error ?? t('platform:mfa.setupFailed', 'MFA kurulumu başlatılamadı') });
    } finally {
      setBusy(false);
    }
  };

  const verifySetup = async () => {
    setBusy(true); setMessage(null);
    try {
      await api.post('/platform/auth/mfa/verify', { code });
      setMfaEnabled(true);
      setSetup(null);
      setCode('');
      setMessage({ type: 'ok', text: t('platform:mfa.enabled', 'MFA etkinleştirildi. Bir sonraki girişte kod istenecek.') });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error ?? t('platform:mfa.invalidCode', 'Kod doğrulanamadı') });
    } finally {
      setBusy(false);
    }
  };

  const disableMfa = async () => {
    setBusy(true); setMessage(null);
    try {
      await api.post('/platform/auth/mfa/disable', { code, password: disablePassword });
      setMfaEnabled(false);
      setDisabling(false);
      setCode('');
      setDisablePassword('');
      setMessage({ type: 'ok', text: t('platform:mfa.disabled', 'MFA devre dışı bırakıldı.') });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error ?? t('platform:mfa.disableFailed', 'MFA devre dışı bırakılamadı') });
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={18} className={mfaEnabled ? 'text-green-500' : 'text-gray-400'} />
        <h2 className="font-semibold text-gray-900 dark:text-white">
          {t('platform:mfa.title', 'İki Adımlı Doğrulama (MFA)')}
        </h2>
        {mfaEnabled != null && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${mfaEnabled ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
            {mfaEnabled ? t('platform:mfa.statusOn', 'Etkin') : t('platform:mfa.statusOff', 'Kapalı')}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {t('platform:mfa.description', 'Bu hesap tüm kiracılara erişebilir; TOTP tabanlı ikinci faktör şiddetle önerilir.')}
      </p>

      {message && (
        <p className={`text-sm rounded-lg px-3 py-2 mb-3 ${message.type === 'ok' ? 'text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-400' : 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400'}`}>
          {message.text}
        </p>
      )}

      {mfaEnabled === false && !setup && (
        <button onClick={startSetup} disabled={busy}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          {busy && <Loader2 size={14} className="animate-spin" />}
          {t('platform:mfa.enable', 'MFA Kurulumunu Başlat')}
        </button>
      )}

      {setup && (
        <div className="space-y-3 max-w-lg">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {t('platform:mfa.setupInstructions', 'Aşağıdaki secret\'ı authenticator uygulamanıza (Google Authenticator, 1Password vb.) manuel olarak ekleyin, ardından üretilen 6 haneli kodu girin.')}
          </p>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-1">
            <p className="text-xs text-gray-500">{t('platform:mfa.secret', 'Secret (manuel giriş)')}</p>
            <code className="text-sm font-mono break-all text-gray-900 dark:text-white select-all">{setup.secret}</code>
            <p className="text-xs text-gray-500 pt-2">otpauth URI</p>
            <code className="text-xs font-mono break-all text-gray-500 select-all">{setup.otpauthUri}</code>
          </div>
          <input type="text" inputMode="numeric" maxLength={6} value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className={inputCls} placeholder="000000" />
          <div className="flex gap-2">
            <button onClick={verifySetup} disabled={busy || code.length !== 6}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t('platform:mfa.verify', 'Doğrula ve Etkinleştir')}
            </button>
            <button onClick={() => { setSetup(null); setCode(''); }}
              className="text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2">
              {t('platform:actions.cancel', 'Vazgeç')}
            </button>
          </div>
        </div>
      )}

      {mfaEnabled && !disabling && (
        <button onClick={() => { setDisabling(true); setMessage(null); }}
          className="text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
          {t('platform:mfa.disable', 'MFA\'yı Devre Dışı Bırak')}
        </button>
      )}

      {mfaEnabled && disabling && (
        <div className="space-y-3 max-w-sm">
          <input type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)}
            className={inputCls} placeholder={t('platform:mfa.password', 'Hesap şifresi')} />
          <input type="text" inputMode="numeric" maxLength={6} value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className={inputCls} placeholder="000000" />
          <div className="flex gap-2">
            <button onClick={disableMfa} disabled={busy || code.length !== 6 || !disablePassword}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t('platform:mfa.confirmDisable', 'Devre Dışı Bırak')}
            </button>
            <button onClick={() => { setDisabling(false); setCode(''); setDisablePassword(''); }}
              className="text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2">
              {t('platform:actions.cancel', 'Vazgeç')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlatformSystem;
