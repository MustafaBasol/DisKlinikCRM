import React, { useEffect, useState } from 'react';
import { 
  Users, 
  Calendar, 
  Clock,
  TrendingUp,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  CheckSquare,
  DollarSign,
  UserMinus,
  MessageSquare,
  Briefcase,
  ChevronRight,
  Plus,
  History,
  BarChart2,
  Award,
  Activity,
  Star,
  ClipboardList,
  MessageCircle,
  CalendarDays,
} from 'lucide-react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import {
  normalizeRole,
  canViewFinanceDashboard,
  canViewPatients,
  canCreateAppointment,
  canViewAppointmentRequests,
  canViewNoShowDashboard,
  canViewOperations,
} from '../utils/permissions';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { dashboardService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { useTranslation } from 'react-i18next';
import AppointmentForm from '../components/AppointmentForm';
import PatientForm from '../components/PatientForm';
import SetupChecklist from '../components/SetupChecklist';

const STAGE_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  consultation_scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  consultation_done: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  quote_sent: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  waiting_patient_decision: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  accepted: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  in_progress: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
};

// ─── Doctor Dashboard ─────────────────────────────────────────────────────────

const DoctorDashboard: React.FC<{ data: any; user: any }> = ({ data, user }) => {
  const { t } = useTranslation(['dashboard', 'common', 'appointments', 'treatmentCases']);
  const { formatCurrency, formatDate, formatDateTime, formatTime } = useClinicPreferences();
  const navigate = useNavigate();
  const [isNewApptOpen, setIsNewApptOpen] = useState(false);

  const stats = data.stats;
  const extras = data.doctorExtras || {};

  const statCards = [
    { label: t('dashboard:todayAppointments'), value: stats.todayAppointments, icon: <Calendar size={22} />, color: 'bg-blue-500', link: '/appointments' },
    { label: t('dashboard:doctor.weekAppointments'), value: stats.weekAppointments, icon: <Clock size={22} />, color: 'bg-indigo-500', link: '/appointments' },
    { label: t('dashboard:openTreatments'), value: stats.openTreatments, icon: <Briefcase size={22} />, color: 'bg-teal-500', link: '/treatment-cases' },
    { label: t('dashboard:doctor.pendingTasks'), value: stats.pendingTasks, icon: <CheckSquare size={22} />, color: 'bg-amber-500', link: '/tasks' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('dashboard:doctor.greeting', { name: user?.firstName })}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {formatDate(new Date())}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setIsNewApptOpen(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} />{t('common:appointments')}
          </button>
          <Link to="/my-earnings" className="btn-secondary flex items-center gap-2">
            <Award size={16} />{t('common:myEarnings')}
          </Link>
        </div>
      </div>

      {/* Overdue task alert */}
      {stats.overdueTasks > 0 && (
        <Link to="/tasks?overdue=true" className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-100 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 hover:shadow-sm transition-all">
          <AlertCircle size={20} />
          <span className="text-sm font-semibold">{t('dashboard:doctor.overdueTasksAlert', { count: stats.overdueTasks })}</span>
          <ChevronRight size={16} className="ml-auto" />
        </Link>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <Link key={card.label} to={card.link} className="card p-5 hover:shadow-md transition-all group">
            <div className={`w-10 h-10 rounded-xl ${card.color} text-white flex items-center justify-center mb-3 group-hover:scale-105 transition-transform`}>
              {card.icon}
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{card.value}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{card.label}</p>
          </Link>
        ))}
      </div>

      {/* Earnings card */}
      {extras.pendingEarnings > 0 && (
        <Link to="/my-earnings" className="flex items-center gap-4 p-5 card hover:shadow-md transition-all">
          <div className="w-12 h-12 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
            <Award size={22} />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('dashboard:doctor.pendingEarnings')}</p>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(extras.pendingEarnings)}
            </p>
          </div>
          <ChevronRight size={20} className="text-gray-400" />
        </Link>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Appointments */}
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Calendar size={18} className="text-blue-500" />{t('dashboard:doctor.todaySchedule')}
            </h2>
            <Link to="/appointments" className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium">{t('common:viewAll')}</Link>
          </div>
          {data.agenda?.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {data.agenda.map((appt: any) => (
                <div
                  key={appt.id}
                  onClick={() => navigate(`/appointments/${appt.id}`)}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                >
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: appt.appointmentType?.color || '#6366f1' }} />
                  <div className="w-14 text-xs font-bold text-gray-500 dark:text-gray-400 shrink-0">
                    {formatTime(appt.startTime)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">
                      {appt.patient.firstName} {appt.patient.lastName}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{appt.appointmentType?.name}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                    appt.status === 'completed'  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    appt.status === 'confirmed'  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                    appt.status === 'in_progress'? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' :
                    appt.status === 'no_show'    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}>
                    {t(`appointments:status.${appt.status}`, { defaultValue: appt.status })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-gray-400 dark:text-gray-600">
              <Calendar size={40} className="mx-auto mb-2 opacity-20" />
              <p className="text-sm">{t('dashboard:noAgendaToday')}</p>
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <div className="card flex flex-col overflow-hidden">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Activity size={18} className="text-purple-500" />{t('dashboard:activityFeed')}
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto max-h-72 p-4 space-y-4">
            {data.activities?.length > 0 ? data.activities.slice(0, 8).map((log: any, idx: number) => (
              <div key={idx} className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-2 shrink-0" />
                <div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">{log.description}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatDateTime(log.createdAt)}
                  </p>
                </div>
              </div>
            )) : (
              <p className="text-sm text-gray-400 text-center pt-8">{t('dashboard:doctor.noActivity')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming 7 days */}
        <div className="card overflow-hidden">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <TrendingUp size={18} className="text-teal-500" />{t('dashboard:doctor.upcomingSevenDays')}
            </h2>
            <span className="text-xs text-gray-400">{t('dashboard:doctor.appointmentCount', { count: extras.upcomingWeek?.length || 0 })}</span>
          </div>
          {extras.upcomingWeek?.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-64 overflow-y-auto">
              {extras.upcomingWeek.map((appt: any) => (
                <div key={appt.id} onClick={() => navigate(`/appointments/${appt.id}`)}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer text-sm">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: appt.appointmentType?.color || '#6366f1' }} />
                  <span className="text-gray-500 dark:text-gray-400 w-24 shrink-0 text-xs">
                    {formatDate(appt.startTime)}
                  </span>
                  <span className="font-medium text-gray-900 dark:text-white truncate">
                    {appt.patient.firstName} {appt.patient.lastName}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500 text-xs truncate ml-auto">{appt.appointmentType?.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-gray-400 dark:text-gray-600 text-sm">
              {t('dashboard:doctor.noUpcomingAppointments')}
            </div>
          )}
        </div>

        {/* Treatment Pipeline + Recent Patients */}
        <div className="space-y-4">
          {/* Pipeline */}
          {extras.treatmentPipeline?.length > 0 && (
            <div className="card p-5">
              <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
                <Briefcase size={18} className="text-indigo-500" />{t('dashboard:doctor.treatmentPipeline')}
              </h2>
              <div className="flex flex-wrap gap-2">
                {extras.treatmentPipeline.map((p: any) => {
                  const color = STAGE_COLORS[p.stage] || 'bg-gray-100 text-gray-700';
                  return (
                    <Link key={p.stage} to={`/treatment-cases?stage=${p.stage}`}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${color} hover:opacity-80 transition-opacity`}>
                      {t(`treatmentCases:stages.${p.stage}`, { defaultValue: p.stage })}
                      <span className="ml-1 bg-white/60 dark:bg-black/20 rounded-full w-5 h-5 flex items-center justify-center font-bold text-[11px]">
                        {p.count}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent Patients */}
          <div className="card overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Star size={18} className="text-amber-500" />{t('dashboard:doctor.recentPatients')}
              </h2>
              <Link to="/patients" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{t('common:viewAll')}</Link>
            </div>
            {extras.recentPatients?.length > 0 ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {extras.recentPatients.map((p: any) => (
                  <Link key={p.id} to={`/patients/${p.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300 shrink-0">
                      {p.firstName[0]}{p.lastName[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {p.firstName} {p.lastName}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{p.lastService}</p>
                    </div>
                    <p className="text-xs text-gray-400 shrink-0">
                      {formatDate(p.lastVisit)}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-gray-400 text-sm">{t('dashboard:doctor.noRecentPatients')}</div>
            )}
          </div>
        </div>
      </div>

      {isNewApptOpen && (
        <AppointmentForm
          onClose={() => setIsNewApptOpen(false)}
          onSuccess={() => { setIsNewApptOpen(false); navigate('/appointments'); }}
        />
      )}
    </div>
  );
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────

const Dashboard: React.FC = () => {
  const { t } = useTranslation(['dashboard', 'common', 'appointments', 'patients', 'tasks', 'messages']);
  const { user } = useAuth();
  const { selectedClinicId } = useClinic();
  const { formatCurrency, formatDateTime, formatTime, formatNumber } = useClinicPreferences();
  const navigate = useNavigate();
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isNewApptOpen, setIsNewApptOpen] = useState(false);
  const [isNewPatientOpen, setIsNewPatientOpen] = useState(false);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const res = await dashboardService.getStats();
      setData(res.data);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [selectedClinicId]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="animate-spin text-primary-600" size={48} />
      </div>
    );
  }

  // ── BILLING: finans paneline yönlendir ─────────────────────────────────
  if (user && normalizeRole(user.role, user.canAccessAllClinics) === 'BILLING') {
    return <Navigate to="/finance" replace />;
  }

  // ── Hekim kendi özel dashboard'unu görür ──────────────────────────────────
  if (user?.role === 'doctor' || (user && normalizeRole(user.role, user.canAccessAllClinics) === 'DENTIST')) {
    return <DoctorDashboard data={data} user={user} />;
  }

  const statCards = [
    {
      label: t('dashboard:todayAppointments'),
      value: data?.stats?.todayAppointments || 0,
      icon: <Calendar size={24} />,
      color: "bg-blue-500",
      trend: t('dashboard:stats.weekTotal', { count: data?.stats?.weekAppointments }),
      trendType: "info",
      link: '/appointments?date=today',
    },
    {
      label: t('dashboard:newPatients'),
      value: data?.stats?.newPatientsMonth || 0,
      icon: <Users size={24} />,
      color: "bg-teal-500",
      trend: t('dashboard:stats.monthTrend'),
      trendType: "up",
      link: '/patients?createdWithin=30d',
    },
    {
      label: t('dashboard:monthlyRevenue'),
      value: formatCurrency(data?.stats?.monthlyRevenue || 0),
      icon: <TrendingUp size={24} />,
      color: "bg-purple-500",
      trend: t('dashboard:stats.revenueGoal'),
      trendType: "up",
      link: '/finance?period=this_month',
    },
    {
      label: t('dashboard:overdueCollections'),
      value: formatCurrency(data?.stats?.overdueAmount || 0),
      icon: <DollarSign size={24} />,
      color: "bg-amber-500",
      trend: t('dashboard:stats.actionRequired'),
      trendType: "warning",
      link: '/payment-plans?overdueOnly=true',
    },
  ];

  // Fixed operational cards shown to the right of the "Unpaid Balances" alert —
  // always rendered with real counts (0 when there's nothing pending), so the row
  // never has an empty/dead area regardless of which conditional alerts fire.
  const operationalCards: Array<{
    key: string; title: string; count: number; icon: React.ReactNode; link: string; colorClasses: string;
  }> = [];
  if (canViewAppointmentRequests(user)) {
    operationalCards.push({
      key: 'pendingAppointmentRequests',
      title: t('dashboard:alerts.pendingAppointmentRequests'),
      count: data?.stats?.pendingAppointmentRequests || 0,
      icon: <MessageCircle size={18} />,
      link: '/appointment-requests?status=pending',
      colorClasses: 'bg-indigo-50 border-indigo-100 text-indigo-700 dark:bg-indigo-900/20 dark:border-indigo-800 dark:text-indigo-300',
    });
  }
  operationalCards.push({
    key: 'openTasks',
    title: t('dashboard:alerts.openTasks'),
    count: data?.stats?.pendingTasks || 0,
    icon: <ClipboardList size={18} />,
    link: '/tasks?status=open',
    colorClasses: 'bg-blue-50 border-blue-100 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300',
  });
  if (canViewNoShowDashboard(user)) {
    operationalCards.push({
      key: 'noShowFollowUp',
      title: t('dashboard:alerts.noShowFollowUp'),
      count: data?.stats?.noShowsMonth || 0,
      icon: <UserMinus size={18} />,
      link: '/no-shows?recoveryStatus=unresolved',
      colorClasses: 'bg-orange-50 border-orange-100 text-orange-700 dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-300',
    });
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('common:dashboard')}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{t('dashboard:welcome', { name: user?.firstName })}. {t('dashboard:subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreateAppointment(user) && (
            <button
              type="button"
              onClick={() => setIsNewApptOpen(true)}
              className="btn-primary"
              title={t('common:newAppointment')}
              aria-label={t('common:newAppointment')}
            >
              <Plus size={18} />
              {t('common:newAppointment')}
            </button>
          )}
          {canViewPatients(user) && (
            <button
              type="button"
              onClick={() => setIsNewPatientOpen(true)}
              className="btn-secondary"
              title={t('common:newPatient')}
              aria-label={t('common:newPatient')}
            >
              <Plus size={18} />
              {t('common:newPatient')}
            </button>
          )}
          {canCreateAppointment(user) && (
            <Link to="/appointments?view=timeline" className="btn-secondary" title={t('common:calendar')}>
              <CalendarDays size={18} />
              {t('common:calendar')}
            </Link>
          )}
          {canViewFinanceDashboard(user) && (
            <Link to="/finance" className="btn-secondary">
              <BarChart2 size={18} />
              {t('common:financeDashboard')}
            </Link>
          )}
        </div>
      </div>

      {/* New-clinic onboarding checklist (dismissible, localStorage-backed) */}
      <SetupChecklist />

      {/* Operational action row — "Unpaid Balances" is intentionally not shown here
          since it duplicates the "Pending Collections" KPI card below; this row is
          purely the 3 fixed operational cards. */}
      {operationalCards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {operationalCards.map((card) => (
            <Link
              key={card.key}
              to={card.link}
              className={`p-4 rounded-2xl flex items-center gap-4 border transition-all hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 cursor-pointer ${card.colorClasses}`}
              title={card.title}
              aria-label={card.title}
            >
              <div className="p-2 rounded-xl bg-white/60 dark:bg-white/10">
                {card.icon}
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-wider opacity-70">{card.title}</p>
                <p className="text-lg font-bold">{card.count}</p>
              </div>
              <ChevronRight size={20} className="opacity-50" />
            </Link>
          ))}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {statCards.map((stat, idx) => (
          <Link
            key={idx}
            to={stat.link}
            title={stat.label}
            aria-label={stat.label}
            className="card p-6 hover:shadow-md transition-all group cursor-pointer block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          >
            <div className="flex items-start justify-between">
              <div className={`p-3 rounded-xl text-white ${stat.color} shadow-lg shadow-${stat.color.split('-')[1]}-200 group-hover:scale-110 transition-transform`}>
                {stat.icon}
              </div>
              <ChevronRight size={20} className="text-gray-300 group-hover:text-gray-400 group-hover:translate-x-0.5 transition-all" />
            </div>
            <div className="mt-4">
              <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium">{stat.label}</h3>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{stat.value}</p>
            </div>
            <div className="mt-4 flex items-center gap-2">
              {stat.trendType === 'up' && <ArrowUpRight size={16} className="text-green-500" />}
              {stat.trendType === 'down' && <ArrowDownRight size={16} className="text-red-500" />}
              {stat.trendType === 'warning' && <AlertCircle size={16} className="text-yellow-500" />}
              {stat.trendType === 'info' && <Clock size={16} className="text-blue-500" />}
              <span className={`text-xs font-medium ${
                stat.trendType === 'up' ? 'text-green-600' : 
                stat.trendType === 'down' ? 'text-red-600' : 
                stat.trendType === 'warning' ? 'text-yellow-600' : 'text-blue-600'
              }`}>
                {stat.trend}
              </span>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Today's Agenda */}
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Calendar size={20} className="text-primary-600" />
              {t('dashboard:todayAgenda')}
            </h2>
            <Link to="/appointments" className="text-primary-600 dark:text-primary-400 text-sm font-semibold hover:underline">{t('common:viewAll')}</Link>
          </div>
          <div className="overflow-x-auto">
            {data?.agenda?.length > 0 ? (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50/50 dark:bg-gray-800/50">
                    <th className="px-6 py-4">{t('patients:list.name')}</th>
                    <th className="px-6 py-4">{t('common:practitioner')}</th>
                    <th className="px-6 py-4">{t('common:time')}</th>
                    <th className="px-6 py-4">{t('common:service')}</th>
                    <th className="px-6 py-4">{t('patients:list.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.agenda.map((appt: any) => (
                    <tr key={appt.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group cursor-pointer" onClick={() => navigate(`/appointments/${appt.id}`)}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300 group-hover:bg-primary-50 group-hover:text-primary-600 dark:group-hover:bg-primary-900/30 dark:group-hover:text-primary-400 transition-colors">
                            {appt.patient.firstName[0]}{appt.patient.lastName[0]}
                          </div>
                          <p className="font-bold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">{appt.patient.firstName} {appt.patient.lastName}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                        {appt.practitioner.firstName} {appt.practitioner.lastName}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-700 dark:text-gray-300">
                        {formatTime(appt.startTime)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: appt.appointmentType.color || '#3b82f6' }}></div>
                          <span className="text-sm text-gray-600 dark:text-gray-400">{appt.appointmentType.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`badge ${
                          appt.status === 'completed' ? 'badge-green' : 
                          appt.status === 'confirmed' ? 'badge-blue' : 
                          appt.status === 'no_show' ? 'badge-red' : 'badge-yellow'
                        }`}>
                          {t(`appointments:status.${appt.status}`)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-12 text-center text-gray-400">
                <Calendar size={48} className="mx-auto mb-3 opacity-20" />
                <p>{t('dashboard:noAgendaToday')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="card flex flex-col">
          <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <History size={20} className="text-primary-600" />
              {t('dashboard:activityFeed')}
            </h2>
          </div>
          <div className="p-6 flex-1 overflow-y-auto max-h-[500px]">
            {data?.activities?.length > 0 ? (
              <div className="space-y-6 relative before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-[2px] before:bg-gray-50 dark:before:bg-gray-800">
                {data.activities.map((log: any, idx: number) => (
                  <div key={idx} className="relative pl-10 group">
                    <div className="absolute left-0 top-1 w-8 h-8 rounded-full bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-700 flex items-center justify-center z-10 group-hover:border-primary-200 group-hover:bg-primary-50 dark:group-hover:border-primary-800 dark:group-hover:bg-primary-900/30 transition-all">
                      <div className="w-2 h-2 rounded-full bg-primary-500"></div>
                    </div>
                    <div>
                      <p className="text-sm text-gray-900 dark:text-gray-300 leading-snug">
                        <span className="font-bold text-gray-900 dark:text-white">{log.user.firstName}</span> {log.description}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-1 font-medium">
                        {formatDateTime(log.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8">
                <Clock size={48} className="mb-3 opacity-10" />
                <p className="text-sm italic">{t('common:noData')}</p>
              </div>
            )}
          </div>
          {canViewOperations(user) && (
            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 mt-auto">
              <Link to="/operations" className="text-xs font-bold text-primary-600 dark:text-primary-400 hover:underline flex items-center justify-center gap-1">
                {t('dashboard:viewFullLogs')}
                <ChevronRight size={14} />
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Grafikler ───────────────────────────────────────── */}
      {data?.charts && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Haftalık randevu trendi */}
          <div className="card p-6 lg:col-span-2">
            <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <BarChart2 size={18} className="text-primary-600" />
              {t('dashboard:charts.appointmentTrend')}
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.charts.dailyTrend} barSize={28}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}
                  cursor={{ fill: '#f3f4f6' }}
                />
                <Bar dataKey="count" name={t('common:appointments')} fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Hizmet bazlı dağılım */}
          <div className="card p-6">
            <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <TrendingUp size={18} className="text-primary-600" />
              {t('dashboard:charts.serviceDistribution')}
            </h2>
            {data.charts.appointmentsByType.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={data.charts.appointmentsByType}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                  >
                    {data.charts.appointmentsByType.map((entry: any, index: number) => (
                      <Cell key={index} fill={entry.color || `hsl(${index * 60},70%,55%)`} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: 8, fontSize: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">{t('common:noData')}</div>
            )}
          </div>

          {/* Aylık gelir trendi */}
          <div className="card p-6 lg:col-span-3">
            <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <DollarSign size={18} className="text-primary-600" />
              {t('dashboard:charts.revenueTrend')}
            </h2>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data.charts.monthlyRevenueTrend}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={55} tickFormatter={(v) => formatNumber(Number(v))} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}
                  formatter={(v: any) => [formatCurrency(Number(v)), t('dashboard:charts.revenue')]}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  name={t('dashboard:charts.revenue')}
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ fill: '#10b981', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Operational Summary Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-6 flex items-center gap-4">
          <div className="p-4 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-2xl">
            <UserMinus size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard:noShowsMonth')}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{data?.stats?.noShowsMonth || 0}</p>
          </div>
        </div>
        <div className="card p-6 flex items-center gap-4">
          <div className="p-4 bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 rounded-2xl">
            <Briefcase size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard:openTreatments')}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{data?.stats?.openTreatments || 0}</p>
          </div>
        </div>
        <div className="card p-6 flex items-center gap-4">
          <div className="p-4 bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 rounded-2xl">
            <MessageSquare size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard:preparedMessages')}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{data?.stats?.preparedMessages || 0}</p>
          </div>
        </div>
      </div>

      {isNewApptOpen && (
        <AppointmentForm
          onClose={() => setIsNewApptOpen(false)}
          onSuccess={() => { setIsNewApptOpen(false); navigate('/appointments'); }}
        />
      )}
      {isNewPatientOpen && (
        <PatientForm
          onClose={() => setIsNewPatientOpen(false)}
          onSuccess={() => { setIsNewPatientOpen(false); navigate('/patients'); }}
        />
      )}
    </div>
  );
};

export default Dashboard;
