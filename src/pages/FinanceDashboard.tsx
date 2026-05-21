import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  TrendingUp,
  AlertTriangle,
  Clock,
  CreditCard,
  DollarSign,
  Building2,
  ChevronRight,
  RefreshCw,
  Calendar,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { financeDashboardService } from '../services/api';
import { canViewFinanceDashboard } from '../utils/permissions';
import { normalizeRole } from '../utils/permissions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FinanceSummary {
  collectedToday: number;
  collectedInRange: number;
  outstandingBalance: number;
  overdueAmount: number;
  pendingInstallments: number;
  overdueInstallments: number;
  cancelledPayments: number;
  practitionerPayoutsDue: number;
  practitionerPayoutsPaid: number;
}

interface CollectionByMethod {
  method: string;
  amount: number;
  count: number;
}

interface BranchRow {
  clinicId: string;
  clinicName: string;
  collected: number;
  outstanding: number;
  overdue: number;
  pendingInstallments: number;
}

interface RecentPayment {
  id: string;
  patientName: string;
  clinicName: string;
  amount: number;
  method: string;
  paidAt: string | null;
  status: string;
}

interface UpcomingInstallment {
  id: string;
  planId: string;
  patientName: string;
  clinicName: string;
  amount: number;
  dueDate: string;
  status: string;
}

interface DashboardData {
  summary: FinanceSummary;
  collectionsByMethod: CollectionByMethod[];
  branchBreakdown: BranchRow[];
  recentPayments: RecentPayment[];
  upcomingInstallments: UpcomingInstallment[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { value: 'today', label: 'Bugün' },
  { value: 'this_week', label: 'Bu Hafta' },
  { value: 'this_month', label: 'Bu Ay' },
  { value: 'last_30_days', label: 'Son 30 Gün' },
];

const METHOD_LABELS: Record<string, string> = {
  cash: 'Nakit',
  card: 'Kart',
  bank_transfer: 'Havale/EFT',
  insurance: 'Sigorta',
  other: 'Diğer',
};

function fmt(n: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('tr-TR');
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  title,
  value,
  icon,
  color,
  sub,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  sub?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex items-start gap-3`}>
      <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500 font-medium">{title}</p>
        <p className="text-xl font-bold text-gray-800 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FinanceDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [range, setRange] = useState('this_month');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Redirect unauthorized users
  useEffect(() => {
    if (!canViewFinanceDashboard(user)) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await financeDashboardService.get({ range });
      setData(res.data);
    } catch {
      setError('Finans verileri yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    if (canViewFinanceDashboard(user)) {
      load();
    }
  }, [load, user]);

  const role = normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false);
  const s = data?.summary;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <DollarSign className="text-green-600" size={28} />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Finans Paneli</h1>
            <p className="text-sm text-gray-500">
              {role === 'BILLING' ? 'Fatura Özeti' : 'Gelir &amp; Ödeme Takibi'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 border border-gray-200 rounded-lg overflow-hidden">
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  range === opt.value
                    ? 'bg-green-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500"
            title="Yenile"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div className="text-center py-16 text-gray-400">Yükleniyor...</div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
            <SummaryCard
              title="Bugün Tahsilat"
              value={`₺${fmt(s!.collectedToday)}`}
              icon={<TrendingUp size={18} className="text-green-600" />}
              color="bg-green-50"
            />
            <SummaryCard
              title="Dönem Tahsilat"
              value={`₺${fmt(s!.collectedInRange)}`}
              icon={<CreditCard size={18} className="text-blue-600" />}
              color="bg-blue-50"
              sub={RANGE_OPTIONS.find(o => o.value === range)?.label}
            />
            <SummaryCard
              title="Bekleyen Bakiye"
              value={`₺${fmt(s!.outstandingBalance)}`}
              icon={<Clock size={18} className="text-yellow-600" />}
              color="bg-yellow-50"
            />
            <SummaryCard
              title="Gecikmiş Tutar"
              value={`₺${fmt(s!.overdueAmount)}`}
              icon={<AlertTriangle size={18} className="text-red-500" />}
              color="bg-red-50"
            />
            <SummaryCard
              title="Bekleyen Taksit"
              value={String(s!.pendingInstallments)}
              icon={<Calendar size={18} className="text-indigo-600" />}
              color="bg-indigo-50"
            />
            <SummaryCard
              title="Gecikmiş Taksit"
              value={String(s!.overdueInstallments)}
              icon={<AlertTriangle size={18} className="text-orange-500" />}
              color="bg-orange-50"
            />
            <SummaryCard
              title="Hekim Hak Edişi (Ödenmemiş)"
              value={`₺${fmt(s!.practitionerPayoutsDue)}`}
              icon={<DollarSign size={18} className="text-purple-600" />}
              color="bg-purple-50"
            />
            <SummaryCard
              title="Hekim Ödemesi (Dönem)"
              value={`₺${fmt(s!.practitionerPayoutsPaid)}`}
              icon={<TrendingUp size={18} className="text-teal-600" />}
              color="bg-teal-50"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Collections by method */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <CreditCard size={16} /> Ödeme Yöntemine Göre
              </h2>
              {data.collectionsByMethod.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Veri yok</p>
              ) : (
                <div className="space-y-2">
                  {data.collectionsByMethod.map(m => (
                    <div key={m.method} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">
                          {METHOD_LABELS[m.method] ?? m.method}
                        </span>
                        <span className="text-xs text-gray-400">({m.count} işlem)</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-800">₺{fmt(m.amount)}</span>
                    </div>
                  ))}
                  <div className="border-t pt-2 flex justify-between text-sm font-bold">
                    <span>Toplam</span>
                    <span>₺{fmt(data.collectionsByMethod.reduce((a, m) => a + m.amount, 0))}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Upcoming/overdue installments */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Calendar size={16} /> Yaklaşan / Gecikmiş Taksitler
              </h2>
              {data.upcomingInstallments.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Taksit yok</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b">
                        <th className="pb-2 pr-3">Hasta</th>
                        <th className="pb-2 pr-3">Klinik</th>
                        <th className="pb-2 pr-3">Tutar</th>
                        <th className="pb-2 pr-3">Vade</th>
                        <th className="pb-2">Durum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.upcomingInstallments.map(inst => (
                        <tr key={inst.id} className="hover:bg-gray-50">
                          <td className="py-1.5 pr-3 font-medium">{inst.patientName}</td>
                          <td className="py-1.5 pr-3 text-gray-500">{inst.clinicName}</td>
                          <td className="py-1.5 pr-3">₺{fmt(inst.amount)}</td>
                          <td className="py-1.5 pr-3">{fmtDate(inst.dueDate)}</td>
                          <td className="py-1.5">
                            <span className={`text-xs rounded-full px-2 py-0.5 ${
                              inst.status === 'overdue'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {inst.status === 'overdue' ? 'Gecikmiş' : 'Bekliyor'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Link
                    to="/payment-plans"
                    className="mt-3 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                  >
                    Tüm taksit planlarını gör <ChevronRight size={12} />
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Branch breakdown */}
          {data.branchBreakdown.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
              <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Building2 size={16} /> Şube Bazlı Performans
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b">
                      <th className="pb-2 pr-4">Klinik</th>
                      <th className="pb-2 pr-4 text-right">Tahsilat</th>
                      <th className="pb-2 pr-4 text-right">Bekleyen</th>
                      <th className="pb-2 pr-4 text-right">Gecikmiş</th>
                      <th className="pb-2 pr-4 text-right">Taksit</th>
                      <th className="pb-2 text-right">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.branchBreakdown.map(b => (
                      <tr key={b.clinicId} className="hover:bg-gray-50">
                        <td className="py-2 pr-4 font-medium">{b.clinicName}</td>
                        <td className="py-2 pr-4 text-right text-green-700">₺{fmt(b.collected)}</td>
                        <td className="py-2 pr-4 text-right text-yellow-700">₺{fmt(b.outstanding)}</td>
                        <td className="py-2 pr-4 text-right text-red-600">₺{fmt(b.overdue)}</td>
                        <td className="py-2 pr-4 text-right">{b.pendingInstallments}</td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              to={`/payments?clinicId=${b.clinicId}`}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              Ödemeler
                            </Link>
                            <Link
                              to={`/payment-plans?clinicId=${b.clinicId}`}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              Taksitler
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t">
                    <tr className="font-bold text-sm">
                      <td className="pt-2 pr-4">Toplam</td>
                      <td className="pt-2 pr-4 text-right text-green-700">
                        ₺{fmt(data.branchBreakdown.reduce((a, b) => a + b.collected, 0))}
                      </td>
                      <td className="pt-2 pr-4 text-right text-yellow-700">
                        ₺{fmt(data.branchBreakdown.reduce((a, b) => a + b.outstanding, 0))}
                      </td>
                      <td className="pt-2 pr-4 text-right text-red-600">
                        ₺{fmt(data.branchBreakdown.reduce((a, b) => a + b.overdue, 0))}
                      </td>
                      <td className="pt-2 pr-4 text-right">
                        {data.branchBreakdown.reduce((a, b) => a + b.pendingInstallments, 0)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Recent payments */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-700 flex items-center gap-2">
                <TrendingUp size={16} /> Son Ödemeler
              </h2>
              <Link
                to="/payments"
                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
              >
                Tümünü gör <ChevronRight size={12} />
              </Link>
            </div>
            {data.recentPayments.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Dönemde ödeme yok</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b">
                      <th className="pb-2 pr-3">Hasta</th>
                      <th className="pb-2 pr-3">Klinik</th>
                      <th className="pb-2 pr-3 text-right">Tutar</th>
                      <th className="pb-2 pr-3">Yöntem</th>
                      <th className="pb-2 pr-3">Tarih</th>
                      <th className="pb-2">Durum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.recentPayments.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="py-1.5 pr-3 font-medium">{p.patientName}</td>
                        <td className="py-1.5 pr-3 text-gray-500">{p.clinicName}</td>
                        <td className="py-1.5 pr-3 text-right font-semibold">₺{fmt(p.amount)}</td>
                        <td className="py-1.5 pr-3">{METHOD_LABELS[p.method] ?? p.method}</td>
                        <td className="py-1.5 pr-3 text-gray-500">{fmtDate(p.paidAt)}</td>
                        <td className="py-1.5">
                          <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                            Ödendi
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
