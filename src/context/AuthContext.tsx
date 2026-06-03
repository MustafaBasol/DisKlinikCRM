import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { authService } from '../services/api';

interface ClinicInfo {
  id: string;
  name: string;
  slug?: string;
  status: string;
  memberRole?: string;
  currency?: string;
  timezone?: string;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  normalizedRole?: string;
  organizationId?: string;
  canAccessAllClinics?: boolean;
  allowedClinicIds?: string[];
  clinic: {
    id: string;
    name: string;
    currency?: string;
    timezone?: string;
  };
  clinics?: ClinicInfo[];
  organization?: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  /** Backend tarafından hesaplanmış izin bayrakları */
  permissions?: {
    canViewOrganizationDashboard: boolean;
    canDeletePatient: boolean;
    canManageUsers: boolean;
    canViewReports: boolean;
    canManagePayments: boolean;
    canManageInventory: boolean;
    canManageBranches: boolean;
    canAssignUserClinics: boolean;
    // WhatsApp izinleri
    canManageWhatsAppConnections?: boolean;
    canViewWhatsAppStatus?: boolean;
    canAssignWhatsAppToClinic?: boolean;
  };
  defaultClinicId?: string | null;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const AUTH_VERSION = 'aile-dis-cookie-v1';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation('common');
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      localStorage.removeItem('hcrm_token');
      localStorage.removeItem('hcrm_user');
      localStorage.setItem('hcrm_auth_version', AUTH_VERSION);

      try {
        const { data } = await authService.me();
        await authService.csrf().catch(() => undefined);
        setUser(data);
      } catch {
        setUser(null);
      } finally {
        setToken(null);
        setLoading(false);
      }
    };

    initAuth();

    const handleAuthExpired = () => {
      setToken(null);
      setUser(null);
      localStorage.removeItem('hcrm_token');
      localStorage.removeItem('hcrm_user');
    };

    window.addEventListener('auth:expired', handleAuthExpired);
    return () => window.removeEventListener('auth:expired', handleAuthExpired);
  }, []);

  const login = (newUser: User) => {
    setToken(null);
    setUser(newUser);
    localStorage.removeItem('hcrm_token');
    localStorage.removeItem('hcrm_user');
    localStorage.setItem('hcrm_auth_version', AUTH_VERSION);
  };

  const logout = () => {
    authService.logout().catch(() => undefined);
    setToken(null);
    setUser(null);
    localStorage.removeItem('hcrm_token');
    localStorage.removeItem('hcrm_user');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="flex flex-col items-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-slate-500 dark:text-slate-400">{t('loadingApp')}</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
