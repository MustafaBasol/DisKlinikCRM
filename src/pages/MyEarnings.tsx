import React, { useState, useEffect, useCallback } from 'react';
import { DollarSign, Clock, CheckCircle, CreditCard, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { practitionerEarningService } from '../services/api';

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Bekliyor',  cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  approved:  { label: 'Onaylandı', cls: 'bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-300'   },
  paid:      { label: 'Ödendi',    cls: 'bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-300'  },
  cancelled: { label: 'İptal',     cls: 'bg-gray-100   text-gray-600   dark:bg-gray-700      dark:text-gray-400'   },
};

function fmt(n: number) {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function currentPeriod() {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

const MyEarnings: React.FC = () => {
  const { user } = useAuth();
  const [earnings, setEarnings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [periodMonth, setPeriodMonth] = useState(currentPeriod().month);
  const [periodYear, setPeriodYear] = useState(currentPeriod().year);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params: any = { periodMonth, periodYear, limit: 200 };
      if (filterStatus) params.status = filterStatus;
      const res = await practitionerEarningService.getAll(params);
      setEarnings(res.data.earnings || res.data);
    } catch {
      setError('Kazanç bilgisi yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, periodMonth, periodYear]);

  useEffect(() => { load(); }, [load]);

  // Summary metrics
  const summary = earnings.reduce(
    (acc, e) => {
      const amount = e.adminAdjustmentAmount ?? e.earningAmount;
      acc.total += amount;
      if (e.status === 'pending')   acc.pending   += amount;
      if (e.status === 'approved')  acc.approved  += amount;
      if (e.status === 'paid')      acc.paid       += amount;
      return acc;
    },
    { total: 0, pending: 0, approved: 0, paid: 0 },
  );

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = [2024, 2025, 2026, 2027];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Kazançlarım</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {user?.firstName} {user?.lastName} — Kişisel kazanç özeti
        </p>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-2 mb-6">
        <select value={periodMonth} onChange={e => setPeriodMonth(Number(e.target.value))} className="input-field w-28">
          {months.map(m => <option key={m} value={m}>{m}. Ay</option>)}
        </select>
        <select value={periodYear} onChange={e => setPeriodYear(Number(e.target.value))} className="input-field w-20">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={load} className="btn-secondary text-sm">Yenile</button>
      </div>

      {/* Summary Cards */}
      {!loading && !error && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Toplam Kazanç', value: summary.total, color: 'text-gray-900 dark:text-white', icon: <DollarSign size={20} className="text-blue-500" /> },
            { label: 'Bekleyen',      value: summary.pending,  color: 'text-yellow-600 dark:text-yellow-400', icon: <Clock size={20} className="text-yellow-500" /> },
            { label: 'Onaylanan',     value: summary.approved, color: 'text-blue-600 dark:text-blue-400',   icon: <CheckCircle size={20} className="text-blue-500" /> },
            { label: 'Ödenen',        value: summary.paid,     color: 'text-green-600 dark:text-green-400', icon: <CreditCard size={20} className="text-green-500" /> },
          ].map(card => (
            <div key={card.label} className="card p-4">
              <div className="flex items-center gap-2 mb-2">{card.icon}<span className="text-sm text-gray-500 dark:text-gray-400">{card.label}</span></div>
              <p className={`text-xl font-bold ${card.color}`}>{fmt(card.value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Remaining payable */}
      {!loading && !error && summary.approved > 0 && (
        <div className="card p-4 mb-6 border-l-4 border-orange-400">
          <p className="text-sm text-gray-600 dark:text-gray-400">Ödenmesi Gereken (Onaylı)</p>
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{fmt(summary.approved)}</p>
        </div>
      )}

      {/* Earnings Table */}
      <div className="card">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">Kazanç Detayları</h2>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input-field w-36 text-sm">
            <option value="">Tüm Durumlar</option>
            {Object.entries(STATUS_BADGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm p-4">
            <AlertCircle size={16} />{error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
        ) : earnings.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Bu dönemde kazanç kaydı bulunamadı.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 dark:text-gray-400 text-left">
                  <th className="px-4 py-3">Hasta</th>
                  <th className="px-4 py-3">Hizmet / Vaka</th>
                  <th className="px-4 py-3 text-right">Tahsilat</th>
                  <th className="px-4 py-3 text-right">Kazanç</th>
                  <th className="px-4 py-3 text-right">Düz. Kazanç</th>
                  <th className="px-4 py-3 text-center">Durum</th>
                  <th className="px-4 py-3 text-right">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {earnings.map(e => (
                  <tr key={e.id} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {e.patient ? `${e.patient.firstName} ${e.patient.lastName}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {e.service?.name ?? e.treatmentCase?.title ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">{fmt(e.collectedAmount)}</td>
                    <td className="px-4 py-3 text-right">{fmt(e.earningAmount)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-white">
                      {e.adminAdjustmentAmount != null ? fmt(e.adminAdjustmentAmount) : '—'}
                      {e.adminAdjustmentReason && (
                        <span className="block text-xs text-gray-400 font-normal">{e.adminAdjustmentReason}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[e.status]?.cls}`}>
                        {STATUS_BADGE[e.status]?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                      {new Date(e.createdAt).toLocaleDateString('tr-TR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default MyEarnings;
