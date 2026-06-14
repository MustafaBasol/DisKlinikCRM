import React, { useState, useEffect, useRef } from 'react';
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
  Sun,
  BarChart2,
  TrendingUp,
  Award,
  Package,
  Building2,
  Inbox,
  BarChart3,
  Activity,
  UserX,
  Instagram,
  RotateCcw,
  KeyRound,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import ClinicSwitcher from '../components/ClinicSwitcher';
import TaskForm from '../components/TaskForm';
import NotificationBell from '../components/NotificationBell';
import { authService, contactRequestService } from '../services/api';
import { useDarkMode } from '../utils/darkMode';
import {
  canViewOrganizationDashboard,
  canViewBranches,
  canViewPatients,
  canViewAppointments,
  canViewPayments,
  canViewReports,
  canManageInventory,
  canManageUsers,
  canViewUsers,
  normalizeRole,
  canViewWhatsAppInbox,
  canViewFinanceDashboard,
  canViewOperations,
  canViewNoShowDashboard,
  canViewRecallDashboard,
  canViewInstagramInbox,
} from '../utils/permissions';

type NavItem = { path: string; icon: React.ReactNode; label: string; badge?: number };
type NavGroup = { id: string; label: string; collapsible: boolean; items: NavItem[] };

type ChangePasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const emptyPasswordForm: ChangePasswordForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

const getPasswordRuleErrors = (password: string, t: (key: string) => string) => {
  const errors: string[] = [];
  if (password.length < 8) errors.push(t('auth:passwordRequirements.minLength'));
  if (!/[A-Z]/.test(password)) errors.push(t('auth:passwordRequirements.uppercase'));
  if (!/[a-z]/.test(password)) errors.push(t('auth:passwordRequirements.lowercase'));
  if (!/\d/.test(password)) errors.push(t('auth:passwordRequirements.number'));
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push(t('auth:passwordRequirements.special'));
  return errors;
};

const resolvePasswordErrorMessage = (error: any, t: (key: string) => string) => {
  const code = error?.response?.data?.code;
  if (code === 'CURRENT_PASSWORD_INCORRECT') return t('common:profile.currentPasswordIncorrect');
  if (code === 'PASSWORD_WEAK') return t('common:profile.passwordRequirementsNotMet');
  if (code === 'PASSWORD_FIELDS_REQUIRED') return t('common:profile.requiredFields');
  return error?.response?.data?.error || t('common:errorGeneric');
};

const ChangePasswordModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation(['common', 'auth']);
  const [formData, setFormData] = useState<ChangePasswordForm>(emptyPasswordForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const passwordErrors = getPasswordRuleErrors(formData.newPassword, t);
  const passwordsDoNotMatch = Boolean(formData.confirmPassword) && formData.newPassword !== formData.confirmPassword;
  const canSubmit = Boolean(formData.currentPassword && formData.newPassword && formData.confirmPassword)
    && passwordErrors.length === 0
    && !passwordsDoNotMatch
    && !loading;

  const updateField = (field: keyof ChangePasswordForm, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (!formData.currentPassword || !formData.newPassword || !formData.confirmPassword) {
      setError(t('common:profile.requiredFields'));
      return;
    }

    if (passwordErrors.length > 0) {
      setError(t('common:profile.passwordRequirementsNotMet'));
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setError(t('common:profile.passwordsDoNotMatch'));
      return;
    }

    try {
      setLoading(true);
      await authService.changePassword({
        currentPassword: formData.currentPassword,
        newPassword: formData.newPassword,
      });
      setFormData(emptyPasswordForm);
      setSuccess(t('common:profile.passwordUpdated'));
    } catch (err: any) {
      setError(resolvePasswordErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 px-4 py-6">
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-900 shadow-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 dark:border-gray-700 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('common:profile.changePasswordTitle')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('common:profile.changePasswordDescription')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label={t('common:close')}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
          {error && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300">
              <CheckCircle size={16} className="mt-0.5 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('common:profile.currentPassword')}
            </label>
            <input
              type="password"
              autoComplete="current-password"
              className="input-field w-full"
              value={formData.currentPassword}
              onChange={event => updateField('currentPassword', event.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('common:profile.newPassword')}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              className="input-field w-full"
              value={formData.newPassword}
              onChange={event => updateField('newPassword', event.target.value)}
            />
          </div>

          {formData.newPassword && passwordErrors.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:border-amber-900/60 dark:text-amber-300">
              <p className="font-medium mb-2">{t('auth:passwordRequirements.title')}</p>
              <ul className="list-disc pl-5 space-y-1">
                {passwordErrors.map(rule => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('common:profile.confirmNewPassword')}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              className="input-field w-full"
              value={formData.confirmPassword}
              onChange={event => updateField('confirmPassword', event.target.value)}
            />
            {passwordsDoNotMatch && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{t('common:profile.passwordsDoNotMatch')}</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t('common:cancel')}
            </button>
            <button type="submit" disabled={!canSubmit} className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? t('common:profile.updatingPassword') : t('common:profile.updatePassword')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const MainLayoutInner: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const location = useLocation();
  const { isDark, toggle: toggleDark } = useDarkMode();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [contactRequestCount, setContactRequestCount] = useState(0);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  // Collapsible group state — persisted in localStorage
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('sidebar_groups_collapsed') ?? '{}');
    } catch {
      return {};
    }
  });

  // Detect mobile breakpoint (< lg = 1024px) and adjust sidebar accordingly
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const handler = (e: MediaQueryList | MediaQueryListEvent) => {
      const mobile = e.matches;
      setIsMobile(mobile);
      setIsSidebarOpen(!mobile);
    };
    handler(mq);
    mq.addEventListener('change', handler as (e: MediaQueryListEvent) => void);
    return () => mq.removeEventListener('change', handler as (e: MediaQueryListEvent) => void);
  }, []);

  useEffect(() => {
    if (!isUserMenuOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isUserMenuOpen]);

  useEffect(() => {
    setIsUserMenuOpen(false);
  }, [location.pathname]);

  // Fetch unresolved contact request count for sidebar badge
  useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await contactRequestService.getCounts();
        if (!cancelled) setContactRequestCount(res.data.unresolved ?? 0);
      } catch {
        // Non-critical; badge just shows 0
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [location.pathname]);

  // Close sidebar when navigating on mobile
  const handleNavClick = () => {
    if (isMobile) setIsSidebarOpen(false);
  };

  const toggleGroup = (id: string) => {
    setCollapsedGroups(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem('sidebar_groups_collapsed', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const isGroupActive = (group: NavGroup) =>
    group.items.some(
      item =>
        item.path === '/'
          ? location.pathname === '/'
          : location.pathname === item.path || location.pathname.startsWith(item.path + '/'),
    );

  const isGroupExpanded = (group: NavGroup) => {
    if (!group.collapsible) return true;
    if (isGroupActive(group)) return true;
    return !collapsedGroups[group.id];
  };

  // Pre-compute derived permissions
  const userRole = normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false);
  const canSeeAppointmentRequests = canViewAppointments(user) && userRole !== 'DENTIST' && userRole !== 'BILLING';
  const canSeeTemplates = canManageUsers(user) || userRole === 'RECEPTIONIST';

  // ── Build navGroups ──────────────────────────────────────────────────────────
  const navGroups: NavGroup[] = [];

  // Genel
  {
    const items: NavItem[] = [{ path: '/dashboard', icon: <LayoutDashboard size={18} />, label: t('common:dashboard') }];
    navGroups.push({ id: 'genel', label: t('common:navGroups.general'), collapsible: false, items });
  }

  // Hasta Yönetimi
  {
    const items: NavItem[] = [];
    if (canViewPatients(user)) {
      items.push({ path: '/patients', icon: <Users size={18} />, label: t('common:patients') });
    }
    if (canViewAppointments(user)) {
      items.push({ path: '/appointments', icon: <Calendar size={18} />, label: t('common:appointments') });
    }
    if (canViewPatients(user)) {
      items.push({ path: '/treatment-cases', icon: <Briefcase size={18} />, label: t('common:treatmentCases') });
      items.push({ path: '/tasks', icon: <CheckSquare size={18} />, label: t('common:tasks') });
    }
    if (canViewPayments(user)) {
      items.push({ path: '/insurance-provisions', icon: <ShieldCheck size={18} />, label: t('common:insurance') });
    }
    if (canViewNoShowDashboard(user)) {
      items.push({ path: '/no-shows', icon: <UserX size={18} />, label: t('common:noShowTracking') });
    }
    if (canViewRecallDashboard(user)) {
      items.push({ path: '/recall', icon: <RotateCcw size={18} />, label: t('recall:nav') });
    }
    if (items.length > 0) {
      navGroups.push({ id: 'hasta', label: t('common:navGroups.patientManagement'), collapsible: true, items });
    }
  }

  // İletişim
  {
    const items: NavItem[] = [];
    if (canViewWhatsAppInbox(user)) {
      items.push({ path: '/whatsapp-inbox', icon: <Inbox size={18} />, label: t('common:whatsappInbox') });
    }
    if (canSeeAppointmentRequests) {
      items.push({ path: '/appointment-requests', icon: <CalendarPlus size={18} />, label: t('common:whatsappRequests') });
      items.push({
        path: '/contact-requests',
        icon: <Inbox size={18} />,
        label: t('common:contactRequests'),
        badge: contactRequestCount > 0 ? contactRequestCount : undefined,
      });
    }
    if (canViewPatients(user)) {
      items.push({ path: '/messages', icon: <MessageSquare size={18} />, label: t('common:messages') });
    }
    if (canSeeTemplates) {
      items.push({ path: '/templates', icon: <Mail size={18} />, label: t('common:templates') });
    }
    if (canViewInstagramInbox(user)) {
      items.push({ path: '/instagram-inbox', icon: <Instagram size={18} />, label: t('common:instagramInbox') });
    }
    if (items.length > 0) {
      navGroups.push({ id: 'iletisim', label: t('common:navGroups.communication'), collapsible: true, items });
    }
  }

  // Finans
  {
    const items: NavItem[] = [];
    if (canViewFinanceDashboard(user)) {
      items.push({ path: '/finance', icon: <BarChart3 size={18} />, label: t('common:financeDashboard') });
    }
    if (canViewPayments(user)) {
      items.push({ path: '/payments', icon: <CreditCard size={18} />, label: t('common:payments') });
      items.push({ path: '/payment-plans', icon: <CreditCard size={18} />, label: t('common:paymentPlans') });
    }
    if (canViewReports(user)) {
      items.push({ path: '/reports', icon: <BarChart2 size={18} />, label: t('common:reports') });
      items.push({ path: '/practitioner-earnings', icon: <TrendingUp size={18} />, label: t('common:practitionerEarnings') });
    }
    if (userRole === 'DENTIST') {
      items.push({ path: '/my-earnings', icon: <Award size={18} />, label: t('common:myEarnings') });
    }
    if (items.length > 0) {
      navGroups.push({ id: 'finans', label: t('common:navGroups.finance'), collapsible: true, items });
    }
  }

  // Stok
  if (canManageInventory(user)) {
    navGroups.push({
      id: 'stok',
      label: t('common:navGroups.stock'),
      collapsible: false,
      items: [{ path: '/inventory', icon: <Package size={18} />, label: t('common:stockTracking') }],
    });
  }

  // Yönetim
  {
    const items: NavItem[] = [];
    if (canViewOrganizationDashboard(user)) {
      items.push({ path: '/organization/dashboard', icon: <Building2 size={18} />, label: t('common:organizationDashboard') });
    }
    if (canViewBranches(user)) {
      items.push({ path: '/branches', icon: <Building2 size={18} />, label: t('common:branches') });
    }
    if (canViewUsers(user)) {
      items.push({ path: '/users', icon: <Users size={18} />, label: t('common:users') });
    }
    if (canViewOperations(user)) {
      items.push({ path: '/operations', icon: <Activity size={18} />, label: t('common:operationsMonitoring') });
    }
    if (items.length > 0) {
      navGroups.push({ id: 'yonetim', label: t('common:navGroups.management'), collapsible: true, items });
    }
  }

  const showLabels = isSidebarOpen || isMobile;

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
          isMobile ? 'w-64' : (isSidebarOpen ? 'w-64' : 'w-20'),
          isMobile ? (isSidebarOpen ? 'translate-x-0' : '-translate-x-full') : 'translate-x-0',
        ].join(' ')}
      >
        {/* Logo */}
        <div className="px-4 h-16 flex items-center border-b border-gray-200 dark:border-gray-700 shrink-0">
          {showLabels ? (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold shrink-0">
                H
              </div>
              <span className="font-bold text-lg tracking-tight truncate">{t('common:appName')}</span>
            </div>
          ) : (
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold mx-auto">
              {t('common:appName')[0]}
            </div>
          )}
        </div>

        {/* Grouped Nav */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto overflow-x-hidden">
          {navGroups.filter(g => g.items.length > 0).map((group, groupIdx) => (
            <div key={group.id} className={groupIdx > 0 ? 'mt-1' : ''}>
              {/* Icon-only: thin divider between groups */}
              {!showLabels && groupIdx > 0 && (
                <div className="my-2 border-t border-gray-100 dark:border-gray-800" />
              )}

              {/* Group header — full sidebar only */}
              {showLabels && (
                group.collapsible ? (
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center justify-between px-2 py-1.5 mb-0.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded"
                  >
                    <span>{group.label}</span>
                    <ChevronDown
                      size={12}
                      className={`transition-transform duration-200 ${isGroupExpanded(group) ? 'rotate-0' : '-rotate-90'}`}
                    />
                  </button>
                ) : (
                  <div className="px-2 py-1.5 mb-0.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                    {group.label}
                  </div>
                )
              )}

              {/* Group items — always shown in icon-only mode; respect collapsed state in full mode */}
              {(isGroupExpanded(group) || !showLabels) && (
                <div className="space-y-0.5">
                  {group.items.map(item => {
                    const isActive =
                      item.path === '/'
                        ? location.pathname === '/'
                        : location.pathname === item.path ||
                          location.pathname.startsWith(item.path + '/');
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={handleNavClick}
                        title={!showLabels ? item.label : undefined}
                        className={[
                          'flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm',
                          !showLabels ? 'justify-center' : '',
                          isActive
                            ? 'bg-primary-50 text-primary-600 font-medium shadow-sm border border-primary-100 dark:bg-primary-900/30 dark:border-primary-800'
                            : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800',
                        ].join(' ')}
                      >
                        <span className={`shrink-0 relative ${isActive ? 'text-primary-600' : 'text-gray-400'}`}>
                          {item.icon}
                          {!showLabels && item.badge != null && (
                            <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-0.5">
                              {item.badge > 99 ? '99+' : item.badge}
                            </span>
                          )}
                        </span>
                        {showLabels && (
                          <span className="flex-1 truncate leading-snug">{item.label}</span>
                        )}
                        {showLabels && item.badge != null && (
                          <span className="shrink-0 min-w-[20px] h-5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold px-1">
                            {item.badge > 99 ? '99+' : item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Bottom: Settings & Logout */}
        <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-700 space-y-0.5 shrink-0">
          <Link
            to="/settings"
            onClick={handleNavClick}
            title={!showLabels ? t('common:settings') : undefined}
            className={[
              'flex items-center gap-3 px-3 py-2 text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800 rounded-lg transition-all text-sm',
              !showLabels ? 'justify-center' : '',
            ].join(' ')}
          >
            <Settings size={18} className="shrink-0 text-gray-400" />
            {showLabels && <span>{t('common:settings')}</span>}
          </Link>
          <button
            onClick={logout}
            title={!showLabels ? t('common:logout') : undefined}
            className={[
              'w-full flex items-center gap-3 px-3 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all text-sm',
              !showLabels ? 'justify-center' : '',
            ].join(' ')}
          >
            <LogOut size={18} className="shrink-0" />
            {showLabels && <span>{t('common:logout')}</span>}
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
            <ClinicSwitcher />
            
            {/* Dark Mode Toggle */}
            <button
              onClick={toggleDark}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500 dark:text-gray-400"
              aria-label={t('common:toggleTheme')}
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
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsUserMenuOpen(prev => !prev)}
                className="flex items-center gap-2 p-1 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                aria-haspopup="menu"
                aria-expanded={isUserMenuOpen}
                aria-label={t('common:profile.accountMenu')}
              >
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-none">{user?.firstName} {user?.lastName}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 capitalize">{user?.role}</p>
                </div>
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-health-100 flex items-center justify-center text-health-700 font-bold border-2 border-health-200 text-sm">
                  {user?.firstName[0]}{user?.lastName[0]}
                </div>
                <ChevronDown size={14} className="hidden sm:block text-gray-400" />
              </button>

              {isUserMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-56 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xl py-2 z-50"
                >
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 sm:hidden">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{user?.firstName} {user?.lastName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 capitalize">{user?.role}</p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      setIsPasswordModalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:text-primary-600 transition-colors"
                  >
                    <KeyRound size={16} className="text-gray-400" />
                    <span>{t('common:profile.changePassword')}</span>
                  </button>
                </div>
              )}
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

      {isPasswordModalOpen && (
        <ChangePasswordModal onClose={() => setIsPasswordModalOpen(false)} />
      )}
    </div>
  );
};

const MainLayout: React.FC = () => <MainLayoutInner />;

export default MainLayout;
