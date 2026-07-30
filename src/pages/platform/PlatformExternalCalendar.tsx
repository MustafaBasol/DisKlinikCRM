import React, { useCallback, useEffect, useState } from 'react';
import {
  Search, Loader2, AlertCircle, CheckCircle2, XCircle, Plug, Copy, Check, RefreshCw, Trash2, Plus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';

interface ClinicOption {
  id: string;
  name: string;
  slug: string;
  organization?: { name: string } | null;
}

interface IntegrationSummary {
  id: string;
  clinicId: string;
  provider: string;
  enabled: boolean;
  status: string;
  clientIdConfigured: boolean;
  clientIdHint: string | null;
  clientSecretConfigured: boolean;
  webhookSecretConfigured: boolean;
  externalCompanyId: string | null;
  externalClinicId: string | null;
  apiBaseUrl: string | null;
  lastSuccessfulCheckAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

interface MappingRow {
  id: string;
  mappingType: 'practitioner' | 'service';
  localId: string;
  localLabel: string | null;
  externalId: string;
  externalLabel: string | null;
  isActive: boolean;
}

interface LocalOption { id: string; label: string }
interface RemoteOption { id: string; name: string }

const STATUS_BADGE: Record<string, string> = {
  not_configured: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  configured: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  connected: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const PlatformExternalCalendar: React.FC = () => {
  const { t } = useTranslation(['platform']);
  const api = usePlatformApi();

  const [search, setSearch] = useState('');
  const [clinics, setClinics] = useState<ClinicOption[]>([]);
  const [clinicsLoading, setClinicsLoading] = useState(true);
  const [selected, setSelected] = useState<ClinicOption | null>(null);

  const [integration, setIntegration] = useState<IntegrationSummary | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    clientId: '', clientSecret: '', webhookSecret: '', externalCompanyId: '', externalClinicId: '', apiBaseUrl: '',
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [localOptions, setLocalOptions] = useState<{ practitioners: LocalOption[]; services: LocalOption[] }>({ practitioners: [], services: [] });
  const [remoteOptions, setRemoteOptions] = useState<{ doctors: RemoteOption[]; treatmentTypes: RemoteOption[] } | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const [newMapping, setNewMapping] = useState({ mappingType: 'practitioner' as 'practitioner' | 'service', localId: '', externalId: '' });
  const [mappingSaving, setMappingSaving] = useState(false);

  const fetchClinics = useCallback(() => {
    setClinicsLoading(true);
    api.get('/platform/clinics', { params: { page: 1, limit: 50, search: search || undefined } })
      .then((res) => setClinics(res.data?.data ?? []))
      .catch(() => setClinics([]))
      .finally(() => setClinicsLoading(false));
  }, [api, search]);

  useEffect(() => { fetchClinics(); }, [fetchClinics]);

  const loadDetail = useCallback((clinic: ClinicOption) => {
    setSelected(clinic);
    setDetailLoading(true);
    setDetailError('');
    setTestResult(null);
    setRemoteOptions(null);
    setRemoteError('');
    api.get(`/platform/clinics/${clinic.id}/external-calendar`)
      .then((res) => {
        setIntegration(res.data.integration);
        setWebhookUrl(res.data.webhookUrl);
        setForm({
          clientId: '', clientSecret: '', webhookSecret: '',
          externalCompanyId: res.data.integration?.externalCompanyId ?? '',
          externalClinicId: res.data.integration?.externalClinicId ?? '',
          apiBaseUrl: res.data.integration?.apiBaseUrl ?? '',
        });
        return res.data.integration
          ? api.get(`/platform/clinics/${clinic.id}/external-calendar/mappings`).then((r) => setMappings(r.data.mappings ?? []))
          : setMappings([]);
      })
      .catch(() => setDetailError(t('platform:externalCalendar.errors.loadFailed')))
      .finally(() => setDetailLoading(false));

    api.get(`/platform/clinics/${clinic.id}/external-calendar/local-options`)
      .then((res) => setLocalOptions(res.data))
      .catch(() => setLocalOptions({ practitioners: [], services: [] }));
  }, [api, t]);

  const saveConfig = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        externalCompanyId: form.externalCompanyId, externalClinicId: form.externalClinicId, apiBaseUrl: form.apiBaseUrl,
      };
      if (form.clientId.trim()) payload.clientId = form.clientId.trim();
      if (form.clientSecret.trim()) payload.clientSecret = form.clientSecret.trim();
      if (form.webhookSecret.trim()) payload.webhookSecret = form.webhookSecret.trim();
      const res = await api.put(`/platform/clinics/${selected.id}/external-calendar`, payload);
      setIntegration(res.data.integration);
      setWebhookUrl(res.data.webhookUrl);
      setForm((f) => ({ ...f, clientId: '', clientSecret: '', webhookSecret: '' }));
    } catch (err: any) {
      setDetailError(err.response?.data?.error ?? t('platform:externalCalendar.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async () => {
    if (!selected || !integration) return;
    try {
      const res = await api.patch(`/platform/clinics/${selected.id}/external-calendar/enabled`, { enabled: !integration.enabled });
      setIntegration(res.data.integration);
    } catch (err: any) {
      setDetailError(err.response?.data?.error ?? t('platform:externalCalendar.errors.toggleFailed'));
    }
  };

  const testConnection = async () => {
    if (!selected) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post(`/platform/clinics/${selected.id}/external-calendar/test-connection`);
      setTestResult(res.data.result);
      setIntegration(res.data.integration);
    } catch (err: any) {
      setTestResult({ success: false, message: err.response?.data?.error ?? t('platform:externalCalendar.errors.testFailed') });
    } finally {
      setTesting(false);
    }
  };

  const loadRemoteOptions = async () => {
    if (!selected) return;
    setRemoteLoading(true);
    setRemoteError('');
    try {
      const res = await api.get(`/platform/clinics/${selected.id}/external-calendar/remote-options`);
      setRemoteOptions(res.data);
    } catch (err: any) {
      setRemoteError(err.response?.data?.error ?? t('platform:externalCalendar.errors.remoteOptionsFailed'));
    } finally {
      setRemoteLoading(false);
    }
  };

  const addMapping = async () => {
    if (!selected || !newMapping.localId || !newMapping.externalId) return;
    setMappingSaving(true);
    try {
      const res = await api.put(`/platform/clinics/${selected.id}/external-calendar/mappings`, newMapping);
      setMappings((prev) => {
        const idx = prev.findIndex((m) => m.id === res.data.mapping.id);
        if (idx >= 0) { const next = [...prev]; next[idx] = res.data.mapping; return next; }
        return [...prev, res.data.mapping];
      });
      setNewMapping({ mappingType: 'practitioner', localId: '', externalId: '' });
    } catch (err: any) {
      setDetailError(err.response?.data?.error ?? t('platform:externalCalendar.errors.mappingSaveFailed'));
    } finally {
      setMappingSaving(false);
    }
  };

  const removeMapping = async (mappingId: string) => {
    if (!selected) return;
    await api.delete(`/platform/clinics/${selected.id}/external-calendar/mappings/${mappingId}`).catch(() => {});
    setMappings((prev) => prev.filter((m) => m.id !== mappingId));
  };

  const copyWebhookUrl = () => {
    if (!webhookUrl) return;
    navigator.clipboard?.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const canEnable = Boolean(
    integration && (integration.clientIdConfigured || form.clientId) && (integration.clientSecretConfigured || form.clientSecret) &&
    (integration.externalClinicId || form.externalClinicId),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('platform:externalCalendar.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('platform:externalCalendar.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Clinic selector */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden lg:col-span-1">
          <div className="p-3 border-b border-gray-100 dark:border-gray-800">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={t('platform:externalCalendar.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="max-h-[32rem] overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
            {clinicsLoading ? (
              <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-blue-500" /></div>
            ) : clinics.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">{t('platform:externalCalendar.noClinics')}</p>
            ) : (
              clinics.map((clinic) => (
                <button
                  key={clinic.id}
                  onClick={() => loadDetail(clinic)}
                  className={`w-full text-left px-4 py-3 text-sm transition-colors ${selected?.id === clinic.id ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
                >
                  <p className="font-medium text-gray-900 dark:text-white">{clinic.name}</p>
                  <p className="text-xs text-gray-400">{clinic.organization?.name ?? clinic.slug}</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Configuration panel */}
        <div className="lg:col-span-2 space-y-5">
          {!selected ? (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-12 text-center text-gray-400">
              <Plug size={32} className="mx-auto mb-3 opacity-50" />
              {t('platform:externalCalendar.selectClinicPrompt')}
            </div>
          ) : detailLoading ? (
            <div className="flex items-center justify-center h-48"><Loader2 size={28} className="animate-spin text-blue-500" /></div>
          ) : (
            <>
              {detailError && (
                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                  <AlertCircle size={16} />{detailError}
                </div>
              )}

              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-900 dark:text-white">{selected.name}</h2>
                    <p className="text-xs text-gray-400">{t('platform:externalCalendar.provider.digidentis')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {integration && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[integration.status] ?? STATUS_BADGE.not_configured}`}>
                        {t(`platform:externalCalendar.status.${integration.status}`, { defaultValue: integration.status })}
                      </span>
                    )}
                    {integration && (
                      <label className="flex items-center gap-2 text-sm cursor-pointer text-gray-700 dark:text-gray-300">
                        <input type="checkbox" checked={integration.enabled} disabled={!canEnable && !integration.enabled} onChange={toggleEnabled} className="rounded text-blue-600" />
                        {t('platform:externalCalendar.enabled')}
                      </label>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:externalCalendar.fields.clientId')}</label>
                    <input
                      type="text"
                      placeholder={integration?.clientIdConfigured ? `•••• ${integration.clientIdHint}` : t('platform:externalCalendar.notConfigured')}
                      value={form.clientId}
                      onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:externalCalendar.fields.clientSecret')}</label>
                    <input
                      type="password"
                      placeholder={integration?.clientSecretConfigured ? t('platform:externalCalendar.configured') : t('platform:externalCalendar.notConfigured')}
                      value={form.clientSecret}
                      onChange={(e) => setForm((f) => ({ ...f, clientSecret: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:externalCalendar.fields.webhookSecret')}</label>
                    <input
                      type="password"
                      placeholder={integration?.webhookSecretConfigured ? t('platform:externalCalendar.configured') : t('platform:externalCalendar.notConfigured')}
                      value={form.webhookSecret}
                      onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:externalCalendar.fields.apiBaseUrl')}</label>
                    <input
                      type="text"
                      placeholder="https://..."
                      value={form.apiBaseUrl}
                      onChange={(e) => setForm((f) => ({ ...f, apiBaseUrl: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:externalCalendar.fields.externalCompanyId')}</label>
                    <input
                      type="text"
                      value={form.externalCompanyId}
                      onChange={(e) => setForm((f) => ({ ...f, externalCompanyId: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:externalCalendar.fields.externalClinicId')}</label>
                    <input
                      type="text"
                      value={form.externalClinicId}
                      onChange={(e) => setForm((f) => ({ ...f, externalClinicId: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={saveConfig}
                    disabled={saving}
                    className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    {t('platform:actions.save')}
                  </button>
                  {integration && (
                    <button
                      onClick={testConnection}
                      disabled={testing}
                      className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      {testing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      {t('platform:externalCalendar.testConnection')}
                    </button>
                  )}
                </div>

                {testResult && (
                  <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${testResult.success ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                    {testResult.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                    {testResult.message}
                  </div>
                )}

                {integration && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 border-t border-gray-100 dark:border-gray-800 pt-3">
                    <p>{t('platform:externalCalendar.lastSuccessfulCheck')}: {integration.lastSuccessfulCheckAt ? new Date(integration.lastSuccessfulCheckAt).toLocaleString() : '—'}</p>
                    <p>{t('platform:externalCalendar.lastCheckedAt')}: {integration.lastCheckedAt ? new Date(integration.lastCheckedAt).toLocaleString() : '—'}</p>
                    {integration.lastError && <p className="text-red-500">{t('platform:externalCalendar.lastError')}: {integration.lastError}</p>}
                  </div>
                )}

                {webhookUrl && (
                  <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('platform:externalCalendar.webhookUrl')}</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 overflow-x-auto whitespace-nowrap text-gray-700 dark:text-gray-300">{webhookUrl}</code>
                      <button onClick={copyWebhookUrl} className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">{t('platform:externalCalendar.webhookUrlHint')}</p>
                  </div>
                )}
              </div>

              {/* Mappings */}
              {integration && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{t('platform:externalCalendar.mappings.title')}</h3>
                    <button onClick={loadRemoteOptions} disabled={remoteLoading} className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
                      {remoteLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      {t('platform:externalCalendar.mappings.loadRemote')}
                    </button>
                  </div>
                  {remoteError && <p className="text-xs text-red-500">{remoteError}</p>}

                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-gray-400">
                      <tr>
                        <th className="text-left py-1">{t('platform:externalCalendar.mappings.type')}</th>
                        <th className="text-left py-1">{t('platform:externalCalendar.mappings.local')}</th>
                        <th className="text-left py-1">{t('platform:externalCalendar.mappings.external')}</th>
                        <th className="text-right py-1">{t('platform:actions.actions', { defaultValue: '' })}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                      {mappings.map((m) => (
                        <tr key={m.id}>
                          <td className="py-2 text-gray-500">{t(`platform:externalCalendar.mappings.${m.mappingType}`)}</td>
                          <td className="py-2 text-gray-900 dark:text-white">{m.localLabel ?? m.localId}</td>
                          <td className="py-2 text-gray-900 dark:text-white">{m.externalLabel ?? m.externalId}</td>
                          <td className="py-2 text-right">
                            <button onClick={() => removeMapping(m.id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {mappings.length === 0 && (
                        <tr><td colSpan={4} className="text-center text-gray-400 py-6">{t('platform:externalCalendar.mappings.empty')}</td></tr>
                      )}
                    </tbody>
                  </table>

                  <div className="border-t border-gray-100 dark:border-gray-800 pt-3 grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                    <div>
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:externalCalendar.mappings.type')}</label>
                      <select
                        value={newMapping.mappingType}
                        onChange={(e) => setNewMapping((m) => ({ ...m, mappingType: e.target.value as 'practitioner' | 'service', localId: '', externalId: '' }))}
                        className="mt-1 w-full px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      >
                        <option value="practitioner">{t('platform:externalCalendar.mappings.practitioner')}</option>
                        <option value="service">{t('platform:externalCalendar.mappings.service')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:externalCalendar.mappings.local')}</label>
                      <select
                        value={newMapping.localId}
                        onChange={(e) => setNewMapping((m) => ({ ...m, localId: e.target.value }))}
                        className="mt-1 w-full px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      >
                        <option value="">—</option>
                        {(newMapping.mappingType === 'practitioner' ? localOptions.practitioners : localOptions.services).map((o) => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:externalCalendar.mappings.external')}</label>
                      {remoteOptions ? (
                        <select
                          value={newMapping.externalId}
                          onChange={(e) => setNewMapping((m) => ({ ...m, externalId: e.target.value }))}
                          className="mt-1 w-full px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        >
                          <option value="">—</option>
                          {(newMapping.mappingType === 'practitioner' ? remoteOptions.doctors : remoteOptions.treatmentTypes).map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder={t('platform:externalCalendar.mappings.externalIdPlaceholder')}
                          value={newMapping.externalId}
                          onChange={(e) => setNewMapping((m) => ({ ...m, externalId: e.target.value }))}
                          className="mt-1 w-full px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        />
                      )}
                    </div>
                    <button
                      onClick={addMapping}
                      disabled={mappingSaving || !newMapping.localId || !newMapping.externalId}
                      className="flex items-center justify-center gap-1 px-3 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                    >
                      {mappingSaving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                      {t('platform:actions.save')}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">{t('platform:externalCalendar.mappings.blockingHint')}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlatformExternalCalendar;
