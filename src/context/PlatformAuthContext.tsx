import React, { createContext, useContext, useState, useCallback } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

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
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const PlatformAuthContext = createContext<PlatformAuthState | null>(null);

export const PlatformAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('platform_token'));
  const [admin, setAdmin] = useState<PlatformAdmin | null>(() => {
    const raw = localStorage.getItem('platform_admin');
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback(async (email: string, password: string) => {
    const res = await axios.post(`${API_URL}/platform/auth/login`, { email, password });
    const { token: newToken, admin: newAdmin } = res.data;
    localStorage.setItem('platform_token', newToken);
    localStorage.setItem('platform_admin', JSON.stringify(newAdmin));
    setToken(newToken);
    setAdmin(newAdmin);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('platform_token');
    localStorage.removeItem('platform_admin');
    setToken(null);
    setAdmin(null);
  }, []);

  return (
    <PlatformAuthContext.Provider value={{ token, admin, isAuthenticated: !!token, login, logout }}>
      {children}
    </PlatformAuthContext.Provider>
  );
};

export const usePlatformAuth = (): PlatformAuthState => {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error('usePlatformAuth must be used inside PlatformAuthProvider');
  return ctx;
};

/** Axios instance pre-configured with platform token */
export const usePlatformApi = () => {
  const { token } = usePlatformAuth();

  return React.useMemo(
    () =>
      axios.create({
        baseURL: API_URL,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
    [token],
  );
};
