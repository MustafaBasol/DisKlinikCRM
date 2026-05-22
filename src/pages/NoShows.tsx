import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserX,
  RefreshCw,
  CheckSquare,
  Calendar,
  TrendingDown,
  Phone,
  Building2,
  Stethoscope,
  AlertTriangle,
  CheckCircle2,
  MessageCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { noShowService } from '../services/api';
import {
  canViewNoShowDashboard,
  canManageNoShows,
  canSendNoShowRecoveryMessage,
  canCreateNoShowFollowUpTask,
} from '../utils/permissions';
import { useClinic } from '../context/ClinicContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NoShowSummary {
  noShowCount: number;
  noShowRate: number;
  estimatedLostRevenue: number;
  contactedCount: number;
  recoveredCount: number;
  recoveryRate: number;
}

interface ByClinicRow {
  clinicId: string;
  clinicName: string;
  noShowCount: number;
  totalAppointments: number;
  noShowRate: number;
  estimatedLostRevenue: number;
}

interface ByDoctorRow {
  doctorId: string;
  doctorName: string;
  noShowCount: number;
  totalAppointments: number;
  noShowRate: number;
}

interface RecentNoShow {
  appointmentId: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  clinicName: string;
  practitionerId: string | null;
  doctorName: string;
  appointmentTypeId: string | null;
  date: string;
  time: string;
  serviceName: string | null;
  estimatedValue: number;
  currency: string | null;
  recoveryStatus: 'unresolved' | 'contacted' | 'recovered';
  lastContactAt: string | null;
}

interface DashboardData {
  summary: NoShowSummary;
  byClinic: ByClinicRow[];
  byDoctor: ByDoctorRow[];
  recentNoShows: RecentNoShow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function RecoveryBadge({ status }: { status: string }) {
  if (status === 'recovered') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
        <CheckCircle2 className="w-3 h-3" /> Geri Kazanıldı
      </span>
    );
  }
  if (status === 'contacted') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
        <Phone className="w-3 h-3" /> İletişime Geçildi
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
      <AlertTriangle className="w-3 h-3" /> Bekliyor
    </span>
  );
}

function fmtDate(dateStr: string, timeStr?: string) {
  try {
    const d = new Date(dateStr + (timeStr ? `T${timeStr}` : ''));
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function fmtCurrency(value: number, currency?: string | null) {
  if (!value) return '—';
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: currency ?? 'TRY',
    minimumFractionDigits: 0,
  }).format(value);
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  title,
  value,
  subtitle,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500 dark:text-gray-400">{title}</span>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>{icon}</div>
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
      {subtitle && <div className="text-xs text-gray-400 mt-1">{subtitle}</div>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NoShows() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { selectedClinicId } = useClinic();

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<string>('last_30_days');
  const [doctorFilter, setDoctorFilter] = useState<string>('');
  const [recoveryFilter, setRecoveryFilter] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const canManage = canManageNoShows(user);
  const canSendMsg = canSendNoShowRecoveryMessage(user);
  const canCreateTask = canCreateNoShowFollowUpTask(user);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { range };
      if (selectedClinicId && selectedClinicId !== 'all') params.clinicId = selectedClinicId;
      if (doctorFilter) params.doctorId = doctorFilter;
      if (recoveryFilter) params.recoveryStatus = recoveryFilter;

      const { data: resp } = await noShowService.getDashboard(params);
      setData(resp);
    } catch {
      showToast('Veri yüklenirken hata oluştu.', 'error');
    } finally {
      setLoading(false);
    }
  }, [range, selectedClinicId, doctorFilter, recoveryFilter]);

  useEffect(() => {
    if (!canViewNoShowDashboard(user)) {
      navigate('/');
      return;
    }
    fetchData();
  }, [fetchData, user, navigate]);

  // Refresh when another page dispatches 'noShowRecovered' (e.g., AppointmentForm after reschedule)
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener('noShowRecovered', handler);
    return () => window.removeEventListener('noShowRecovered', handler);
  }, [fetchData]);

  const handleMarkContacted = async (appointmentId: string) => {
    setActionLoading(prev => ({ ...prev, [`contact_${appointmentId}`]: true }));
    try {
      await noShowService.updateRecoveryStatus(appointmentId, { status: 'contacted' });
      showToast('İletişim kuruldu olarak işaretlendi.');
      fetchData();
    } catch {
      showToast('İşlem başarısız.', 'error');
    } finally {
      setActionLoading(prev => ({ ...prev, [`contact_${appointmentId}`]: false }));
    }
  };

  const handleMarkRecovered = async (appointmentId: string) => {
    setActionLoading(prev => ({ ...prev, [`recover_${appointmentId}`]: true }));
    try {
      await noShowService.updateRecoveryStatus(appointmentId, { status: 'recovered' });
      showToast('Randevu kurtarıldı olarak işaretlendi.');
      fetchData();
    } catch {
      showToast('İşlem başarısız.', 'error');
    } finally {
      setActionLoading(prev => ({ ...prev, [`recover_${appointmentId}`]: false }));
    }
  };

  const handleSendWhatsApp = async (appointmentId: string) => {
    setActionLoading(prev => ({ ...prev, [`whatsapp_${appointmentId}`]: true }));
    try {
      await noShowService.sendRecoveryMessage(appointmentId);
      showToast('WhatsApp mesajı gönderildi.');
      fetchData();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Mesaj gönderilemedi.';
      showToast(msg, 'error');
    } finally {
      setActionLoading(prev => ({ ...prev, [`whatsapp_${appointmentId}`]: false }));
    }
  };

  const handleCreateTask = async (appointmentId: string) => {
    setActionLoading(prev => ({ ...prev, [`task_${appointmentId}`]: true }));
    try {
      await noShowService.createFollowUpTask(appointmentId);
      showToast('Takip görevi oluşturuldu.');
    } catch {
      showToast('Görev oluşturulamadı.', 'error');
    } finally {
      setActionLoading(prev => ({ ...prev, [`task_${appointmentId}`]: false }));
    }
  };

  if (!canViewNoShowDashboard(user)) return null;

  const summary = data?.summary;

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium flex items-center gap-2 ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/50 dark:text-green-200 dark:border-green-700'
              : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/50 dark:text-red-200 dark:border-red-700'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <UserX className="w-6 h-6 text-red-500" />
            No-show Takibi
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Randevuya gelmeyen hastaları takip edin ve yeniden randevuya kazandırın.
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={range}
          onChange={e => setRange(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          <option value="today">Bugün</option>
          <option value="this_week">Bu Hafta</option>
          <option value="this_month">Bu Ay</option>
          <option value="last_30_days">Son 30 Gün</option>
        </select>

        <select
          value={recoveryFilter}
          onChange={e => setRecoveryFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          <option value="">Tüm Durumlar</option>
          <option value="unresolved">Çözümlenmedi</option>
          <option value="contacted">İletişim Kuruldu</option>
          <option value="recovered">Kurtarıldı</option>
        </select>
      </div>

      {/* Summary Cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 h-24 animate-pulse" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <SummaryCard
            title="No-show Sayısı"
            value={summary.noShowCount}
            icon={<UserX className="w-5 h-5 text-red-600" />}
            color="bg-red-50 dark:bg-red-900/20"
          />
          <SummaryCard
            title="No-show Oranı"
            value={`${summary.noShowRate}%`}
            icon={<TrendingDown className="w-5 h-5 text-orange-600" />}
            color="bg-orange-50 dark:bg-orange-900/20"
          />
          <SummaryCard
            title="Tahmini Gelir Kaybı"
            value={fmtCurrency(summary.estimatedLostRevenue)}
            subtitle="Hizmet fiyatlarına göre"
            icon={<TrendingDown className="w-5 h-5 text-yellow-600" />}
            color="bg-yellow-50 dark:bg-yellow-900/20"
          />
          <SummaryCard
            title="İletişim Kuruldu"
            value={summary.contactedCount}
            icon={<Phone className="w-5 h-5 text-blue-600" />}
            color="bg-blue-50 dark:bg-blue-900/20"
          />
          <SummaryCard
            title="Kurtarılan Randevu"
            value={summary.recoveredCount}
            icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
            color="bg-green-50 dark:bg-green-900/20"
          />
          <SummaryCard
            title="Kurtarma Oranı"
            value={`${summary.recoveryRate}%`}
            icon={<TrendingDown className="w-5 h-5 text-teal-600" />}
            color="bg-teal-50 dark:bg-teal-900/20"
          />
        </div>
      ) : null}

      {/* By Clinic & By Doctor */}
      {!loading && data && (data.byClinic.length > 0 || data.byDoctor.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* By Clinic */}
          {data.byClinic.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-gray-500" /> Şubeye Göre
              </h2>
              <div className="space-y-3">
                {data.byClinic.map(row => (
                  <div key={row.clinicId} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300 truncate max-w-[160px]">{row.clinicName}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-red-600">{row.noShowCount}</span>
                      <span className="text-gray-400">/ {row.totalAppointments}</span>
                      <span className="text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded">
                        %{row.noShowRate}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By Doctor */}
          {data.byDoctor.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-gray-500" /> Doktora Göre
              </h2>
              <div className="space-y-3">
                {data.byDoctor.map(row => (
                  <div key={row.doctorId} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300 truncate max-w-[160px]">{row.doctorName}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-red-600">{row.noShowCount}</span>
                      <span className="text-gray-400">/ {row.totalAppointments}</span>
                      <span className="text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded">
                        %{row.noShowRate}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent No-shows Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" /> Son No-show Randevular
          </h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
            Yükleniyor...
          </div>
        ) : !data || data.recentNoShows.length === 0 ? (
          <div className="p-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">
              Seçili dönemde no-show randevu bulunmuyor.
            </p>
            <p className="text-sm text-gray-400 mt-1">Bu dönemde tüm hastalar randevularına katılmış. 🎉</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  {['Hasta', 'Şube', 'Doktor', 'Tarih/Saat', 'Hizmet', 'Tahmini Değer', 'Durum', 'Son Temas', 'İşlemler'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {data.recentNoShows.map(row => (
                  <tr key={row.appointmentId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/patients/${row.patientId}`)}
                        className="font-medium text-primary-600 hover:underline text-left"
                      >
                        {row.patientName}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{row.clinicName}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{row.doctorName}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {fmtDate(row.date)} {row.time}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{row.serviceName ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {fmtCurrency(row.estimatedValue, row.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <RecoveryBadge status={row.recoveryStatus} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {row.lastContactAt
                        ? new Date(row.lastContactAt).toLocaleDateString('tr-TR')
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {/* WhatsApp */}
                        {canSendMsg && row.recoveryStatus !== 'recovered' && (
                          <button
                            title="WhatsApp Gönder"
                            disabled={!!actionLoading[`whatsapp_${row.appointmentId}`]}
                            onClick={() => handleSendWhatsApp(row.appointmentId)}
                            className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors"
                          >
                            {actionLoading[`whatsapp_${row.appointmentId}`]
                              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              : <MessageCircle className="w-3.5 h-3.5" />}
                          </button>
                        )}

                        {/* Create Task */}
                        {canCreateTask && (
                          <button
                            title="Görev Oluştur"
                            disabled={!!actionLoading[`task_${row.appointmentId}`]}
                            onClick={() => handleCreateTask(row.appointmentId)}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 transition-colors"
                          >
                            {actionLoading[`task_${row.appointmentId}`]
                              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              : <CheckSquare className="w-3.5 h-3.5" />}
                          </button>
                        )}

                        {/* Mark Contacted */}
                        {canManage && row.recoveryStatus === 'unresolved' && (
                          <button
                            title="İletişim Kuruldu"
                            disabled={!!actionLoading[`contact_${row.appointmentId}`]}
                            onClick={() => handleMarkContacted(row.appointmentId)}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 transition-colors"
                          >
                            {actionLoading[`contact_${row.appointmentId}`]
                              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              : <Phone className="w-3.5 h-3.5" />}
                          </button>
                        )}

                        {/* Mark Recovered */}
                        {canManage && row.recoveryStatus !== 'recovered' && (
                          <button
                            title="Kurtarıldı Olarak İşaretle"
                            disabled={!!actionLoading[`recover_${row.appointmentId}`]}
                            onClick={() => handleMarkRecovered(row.appointmentId)}
                            className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors"
                          >
                            {actionLoading[`recover_${row.appointmentId}`]
                              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              : <CheckCircle2 className="w-3.5 h-3.5" />}
                          </button>
                        )}

                        {/* Reschedule */}
                        {(() => {
                          const canReschedule = !!row.patientId && !!row.clinicId;
                          const buildRescheduleUrl = () => {
                            const params = new URLSearchParams({
                              source: 'no_show',
                              patientId: row.patientId,
                              clinicId: row.clinicId,
                              previousAppointmentId: row.appointmentId,
                            });
                            if (row.practitionerId) params.set('doctorId', row.practitionerId);
                            if (row.appointmentTypeId) params.set('appointmentTypeId', row.appointmentTypeId);
                            return `/appointments?${params.toString()}`;
                          };
                          return (
                            <button
                              title={canReschedule ? 'Yeniden Randevu Oluştur' : 'Hasta veya klinik bilgisi eksik.'}
                              disabled={!canReschedule}
                              onClick={() => canReschedule && navigate(buildRescheduleUrl())}
                              className={`p-1.5 rounded-lg transition-colors ${
                                canReschedule
                                  ? 'text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                                  : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                              }`}
                            >
                              <Calendar className="w-3.5 h-3.5" />
                            </button>
                          );
                        })()}
                      </div>
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
}
