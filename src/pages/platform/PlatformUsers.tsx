import React, { useEffect, useState, useCallback } from 'react';
import {
  Search, Loader2, AlertCircle, ChevronLeft, ChevronRight,
  RefreshCw, CheckCircle2, XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  isActive: boolean;
  canAccessAllClinics: boolean;
  lastLoginAt?: string;
  createdAt: string;
  organization?: { id: string; name: string; slug: string };
  defaultClinic?: { id: string; name: string; slug: string };
  clinic?: { id: string; name: string; slug: string };
}

interface PagedResponse {
  data: User[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

const ROLE_KEYS = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'BILLING', 'ASSISTANT'];

const PlatformUsers: React.FC = () => {
  const { t, i18n } = useTranslation(['platform']);
  const api = usePlatformApi();
  const [data, setData] = useState<PagedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [actionId, setActionId] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .get('/platform/users', {
        params: {
          page,
          limit: 25,
          search: search || undefined,
          status: statusFilter || undefined,
          role: roleFilter || undefined,
        },
      })
      .then((res) => setData(res.data))
      .catch(() => setError(t('platform:errors.usersLoadFailed')))
      .finally(() => setLoading(false));
  }, [api, page, search, statusFilter, roleFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleStatus = async (user: User) => {
    setActionId(user.id);
    try {
      await api.patch(`/platform/users/${user.id}/status`, { isActive: !user.isActive });
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('platform:users.title')}</h1>
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
            placeholder={t('platform:users.searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none"
        >
          <option value="">{t('platform:filters.allStatuses')}</option>
          <option value="active">{t('platform:statuses.active')}</option>
          <option value="inactive">{t('platform:statuses.inactive')}</option>
        </select>
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none"
        >
          <option value="">{t('platform:filters.allRoles')}</option>
          {ROLE_KEYS.map((val) => (
            <option key={val} value={val}>{t(`platform:users.roles.${val}`, { defaultValue: val })}</option>
          ))}
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
                    <th className="px-5 py-3 text-left">{t('platform:users.columns.user')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:users.columns.role')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:users.columns.organization')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:users.columns.defaultClinic')}</th>
                    <th className="px-4 py-3 text-center">{t('platform:users.columns.allClinics')}</th>
                    <th className="px-4 py-3 text-center">{t('platform:users.columns.status')}</th>
                    <th className="px-4 py-3 text-left">{t('platform:users.columns.lastLogin')}</th>
                    <th className="px-5 py-3 text-right">{t('platform:users.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {data?.data.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-900 dark:text-white">
                          {user.firstName} {user.lastName}
                        </p>
                        <p className="text-xs text-gray-400">{user.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                          {t(`platform:users.roles.${user.role}`, { defaultValue: user.role })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                        {user.organization?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                        {user.defaultClinic?.name ?? user.clinic?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {user.canAccessAllClinics ? (
                          <CheckCircle2 size={14} className="inline text-green-500" />
                        ) : (
                          <XCircle size={14} className="inline text-gray-300" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${user.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                          {user.isActive ? t('platform:statuses.active') : t('platform:statuses.inactive')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString(i18n.language || 'tr') : '—'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => toggleStatus(user)}
                          disabled={actionId === user.id}
                          className={`text-xs px-2 py-1 rounded transition-colors disabled:opacity-50 ${
                            user.isActive
                              ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-400'
                              : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400'
                          }`}
                        >
                          {actionId === user.id ? (
                            <Loader2 size={12} className="animate-spin inline" />
                          ) : user.isActive ? t('platform:actions.deactivate') : t('platform:actions.activate')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data?.data.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center text-gray-400 py-12">{t('platform:users.empty')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {data && data.pages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 text-sm text-gray-500">
                <span>{t('platform:users.pageInfo', { total: data.total, page: data.page, pages: data.pages })}</span>
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

export default PlatformUsers;
