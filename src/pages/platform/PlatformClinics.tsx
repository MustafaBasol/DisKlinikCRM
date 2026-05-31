import React, { useEffect, useState, useCallback } from 'react';
import {
  Search, Loader2, AlertCircle, ChevronLeft, ChevronRight,
  CheckCircle2, Clock, Ban, RefreshCw,
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
  plan?: { displayName: string };
  _count: { users: number; patients: number; appointments: number };
}

interface PagedResponse {
  data: Clinic[];
  total: number;
  page: number;
  limit: number;
  pages: number;
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
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{clinic._count.users}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{clinic._count.patients}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(clinic.createdAt).toLocaleDateString(i18n.language || 'tr')}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
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
                      <td colSpan={8} className="text-center text-gray-400 py-12">{t('platform:clinics.empty')}</td>
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
    </div>
  );
};

export default PlatformClinics;
