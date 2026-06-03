import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const PLATFORM_CSRF_COOKIE_NAME = 'platform_csrf_token';
const UNSAFE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
  createdAt?: string;
}

interface PlatformAuthState {
  token: string | null;
  admin: PlatformAdmin | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.substring(name.length + 1)) : null;
}

const platformApi = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

platformApi.interceptors.request.use((config) => {
  const method = config.method?.toLowerCase();
  if (method && UNSAFE_METHODS.has(method)) {
    const csrfToken = readCookie(PLATFORM_CSRF_COOKIE_NAME);
    if (csrfToken) {
      config.headers = config.headers ?? {};
      config.headers['X-CSRF-Token'] = csrfToken;
    }
  }

  return config;
});

platformApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = String(error.config?.url ?? '');
    const isAuthProbe = (
      url === '/platform/me' ||
      url === '/platform/auth/csrf' ||
      url === '/platform/auth/login' ||
      url === '/platform/auth/logout'
    );
    if (error.response?.status === 401 && !isAuthProbe) {
      window.dispatchEvent(new CustomEvent('platform-auth:expired'));
    }
    return Promise.reject(error);
  },
);

const PlatformAuthContext = createContext<PlatformAuthState | null>(null);

export const PlatformAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearLegacyStorage = useCallback(() => {
    localStorage.removeItem('platform_token');
    localStorage.removeItem('platform_admin');
  }, []);

  useEffect(() => {
    const handleExpired = () => {
      clearLegacyStorage();
      setAdmin(null);
    };

    const initAuth = async () => {
      clearLegacyStorage();
      try {
        const { data } = await platformApi.get('/platform/me');
        await platformApi.get('/platform/auth/csrf').catch(() => undefined);
        setAdmin(data);
      } catch {
        setAdmin(null);
      } finally {
        setIsLoading(false);
      }
    };

    window.addEventListener('platform-auth:expired', handleExpired);
    initAuth();
    return () => window.removeEventListener('platform-auth:expired', handleExpired);
  }, [clearLegacyStorage]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await platformApi.post('/platform/auth/login', { email, password });
    clearLegacyStorage();
    setAdmin(res.data.admin);
  }, [clearLegacyStorage]);

  const logout = useCallback(() => {
    platformApi.post('/platform/auth/logout').catch(() => undefined);
    clearLegacyStorage();
    setAdmin(null);
  }, [clearLegacyStorage]);

  return (
    <PlatformAuthContext.Provider value={{
      token: null,
      admin,
      isAuthenticated: !!admin,
      isLoading,
      login,
      logout,
    }}>
      {children}
    </PlatformAuthContext.Provider>
  );
};

export const usePlatformAuth = (): PlatformAuthState => {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error('usePlatformAuth must be used inside PlatformAuthProvider');
  return ctx;
};

export const usePlatformApi = () => {
  usePlatformAuth();
  return React.useMemo(() => platformApi, []);
};
