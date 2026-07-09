import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FinanceSummary {
  collectedToday: number;
  collectedInRange: number;
  outstandingBalance: number;
  overdueAmount: number;
  pendingInstallments: number;
  overdueInstallments: number;
  overdueInstallmentsCount: number;
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
  { value: 'today' },
  { value: 'this_week' },
  { value: 'this_month' },
  { value: 'last_30_days' },
];

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
  const { t } = useTranslation(['payments', 'common']);
  const navigate = useNavigate();
  const { defaultCurrency, formatCurrency, formatDate } = useClinicPreferences();
  const [searchParams] = useSearchParams();

  // "period" is read from the URL (e.g. /finance?period=this_month) so dashboard KPI
  // links apply the range immediately; falls back to the existing default otherwise.
  const [range, setRange] = useState(() => {
    const fromUrl = searchParams.get('period');
    return fromUrl && RANGE_OPTIONS.some(opt => opt.value === fromUrl) ? fromUrl : 'this_month';
  });
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
      setError(t('payments:financeDashboard.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [range, t]);

  useEffect(() => {
    if (canViewFinanceDashboard(user)) {
      load();
    }
  }, [load, user]);

  const role = normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false);
  const s = data?.summary;
  const rangeLabel = (value: string) => t(`payments:financeDashboard.ranges.${value}`);
  const methodLabel = (method: string) => t(`payments:methods.${method}`, { defaultValue: method });
  const money = (value: number) => formatCurrency(value, defaultCurrency);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <DollarSign className="text-green-600" size={28} />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{t('payments:financeDashboard.title')}</h1>
            <p className="text-sm text-gray-500">
              {role === 'BILLING'
                ? t('payments:financeDashboard.billingSubtitle')
                : t('payments:financeDashboard.subtitle')}
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
                {rangeLabel(opt.value)}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500"
            title={t('common:refresh')}
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
        <div className="text-center py-16 text-gray-400">{t('common:loading')}</div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
            <SummaryCard
              title={t('payments:financeDashboard.cards.collectedToday')}
              value={money(s!.collectedToday)}
              icon={<TrendingUp size={18} className="text-green-600" />}
              color="bg-green-50"
            />
            <SummaryCard
              title={t('payments:financeDashboard.cards.collectedInRange')}
              value={money(s!.collectedInRange)}
              icon={<CreditCard size={18} className="text-blue-600" />}
              color="bg-blue-50"
              sub={rangeLabel(range)}
            />
            <SummaryCard
              title={t('payments:financeDashboard.cards.outstandingBalance')}
              value={money(s!.outstandingBalance)}
              icon={<Clock size={18} className="text-yellow-600" />}
              color="bg-yellow-50"
            />
            <SummaryCard
              title={t('payments:financeDashboard.cards.overdueAmount')}
              value={money(s!.overdueAmount)}
              icon={<AlertTriangle size={18} className="text-red-500" />}
              color="bg-red-50"
            />
            <SummaryCard
              title={t('payments:financeDashboard.cards.pendingInstallments')}
              value={String(s!.pendingInstallments)}
              icon={<Calendar size={18} className="text-indigo-600" />}
              color="bg-indigo-50"
            />
            <SummaryCard
              title={t('payments:financeDashboard.cards.overdueInstallments')}
              value={money(s!.overdueInstallments)}
              icon={<AlertTriangle size={18} className="text-orange-500" />}
              color="bg-orange-50"
            />
            <SummaryCard
              title={t('payments:financeDashboard.cards.practitionerPayoutsDue')}
              value={money(s!.practitionerPayoutsDue)}
              icon={<DollarSign size={18} className="text-purple-600" />}
              color="bg-purple-50"
            />
            <SummaryCard
              title={t('payments:financeDashboard.cards.practitionerPayoutsPaid')}
              value={money(s!.practitionerPayoutsPaid)}
              icon={<TrendingUp size={18} className="text-teal-600" />}
              color="bg-teal-50"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Collections by method */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <CreditCard size={16} /> {t('payments:financeDashboard.sections.byMethod')}
              </h2>
              {data.collectionsByMethod.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">{t('common:noData')}</p>
              ) : (
                <div className="space-y-2">
                  {data.collectionsByMethod.map(m => (
                    <div key={m.method} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">
                          {methodLabel(m.method)}
                        </span>
                        <span className="text-xs text-gray-400">({t('payments:financeDashboard.transactionCount', { count: m.count })})</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-800">{money(m.amount)}</span>
                    </div>
                  ))}
                  <div className="border-t pt-2 flex justify-between text-sm font-bold">
                    <span>{t('payments:planForm.total')}</span>
                    <span>{money(data.collectionsByMethod.reduce((a, m) => a + m.amount, 0))}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Upcoming/overdue installments */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Calendar size={16} /> {t('payments:financeDashboard.sections.upcomingInstallments')}
              </h2>
              {data.upcomingInstallments.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">{t('payments:financeDashboard.empty.noInstallments')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b">
                        <th className="pb-2 pr-3">{t('payments:list.patient')}</th>
                        <th className="pb-2 pr-3">{t('common:clinic')}</th>
                        <th className="pb-2 pr-3">{t('payments:list.amount')}</th>
                        <th className="pb-2 pr-3">{t('payments:planForm.dueDate')}</th>
                        <th className="pb-2">{t('payments:list.status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.upcomingInstallments.map(inst => (
                        <tr key={inst.id} className="hover:bg-gray-50">
                          <td className="py-1.5 pr-3 font-medium">{inst.patientName}</td>
                          <td className="py-1.5 pr-3 text-gray-500">{inst.clinicName}</td>
                          <td className="py-1.5 pr-3">{money(inst.amount)}</td>
                          <td className="py-1.5 pr-3">{formatDate(inst.dueDate)}</td>
                          <td className="py-1.5">
                            <span className={`text-xs rounded-full px-2 py-0.5 ${
                              inst.status === 'overdue'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {inst.status === 'overdue'
                                ? t('payments:planForm.installmentStatus.overdue')
                                : t('payments:status.pending')}
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
                    {t('payments:financeDashboard.actions.viewAllPaymentPlans')} <ChevronRight size={12} />
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Branch breakdown */}
          {data.branchBreakdown.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
              <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Building2 size={16} /> {t('payments:financeDashboard.sections.branchPerformance')}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b">
                      <th className="pb-2 pr-4">{t('common:clinic')}</th>
                      <th className="pb-2 pr-4 text-right">{t('payments:financeDashboard.columns.collected')}</th>
                      <th className="pb-2 pr-4 text-right">{t('payments:summary.pending')}</th>
                      <th className="pb-2 pr-4 text-right">{t('payments:planForm.installmentStatus.overdue')}</th>
                      <th className="pb-2 pr-4 text-right">{t('payments:financeDashboard.columns.installment')}</th>
                      <th className="pb-2 text-right">{t('common:actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.branchBreakdown.map(b => (
                      <tr key={b.clinicId} className="hover:bg-gray-50">
                        <td className="py-2 pr-4 font-medium">{b.clinicName}</td>
                        <td className="py-2 pr-4 text-right text-green-700">{money(b.collected)}</td>
                        <td className="py-2 pr-4 text-right text-yellow-700">{money(b.outstanding)}</td>
                        <td className="py-2 pr-4 text-right text-red-600">{money(b.overdue)}</td>
                        <td className="py-2 pr-4 text-right">{b.pendingInstallments}</td>
                        <td className="py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              to={`/payments?clinicId=${b.clinicId}`}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {t('common:payments')}
                            </Link>
                            <Link
                              to={`/payment-plans?clinicId=${b.clinicId}`}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {t('payments:financeDashboard.actions.installments')}
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t">
                    <tr className="font-bold text-sm">
                      <td className="pt-2 pr-4">{t('payments:planForm.total')}</td>
                      <td className="pt-2 pr-4 text-right text-green-700">
                        {money(data.branchBreakdown.reduce((a, b) => a + b.collected, 0))}
                      </td>
                      <td className="pt-2 pr-4 text-right text-yellow-700">
                        {money(data.branchBreakdown.reduce((a, b) => a + b.outstanding, 0))}
                      </td>
                      <td className="pt-2 pr-4 text-right text-red-600">
                        {money(data.branchBreakdown.reduce((a, b) => a + b.overdue, 0))}
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
                <TrendingUp size={16} /> {t('payments:financeDashboard.sections.recentPayments')}
              </h2>
              <Link
                to="/payments"
                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
              >
                {t('common:viewAll')} <ChevronRight size={12} />
              </Link>
            </div>
            {data.recentPayments.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">{t('payments:financeDashboard.empty.noPaymentsInRange')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b">
                      <th className="pb-2 pr-3">{t('payments:list.patient')}</th>
                      <th className="pb-2 pr-3">{t('common:clinic')}</th>
                      <th className="pb-2 pr-3 text-right">{t('payments:list.amount')}</th>
                      <th className="pb-2 pr-3">{t('payments:list.method')}</th>
                      <th className="pb-2 pr-3">{t('payments:list.date')}</th>
                      <th className="pb-2">{t('payments:list.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.recentPayments.map(p => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="py-1.5 pr-3 font-medium">{p.patientName}</td>
                        <td className="py-1.5 pr-3 text-gray-500">{p.clinicName}</td>
                        <td className="py-1.5 pr-3 text-right font-semibold">{money(p.amount)}</td>
                        <td className="py-1.5 pr-3">{methodLabel(p.method)}</td>
                        <td className="py-1.5 pr-3 text-gray-500">{formatDate(p.paidAt)}</td>
                        <td className="py-1.5">
                          <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                            {t('payments:status.paid')}
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
