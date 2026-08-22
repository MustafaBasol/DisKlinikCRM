import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, XCircle, MessageCircle, RefreshCw, Trash2, Plug2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';

interface PlatformWhatsAppConnection {
  id: string;
  name: string;
  provider: string;
  status: string;
  phoneNumber: string | null;
  displayName: string | null;
  metaBusinessId: string | null;
  metaWabaId: string | null;
  metaPhoneNumberId: string | null;
  metaAppId: string | null;
  isActive: boolean;
  lastConnectedAt: string | null;
  lastError: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  disconnected: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  connecting: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  connected: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const emptyForm = {
  name: '',
  phoneNumber: '',
  displayName: '',
  metaBusinessId: '',
  metaWabaId: '',
  metaPhoneNumberId: '',
  metaAppId: '',
  metaAccessTokenEncrypted: '',
  metaWebhookVerifyToken: '',
  metaWebhookSecret: '',
  webhookSecret: '',
};

const PlatformWhatsApp: React.FC = () => {
  const { t } = useTranslation(['platform']);
  const api = usePlatformApi();

  const [connection, setConnection] = useState<PlatformWhatsAppConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get('/platform/whatsapp/meta-connection')
      .then((res) => {
        const conn = res.data?.connection ?? null;
        setConnection(conn);
        setForm({
          name: conn?.name ?? '',
          phoneNumber: conn?.phoneNumber ?? '',
          displayName: conn?.displayName ?? '',
          metaBusinessId: conn?.metaBusinessId ?? '',
          metaWabaId: conn?.metaWabaId ?? '',
          metaPhoneNumberId: conn?.metaPhoneNumberId ?? '',
          metaAppId: conn?.metaAppId ?? '',
          metaAccessTokenEncrypted: '',
          metaWebhookVerifyToken: '',
          metaWebhookSecret: '',
          webhookSecret: '',
        });
      })
      .catch(() => setError(t('platform:whatsapp.errors.loadFailed')))
      .finally(() => setLoading(false));
  }, [api, t]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, string> = {
        name: form.name,
        phoneNumber: form.phoneNumber,
        displayName: form.displayName,
        metaBusinessId: form.metaBusinessId,
        metaWabaId: form.metaWabaId,
        metaPhoneNumberId: form.metaPhoneNumberId,
        metaAppId: form.metaAppId,
      };
      // Leave-unchanged convention (mirrors the tenant WhatsApp screen's
      // handleSave): GET never returns these values back (they're stripped
      // from every response), so the field always redisplays blank — only
      // send one when the operator actually typed a new value, or an update
      // would silently blank out the stored value.
      if (form.metaWebhookVerifyToken.trim()) payload.metaWebhookVerifyToken = form.metaWebhookVerifyToken.trim();
      if (form.metaAccessTokenEncrypted.trim()) payload.metaAccessTokenEncrypted = form.metaAccessTokenEncrypted.trim();
      if (form.metaWebhookSecret.trim()) payload.metaWebhookSecret = form.metaWebhookSecret.trim();
      if (form.webhookSecret.trim()) payload.webhookSecret = form.webhookSecret.trim();

      const res = connection
        ? await api.put('/platform/whatsapp/meta-connection', payload)
        : await api.post('/platform/whatsapp/meta-connection', payload);
      setConnection(res.data.connection);
      setForm((f) => ({ ...f, metaAccessTokenEncrypted: '', metaWebhookSecret: '', webhookSecret: '' }));
    } catch (err: any) {
      setError(err.response?.data?.error ?? t('platform:whatsapp.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('/platform/whatsapp/meta-connection/test');
      setTestResult(res.data.result);
    } catch (err: any) {
      setTestResult({ success: false, message: err.response?.data?.error ?? t('platform:whatsapp.errors.testFailed') });
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(t('platform:whatsapp.disconnectConfirm'))) return;
    setDisconnecting(true);
    try {
      await api.post('/platform/whatsapp/meta-connection/disconnect');
      load();
    } catch (err: any) {
      setError(err.response?.data?.error ?? t('platform:whatsapp.errors.disconnectFailed'));
    } finally {
      setDisconnecting(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t('platform:whatsapp.deleteConfirm'))) return;
    setDeleting(true);
    try {
      await api.delete('/platform/whatsapp/meta-connection');
      setConnection(null);
      setForm(emptyForm);
      setTestResult(null);
    } catch (err: any) {
      setError(err.response?.data?.error ?? t('platform:whatsapp.errors.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('platform:whatsapp.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('platform:whatsapp.subtitle')}</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 size={28} className="animate-spin text-blue-500" /></div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle size={18} className="text-green-600" />
              <h2 className="font-semibold text-gray-900 dark:text-white">{t('platform:whatsapp.metaConnection')}</h2>
            </div>
            {connection && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[connection.status] ?? STATUS_BADGE.disconnected}`}>
                {t(`platform:whatsapp.status.${connection.status}`, { defaultValue: connection.status })}
              </span>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:whatsapp.fields.name')}</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:whatsapp.fields.phoneNumber')}</label>
              <input type="text" value={form.phoneNumber} onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:whatsapp.fields.displayName')}</label>
              <input type="text" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:whatsapp.fields.metaBusinessId')}</label>
              <input type="text" value={form.metaBusinessId} onChange={(e) => setForm((f) => ({ ...f, metaBusinessId: e.target.value }))}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:whatsapp.fields.metaWabaId')}</label>
              <input type="text" value={form.metaWabaId} onChange={(e) => setForm((f) => ({ ...f, metaWabaId: e.target.value }))}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:whatsapp.fields.metaPhoneNumberId')}</label>
              <input type="text" value={form.metaPhoneNumberId} onChange={(e) => setForm((f) => ({ ...f, metaPhoneNumberId: e.target.value }))}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:whatsapp.fields.metaAppId')}</label>
              <input type="text" value={form.metaAppId} onChange={(e) => setForm((f) => ({ ...f, metaAppId: e.target.value }))}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:whatsapp.fields.metaWebhookVerifyToken')}</label>
              <input type="text" value={form.metaWebhookVerifyToken} onChange={(e) => setForm((f) => ({ ...f, metaWebhookVerifyToken: e.target.value }))}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:whatsapp.fields.metaAccessToken')} {connection && <span className="text-gray-400">({t('platform:whatsapp.leaveBlankUnchanged')})</span>}</label>
              <input type="password" value={form.metaAccessTokenEncrypted} onChange={(e) => setForm((f) => ({ ...f, metaAccessTokenEncrypted: e.target.value }))}
                placeholder={connection ? t('platform:whatsapp.configuredPlaceholder') : ''}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:whatsapp.fields.metaWebhookSecret')} {connection && <span className="text-gray-400">({t('platform:whatsapp.leaveBlankUnchanged')})</span>}</label>
              <input type="password" value={form.metaWebhookSecret} onChange={(e) => setForm((f) => ({ ...f, metaWebhookSecret: e.target.value }))}
                placeholder={connection ? t('platform:whatsapp.configuredPlaceholder') : ''}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:whatsapp.fields.webhookSecret')} {connection && <span className="text-gray-400">({t('platform:whatsapp.leaveBlankUnchanged')})</span>}</label>
              <input type="password" value={form.webhookSecret} onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
                placeholder={connection ? t('platform:whatsapp.configuredPlaceholder') : ''}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={save} disabled={saving || !form.name.trim()}
              className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plug2 size={13} />}
              {t('platform:actions.save')}
            </button>
            {connection && (
              <>
                <button onClick={testConnection} disabled={testing}
                  className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50">
                  {testing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  {t('platform:whatsapp.testConnection')}
                </button>
                <button onClick={disconnect} disabled={disconnecting}
                  className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50">
                  {t('platform:whatsapp.disconnect')}
                </button>
                <button onClick={remove} disabled={deleting}
                  className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50">
                  <Trash2 size={13} />
                  {t('platform:actions.delete', { defaultValue: 'Delete' })}
                </button>
              </>
            )}
          </div>

          {testResult && (
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${testResult.success ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
              {testResult.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {testResult.message}
            </div>
          )}

          {connection && (
            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 border-t border-gray-100 dark:border-gray-800 pt-3">
              <p>{t('platform:whatsapp.lastConnectedAt')}: {connection.lastConnectedAt ? new Date(connection.lastConnectedAt).toLocaleString() : '—'}</p>
              {connection.lastError && <p className="text-red-500">{t('platform:whatsapp.lastError')}: {connection.lastError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PlatformWhatsApp;
