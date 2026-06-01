import React, { useState } from 'react';
import {
  BarChart2,
  TrendingUp,
  DollarSign,
  Clock,
  Download,
  Users,
  Calendar,
  ChevronRight,
  Loader2,
  AlertCircle,
  Award,
  UserMinus,
  Megaphone,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  ComposedChart, Line,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { reportService, userService } from '../services/api';
import { useClinic } from '../context/ClinicContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

const METHOD_KEYS = ['cash', 'card', 'bank_transfer', 'cheque', 'insurance', 'other'] as const;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#6B7280', '#EC4899', '#14B8A6'];

function formatEnumFallback(value: string) {
  const normalized = value?.trim();
  if (!normalized) return '-';

  return normalized
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(1); // first of current month
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  };
}

const Reports: React.FC = () => {
  const { t } = useTranslation(['reports', 'common', 'payments']);
  const { selectedClinicId } = useClinic();
  const { defaultCurrency, formatCurrency } = useClinicPreferences();
  const [tab, setTab] = useState<'revenue' | 'doctors' | 'sources' | 'noshow'>('revenue');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const range = defaultDateRange();
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('month');
  const [practitionerId, setPractitionerId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');

  const [revenueData, setRevenueData] = useState<any>(null);
  const [doctorData, setDoctorData] = useState<any>(null);
  const [sourcesData, setSourcesData] = useState<any>(null);
  const [noShowData, setNoShowData] = useState<any>(null);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [doctorsLoaded, setDoctorsLoaded] = useState(false);

  const loadRevenue = async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    setError('');
    try {
      const params: any = { dateFrom, dateTo, groupBy };
      if (practitionerId) params.practitionerId = practitionerId;
      if (paymentMethod) params.paymentMethod = paymentMethod;
      const res = await reportService.getRevenue(params);
      setRevenueData(res.data);
    } catch {
      setError(t('reports:errors.revenueLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadDoctors = async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    setError('');
    try {
      const res = await reportService.getDoctorPerformance({ dateFrom, dateTo });
      setDoctorData(res.data);
    } catch {
      setError(t('reports:errors.doctorLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadSources = async () => {
    setLoading(true);
    setError('');
    try {
      const params: any = {};
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const res = await reportService.getPatientSources(params);
      setSourcesData(res.data);
    } catch {
      setError(t('reports:errors.sourcesLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadNoShow = async () => {
    setLoading(true);
    setError('');
    try {
      const params: any = {};
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const res = await reportService.getNoShowAnalysis(params);
      setNoShowData(res.data);
    } catch {
      setError(t('reports:errors.noShowLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadDoctorList = async () => {
    if (doctorsLoaded) return;
    try {
      const res = await userService.getDoctors();
      setDoctors(res.data || []);
      setDoctorsLoaded(true);
    } catch { /* ignore */ }
  };

  React.useEffect(() => {
    loadRevenue();
    loadDoctorList();
  }, [selectedClinicId]); // eslint-disable-line

  const handleSearch = () => {
    if (tab === 'revenue') loadRevenue();
    else if (tab === 'doctors') loadDoctors();
    else if (tab === 'sources') loadSources();
    else if (tab === 'noshow') loadNoShow();
  };

  React.useEffect(() => {
    if (tab === 'doctors' && !doctorData) loadDoctors();
    else if (tab === 'sources' && !sourcesData) loadSources();
    else if (tab === 'noshow' && !noShowData) loadNoShow();
  }, [tab, selectedClinicId]); // eslint-disable-line

  const handleExportCSV = () => {
    const baseUrl = (import.meta.env.VITE_API_URL as string) || '/api';
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (practitionerId) params.set('practitionerId', practitionerId);
    if (paymentMethod) params.set('paymentMethod', paymentMethod);
    if (selectedClinicId && selectedClinicId !== 'all') params.set('clinicId', selectedClinicId);
    const token = localStorage.getItem('hcrm_token');
    const url = `${baseUrl}/reports/revenue/export.csv?${params.toString()}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) throw new Error('Export failed');
        return r.blob();
      })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${t('reports:export.filePrefix')}-${dateFrom}-${dateTo}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => setError(t('reports:errors.csvFailed')));
  };

  const summary = revenueData?.summary;
  const byPeriod = revenueData?.byPeriod || [];
  const byMethod = revenueData?.byMethod || [];
  const byPractitioner = revenueData?.byPractitioner || [];
  const money = (amount: number, currency = defaultCurrency) => formatCurrency(amount, currency);
  const methodLabel = (method: string) => t(`payments:methods.${method}`, { defaultValue: formatEnumFallback(method) });
  const sourceLabel = (source: string) => t(`reports:sources.${source}`, { defaultValue: formatEnumFallback(source) });
  const dayLabel = (day: number | string) => {
    const key = DAY_KEYS[Number(day)];
    return key ? t(`reports:daysShort.${key}`) : String(day);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('reports:title')}</h1>
          <p className="text-gray-500 mt-1">{t('reports:subtitle')}</p>
        </div>
        {tab === 'revenue' && revenueData && (
          <button onClick={handleExportCSV} className="btn-secondary flex items-center gap-2 shrink-0">
            <Download size={16} />
            {t('reports:export.csv')}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
        {[
          { key: 'revenue',  icon: <TrendingUp size={16} />,  label: t('reports:tabs.revenue') },
          { key: 'doctors',  icon: <Users size={16} />,       label: t('reports:tabs.doctors') },
          { key: 'sources',  icon: <Megaphone size={16} />,   label: t('reports:tabs.sources') },
          { key: 'noshow',   icon: <UserMinus size={16} />,   label: t('reports:tabs.noshow') },
        ].map(({ key, icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === key ? 'bg-white dark:bg-gray-700 shadow text-primary-600' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}
          >
            <span className="flex items-center gap-2">{icon}{label}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">{t('reports:filters.startDate')}</label>
            <input type="date" className="input-field" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">{t('reports:filters.endDate')}</label>
            <input type="date" className="input-field" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          {tab === 'revenue' && (
            <>
              <div>
                <label className="label">{t('reports:filters.grouping')}</label>
                <select className="input-field" value={groupBy} onChange={e => setGroupBy(e.target.value as any)}>
                  <option value="day">{t('reports:filters.day')}</option>
                  <option value="week">{t('reports:filters.week')}</option>
                  <option value="month">{t('reports:filters.month')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('reports:filters.paymentMethod')}</label>
                <select className="input-field" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  <option value="">{t('reports:filters.all')}</option>
                  {METHOD_KEYS.map(k => <option key={k} value={k}>{methodLabel(k)}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('reports:filters.doctor')}</label>
                <select className="input-field" value={practitionerId} onChange={e => setPractitionerId(e.target.value)}>
                  <option value="">{t('reports:filters.allDoctors')}</option>
                  {doctors.map(d => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}
                </select>
              </div>
            </>
          )}
          <div className="flex items-end">
            <button onClick={handleSearch} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <BarChart2 size={16} />}
              {t('reports:filters.runReport')}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg p-3">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={32} className="animate-spin text-primary-500" />
        </div>
      )}

      {/* Revenue Tab */}
      {!loading && tab === 'revenue' && revenueData && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card p-5 bg-gradient-to-br from-green-500 to-green-600 text-white border-none">
              <div className="flex items-center justify-between mb-3">
                <p className="text-green-100 text-sm">{t('reports:revenue.totalRevenue')}</p>
                <DollarSign size={20} className="text-green-200" />
              </div>
              <p className="text-2xl font-bold">{money(summary.totalRevenue)}</p>
              <p className="text-green-100 text-xs mt-1">{t('reports:revenue.paymentCount', { count: summary.totalCount })}</p>
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-gray-500 text-sm">{t('reports:revenue.avgPayment')}</p>
                <TrendingUp size={20} className="text-blue-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{money(summary.avgPerPayment)}</p>
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-gray-500 text-sm">{t('reports:revenue.pendingCollection')}</p>
                <Clock size={20} className="text-amber-500" />
              </div>
              <p className="text-2xl font-bold text-amber-600">{money(summary.pendingAmount)}</p>
              <p className="text-gray-400 text-xs mt-1">{t('reports:revenue.pendingCount', { count: summary.pendingCount })}</p>
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-gray-500 text-sm">{t('reports:revenue.paymentCountTitle')}</p>
                <Calendar size={20} className="text-purple-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{summary.totalCount}</p>
            </div>
          </div>

          {/* Period Chart */}
          {byPeriod.length > 0 && (
            <div className="card p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp size={18} className="text-primary-500" />
                {t('reports:revenue.periodicRevenue')}
              </h3>
              <div className="overflow-x-auto">
                <div style={{ minWidth: Math.max(400, byPeriod.length * 60) }}>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={byPeriod} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
                      <Tooltip formatter={(v: any) => money(v as number)} />
                      <Bar dataKey="revenue" fill="#3B82F6" radius={[4, 4, 0, 0]} name={t('reports:revenue.revenue')} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By Method */}
            {byMethod.length > 0 && (
              <div className="card p-6">
                <h3 className="font-semibold text-gray-900 mb-4">{t('reports:revenue.paymentMethodDistribution')}</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={byMethod} dataKey="revenue" nameKey="method" cx="50%" cy="50%"
                      outerRadius={80} label={({ method, percent }: any) => `${methodLabel(method)} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {byMethod.map((_: any, index: number) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any, name: any) => [money(v as number), methodLabel(name as string)]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-3 space-y-1">
                  {byMethod.map((m: any, i: number) => (
                    <div key={m.method} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="text-gray-600">{methodLabel(m.method)}</span>
                      </div>
                      <span className="font-semibold text-gray-900">{money(m.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* By Practitioner */}
            {byPractitioner.length > 0 && (
              <div className="card p-6">
                <h3 className="font-semibold text-gray-900 mb-4">{t('reports:revenue.revenueByDoctor')}</h3>
                <div className="space-y-3">
                  {byPractitioner.sort((a: any, b: any) => b.revenue - a.revenue).map((d: any, i: number) => (
                    <div key={d.practitionerId} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                          style={{ background: COLORS[i % COLORS.length] }}>
                          {d.firstName[0]}{d.lastName[0]}
                        </div>
                        <span className="text-sm text-gray-700 truncate">Dr. {d.firstName} {d.lastName}</span>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="font-semibold text-gray-900 text-sm">{money(d.revenue)}</p>
                        <p className="text-xs text-gray-400">{t('reports:revenue.doctorPaymentCount', { count: d.count })}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* By Period Table */}
          {byPeriod.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">{t('reports:revenue.detailTable')}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 font-medium text-gray-500">{t('reports:revenue.period')}</th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-right">{t('reports:revenue.revenue')}</th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-right">{t('reports:revenue.paymentCountTitle')}</th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-right">{t('reports:revenue.average')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {byPeriod.map((row: any) => (
                      <tr key={row.period} className="hover:bg-gray-50">
                        <td className="px-6 py-3 font-medium text-gray-900">{row.period}</td>
                        <td className="px-6 py-3 text-right text-green-600 font-semibold">{money(Number(row.revenue))}</td>
                        <td className="px-6 py-3 text-right text-gray-600">{row.count}</td>
                        <td className="px-6 py-3 text-right text-gray-600">
                          {row.count > 0 ? money(Number(row.revenue) / row.count) : '—'}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-6 py-3 text-gray-900">{t('reports:revenue.total')}</td>
                      <td className="px-6 py-3 text-right text-green-700">{money(summary.totalRevenue)}</td>
                      <td className="px-6 py-3 text-right text-gray-900">{summary.totalCount}</td>
                      <td className="px-6 py-3 text-right text-gray-900">{money(summary.avgPerPayment)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {byPeriod.length === 0 && !loading && (
            <div className="card p-12 text-center text-gray-400">
              <BarChart2 size={40} className="mx-auto mb-3 opacity-30" />
              <p>{t('reports:revenue.empty')}</p>
            </div>
          )}
        </div>
      )}

      {/* Patient Sources Tab */}
      {!loading && tab === 'sources' && sourcesData && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card p-5 bg-gradient-to-br from-violet-500 to-violet-600 text-white border-none lg:col-span-2">
              <p className="text-violet-100 text-sm mb-1">{t('reports:sources.totalPatientsInRange')}</p>
              <p className="text-3xl font-bold">{sourcesData.total}</p>
              <p className="text-violet-200 text-xs mt-1">{t('reports:sources.sourceCount', { count: sourcesData.sources?.length || 0 })}</p>
            </div>
            {sourcesData.sources?.slice(0, 2).map((s: any, i: number) => (
              <div key={s.source} className="card p-5">
                <p className="text-xs text-gray-500 mb-1">{t('reports:sources.rankedSource', { rank: i + 1 })}</p>
                <p className="text-xl font-bold text-gray-900">{sourceLabel(s.source)}</p>
                <p className="text-2xl font-bold mt-1" style={{ color: COLORS[i % COLORS.length] }}>{s.count}</p>
                <p className="text-xs text-gray-400">{t('reports:sources.patients')}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie chart: patient count distribution */}
            <div className="card p-6">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Users size={18} className="text-violet-500" />{t('reports:sources.patientDistribution')}
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={sourcesData.sources}
                    dataKey="count"
                    nameKey="source"
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    label={({ source, percent }: any) =>
                      percent > 0.03 ? `${sourceLabel(source)} ${(percent * 100).toFixed(0)}%` : ''
                    }
                    labelLine={false}
                  >
                    {sourcesData.sources.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any, name: any) => [t('reports:sources.patientCountValue', { count: v as number }), sourceLabel(name as string)]} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Bar chart: revenue per source */}
            {sourcesData.sources?.some((s: any) => s.revenue > 0) && (
              <div className="card p-6">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                  <DollarSign size={18} className="text-emerald-500" />{t('reports:sources.revenueBySource')}
                </h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={sourcesData.sources.filter((s: any) => s.revenue > 0)} layout="vertical"
                    margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                    <YAxis type="category" dataKey="source" tick={{ fontSize: 11 }}
                      tickFormatter={(v) => sourceLabel(v)} width={90} />
                    <Tooltip formatter={(v: any) => [money(v as number), t('reports:revenue.revenue')]} />
                    <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                      {sourcesData.sources.map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Detail Table */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-semibold text-gray-900 dark:text-white">{t('reports:sources.detailTable')}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    <th className="px-6 py-3 font-medium text-gray-500 pl-6">#</th>
                    <th className="px-6 py-3 font-medium text-gray-500">{t('reports:sources.source')}</th>
                    <th className="px-6 py-3 font-medium text-gray-500 text-right">{t('reports:sources.patientCount')}</th>
                    <th className="px-6 py-3 font-medium text-gray-500 text-right">{t('reports:sources.share')}</th>
                    <th className="px-6 py-3 font-medium text-gray-500 text-right pr-6">{t('reports:revenue.revenue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {sourcesData.sources.map((s: any, i: number) => (
                    <tr key={s.source} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-6 py-3 pl-6">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                          style={{ background: COLORS[i % COLORS.length] }}>
                          {i + 1}
                        </div>
                      </td>
                      <td className="px-6 py-3 font-semibold text-gray-900 dark:text-white">
                        {sourceLabel(s.source)}
                      </td>
                      <td className="px-6 py-3 text-right font-bold text-gray-900 dark:text-white">{s.count}</td>
                      <td className="px-6 py-3 text-right text-gray-500">
                        {sourcesData.total > 0 ? `%${Math.round(s.count / sourcesData.total * 100)}` : '—'}
                      </td>
                      <td className="px-6 py-3 text-right text-emerald-600 font-semibold pr-6">
                        {s.revenue > 0 ? money(s.revenue) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {!loading && tab === 'sources' && !sourcesData && (
        <div className="card p-12 text-center text-gray-400">
          <Megaphone size={40} className="mx-auto mb-3 opacity-30" />
          <p>{t('reports:empty.prompt', { button: t('reports:filters.runReport') })}</p>
        </div>
      )}

      {/* No-Show Analysis Tab */}
      {!loading && tab === 'noshow' && noShowData && (
        <div className="space-y-6">
          {/* Summary cards */}
          {(() => {
            const totalNoShows = noShowData.monthlyTrend.reduce((s: number, m: any) => s + Number(m.no_shows), 0);
            const totalAppts = noShowData.monthlyTrend.reduce((s: number, m: any) => s + Number(m.total), 0);
            const totalCancellations = noShowData.monthlyTrend.reduce((s: number, m: any) => s + Number(m.cancellations), 0);
            const overallRate = totalAppts > 0 ? Math.round(totalNoShows / totalAppts * 100) : 0;
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card p-5 bg-gradient-to-br from-red-500 to-red-600 text-white border-none">
                  <p className="text-red-100 text-sm mb-1">{t('reports:noshow.totalNoShow')}</p>
                  <p className="text-3xl font-bold">{totalNoShows}</p>
                </div>
                <div className="card p-5">
                  <p className="text-gray-500 text-sm mb-1">{t('reports:noshow.noShowRate')}</p>
                  <p className={`text-3xl font-bold ${overallRate > 20 ? 'text-red-600' : overallRate > 10 ? 'text-amber-500' : 'text-green-600'}`}>
                    %{overallRate}
                  </p>
                </div>
                <div className="card p-5">
                  <p className="text-gray-500 text-sm mb-1">{t('reports:noshow.cancellationCount')}</p>
                  <p className="text-3xl font-bold text-orange-500">{totalCancellations}</p>
                </div>
                <div className="card p-5">
                  <p className="text-gray-500 text-sm mb-1">{t('reports:noshow.totalAppointments')}</p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">{totalAppts}</p>
                </div>
              </div>
            );
          })()}

          {/* Monthly trend */}
          {noShowData.monthlyTrend.length > 0 && (
            <div className="card p-6">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <TrendingUp size={18} className="text-red-500" />{t('reports:noshow.monthlyTrend')}
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={noShowData.monthlyTrend.map((m: any) => ({
                  month: m.month,
                  no_shows: Number(m.no_shows),
                  cancellations: Number(m.cancellations),
                  rate: Number(m.total) > 0 ? Math.round(Number(m.no_shows) / Number(m.total) * 100) : 0,
                }))} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={v => `%${v}`} />
                  <Tooltip formatter={(v: any, name: any) => {
                    if (name === 'rate') return [`%${v}`, t('reports:noshow.noShowRate')];
                    if (name === 'no_shows') return [v, t('reports:noshow.noShow')];
                    if (name === 'cancellations') return [v, t('reports:noshow.cancelled')];
                    return [v, name];
                  }} />
                  <Legend formatter={(v) => v === 'no_shows' ? t('reports:noshow.noShow') : v === 'cancellations' ? t('reports:noshow.cancelled') : t('reports:noshow.ratePercent')} />
                  <Bar yAxisId="left" dataKey="no_shows" fill="#EF4444" radius={[4, 4, 0, 0]} name="no_shows" />
                  <Bar yAxisId="left" dataKey="cancellations" fill="#F97316" radius={[4, 4, 0, 0]} name="cancellations" />
                  <Line yAxisId="right" type="monotone" dataKey="rate" stroke="#8B5CF6" strokeWidth={2} dot={false} name="rate" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By day of week */}
            {noShowData.byDayOfWeek.length > 0 && (
              <div className="card p-6">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                  <Calendar size={18} className="text-indigo-500" />{t('reports:noshow.byDay')}
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={noShowData.byDayOfWeek.map((d: any) => ({
                    day: dayLabel(d.day_of_week),
                    no_shows: Number(d.no_shows),
                    rate: Number(d.total) > 0 ? Math.round(Number(d.no_shows) / Number(d.total) * 100) : 0,
                  }))} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any, name: any) => [name === 'rate' ? `%${v}` : v, name === 'rate' ? t('reports:noshow.rate') : t('reports:noshow.noShow')]} />
                    <Bar dataKey="no_shows" fill="#EF4444" radius={[4, 4, 0, 0]} name="no_shows" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* By hour */}
            {noShowData.byHour.length > 0 && (
              <div className="card p-6">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                  <Clock size={18} className="text-amber-500" />{t('reports:noshow.byHour')}
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={noShowData.byHour.map((h: any) => ({
                    hour: `${String(h.hour).padStart(2, '0')}:00`,
                    no_shows: Number(h.no_shows),
                    total: Number(h.total),
                  }))} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any, name: any) => [v, name === 'no_shows' ? t('reports:noshow.noShow') : t('reports:noshow.total')]} />
                    <Bar dataKey="total" fill="#E5E7EB" radius={[4, 4, 0, 0]} name="total" />
                    <Bar dataKey="no_shows" fill="#EF4444" radius={[4, 4, 0, 0]} name="no_shows" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* By doctor table */}
          {noShowData.byDoctor.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Users size={18} className="text-blue-500" />{t('reports:noshow.doctorRate')}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      <th className="px-6 py-3 font-medium text-gray-500 pl-6">{t('reports:noshow.doctor')}</th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-right">{t('reports:noshow.total')}</th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-right">{t('reports:noshow.noShow')}</th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-right">{t('reports:noshow.cancelled')}</th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-right pr-6">{t('reports:noshow.noShowRate')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {noShowData.byDoctor.map((doc: any) => (
                      <tr key={doc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-6 py-4 pl-6">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-700 font-bold text-xs">
                              {doc.firstName[0]}{doc.lastName[0]}
                            </div>
                            <span className="font-semibold text-gray-900 dark:text-white">Dr. {doc.firstName} {doc.lastName}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right text-gray-600 dark:text-gray-400">{doc.total}</td>
                        <td className="px-6 py-4 text-right font-semibold text-red-600">{doc.noShows}</td>
                        <td className="px-6 py-4 text-right text-orange-500">{doc.cancellations}</td>
                        <td className="px-6 py-4 text-right pr-6">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            doc.noShowRate > 20 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                            doc.noShowRate > 10 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                            'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          }`}>
                            %{doc.noShowRate}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
      {!loading && tab === 'noshow' && !noShowData && (
        <div className="card p-12 text-center text-gray-400">
          <UserMinus size={40} className="mx-auto mb-3 opacity-30" />
          <p>{t('reports:empty.prompt', { button: t('reports:filters.runReport') })}</p>
        </div>
      )}

      {/* Doctor Performance Tab */}
      {!loading && tab === 'doctors' && doctorData && (
        <div className="space-y-4">
          {doctorData.doctors.length === 0 ? (
            <div className="card p-12 text-center text-gray-400">
              <Users size={40} className="mx-auto mb-3 opacity-30" />
              <p>{t('reports:doctors.empty')}</p>
            </div>
          ) : (
            doctorData.doctors.map((doc: any) => (
              <div key={doc.id} className="card p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-700 font-bold text-lg">
                      {doc.firstName[0]}{doc.lastName[0]}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">Dr. {doc.firstName} {doc.lastName}</h3>
                      <p className="text-sm text-gray-500">{t('reports:doctors.commissionRate', { rate: doc.commissionRate })}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-gray-400">{t('reports:doctors.totalRevenue')}</p>
                      <p className="font-bold text-green-600 text-lg">{money(doc.metrics.revenue)}</p>
                    </div>
                    {doc.commissionRate > 0 && (
                      <div className="text-right">
                        <p className="text-xs text-gray-400">{t('reports:doctors.commission')}</p>
                        <p className="font-bold text-purple-600">{money(doc.metrics.commissionAmount)}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: t('reports:doctors.totalAppointments'), value: doc.metrics.appointmentCount, icon: Calendar, color: 'text-blue-600' },
                    { label: t('reports:doctors.completed'), value: doc.metrics.completedAppointments, icon: ChevronRight, color: 'text-green-600' },
                    { label: t('reports:doctors.noShow'), value: doc.metrics.noShowCount, icon: AlertCircle, color: 'text-red-500' },
                    { label: t('reports:doctors.completionRate'), value: `%${doc.metrics.completionRate}`, icon: Award, color: 'text-amber-600' },
                  ].map(stat => (
                    <div key={stat.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
                      <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
                    </div>
                  ))}
                </div>
                {(doc.metrics.treatmentCasesOpened > 0 || doc.metrics.treatmentCasesCompleted > 0) && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 text-sm text-gray-500">
                    <span>{t('reports:doctors.openedTreatment')}: <strong className="text-gray-900">{doc.metrics.treatmentCasesOpened}</strong></span>
                    <span>{t('reports:doctors.completed')}: <strong className="text-gray-900">{doc.metrics.treatmentCasesCompleted}</strong></span>
                    {doc.metrics.revenueCount > 0 && (
                      <span>{t('reports:doctors.avgPayment')}: <strong className="text-gray-900">{money(doc.metrics.avgRevenuePerAppointment)}</strong></span>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default Reports;
