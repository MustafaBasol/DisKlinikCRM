import React, { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Stethoscope,
  Users,
  Package,
  Activity,
  Lock,
  HardDrive,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Shield,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformAuth } from '../context/PlatformAuthContext';

type NavItem = { path: string; icon: React.ReactNode; labelKey: string };

const NAV_ITEMS: NavItem[] = [
  { path: '/platform', icon: <LayoutDashboard size={18} />, labelKey: 'dashboard' },
  { path: '/platform/organizations', icon: <Building2 size={18} />, labelKey: 'organizations' },
  { path: '/platform/clinics', icon: <Stethoscope size={18} />, labelKey: 'clinics' },
  { path: '/platform/users', icon: <Users size={18} />, labelKey: 'users' },
  { path: '/platform/plans', icon: <Package size={18} />, labelKey: 'plans' },
  { path: '/platform/system', icon: <Activity size={18} />, labelKey: 'system' },
  { path: '/platform/privacy', icon: <Lock size={18} />, labelKey: 'privacy' },
  { path: '/platform/backups', icon: <HardDrive size={18} />, labelKey: 'backups' },
];

const PlatformAdminLayout: React.FC = () => {
  const { t } = useTranslation('platform');
  const location = useLocation();
  const navigate = useNavigate();
  const { admin, logout } = usePlatformAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = () => {
    logout();
    navigate('/platform/login');
  };

  const isActive = (path: string) => {
    if (path === '/platform') return location.pathname === '/platform';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-950">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-16'
        } flex flex-col bg-slate-900 text-white transition-all duration-200 shrink-0`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-700">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <Shield size={20} className="text-blue-400" />
              <span className="font-semibold text-sm leading-tight">
                {t('layout.brandPrimary')}<br />
                <span className="text-blue-400">{t('layout.brandSecondary')}</span>
              </span>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1 rounded hover:bg-slate-700 transition-colors ml-auto"
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 space-y-1 px-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive(item.path)
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              {sidebarOpen && <span>{t(`layout.nav.${item.labelKey}`)}</span>}
              {sidebarOpen && isActive(item.path) && (
                <ChevronRight size={14} className="ml-auto" />
              )}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-700 px-4 py-3">
          {sidebarOpen && admin && (
            <p className="text-xs text-slate-400 mb-2 truncate">{admin.email}</p>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors w-full"
          >
            <LogOut size={16} />
            {sidebarOpen && <span>{t('layout.logout')}</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-blue-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('layout.topbarTitle')}
            </span>
          </div>
          {admin && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {admin.name ?? admin.email}
            </span>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default PlatformAdminLayout;
