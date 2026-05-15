import React, { useEffect, useState } from 'react';
import { 
  Users, 
  Calendar, 
  Clock, 
  TrendingUp,
  AlertCircle,
  MoreVertical,
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
  History
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { dashboardService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { formatTimeInTimeZone } from '../utils/dateTime';

const Dashboard: React.FC = () => {
  const { t } = useTranslation(['dashboard', 'common', 'appointments', 'patients', 'tasks', 'messages']);
  const { user } = useAuth();
  const clinicTimeZone = user?.clinic?.timezone || 'Europe/Paris';
  const navigate = useNavigate();
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
  }, []);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="animate-spin text-primary-600" size={48} />
      </div>
    );
  }

  const statCards = [
    { 
      label: t('dashboard:todayAppointments'), 
      value: data?.stats?.todayAppointments || 0, 
      icon: <Calendar size={24} />, 
      color: "bg-blue-500", 
      trend: t('dashboard:stats.weekTotal', { count: data?.stats?.weekAppointments }),
      trendType: "info" 
    },
    { 
      label: t('dashboard:newPatients'), 
      value: data?.stats?.newPatientsMonth || 0, 
      icon: <Users size={24} />, 
      color: "bg-teal-500", 
      trend: t('dashboard:stats.monthTrend'),
      trendType: "up" 
    },
    { 
      label: t('dashboard:monthlyRevenue'), 
      value: `${data?.stats?.monthlyRevenue?.toLocaleString()} ${user?.clinic?.currency || '$'}`, 
      icon: <TrendingUp size={24} />, 
      color: "bg-purple-500", 
      trend: t('dashboard:stats.revenueGoal'),
      trendType: "up" 
    },
    { 
      label: t('dashboard:pendingCollections'), 
      value: `${data?.stats?.pendingAmount?.toLocaleString()} ${user?.clinic?.currency || '$'}`, 
      icon: <DollarSign size={24} />, 
      color: "bg-amber-500", 
      trend: t('dashboard:stats.actionRequired'), 
      trendType: "warning" 
    },
  ];

  const getAlertIcon = (iconName: string) => {
    switch (iconName) {
      case 'Clock': return <Clock size={18} />;
      case 'UserMinus': return <UserMinus size={18} />;
      case 'DollarSign': return <DollarSign size={18} />;
      default: return <AlertCircle size={18} />;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('common:dashboard')}</h1>
          <p className="text-gray-500 mt-1">{t('dashboard:welcome', { name: user?.firstName })}. {t('dashboard:subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/appointments" className="btn-primary">
            <Plus size={18} />
            {t('common:newAppointment')}
          </Link>
          <Link to="/patients" className="btn-secondary">
            <Plus size={18} />
            {t('common:newPatient')}
          </Link>
        </div>
      </div>

      {/* Alerts */}
      {data?.alerts?.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.alerts.map((alert: any, idx: number) => (
            <Link 
              key={idx} 
              to={alert.link}
              className={`p-4 rounded-2xl flex items-center gap-4 border transition-all hover:shadow-md ${
                alert.type === 'danger' ? 'bg-red-50 border-red-100 text-red-700' :
                alert.type === 'warning' ? 'bg-amber-50 border-amber-100 text-amber-700' :
                'bg-blue-50 border-blue-100 text-blue-700'
              }`}
            >
              <div className={`p-2 rounded-xl ${
                alert.type === 'danger' ? 'bg-red-100' :
                alert.type === 'warning' ? 'bg-amber-100' :
                'bg-blue-100'
              }`}>
                {getAlertIcon(alert.icon)}
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-wider opacity-70">{t(`dashboard:alerts.${alert.title}`)}</p>
                <p className="text-lg font-bold">
                  {alert.count !== undefined ? alert.count : `${alert.value?.toLocaleString()} ${user?.clinic?.currency || '$'}`}
                </p>
              </div>
              <ChevronRight size={20} className="opacity-50" />
            </Link>
          ))}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, idx) => (
          <div key={idx} className="card p-6 hover:shadow-md transition-all group">
            <div className="flex items-start justify-between">
              <div className={`p-3 rounded-xl text-white ${stat.color} shadow-lg shadow-${stat.color.split('-')[1]}-200 group-hover:scale-110 transition-transform`}>
                {stat.icon}
              </div>
              <button className="text-gray-400 hover:text-gray-600">
                <MoreVertical size={20} />
              </button>
            </div>
            <div className="mt-4">
              <h3 className="text-gray-500 text-sm font-medium">{stat.label}</h3>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
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
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Today's Agenda */}
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Calendar size={20} className="text-primary-600" />
              {t('dashboard:todayAgenda')}
            </h2>
            <Link to="/appointments" className="text-primary-600 text-sm font-semibold hover:underline">{t('common:viewAll')}</Link>
          </div>
          <div className="overflow-x-auto">
            {data?.agenda?.length > 0 ? (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50/50">
                    <th className="px-6 py-4">{t('patients:list.name')}</th>
                    <th className="px-6 py-4">{t('common:time')}</th>
                    <th className="px-6 py-4">{t('common:service')}</th>
                    <th className="px-6 py-4">{t('patients:list.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.agenda.map((appt: any) => (
                    <tr key={appt.id} className="hover:bg-gray-50 transition-colors group cursor-pointer" onClick={() => navigate(`/appointments/${appt.id}`)}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 group-hover:bg-primary-50 group-hover:text-primary-600 transition-colors">
                            {appt.patient.firstName[0]}{appt.patient.lastName[0]}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 group-hover:text-primary-600 transition-colors">{appt.patient.firstName} {appt.patient.lastName}</p>
                            <p className="text-[10px] text-gray-500">Dt. {appt.practitioner.firstName}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-700">
                        {formatTimeInTimeZone(appt.startTime, undefined, clinicTimeZone)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: appt.appointmentType.color || '#3b82f6' }}></div>
                          <span className="text-sm text-gray-600">{appt.appointmentType.name}</span>
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
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <History size={20} className="text-primary-600" />
              {t('dashboard:activityFeed')}
            </h2>
          </div>
          <div className="p-6 flex-1 overflow-y-auto max-h-[500px]">
            {data?.activities?.length > 0 ? (
              <div className="space-y-6 relative before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-[2px] before:bg-gray-50">
                {data.activities.map((log: any, idx: number) => (
                  <div key={idx} className="relative pl-10 group">
                    <div className="absolute left-0 top-1 w-8 h-8 rounded-full bg-white border-2 border-gray-100 flex items-center justify-center z-10 group-hover:border-primary-200 group-hover:bg-primary-50 transition-all">
                      <div className="w-2 h-2 rounded-full bg-primary-500"></div>
                    </div>
                    <div>
                      <p className="text-sm text-gray-900 leading-snug">
                        <span className="font-bold text-gray-900">{log.user.firstName}</span> {log.description}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-1 font-medium">
                        {new Date(log.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
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
          <div className="p-4 bg-gray-50 border-t border-gray-100 mt-auto">
            <Link to="/activity-logs" className="text-xs font-bold text-primary-600 hover:underline flex items-center justify-center gap-1">
              {t('dashboard:viewFullLogs')}
              <ChevronRight size={14} />
            </Link>
          </div>
        </div>
      </div>

      {/* Operational Summary Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-6 flex items-center gap-4">
          <div className="p-4 bg-red-50 text-red-600 rounded-2xl">
            <UserMinus size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard:noShowsMonth')}</p>
            <p className="text-xl font-bold">{data?.stats?.noShowsMonth || 0}</p>
          </div>
        </div>
        <div className="card p-6 flex items-center gap-4">
          <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl">
            <Briefcase size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard:openTreatments')}</p>
            <p className="text-xl font-bold">{data?.stats?.openTreatments || 0}</p>
          </div>
        </div>
        <div className="card p-6 flex items-center gap-4">
          <div className="p-4 bg-green-50 text-green-600 rounded-2xl">
            <MessageSquare size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('dashboard:preparedMessages')}</p>
            <p className="text-xl font-bold">{data?.stats?.preparedMessages || 0}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
