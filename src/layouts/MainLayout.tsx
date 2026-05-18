import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  Calendar, 
  CheckSquare, 
  CreditCard, 
  ShieldCheck,
  Settings, 
  LogOut,
  Search,
  Globe,
  ChevronDown,
  Menu,
  X,
  ClipboardList,
  Briefcase,
  MessageSquare,
  Mail,
  CalendarPlus,
  Moon,
  Sun
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import TaskForm from '../components/TaskForm';
import NotificationBell from '../components/NotificationBell';
import { useDarkMode } from '../utils/darkMode';

const MainLayout: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const location = useLocation();
  const { isDark, toggle: toggleDark } = useDarkMode();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);

  // Detect mobile breakpoint (< lg = 1024px) and adjust sidebar accordingly
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const handler = (e: MediaQueryList | MediaQueryListEvent) => {
      const mobile = e.matches;
      setIsMobile(mobile);
      setIsSidebarOpen(!mobile); // open by default on desktop, closed on mobile
    };
    handler(mq);
    mq.addEventListener('change', handler as (e: MediaQueryListEvent) => void);
    return () => mq.removeEventListener('change', handler as (e: MediaQueryListEvent) => void);
  }, []);

  // Close sidebar when navigating on mobile
  const handleNavClick = () => {
    if (isMobile) setIsSidebarOpen(false);
  };

  const navItems = [
    { path: '/', icon: <LayoutDashboard size={20} />, label: t('common:dashboard') },
    { path: '/patients', icon: <Users size={20} />, label: t('common:patients') },
    { path: '/appointments', icon: <Calendar size={20} />, label: t('common:appointments') },
    { path: '/treatment-cases', icon: <Briefcase size={20} />, label: t('common:treatmentCases') },
    { path: '/tasks', icon: <CheckSquare size={20} />, label: t('common:tasks') },
    { path: '/payments', icon: <CreditCard size={20} />, label: t('common:payments') },
    { path: '/insurance-provisions', icon: <ShieldCheck size={20} />, label: t('common:insurance') },
    { path: '/messages', icon: <MessageSquare size={20} />, label: t('common:messages', { defaultValue: 'Messages' }) },
  ];

  if (user?.role === 'admin' || user?.role === 'receptionist') {
    navItems.splice(3, 0, { path: '/appointment-requests', icon: <CalendarPlus size={20} />, label: t('common:appointmentRequests') });
  }

  if (user?.role === 'admin' || user?.role === 'receptionist') {
    navItems.push({ path: '/templates', icon: <Mail size={20} />, label: t('common:templates', { defaultValue: 'Templates' }) });
  }

  return (
    <div className="min-h-screen bg-page dark:bg-gray-950 flex">
      {/* Mobile backdrop — closes sidebar on tap outside */}
      {isMobile && isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          'bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col fixed inset-y-0 z-50',
          // Width: always 64 on mobile (full drawer), 64 or 20 icon-only on desktop
          isMobile ? 'w-64' : (isSidebarOpen ? 'w-64' : 'w-20'),
          // Slide in/out on mobile; always visible on desktop
          isMobile ? (isSidebarOpen ? 'translate-x-0' : '-translate-x-full') : 'translate-x-0',
        ].join(' ')}
      >
        <div className="p-6 flex items-center justify-between">
          {isSidebarOpen ? (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold">
                H
              </div>
              <span className="font-bold text-xl tracking-tight">{t('common:appName')}</span>
            </div>
          ) : (
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold mx-auto">
              {t('common:appName')[0]}
            </div>
          )}
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                  isActive 
                    ? 'bg-primary-50 text-primary-600 font-medium shadow-sm border border-primary-100 dark:bg-primary-900/30 dark:border-primary-800' 
                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
                }`}
              >
                <span className={isActive ? 'text-primary-600' : 'text-gray-400'}>
                  {item.icon}
                </span>
                {(isSidebarOpen || isMobile) && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <Link
            to="/settings"
            onClick={handleNavClick}
            className="flex items-center gap-3 px-3 py-2 text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800 rounded-lg transition-all mb-2"
          >
            <Settings size={20} className="text-gray-400" />
            {(isSidebarOpen || isMobile) && <span>{t('common:settings')}</span>}
          </Link>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"
          >
            <LogOut size={20} />
            {(isSidebarOpen || isMobile) && <span>{t('common:logout')}</span>}
          </button>
        </div>
      </aside>

      {/* Main Content — no left margin on mobile (sidebar overlays); desktop gets ml based on sidebar state */}
      <main
        className={[
          'flex-1 transition-all duration-300 flex flex-col min-w-0 overflow-x-hidden',
          isMobile ? 'ml-0' : (isSidebarOpen ? 'ml-64' : 'ml-20'),
        ].join(' ')}
      >
        {/* Header */}
        <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-3 sm:px-8 sticky top-0 z-40">
          <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500 dark:text-gray-400 shrink-0"
            >
              {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            {/* Küresel Arama Tetikleyici */}
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
              className="hidden md:flex items-center gap-2 max-w-md w-full pl-3 pr-3 py-2 bg-gray-50 dark:bg-gray-800 border-none rounded-xl text-sm text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <Search size={18} className="text-gray-400" />
              <span className="flex-1 text-left">{t('common:search')}…</span>
              <span className="hidden lg:flex items-center gap-0.5 text-[11px] font-mono bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-400">
                <span>Ctrl</span><span>+K</span>
              </span>
            </button>
          </div>

          <div className="flex items-center gap-1 sm:gap-4 shrink-0">
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-xs font-bold border border-primary-100 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-800">
              <span className="w-2 h-2 bg-primary-500 rounded-full animate-pulse"></span>
              {user?.clinic.name}
            </div>
            
            {/* Dark Mode Toggle */}
            <button
              onClick={toggleDark}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500 dark:text-gray-400"
              aria-label="Tema değiştir"
            >
              {isDark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            
            {/* Yeni Görev — mobilde gizli */}
            <button 
              onClick={() => setIsTaskFormOpen(true)} 
              className="hidden sm:flex p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors relative"
              title={t('tasks:newTask')}
            >
              <ClipboardList size={20} />
            </button>
            <div className="hidden sm:block w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1"></div>
            
            {/* Dil Seçici */}
            <div className="relative group">
              <button className="flex items-center gap-1 sm:gap-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-600 dark:text-gray-300">
                <Globe size={18} />
                <span className="hidden sm:inline text-xs font-bold uppercase">{t(`common:languages.${i18n.language.split('-')[0]}`)}</span>
                <ChevronDown size={12} className="hidden sm:block" />
              </button>
              <div className="absolute right-0 mt-2 w-32 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                {['en', 'tr', 'fr', 'de'].map((lng) => (
                  <button
                    key={lng}
                    onClick={() => i18n.changeLanguage(lng)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:text-primary-600 transition-colors ${
                      i18n.language.startsWith(lng) ? 'text-primary-600 font-bold' : 'text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {t(`common:languages.${lng}`)}
                  </button>
                ))}
              </div>
            </div>

            <NotificationBell />
            <div className="hidden sm:block h-8 w-px bg-gray-200 dark:bg-gray-700 mx-1"></div>
            <div className="flex items-center gap-2 cursor-pointer p-1 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-none">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 capitalize">{user?.role}</p>
              </div>
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-health-100 flex items-center justify-center text-health-700 font-bold border-2 border-health-200 text-sm">
                {user?.firstName[0]}{user?.lastName[0]}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>

      {isTaskFormOpen && (
        <TaskForm 
          onClose={() => setIsTaskFormOpen(false)}
          onSuccess={() => {
            setIsTaskFormOpen(false);
            // Optionally show success toast
          }}
        />
      )}
    </div>
  );
};

export default MainLayout;
