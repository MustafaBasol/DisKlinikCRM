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
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { reportService, userService } from '../services/api';
import { useAuth } from '../context/AuthContext';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Nakit',
  card: 'Kart',
  bank_transfer: 'Havale/EFT',
  cheque: 'Çek',
  other: 'Diğer',
  insurance: 'Sigorta',
};

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#6B7280'];

function formatCurrency(amount: number, currency = 'TRY') {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(amount);
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
  const { t } = useTranslation(['common']);
  const { user } = useAuth();
  const [tab, setTab] = useState<'revenue' | 'doctors'>('revenue');
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
      setError('Rapor yüklenemedi.');
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
      setError('Hekim raporu yüklenemedi.');
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
  }, []); // eslint-disable-line

  const handleSearch = () => {
    if (tab === 'revenue') loadRevenue();
    else loadDoctors();
  };

  React.useEffect(() => {
    if (tab === 'doctors' && !doctorData) loadDoctors();
  }, [tab]); // eslint-disable-line

  const handleExportCSV = () => {
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (practitionerId) params.set('practitionerId', practitionerId);
    if (paymentMethod) params.set('paymentMethod', paymentMethod);
    const token = localStorage.getItem('hcrm_token');
    const url = `/api/reports/revenue/export.csv?${params.toString()}`;
    // Use fetch to include auth header, then trigger download
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `gelir-raporu-${dateFrom}-${dateTo}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  const summary = revenueData?.summary;
  const byPeriod = revenueData?.byPeriod || [];
  const byMethod = revenueData?.byMethod || [];
  const byPractitioner = revenueData?.byPractitioner || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Raporlar</h1>
          <p className="text-gray-500 mt-1">Gelir analizi ve hekim performansı</p>
        </div>
        {tab === 'revenue' && revenueData && (
          <button onClick={handleExportCSV} className="btn-secondary flex items-center gap-2 shrink-0">
            <Download size={16} />
            CSV İndir
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
        <button
          onClick={() => setTab('revenue')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'revenue' ? 'bg-white dark:bg-gray-700 shadow text-primary-600' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center gap-2"><TrendingUp size={16} />Gelir Raporu</span>
        </button>
        <button
          onClick={() => setTab('doctors')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'doctors' ? 'bg-white dark:bg-gray-700 shadow text-primary-600' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center gap-2"><Users size={16} />Hekim Performansı</span>
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">Başlangıç Tarihi</label>
            <input type="date" className="input-field" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">Bitiş Tarihi</label>
            <input type="date" className="input-field" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          {tab === 'revenue' && (
            <>
              <div>
                <label className="label">Gruplama</label>
                <select className="input-field" value={groupBy} onChange={e => setGroupBy(e.target.value as any)}>
                  <option value="day">Günlük</option>
                  <option value="week">Haftalık</option>
                  <option value="month">Aylık</option>
                </select>
              </div>
              <div>
                <label className="label">Ödeme Yöntemi</label>
                <select className="input-field" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  <option value="">Tümü</option>
                  {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Hekim</label>
                <select className="input-field" value={practitionerId} onChange={e => setPractitionerId(e.target.value)}>
                  <option value="">Tüm Hekimler</option>
                  {doctors.map(d => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}
                </select>
              </div>
            </>
          )}
          <div className="flex items-end">
            <button onClick={handleSearch} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <BarChart2 size={16} />}
              Raporu Getir
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
                <p className="text-green-100 text-sm">Toplam Gelir</p>
                <DollarSign size={20} className="text-green-200" />
              </div>
              <p className="text-2xl font-bold">{formatCurrency(summary.totalRevenue)}</p>
              <p className="text-green-100 text-xs mt-1">{summary.totalCount} ödeme</p>
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-gray-500 text-sm">Ortalama Ödeme</p>
                <TrendingUp size={20} className="text-blue-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(summary.avgPerPayment)}</p>
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-gray-500 text-sm">Bekleyen Tahsilat</p>
                <Clock size={20} className="text-amber-500" />
              </div>
              <p className="text-2xl font-bold text-amber-600">{formatCurrency(summary.pendingAmount)}</p>
              <p className="text-gray-400 text-xs mt-1">{summary.pendingCount} bekleyen</p>
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-gray-500 text-sm">Ödeme Sayısı</p>
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
                Dönemsel Gelir
              </h3>
              <div className="overflow-x-auto">
                <div style={{ minWidth: Math.max(400, byPeriod.length * 60) }}>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={byPeriod} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Bar dataKey="revenue" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Gelir" />
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
                <h3 className="font-semibold text-gray-900 mb-4">Ödeme Yöntemi Dağılımı</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={byMethod} dataKey="revenue" nameKey="method" cx="50%" cy="50%"
                      outerRadius={80} label={({ method, percent }) => `${METHOD_LABELS[method] || method} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {byMethod.map((_: any, index: number) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number, name: string) => [formatCurrency(v), METHOD_LABELS[name] || name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-3 space-y-1">
                  {byMethod.map((m: any, i: number) => (
                    <div key={m.method} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="text-gray-600">{METHOD_LABELS[m.method] || m.method}</span>
                      </div>
                      <span className="font-semibold text-gray-900">{formatCurrency(m.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* By Practitioner */}
            {byPractitioner.length > 0 && (
              <div className="card p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Hekim Bazlı Gelir</h3>
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
                        <p className="font-semibold text-gray-900 text-sm">{formatCurrency(d.revenue)}</p>
                        <p className="text-xs text-gray-400">{d.count} ödeme</p>
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
                <h3 className="font-semibold text-gray-900">Detay Tablosu</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 font-medium text-gray-500">Dönem</th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-right">Gelir</th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-right">Ödeme Sayısı</th>
                      <th className="px-6 py-3 font-medium text-gray-500 text-right">Ortalama</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {byPeriod.map((row: any) => (
                      <tr key={row.period} className="hover:bg-gray-50">
                        <td className="px-6 py-3 font-medium text-gray-900">{row.period}</td>
                        <td className="px-6 py-3 text-right text-green-600 font-semibold">{formatCurrency(Number(row.revenue))}</td>
                        <td className="px-6 py-3 text-right text-gray-600">{row.count}</td>
                        <td className="px-6 py-3 text-right text-gray-600">
                          {row.count > 0 ? formatCurrency(Number(row.revenue) / row.count) : '—'}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-6 py-3 text-gray-900">Toplam</td>
                      <td className="px-6 py-3 text-right text-green-700">{formatCurrency(summary.totalRevenue)}</td>
                      <td className="px-6 py-3 text-right text-gray-900">{summary.totalCount}</td>
                      <td className="px-6 py-3 text-right text-gray-900">{formatCurrency(summary.avgPerPayment)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {byPeriod.length === 0 && !loading && (
            <div className="card p-12 text-center text-gray-400">
              <BarChart2 size={40} className="mx-auto mb-3 opacity-30" />
              <p>Seçili tarih aralığında tahsilat kaydı bulunamadı.</p>
            </div>
          )}
        </div>
      )}

      {/* Doctor Performance Tab */}
      {!loading && tab === 'doctors' && doctorData && (
        <div className="space-y-4">
          {doctorData.doctors.length === 0 ? (
            <div className="card p-12 text-center text-gray-400">
              <Users size={40} className="mx-auto mb-3 opacity-30" />
              <p>Aktif hekim bulunamadı.</p>
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
                      <p className="text-sm text-gray-500">Komisyon oranı: %{doc.commissionRate}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Toplam Gelir</p>
                      <p className="font-bold text-green-600 text-lg">{formatCurrency(doc.metrics.revenue)}</p>
                    </div>
                    {doc.commissionRate > 0 && (
                      <div className="text-right">
                        <p className="text-xs text-gray-400">Komisyon</p>
                        <p className="font-bold text-purple-600">{formatCurrency(doc.metrics.commissionAmount)}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Toplam Randevu', value: doc.metrics.appointmentCount, icon: Calendar, color: 'text-blue-600' },
                    { label: 'Tamamlanan', value: doc.metrics.completedAppointments, icon: ChevronRight, color: 'text-green-600' },
                    { label: 'No-Show', value: doc.metrics.noShowCount, icon: AlertCircle, color: 'text-red-500' },
                    { label: 'Tamamlanma %', value: `%${doc.metrics.completionRate}`, icon: Award, color: 'text-amber-600' },
                  ].map(stat => (
                    <div key={stat.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
                      <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
                    </div>
                  ))}
                </div>
                {(doc.metrics.treatmentCasesOpened > 0 || doc.metrics.treatmentCasesCompleted > 0) && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 text-sm text-gray-500">
                    <span>Açılan Tedavi: <strong className="text-gray-900">{doc.metrics.treatmentCasesOpened}</strong></span>
                    <span>Tamamlanan: <strong className="text-gray-900">{doc.metrics.treatmentCasesCompleted}</strong></span>
                    {doc.metrics.revenueCount > 0 && (
                      <span>Ort. Ödeme: <strong className="text-gray-900">{formatCurrency(doc.metrics.avgRevenuePerAppointment)}</strong></span>
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
