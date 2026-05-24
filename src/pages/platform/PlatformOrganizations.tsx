import React, { useEffect, useState, useCallback } from 'react';
import {
  Search, Loader2, AlertCircle, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, Clock, Ban, RefreshCw, Package,
  CalendarClock,
} from 'lucide-react';
import { usePlatformApi } from '../../context/PlatformAuthContext';

interface Org {
  id: string;
  name: string;
  slug: string;
  status: string;
  trialEndsAt?: string;
  createdAt: string;
  plan?: { name: string; displayName: string };
  _count: { clinics: number; users: number; patients: number };
}

interface PagedResponse {
  data: Org[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

const STATUS_OPTIONS = [
  { value: '', label: 'Tüm Durumlar' },
  { value: 'trial', label: 'Deneme' },
  { value: 'active', label: 'Aktif' },
  { value: 'suspended', label: 'Askıya Alındı' },
  { value: 'cancelled', label: 'İptal' },
];

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  trial: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'active') return <CheckCircle2 size={13} />;
  if (status === 'trial') return <Clock size={13} />;
  if (status === 'suspended') return <AlertCircle size={13} />;
  if (status === 'cancelled') return <Ban size={13} />;
  return null;
};

const PlatformOrganizations: React.FC = () => {
  const api = usePlatformApi();
  const [data, setData] = useState<PagedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  // Action modals
  const [actionOrgId, setActionOrgId] = useState<string | null>(null);
  const [planModal, setPlanModal] = useState<Org | null>(null);
  const [trialModal, setTrialModal] = useState<Org | null>(null);
  const [plans, setPlans] = useState<Array<{ id: string; displayName: string }>>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [trialDate, setTrialDate] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .get('/platform/organizations', {
        params: { page, limit: 25, search: search || undefined, status: statusFilter || undefined },
      })
      .then((res) => setData(res.data))
      .catch(() => setError('Organizasyonlar yüklenemedi'))
      .finally(() => setLoading(false));
  }, [api, page, search, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch plans once
  useEffect(() => {
    api.get('/platform/plans').then((res) => setPlans(res.data)).catch(() => {});
  }, [api]);

  const updateStatus = async (id: string, status: string) => {
    setActionOrgId(id);
    try {
      await api.patch(`/platform/organizations/${id}/status`, { status });
      fetchData();
    } catch {
      alert('Durum güncellenemedi');
    } finally {
      setActionOrgId(null);
    }
  };

  const updatePlan = async () => {
    if (!planModal || !selectedPlanId) return;
    setActionLoading(true);
    try {
      await api.patch(`/platform/organizations/${planModal.id}/plan`, { planId: selectedPlanId });
      setPlanModal(null);
      fetchData();
    } catch {
      alert('Plan güncellenemedi');
    } finally {
      setActionLoading(false);
    }
  };

  const extendTrial = async () => {
    if (!trialModal || !trialDate) return;
    setActionLoading(true);
    try {
      await api.patch(`/platform/organizations/${trialModal.id}/trial`, { trialEndsAt: trialDate });
      setTrialModal(null);
      fetchData();
    } catch {
      alert('Deneme süresi güncellenemedi');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Organizasyonlar</h1>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
        >
          <RefreshCw size={14} />
          Yenile
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Ad veya slug ara..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-8 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
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
                    <th className="px-5 py-3 text-left">Organizasyon</th>
                    <th className="px-4 py-3 text-left">Plan</th>
                    <th className="px-4 py-3 text-center">Durum</th>
                    <th className="px-4 py-3 text-center">Klinik</th>
                    <th className="px-4 py-3 text-center">Kullanıcı</th>
                    <th className="px-4 py-3 text-center">Hasta</th>
                    <th className="px-4 py-3 text-left">Deneme Bitiş</th>
                    <th className="px-4 py-3 text-left">Oluşturulma</th>
                    <th className="px-5 py-3 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {data?.data.map((org) => (
                    <tr key={org.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-900 dark:text-white">{org.name}</p>
                        <p className="text-xs text-gray-400">{org.slug}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {org.plan?.displayName ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[org.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          <StatusIcon status={org.status} />
                          {org.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{org._count.clinics}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{org._count.users}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-400">{org._count.patients}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {org.trialEndsAt ? new Date(org.trialEndsAt).toLocaleDateString('tr-TR') : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(org.createdAt).toLocaleDateString('tr-TR')}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          {org.status !== 'active' && (
                            <button
                              onClick={() => updateStatus(org.id, 'active')}
                              disabled={actionOrgId === org.id}
                              className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400 dark:hover:bg-green-900/60 transition-colors disabled:opacity-50"
                            >
                              Aktifleştir
                            </button>
                          )}
                          {org.status !== 'suspended' && (
                            <button
                              onClick={() => updateStatus(org.id, 'suspended')}
                              disabled={actionOrgId === org.id}
                              className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400 transition-colors disabled:opacity-50"
                            >
                              Askıya Al
                            </button>
                          )}
                          <button
                            onClick={() => { setPlanModal(org); setSelectedPlanId(org.plan ? '' : ''); }}
                            className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-400 transition-colors"
                          >
                            <Package size={12} className="inline mr-1" />
                            Plan
                          </button>
                          <button
                            onClick={() => { setTrialModal(org); setTrialDate(''); }}
                            className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-400 transition-colors"
                          >
                            <CalendarClock size={12} className="inline mr-1" />
                            Deneme
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data?.data.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center text-gray-400 py-12">
                        Organizasyon bulunamadı
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data && data.pages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 text-sm text-gray-500">
                <span>{data.total} organizasyon · Sayfa {data.page}/{data.pages}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                    disabled={page === data.pages}
                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Plan modal */}
      {planModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-96 space-y-4">
            <h3 className="font-bold text-gray-900 dark:text-white">Plan Değiştir — {planModal.name}</h3>
            <select
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Plan seçin...</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPlanModal(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">İptal</button>
              <button onClick={updatePlan} disabled={!selectedPlanId || actionLoading} className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 flex items-center gap-1">
                {actionLoading && <Loader2 size={13} className="animate-spin" />}
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trial modal */}
      {trialModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-96 space-y-4">
            <h3 className="font-bold text-gray-900 dark:text-white">Deneme Uzat — {trialModal.name}</h3>
            <input
              type="date"
              value={trialDate}
              onChange={(e) => setTrialDate(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setTrialModal(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">İptal</button>
              <button onClick={extendTrial} disabled={!trialDate || actionLoading} className="px-4 py-2 text-sm rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors disabled:opacity-50 flex items-center gap-1">
                {actionLoading && <Loader2 size={13} className="animate-spin" />}
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlatformOrganizations;
