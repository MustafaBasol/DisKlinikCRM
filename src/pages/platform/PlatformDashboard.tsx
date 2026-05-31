import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Users, Stethoscope, Activity, Clock, ShieldOff,
  MessageCircle, TrendingUp, Loader2, AlertCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';

interface DashboardData {
  totals: {
    organizations: number;
    activeOrganizations: number;
    suspendedOrganizations: number;
    clinics: number;
    users: number;
    patients: number;
    trialEndingSoon: number;
    whatsappConnections: number;
  };
  recentOrganizations: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: string;
    plan?: { displayName: string };
    _count: { clinics: number; users: number };
  }>;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  trial: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const StatCard: React.FC<{
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  to?: string;
}> = ({ label, value, icon, color, to }) => {
  const inner = (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5 flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
      </div>
    </div>
  );

  if (to) return <Link to={to}>{inner}</Link>;
  return inner;
};

const PlatformDashboard: React.FC = () => {
  const { t } = useTranslation(['platform']);
  const api = usePlatformApi();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/platform/dashboard')
      .then((res) => setData(res.data))
      .catch(() => setError(t('platform:errors.dashboardLoadFailed')))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
        <AlertCircle size={18} />
        <span>{error || t('platform:errors.dataUnavailable')}</span>
      </div>
    );
  }

  const { totals, recentOrganizations } = data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('platform:dashboard.title')}</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label={t('platform:dashboard.totalOrganizations')}
          value={totals.organizations}
          icon={<Building2 size={22} className="text-blue-600" />}
          color="bg-blue-50 dark:bg-blue-900/30"
          to="/platform/organizations"
        />
        <StatCard
          label={t('platform:dashboard.activeOrganizations')}
          value={totals.activeOrganizations}
          icon={<TrendingUp size={22} className="text-green-600" />}
          color="bg-green-50 dark:bg-green-900/30"
        />
        <StatCard
          label={t('platform:dashboard.suspendedOrganizations')}
          value={totals.suspendedOrganizations}
          icon={<ShieldOff size={22} className="text-amber-600" />}
          color="bg-amber-50 dark:bg-amber-900/30"
        />
        <StatCard
          label={t('platform:dashboard.trialEndingSoon')}
          value={totals.trialEndingSoon}
          icon={<Clock size={22} className="text-orange-600" />}
          color="bg-orange-50 dark:bg-orange-900/30"
        />
        <StatCard
          label={t('platform:dashboard.totalClinics')}
          value={totals.clinics}
          icon={<Stethoscope size={22} className="text-purple-600" />}
          color="bg-purple-50 dark:bg-purple-900/30"
          to="/platform/clinics"
        />
        <StatCard
          label={t('platform:dashboard.totalUsers')}
          value={totals.users}
          icon={<Users size={22} className="text-indigo-600" />}
          color="bg-indigo-50 dark:bg-indigo-900/30"
          to="/platform/users"
        />
        <StatCard
          label={t('platform:dashboard.totalPatients')}
          value={totals.patients}
          icon={<Activity size={22} className="text-teal-600" />}
          color="bg-teal-50 dark:bg-teal-900/30"
        />
        <StatCard
          label={t('platform:dashboard.whatsappConnections')}
          value={totals.whatsappConnections}
          icon={<MessageCircle size={22} className="text-green-600" />}
          color="bg-green-50 dark:bg-green-900/30"
        />
      </div>

      {/* Recent organizations */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">{t('platform:dashboard.recentOrganizations')}</h2>
          <Link
            to="/platform/organizations"
            className="text-sm text-blue-600 hover:underline"
          >
            {t('platform:actions.viewAll')}
          </Link>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-gray-800">
          {recentOrganizations.map((org) => (
            <div key={org.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <Link
                  to={`/platform/organizations`}
                  className="font-medium text-gray-900 dark:text-white hover:text-blue-600 text-sm"
                >
                  {org.name}
                </Link>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('platform:counts.clinicsUsers', { clinics: org._count.clinics, users: org._count.users })}
                  {org.plan && ` · ${org.plan.displayName}`}
                </p>
              </div>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[org.status] ?? 'bg-gray-100 text-gray-600'}`}
              >
                {t(`platform:statuses.${org.status}`, { defaultValue: org.status })}
              </span>
            </div>
          ))}
          {recentOrganizations.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">{t('platform:dashboard.emptyOrganizations')}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlatformDashboard;
