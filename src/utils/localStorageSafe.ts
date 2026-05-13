import { logger } from './logger';

const resolveStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch (e) {
    logger.warn('[storage] localStorage not accessible', e);
    return null;
  }
};

export const safeLocalStorage = {
  getItem: (key: string): string | null => {
    const s = resolveStorage();
    if (!s) return null;
    try { return s.getItem(key); } catch (e) { logger.warn(`[storage] read failed: ${key}`, e); return null; }
  },
  setItem: (key: string, value: string): void => {
    const s = resolveStorage();
    if (!s) return;
    try { s.setItem(key, value); } catch (e) { logger.warn(`[storage] write failed: ${key}`, e); }
  },
  removeItem: (key: string): void => {
    const s = resolveStorage();
    if (!s) return;
    try { s.removeItem(key); } catch (e) { logger.warn(`[storage] remove failed: ${key}`, e); }
  },
};

export const safeParseJson = (raw: string | null, context: string): unknown => {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { logger.warn(`[storage] JSON parse failed for ${context}`, e); return null; }
};

export const parseLocalObject = <T extends Record<string, unknown>>(raw: string | null, ctx: string): T | null => {
  const parsed = safeParseJson(raw, ctx);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T;
  return null;
};

// Aile Dis CRM scoped cache keys (clinic-scoped, not tenant-scoped)
const AUTH_TOKEN_KEY    = 'hcrm_auth_token';
const CLINIC_ID_KEY    = 'hcrm_clinic_id';
const USER_CACHE_KEY   = 'hcrm_user';
const CLINIC_CACHE_KEY = 'hcrm_clinic';

export const readAuthToken     = (): string | null => safeLocalStorage.getItem(AUTH_TOKEN_KEY);
export const writeAuthToken    = (token: string | null): void => {
  if (!token) { safeLocalStorage.removeItem(AUTH_TOKEN_KEY); return; }
  safeLocalStorage.setItem(AUTH_TOKEN_KEY, token);
};

export const readClinicId      = (): string | null => safeLocalStorage.getItem(CLINIC_ID_KEY);
export const writeClinicId     = (id: string | null): void => {
  if (!id) { safeLocalStorage.removeItem(CLINIC_ID_KEY); return; }
  safeLocalStorage.setItem(CLINIC_ID_KEY, id);
};

export const readUserCache     = <T extends Record<string, unknown>>(): T | null =>
  parseLocalObject<T>(safeLocalStorage.getItem(USER_CACHE_KEY), 'user cache');

export const writeUserCache    = <T extends Record<string, unknown>>(value: T | null): void => {
  if (!value) { safeLocalStorage.removeItem(USER_CACHE_KEY); return; }
  try { safeLocalStorage.setItem(USER_CACHE_KEY, JSON.stringify(value)); } catch (e) { logger.warn('[storage] writeUserCache failed', e); }
};

export const readClinicCache   = <T extends Record<string, unknown>>(): T | null =>
  parseLocalObject<T>(safeLocalStorage.getItem(CLINIC_CACHE_KEY), 'clinic cache');

export const writeClinicCache  = <T extends Record<string, unknown>>(value: T | null): void => {
  if (!value) { safeLocalStorage.removeItem(CLINIC_CACHE_KEY); return; }
  try { safeLocalStorage.setItem(CLINIC_CACHE_KEY, JSON.stringify(value)); } catch (e) { logger.warn('[storage] writeClinicCache failed', e); }
};

export const clearSessionCaches = (): void => {
  [AUTH_TOKEN_KEY, CLINIC_ID_KEY, USER_CACHE_KEY, CLINIC_CACHE_KEY].forEach(k =>
    safeLocalStorage.removeItem(k)
  );
};
