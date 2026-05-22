import React, { createContext, useContext, useState, useEffect } from 'react';
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
  login: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const AUTH_VERSION = 'aile-dis-v1';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const savedAuthVersion = localStorage.getItem('hcrm_auth_version');
      if (savedAuthVersion !== AUTH_VERSION) {
        localStorage.removeItem('hcrm_token');
        localStorage.removeItem('hcrm_user');
        localStorage.setItem('hcrm_auth_version', AUTH_VERSION);
        setLoading(false);
        return;
      }

      const savedToken = localStorage.getItem('hcrm_token');
      const savedUser = localStorage.getItem('hcrm_user');
      
      if (savedToken && savedUser) {
        try {
          // Verify token
          const { data } = await authService.me();
          setToken(savedToken);
          setUser(data);
          // Also update local storage if user details changed
          localStorage.setItem('hcrm_user', JSON.stringify(data));
        } catch (error) {
          // Token invalid or expired
          setToken(null);
          setUser(null);
          localStorage.removeItem('hcrm_token');
          localStorage.removeItem('hcrm_user');
        }
      }
      setLoading(false);
    };

    initAuth();

    const handleAuthExpired = () => {
      setToken(null);
      setUser(null);
      localStorage.removeItem('hcrm_token');
      localStorage.removeItem('hcrm_user');
      // Dispatch an event for App.tsx to catch and show a toast, or we can just let ProtectedRoute handle the redirect.
      // We will clear state, which will cause isAuthenticated to become false.
    };

    window.addEventListener('auth:expired', handleAuthExpired);
    return () => window.removeEventListener('auth:expired', handleAuthExpired);
  }, []);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('hcrm_token', newToken);
    localStorage.setItem('hcrm_user', JSON.stringify(newUser));
    localStorage.setItem('hcrm_auth_version', AUTH_VERSION);
  };

  const logout = () => {
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
          <p className="mt-4 text-slate-500 dark:text-slate-400">Aile Diş CRM yükleniyor...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!token }}>
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
