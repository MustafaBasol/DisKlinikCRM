import React, { useEffect, useState, useCallback } from 'react';
import {
  Search, Loader2, AlertCircle, ChevronLeft, ChevronRight,
  CheckCircle2, Clock, Ban, RefreshCw, MessageSquare, X, Check,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';

interface Clinic {
  id: string;
  name: string;
  slug: string;
  status: string;
  email?: string;
  address?: string;
  createdAt: string;
  organization?: { id: string; name: string; slug: string };
  plan?: { displayName: string; features?: Record<string, boolean> | null };
  smsSettings?: {
    addonEnabled: boolean;
    monthlyQuota: number;
    turkeyAllowed: boolean;
    europeAllowed: boolean;
    routingPolicy: string;
  } | null;
  _count: { users: number; patients: number; appointments: number };
}

interface PagedResponse {
  data: Clinic[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

type RoutingPolicy = 'automatic_by_recipient_phone_region' | 'force_turkey_provider' | 'force_europe_provider';

interface PlatformSmsProviderRow {
  region: 'tr' | 'eu';
  displayName: string;
  isActive: boolean;
  isDefault: boolean;
}

interface RoutingPreviewResult {
  normalizedPhone: string | null;
  detectedRegion: string | null;
  targetRegion: string | null;
  blocked: boolean;
  blockedReason: string | null;
  blockedMessage: string | null;
  provider: { key: string; displayName: string; source: string } | null;
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  trial: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const PlatformClinics: React.FC = () => {
  const { t, i18n } = useTranslation(['platform']);
  const api = usePlatformApi();
  const [data, setData] = useState<PagedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [actionId, setActionId] = useState<string | null>(null);
  const [smsClinic, setSmsClinic] = useState<Clinic | null>(null);
  const [smsForm, setSmsForm] = useState({
    addonEnabled: false,
    monthlyQuota: 0,
    turkeyAllowed: false,
    europeAllowed: false,
    routingPolicy: 'automatic_by_recipient_phone_region' as RoutingPolicy,
  });
  const [smsSaving, setSmsSaving] = useState(false);
  const [smsProviders, setSmsProviders] = useState<PlatformSmsProviderRow[]>([]);
  const [previewPhone, setPreviewPhone] = useState('');
  const [previewResult, setPreviewResult] = useState<RoutingPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const fetchData = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .get('/platform/clinics', {
        params: { page, limit: 25, search: search || undefined, status: statusFilter || undefined },
      })
      .then((res) => setData(res.data))
      .catch(() => setError(t('platform:errors.clinicsLoadFailed')))
      .finally(() => setLoading(false));
  }, [api, page, search, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateStatus = async (id: string, status: string) => {
    setActionId(id);
    try {
      await api.patch(`/platform/clinics/${id}/status`, { status });
      fetchData();
    } catch {
      alert(t('platform:errors.statusUpdateFailed'));
    } finally {
      setActionId(null);
    }
  };

  const openSmsModal = (clinic: Clinic) => {
    setSmsClinic(clinic);
    setSmsForm({
      addonEnabled: clinic.smsSettings?.addonEnabled ?? false,
      monthlyQuota: clinic.smsSettings?.monthlyQuota ?? 0,
      turkeyAllowed: clinic.smsSettings?.turkeyAllowed ?? false,
      europeAllowed: clinic.smsSettings?.europeAllowed ?? false,
      routingPolicy: (clinic.smsSettings?.routingPolicy as RoutingPolicy) ?? 'automatic_by_recipient_phone_region',
    });
    setPreviewPhone('');
    setPreviewResult(null);
    setPreviewError('');
    api.get('/platform/sms-providers')
      .then((res) => setSmsProviders(res.data?.providers ?? []))
      .catch(() => setSmsProviders([]));
  };

  const saveSmsAddon = async () => {
    if (!smsClinic) return;
    setSmsSaving(true);
    try {
      await api.patch(`/platform/clinics/${smsClinic.id}/sms-addon`, {
        addonEnabled: smsForm.addonEnabled,
        monthlyQuota: smsForm.monthlyQuota,
        turkeyAllowed: smsForm.turkeyAllowed,
        europeAllowed: smsForm.europeAllowed,
        routingPolicy: smsForm.routingPolicy,
      });
      setSmsClinic(null);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error ?? t('platform:clinics.sms.saveFailed'));
    } finally {
      setSmsSaving(false);
    }
  };

  const runRoutingPreview = async () => {
    if (!smsClinic || !previewPhone.trim()) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewResult(null);
    try {
      const res = await api.post(`/platform/clinics/${smsClinic.id}/sms-addon/preview-routing`, {
        phone: previewPhone.trim(),
      });
      setPreviewResult(res.data);
    } catch (err: any) {
      setPreviewError(err.response?.data?.error ?? t('platform:clinics.sms.preview.failed'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const turkeyDefaultProvider = smsProviders.find((p) => p.region === 'tr' && p.isActive && p.isDefault)
    ?? smsProviders.find((p) => p.region === 'tr' && p.isActive);
  const europeDefaultProvider = smsProviders.find((p) => p.region === 'eu' && p.isActive && p.isDefault)
    ?? smsProviders.find((p) => p.region === 'eu' && p.isActive);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('platform:clinics.title')}</h1>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
        >
          <RefreshCw size={14} />
          {t('platform:actions.refresh')}
        </button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t('platform:clinics.searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{t('platform:filters.allStatuses')}</option>
          <option value="trial">{t('platform:statuses.trial')}</option>
          <option value="active">{t('platform:statuses.active')}</option>
          <option value="suspended">{t('platform:statuses.suspended')}</option>
          <option value="cancelled">{t('platform:statuses.cancelled')}</option>
        </select>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={28} className="animate-spin text-blue-500" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-red-600 p-6">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-5 py-3 text-left">{t('platform:clinics.columns.clinic')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:clinics.columns.organization')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:clinics.columns.plan')}</th>
                    <th className="px-4 py-3 text-center">{t('platform:clinics.columns.status')}</th>
                    <th className="px-4 py-3 text-center">{t('platform:clinics.columns.sms')}</th>
                    <th className="px-4 py-3 text-center">{t('platform:clinics.columns.users')}</th>
                    <th className="px-4 py-3 text-center">{t('platform:clinics.columns.patients')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:clinics.columns.created')}</th>
                    <th className="px-5 py-3 text-right">{t('platform:clinics.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {data?.data.map((clinic) => (
                    <tr key={clinic.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-900 dark:text-white">{clinic.name}</p>
                        <p className="text-xs text-gray-400">{clinic.slug}</p>
                        {clinic.email && <p className="text-xs text-gray-400">{clinic.email}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">
                        {clinic.organization?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">
                        {clinic.plan?.displayName ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[clinic.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {t(`platform:statuses.${clinic.status}`, { defaultValue: clinic.status })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {clinic.smsSettings?.addonEnabled ? (
                          <span className="inline-flex flex-col items-center gap-0.5">
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                              {t('platform:clinics.sms.addonBadge')}
                            </span>
                            <span className="text-xs text-gray-400">{clinic.smsSettings.monthlyQuota.toLocaleString(i18n.language || 'tr')}/{t('platform:clinics.sms.month')}</span>
                          </span>
                        ) : clinic.plan?.features?.sms ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                            {t('platform:clinics.sms.planBadge')}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">{t('platform:clinics.sms.inactive')}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{clinic._count.users}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{clinic._count.patients}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(clinic.createdAt).toLocaleDateString(i18n.language || 'tr')}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openSmsModal(clinic)}
                            disabled={actionId === clinic.id}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-400 transition-colors disabled:opacity-50"
                          >
                            <MessageSquare size={12} />
                            SMS
                          </button>
                          {clinic.status !== 'active' && (
                            <button
                              onClick={() => updateStatus(clinic.id, 'active')}
                              disabled={actionId === clinic.id}
                              className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400 transition-colors disabled:opacity-50"
                            >
                              {t('platform:actions.activate')}
                            </button>
                          )}
                          {clinic.status !== 'suspended' && (
                            <button
                              onClick={() => updateStatus(clinic.id, 'suspended')}
                              disabled={actionId === clinic.id}
                              className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-50"
                            >
                              {t('platform:actions.suspend')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data?.data.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center text-gray-400 py-12">{t('platform:clinics.empty')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {data && data.pages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 text-sm text-gray-500">
                <span>{t('platform:pagination', { total: data.total, item: t('platform:items.clinic'), page: data.page, pages: data.pages })}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">
                    <ChevronLeft size={16} />
                  </button>
                  <button onClick={() => setPage((p) => Math.min(data.pages, p + 1))} disabled={page === data.pages} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* SMS add-on modal */}
      {smsClinic && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white">
                {t('platform:clinics.sms.modalTitle', { name: smsClinic.name })}
              </h3>
              <button onClick={() => setSmsClinic(null)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                <X size={18} />
              </button>
            </div>

            <div className="text-xs rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 space-y-1">
              <p>
                {t('platform:clinics.sms.planFeatureLabel')}{' '}
                <span className={smsClinic.plan?.features?.sms ? 'text-green-600 dark:text-green-400 font-medium' : ''}>
                  {smsClinic.plan?.features?.sms
                    ? t('platform:clinics.sms.planFeatureOn', { plan: smsClinic.plan?.displayName ?? '' })
                    : t('platform:clinics.sms.planFeatureOff')}
                </span>
              </p>
              <p>
                {t('platform:clinics.sms.sourceLabel')}{' '}
                <span className="font-medium text-gray-900 dark:text-white">
                  {smsClinic.smsSettings?.addonEnabled
                    ? t('platform:clinics.sms.sourceAddon')
                    : smsClinic.plan?.features?.sms
                      ? t('platform:clinics.sms.sourcePlan')
                      : t('platform:clinics.sms.sourceNone')}
                </span>
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer text-gray-900 dark:text-white">
              <input
                type="checkbox"
                checked={smsForm.addonEnabled}
                onChange={(e) => setSmsForm((f) => ({ ...f, addonEnabled: e.target.checked }))}
                className="rounded text-blue-600"
              />
              {t('platform:clinics.sms.enableAddon')}
            </label>

            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('platform:clinics.sms.monthlyQuota')}</label>
              <input
                type="number"
                min={0}
                max={1000000}
                value={smsForm.monthlyQuota}
                onChange={(e) => setSmsForm((f) => ({ ...f, monthlyQuota: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">{t('platform:clinics.sms.quotaHint')}</p>
            </div>

            {/* Allowed destination regions */}
            <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                {t('platform:clinics.sms.regions.title')}
              </p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer text-gray-900 dark:text-white">
                  <input
                    type="checkbox"
                    checked={smsForm.turkeyAllowed}
                    onChange={(e) => setSmsForm((f) => ({ ...f, turkeyAllowed: e.target.checked }))}
                    className="rounded text-blue-600"
                  />
                  {t('platform:clinics.sms.regions.turkey')}
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer text-gray-900 dark:text-white">
                  <input
                    type="checkbox"
                    checked={smsForm.europeAllowed}
                    onChange={(e) => setSmsForm((f) => ({ ...f, europeAllowed: e.target.checked }))}
                    className="rounded text-blue-600"
                  />
                  {t('platform:clinics.sms.regions.europe')}
                </label>
              </div>
            </div>

            {/* Routing policy */}
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                {t('platform:clinics.sms.routing.title')}
              </label>
              <select
                value={smsForm.routingPolicy}
                onChange={(e) => setSmsForm((f) => ({ ...f, routingPolicy: e.target.value as RoutingPolicy }))}
                className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="automatic_by_recipient_phone_region">{t('platform:clinics.sms.routing.automatic')}</option>
                <option value="force_turkey_provider">{t('platform:clinics.sms.routing.forceTurkey')}</option>
                <option value="force_europe_provider">{t('platform:clinics.sms.routing.forceEurope')}</option>
              </select>
              <p className="mt-1 text-xs text-gray-400">{t('platform:clinics.sms.routing.hint')}</p>
            </div>

            {/* Resolved provider summary (read-only) */}
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2 text-xs space-y-1">
              <p className="font-medium text-gray-600 dark:text-gray-400">{t('platform:clinics.sms.resolvedProviders.title')}</p>
              <p className="flex items-center justify-between">
                <span className="text-gray-500">{t('platform:clinics.sms.regions.turkey')}</span>
                <span className={turkeyDefaultProvider ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}>
                  {turkeyDefaultProvider ? turkeyDefaultProvider.displayName : t('platform:clinics.sms.resolvedProviders.none')}
                </span>
              </p>
              <p className="flex items-center justify-between">
                <span className="text-gray-500">{t('platform:clinics.sms.regions.europe')}</span>
                <span className={europeDefaultProvider ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}>
                  {europeDefaultProvider ? europeDefaultProvider.displayName : t('platform:clinics.sms.resolvedProviders.none')}
                </span>
              </p>
            </div>

            {/* Provider resolution preview */}
            <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                {t('platform:clinics.sms.preview.title')}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t('platform:clinics.sms.preview.placeholder')}
                  value={previewPhone}
                  onChange={(e) => setPreviewPhone(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={runRoutingPreview}
                  disabled={previewLoading || !previewPhone.trim()}
                  className="px-3 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {previewLoading ? <Loader2 size={13} className="animate-spin" /> : null}
                  {t('platform:clinics.sms.preview.run')}
                </button>
              </div>

              {previewError && (
                <p className="mt-2 text-xs text-red-600">{previewError}</p>
              )}

              {previewResult && (
                <div className="mt-2 rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs space-y-1">
                  <p>
                    <span className="text-gray-500">{t('platform:clinics.sms.preview.normalizedPhone')}: </span>
                    <span className="text-gray-900 dark:text-white">{previewResult.normalizedPhone ?? '—'}</span>
                  </p>
                  <p>
                    <span className="text-gray-500">{t('platform:clinics.sms.preview.detectedRegion')}: </span>
                    <span className="text-gray-900 dark:text-white uppercase">{previewResult.detectedRegion ?? '—'}</span>
                  </p>
                  {previewResult.blocked ? (
                    <p className="text-amber-600 dark:text-amber-400">
                      {t('platform:clinics.sms.preview.blocked')}: {previewResult.blockedMessage}
                    </p>
                  ) : (
                    <p className="text-green-600 dark:text-green-400">
                      {t('platform:clinics.sms.preview.selectedProvider')}: {previewResult.provider?.displayName}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setSmsClinic(null)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {t('platform:actions.cancel')}
              </button>
              <button
                onClick={saveSmsAddon}
                disabled={smsSaving}
                className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
              >
                {smsSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {t('platform:actions.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlatformClinics;
