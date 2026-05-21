import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, TrendingUp, Calendar, Users, CreditCard,
  AlertCircle, Activity, BarChart2, Award, ArrowUpRight,
  Clock, ChevronUp, ChevronDown, CheckCircle, XCircle,
  TrendingDown, Stethoscope,
} from 'lucide-react';
import api from '../services/api';
import { useClinic } from '../context/ClinicContext';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

type Range = 'today' | 'this_week' | 'this_month' | 'last_30_days' | 'custom';

interface ClinicMetric {
  clinicId: string;
  clinicName: string;
  clinicSlug: string;
  status: string;
  address: string | null;
  todayAppointments: number;
  appointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowRate: number;
  totalPatients: number;
  newPatients: number;
  revenue: number;
  collectedPayments: number;
  outstandingBalance: number;
  activeTreatmentPlans: number;
  completedTreatments: number;
  staffCount: number;
  doctorCount: number;
}

interface Summary {
  totalClinics: number;
  activeClinics: number;
  todayAppointments: number;
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  monthlyRevenue: number;
  collectedPayments: number;
  outstandingBalance: number;
  newPatients: number;
  activeTreatmentPlans: number;
  completedTreatmentCases: number;
  averageNoShowRate: number;
  staffCount: number;
}

interface Insight {
  clinicId: string;
  clinicName: string;
  value: number;
}

interface Insights {
  topRevenueClinic: Insight | null;
  lowestRevenueClinic: Insight | null;
  highestAppointmentClinic: Insight | null;
  highestOutstandingBalanceClinic: Insight | null;
  highestNoShowClinic: Insight | null;
  topNewPatientClinic: Insight | null;
}

interface OrgDashboardData {
  summary: Summary;
  clinics: ClinicMetric[];
  insights: Insights;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('tr-TR');

const fmtCurrency = (n: number, currency = 'TRY') =>
  new Intl.NumberFormat('tr-TR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

// noShowRate API'den 0–1 ondalık gelir (ör. 0.057 = %5.7)
const fmtPct = (r: number) => `%${(r * 100).toFixed(1)}`;

type SortKey = keyof Pick<ClinicMetric,
  'appointments' | 'revenue' | 'outstandingBalance' | 'newPatients' | 'noShowRate' | 'completedAppointments'>;

const STATUS_BADGE: Record<string, string> = {
  active:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  trial:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  suspended: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Aktif', trial: 'Deneme', suspended: 'Askıya Alındı', cancelled: 'İptal',
};

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

const SummaryCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  sub?: string;
}> = ({ icon, label, value, color, sub }) => (
  <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-700 flex items-center gap-4">
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">{label}</p>
      <p className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-0.5">{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  </div>
);

const InsightCard: React.FC<{
  label: string;
  clinic: Insight | null;
  value: string;
  icon: React.ReactNode;
}> = ({ label, clinic, value, icon }) => (
  <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-gray-100 dark:border-gray-700">
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
    </div>
    {clinic ? (
      <>
        <p className="font-bold text-gray-900 dark:text-gray-100 truncate">{clinic.clinicName}</p>
        <p className="text-sm text-primary-600 dark:text-primary-400 font-medium mt-0.5">{value}</p>
      </>
    ) : (
      <p className="text-sm text-gray-400">—</p>
    )}
  </div>
);

// ────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────

const OrganizationDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { setSelectedClinicId } = useClinic();

  const [range, setRange] = useState<Range>('this_month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<OrgDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortAsc, setSortAsc] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { range };
      if (range === 'custom') {
        if (from) params.from = from;
        if (to) params.to = to;
      }
      const res = await api.get('/organization/dashboard', { params });
      setData(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [range, from, to]);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const goTo = (clinicId: string, path: string) => {
    setSelectedClinicId(clinicId);
    navigate(path);
  };

  const sortedClinics = data
    ? [...data.clinics].sort((a, b) => {
        const diff = (a[sortKey] as number) - (b[sortKey] as number);
        return sortAsc ? diff : -diff;
      })
    : [];

  const SortBtn: React.FC<{ k: SortKey; label: string }> = ({ k, label }) => (
    <button
      onClick={() => handleSort(k)}
      className="flex items-center gap-1 hover:text-primary-600 transition-colors whitespace-nowrap"
    >
      {label}
      {sortKey === k
        ? (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
        : <ChevronDown size={12} className="text-gray-300" />}
    </button>
  );

  const s = data?.summary;
  const ins = data?.insights;

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* Başlık + Filtreler */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Building2 size={24} className="text-primary-500" /> Organizasyon Panosu
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Tüm klinik şubeleri özet görünümü</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['today', 'this_week', 'this_month', 'last_30_days', 'custom'] as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                range === r
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-primary-50'
              }`}
            >
              {{ today: 'Bugün', this_week: 'Bu Hafta', this_month: 'Bu Ay', last_30_days: 'Son 30 Gün', custom: 'Özel' }[r]}
            </button>
          ))}
          {range === 'custom' && (
            <>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200" />
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200" />
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-xl border border-red-100 dark:border-red-800">
          <AlertCircle size={18} /> <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Activity size={24} className="animate-spin mr-3" /> Yükleniyor…
        </div>
      )}

      {s && (
        <>
          {/* ── Özet Kartları ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard
              icon={<Building2 size={20} className="text-white" />}
              label="Şube"
              value={fmt(s.totalClinics)}
              sub={`${s.activeClinics} aktif`}
              color="bg-primary-500"
            />
            <SummaryCard
              icon={<Calendar size={20} className="text-white" />}
              label="Bugünkü Randevu"
              value={fmt(s.todayAppointments)}
              color="bg-blue-500"
            />
            <SummaryCard
              icon={<CheckCircle size={20} className="text-white" />}
              label="Tamamlanan"
              value={fmt(s.completedAppointments)}
              sub={`${fmt(s.totalAppointments)} toplam`}
              color="bg-indigo-500"
            />
            <SummaryCard
              icon={<CreditCard size={20} className="text-white" />}
              label="Dönem Geliri"
              value={fmtCurrency(s.monthlyRevenue)}
              color="bg-green-500"
            />
            <SummaryCard
              icon={<AlertCircle size={20} className="text-white" />}
              label="Bekleyen Bakiye"
              value={fmtCurrency(s.outstandingBalance)}
              color="bg-orange-500"
            />
            <SummaryCard
              icon={<Users size={20} className="text-white" />}
              label="Yeni Hasta"
              value={fmt(s.newPatients)}
              color="bg-pink-500"
            />
            <SummaryCard
              icon={<TrendingUp size={20} className="text-white" />}
              label="Aktif Tedavi"
              value={fmt(s.activeTreatmentPlans)}
              sub={`${fmt(s.completedTreatmentCases)} tamamlandı`}
              color="bg-purple-500"
            />
            <SummaryCard
              icon={<Clock size={20} className="text-white" />}
              label="Ort. No-Show"
              value={fmtPct(s.averageNoShowRate)}
              sub={`${fmt(s.cancelledAppointments)} iptal`}
              color="bg-red-500"
            />
          </div>

          {/* ── İçgörüler ── */}
          {ins && (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <InsightCard
                label="En Yüksek Gelir"
                clinic={ins.topRevenueClinic}
                value={ins.topRevenueClinic ? fmtCurrency(ins.topRevenueClinic.value) : '—'}
                icon={<Award size={16} className="text-yellow-500" />}
              />
              <InsightCard
                label="En Düşük Gelir"
                clinic={ins.lowestRevenueClinic}
                value={ins.lowestRevenueClinic ? fmtCurrency(ins.lowestRevenueClinic.value) : '—'}
                icon={<TrendingDown size={16} className="text-gray-400" />}
              />
              <InsightCard
                label="En Çok Randevu"
                clinic={ins.highestAppointmentClinic}
                value={ins.highestAppointmentClinic ? fmt(ins.highestAppointmentClinic.value) : '—'}
                icon={<BarChart2 size={16} className="text-blue-500" />}
              />
              <InsightCard
                label="En Yüksek Bakiye"
                clinic={ins.highestOutstandingBalanceClinic}
                value={ins.highestOutstandingBalanceClinic ? fmtCurrency(ins.highestOutstandingBalanceClinic.value) : '—'}
                icon={<AlertCircle size={16} className="text-orange-500" />}
              />
              <InsightCard
                label="En Yüksek No-Show"
                clinic={ins.highestNoShowClinic}
                value={ins.highestNoShowClinic ? fmtPct(ins.highestNoShowClinic.value) : '—'}
                icon={<Clock size={16} className="text-red-500" />}
              />
              <InsightCard
                label="En Çok Yeni Hasta"
                clinic={ins.topNewPatientClinic}
                value={ins.topNewPatientClinic ? fmt(ins.topNewPatientClinic.value) : '—'}
                icon={<Users size={16} className="text-pink-500" />}
              />
            </div>
          )}

          {/* ── Şube Karşılaştırma Tablosu ── */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <Building2 size={18} className="text-primary-500" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Şube Karşılaştırması</h2>
              {loading && <Activity size={14} className="animate-spin text-gray-400 ml-auto" />}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Şube</th>
                    <th className="px-4 py-3 text-left">Durum</th>
                    <th className="px-4 py-3 text-right"><SortBtn k="appointments" label="Randevu" /></th>
                    <th className="px-4 py-3 text-right"><SortBtn k="completedAppointments" label="Tamam" /></th>
                    <th className="px-4 py-3 text-right text-gray-400">İptal</th>
                    <th className="px-4 py-3 text-right"><SortBtn k="noShowRate" label="No-Show" /></th>
                    <th className="px-4 py-3 text-right"><SortBtn k="newPatients" label="Yeni Hasta" /></th>
                    <th className="px-4 py-3 text-right"><SortBtn k="revenue" label="Gelir" /></th>
                    <th className="px-4 py-3 text-right"><SortBtn k="outstandingBalance" label="Bakiye" /></th>
                    <th className="px-4 py-3 text-right text-gray-400">Tedavi</th>
                    <th className="px-4 py-3 text-right text-gray-400">Personel</th>
                    <th className="px-4 py-3 text-center">İşlemler</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedClinics.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-4 py-10 text-center text-gray-400 text-sm">
                        Veri bulunamadı
                      </td>
                    </tr>
                  )}
                  {sortedClinics.map((c, i) => (
                    <tr
                      key={c.clinicId}
                      className={`border-t border-gray-50 dark:border-gray-700 hover:bg-primary-50/30 dark:hover:bg-primary-900/10 transition-colors ${
                        i % 2 === 0 ? '' : 'bg-gray-50/40 dark:bg-gray-700/10'
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">
                        <div className="flex flex-col">
                          <span className="flex items-center gap-1.5">
                            <Building2 size={13} className="text-gray-400 shrink-0" />
                            {c.clinicName}
                          </span>
                          {c.address && (
                            <span className="text-xs text-gray-400 mt-0.5 pl-5 truncate max-w-[160px]">{c.address}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABEL[c.status] ?? c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                        {fmt(c.appointments)}
                      </td>
                      <td className="px-4 py-3 text-right text-green-600 dark:text-green-400">
                        {fmt(c.completedAppointments)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400">
                        {fmt(c.cancelledAppointments)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold text-xs ${
                          c.noShowRate > 0.2 ? 'text-red-600' :
                          c.noShowRate > 0.1 ? 'text-orange-500' :
                          'text-gray-600 dark:text-gray-400'
                        }`}>
                          {fmtPct(c.noShowRate)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                        {fmt(c.newPatients)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-green-600 dark:text-green-400">
                        {fmtCurrency(c.revenue)}
                      </td>
                      <td className="px-4 py-3 text-right text-orange-600 dark:text-orange-400">
                        {fmtCurrency(c.outstandingBalance)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                        <span className="text-purple-600 dark:text-purple-400 font-medium">{fmt(c.activeTreatmentPlans)}</span>
                        <span className="text-gray-300 mx-1">/</span>
                        {fmt(c.completedTreatments)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-xs">
                        <span className="flex items-center justify-end gap-1">
                          <Stethoscope size={11} className="text-indigo-400" />
                          {fmt(c.doctorCount)}
                          <span className="text-gray-300 mx-0.5">/</span>
                          {fmt(c.staffCount)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {/* Şube Panosu */}
                          <button
                            onClick={() => goTo(c.clinicId, '/')}
                            title="Şube Panosu"
                            className="p-1.5 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/30 text-primary-600 transition-colors"
                          >
                            <ArrowUpRight size={14} />
                          </button>
                          {/* Randevular */}
                          <button
                            onClick={() => goTo(c.clinicId, '/appointments')}
                            title="Randevular"
                            className="p-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-500 transition-colors"
                          >
                            <Calendar size={14} />
                          </button>
                          {/* Hastalar */}
                          <button
                            onClick={() => goTo(c.clinicId, '/patients')}
                            title="Hastalar"
                            className="p-1.5 rounded-lg hover:bg-pink-100 dark:hover:bg-pink-900/30 text-pink-500 transition-colors"
                          >
                            <Users size={14} />
                          </button>
                          {/* Ödemeler */}
                          <button
                            onClick={() => goTo(c.clinicId, '/payments')}
                            title="Ödemeler"
                            className="p-1.5 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 transition-colors"
                          >
                            <CreditCard size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default OrganizationDashboard;
