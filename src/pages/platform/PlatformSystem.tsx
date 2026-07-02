import React, { useEffect, useState } from 'react';
import {
  Loader2, AlertCircle, CheckCircle2, XCircle, RefreshCw,
  Database, Server, MessageCircle, ShieldCheck,
  MessageSquare, Star, Plus, Trash2, Zap,
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

      <SmsProvidersSection />

      <MfaSection />
    </div>
  );
};

// ─── Platform SMS provider management ────────────────────────────────────────

interface SmsProviderRow {
  id: string;
  region: 'tr' | 'eu';
  providerCode: string;
  displayName: string;
  isActive: boolean;
  isDefault: boolean;
  senderName: string | null;
  credentialsConfigured: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

type SmsProviderForm = {
  region: 'tr' | 'eu';
  providerCode: string;
  displayName: string;
  senderName: string;
  isActive: boolean;
  isDefault: boolean;
  apiKey: string;
  apiSecret: string;
  username: string;
  password: string;
  apiUrl: string;
};

const emptyProviderForm = (region: 'tr' | 'eu'): SmsProviderForm => ({
  region, providerCode: '', displayName: '', senderName: '',
  isActive: false, isDefault: false,
  apiKey: '', apiSecret: '', username: '', password: '', apiUrl: '',
});

/**
 * Turkey/Europe SMS provider configuration (platform-level, sold behind the
 * clinic SMS add-on). Credentials are write-only: the API never returns
 * stored secrets, only a "configured" flag.
 */
const SmsProvidersSection: React.FC = () => {
  const { t, i18n } = useTranslation(['platform']);
  const api = usePlatformApi();
  const [providers, setProviders] = useState<SmsProviderRow[]>([]);
  const [adapters, setAdapters] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<SmsProviderForm | null>(null);
  const [editingConfigured, setEditingConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const fetchProviders = () => {
    setLoading(true);
    setError('');
    api.get('/platform/sms-providers')
      .then((res) => {
        setProviders(res.data.providers ?? []);
        setAdapters(res.data.adapters ?? {});
      })
      .catch(() => setError(t('platform:system.smsProviders.loadFailed', 'SMS sağlayıcıları yüklenemedi')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProviders(); }, []);

  const openEdit = (p: SmsProviderRow) => {
    setMessage(null);
    setEditingConfigured(p.credentialsConfigured);
    setForm({
      region: p.region, providerCode: p.providerCode, displayName: p.displayName,
      senderName: p.senderName ?? '', isActive: p.isActive, isDefault: p.isDefault,
      apiKey: '', apiSecret: '', username: '', password: '', apiUrl: '',
    });
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setMessage(null);
    // Only non-empty credential fields are sent; an empty set keeps the stored secret.
    const credentialEntries = Object.entries({
      apiKey: form.apiKey, apiSecret: form.apiSecret, username: form.username,
      password: form.password, apiUrl: form.apiUrl,
    }).filter(([, v]) => v.trim() !== '');
    try {
      await api.put('/platform/sms-providers', {
        region: form.region,
        providerCode: form.providerCode.trim(),
        displayName: form.displayName.trim(),
        senderName: form.senderName.trim() || null,
        isActive: form.isActive,
        isDefault: form.isDefault,
        ...(credentialEntries.length > 0 ? { credentials: Object.fromEntries(credentialEntries) } : {}),
      });
      setForm(null);
      fetchProviders();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error ?? t('platform:system.smsProviders.saveFailed', 'Sağlayıcı kaydedilemedi') });
    } finally {
      setSaving(false);
    }
  };

  const testProvider = async (p: SmsProviderRow) => {
    setTestingId(p.id);
    setMessage(null);
    try {
      const { data } = await api.post(`/platform/sms-providers/${p.id}/test`);
      setMessage(data.ok
        ? { type: 'ok', text: t('platform:system.smsProviders.testOkMsg', '{{name}} bağlantı testi başarılı', { name: p.displayName }) }
        : { type: 'error', text: data.error ?? t('platform:system.smsProviders.testFailedMsg', 'Sağlayıcı testi başarısız') });
      fetchProviders();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.response?.data?.error ?? t('platform:system.smsProviders.testFailedMsg', 'Sağlayıcı testi başarısız') });
    } finally {
      setTestingId(null);
    }
  };

  const removeProvider = async (p: SmsProviderRow) => {
    if (!window.confirm(t('platform:system.smsProviders.deleteConfirm', '{{name}} sağlayıcı yapılandırması silinsin mi?', { name: p.displayName }))) return;
    try {
      await api.delete(`/platform/sms-providers/${p.id}`);
      fetchProviders();
    } catch {
      setMessage({ type: 'error', text: t('platform:system.smsProviders.deleteFailed', 'Sağlayıcı silinemedi') });
    }
  };

  const chip = (cls: string, label: React.ReactNode, title?: string) => (
    <span title={title} className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
  );

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const secretPlaceholder = editingConfigured
    ? t('platform:system.smsProviders.configuredPlaceholder', '•••• kayıtlı — değiştirmek için doldurun')
    : '';

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare size={18} className="text-violet-500" />
        <h2 className="font-semibold text-gray-900 dark:text-white">
          {t('platform:system.smsProviders.title', 'SMS Sağlayıcıları')}
        </h2>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {t('platform:system.smsProviders.description', 'Türkiye ve Avrupa SMS sağlayıcıları platform genelinde burada yapılandırılır. Klinikler sağlayıcı kimlik bilgilerini görmez; yalnızca eklenti, kota ve geçmişe erişir.')}
      </p>

      {message && (
        <p className={`text-sm rounded-lg px-3 py-2 mb-3 ${message.type === 'ok' ? 'text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-400' : 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400'}`}>
          {message.text}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={22} className="animate-spin text-blue-500" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {(['tr', 'eu'] as const).map((region) => {
            const regionProviders = providers.filter((p) => p.region === region);
            return (
              <div key={region} className="border border-gray-100 dark:border-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {region === 'tr'
                      ? t('platform:system.smsProviders.regionTr', 'Türkiye')
                      : t('platform:system.smsProviders.regionEu', 'Avrupa')}
                  </h3>
                  <button
                    onClick={() => { setMessage(null); setEditingConfigured(false); setForm(emptyProviderForm(region)); }}
                    className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg px-2 py-1 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                  >
                    <Plus size={12} /> {t('platform:system.smsProviders.addProvider', 'Sağlayıcı Ekle')}
                  </button>
                </div>

                {regionProviders.length === 0 ? (
                  <p className="text-xs text-gray-400 py-3">
                    {t('platform:system.smsProviders.empty', 'Bu bölge için henüz sağlayıcı yapılandırılmadı')}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {regionProviders.map((p) => (
                      <div key={p.id} className="flex flex-wrap items-center gap-2 py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.displayName}</span>
                            {p.isDefault && chip('bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', <><Star size={10} /> {t('platform:system.smsProviders.default', 'Varsayılan')}</>)}
                          </div>
                          <div className="text-xs text-gray-400 font-mono">{p.providerCode}{p.senderName ? ` · ${p.senderName}` : ''}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.credentialsConfigured
                              ? chip('bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', t('platform:system.smsProviders.configured', 'Yapılandırıldı'))
                              : chip('bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', t('platform:system.smsProviders.notConfigured', 'Yapılandırılmadı'))}
                            {p.isActive
                              ? chip('bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', t('platform:system.smsProviders.active', 'Aktif'))
                              : chip('bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', t('platform:system.smsProviders.inactive', 'Pasif'))}
                            {p.lastTestOk === true && chip('bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
                              t('platform:system.smsProviders.testOk', 'Son test başarılı'),
                              p.lastTestedAt ? new Date(p.lastTestedAt).toLocaleString(i18n.language || 'tr') : undefined)}
                            {p.lastTestOk === false && chip('bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                              t('platform:system.smsProviders.testFailed', 'Son test başarısız'),
                              p.lastTestError ?? undefined)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => testProvider(p)}
                            disabled={testingId === p.id}
                            className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60 transition-colors"
                          >
                            {testingId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                            {t('platform:system.smsProviders.test', 'Test Et')}
                          </button>
                          <button
                            onClick={() => openEdit(p)}
                            className="text-xs text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg px-2 py-1 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          >
                            {t('platform:actions.edit', 'Düzenle')}
                          </button>
                          <button
                            onClick={() => removeProvider(p)}
                            className="text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg px-2 py-1 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {form && (
        <div className="mt-4 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3 max-w-2xl">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {(form.region === 'tr'
              ? t('platform:system.smsProviders.regionTr', 'Türkiye')
              : t('platform:system.smsProviders.regionEu', 'Avrupa'))}
            {' — '}
            {form.displayName || t('platform:system.smsProviders.addProvider', 'Sağlayıcı Ekle')}
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('platform:system.smsProviders.providerCode', 'Sağlayıcı kodu')}</label>
              <input list={`sms-adapters-${form.region}`} value={form.providerCode}
                onChange={(e) => setForm({ ...form, providerCode: e.target.value })}
                className={inputCls} placeholder={form.region === 'tr' ? 'netgsm' : 'twilio'} />
              <datalist id={`sms-adapters-${form.region}`}>
                {(adapters[form.region] ?? []).map((a) => <option key={a} value={a} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('platform:system.smsProviders.displayName', 'Görünen ad')}</label>
              <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t('platform:system.smsProviders.senderName', 'Gönderici adı (sender ID)')}</label>
              <input value={form.senderName} maxLength={20} onChange={(e) => setForm({ ...form, senderName: e.target.value })} className={inputCls} placeholder="NORAMEDI" />
            </div>
            <div className="flex items-end gap-4 pb-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="rounded" />
                {t('platform:system.smsProviders.isActive', 'Aktif')}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} className="rounded" />
                {t('platform:system.smsProviders.isDefault', 'Bölge varsayılanı')}
              </label>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('platform:system.smsProviders.credentials', 'API kimlik bilgileri')}
            </p>
            <p className="text-xs text-gray-400 mb-2">
              {t('platform:system.smsProviders.credentialsHint', 'Boş bırakılan alanlar kayıtlı kimlik bilgilerini korur; doldurulan alanlar kayıtlı değeri tamamen değiştirir. Değerler şifrelenerek saklanır ve bir daha görüntülenmez.')}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <input type="password" autoComplete="new-password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className={inputCls} placeholder={secretPlaceholder || 'API key'} aria-label="API key" />
              <input type="password" autoComplete="new-password" value={form.apiSecret} onChange={(e) => setForm({ ...form, apiSecret: e.target.value })} className={inputCls} placeholder={secretPlaceholder || 'API secret'} aria-label="API secret" />
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className={inputCls} placeholder={t('platform:system.smsProviders.username', 'Kullanıcı adı / hesap no')} />
              <input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} placeholder={secretPlaceholder || t('platform:system.smsProviders.password', 'Şifre')} aria-label="Password" />
              <input value={form.apiUrl} onChange={(e) => setForm({ ...form, apiUrl: e.target.value })} className={`${inputCls} sm:col-span-2`} placeholder={t('platform:system.smsProviders.apiUrl', 'API URL (opsiyonel)')} />
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !form.providerCode.trim() || !form.displayName.trim()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t('platform:actions.save', 'Kaydet')}
            </button>
            <button onClick={() => setForm(null)}
              className="text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2">
              {t('platform:actions.cancel', 'Vazgeç')}
            </button>
          </div>
        </div>
      )}
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
