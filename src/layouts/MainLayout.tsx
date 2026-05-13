import React, { useState } from 'react';
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
  Bell,
  Search,
  Globe,
  ChevronDown,
  Menu,
  X,
  ClipboardList,
  Briefcase,
  MessageSquare,
  Mail,
  CalendarPlus
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import TaskForm from '../components/TaskForm';

const MainLayout: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);

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
    <div className="min-h-screen bg-page flex">
      {/* Sidebar */}
      <aside 
        className={`${
          isSidebarOpen ? 'w-64' : 'w-20'
        } bg-white border-r border-gray-200 transition-all duration-300 flex flex-col fixed inset-y-0 z-50`}
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
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                  isActive 
                    ? 'bg-primary-50 text-primary-600 font-medium shadow-sm border border-primary-100' 
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className={isActive ? 'text-primary-600' : 'text-gray-400'}>
                  {item.icon}
                </span>
                {isSidebarOpen && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <Link
            to="/settings"
            className="flex items-center gap-3 px-3 py-2 text-gray-600 hover:bg-gray-50 rounded-lg transition-all mb-2"
          >
            <Settings size={20} className="text-gray-400" />
            {isSidebarOpen && <span>{t('common:settings')}</span>}
          </Link>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"
          >
            <LogOut size={20} />
            {isSidebarOpen && <span>{t('common:logout')}</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main 
        className={`flex-1 transition-all duration-300 ${
          isSidebarOpen ? 'ml-64' : 'ml-20'
        } flex flex-col`}
      >
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 sticky top-0 z-40">
          <div className="flex items-center gap-4 flex-1">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
            >
              {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="max-w-md w-full relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input 
                type="text" 
                placeholder={t('common:search')} 
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-xs font-bold border border-primary-100">
              <span className="w-2 h-2 bg-primary-500 rounded-full animate-pulse"></span>
              {user?.clinic.name}
            </div>
            
            {/* Language Switcher */}
            <button 
              onClick={() => setIsTaskFormOpen(true)} 
              className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors relative"
              title={t('tasks:newTask')}
            >
              <ClipboardList size={20} />
            </button>
            <div className="w-px h-6 bg-gray-200 mx-2"></div>
            
            <div className="relative group">
              <button className="flex items-center gap-2 p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600">
                <Globe size={20} />
                <span className="text-xs font-bold uppercase">{t(`common:languages.${i18n.language.split('-')[0]}`)}</span>
                <ChevronDown size={14} />
              </button>
              <div className="absolute right-0 mt-2 w-32 bg-white rounded-xl shadow-xl border border-gray-100 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                {['en', 'tr', 'fr', 'de'].map((lng) => (
                  <button
                    key={lng}
                    onClick={() => i18n.changeLanguage(lng)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-primary-50 hover:text-primary-600 transition-colors ${
                      i18n.language.startsWith(lng) ? 'text-primary-600 font-bold' : 'text-gray-600'
                    }`}
                  >
                    {t(`common:languages.${lng}`)}
                  </button>
                ))}
              </div>
            </div>

            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 relative">
              <Bell size={20} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
            <div className="h-8 w-[1px] bg-gray-200 mx-2"></div>
            <div className="flex items-center gap-3 cursor-pointer p-1 hover:bg-gray-50 rounded-lg transition-colors">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-semibold text-gray-900 leading-none">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-gray-500 mt-1 capitalize">{user?.role}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-health-100 flex items-center justify-center text-health-700 font-bold border-2 border-health-200">
                {user?.firstName[0]}{user?.lastName[0]}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-8">
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
