import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useClinic } from './ClinicContext';
import { clinicOperatingPreferencesService } from '../services/api';
import {
  ClinicOperatingPreferences,
  defaultPreferencesForClinic,
  formatCurrencyWithPreference,
  formatDateTimeWithPreference,
  formatDateWithPreference,
  formatNumberWithPreference,
  formatTimeWithPreference,
} from '../utils/clinicPreferences';

type FormatOptions = Intl.NumberFormatOptions;

type ClinicPreferencesContextType = {
  preferences: ClinicOperatingPreferences;
  loading: boolean;
  clinicId?: string;
  defaultCurrency: string;
  locale: string;
  timezone: string;
  refreshPreferences: () => Promise<void>;
  formatCurrency: (value: number | null | undefined, currency?: string | null, options?: FormatOptions) => string;
  formatNumber: (value: number | null | undefined, options?: FormatOptions) => string;
  formatDate: (value: string | Date | null | undefined) => string;
  formatTime: (value: string | Date | null | undefined) => string;
  formatDateTime: (value: string | Date | null | undefined) => string;
};

const ClinicPreferencesContext = createContext<ClinicPreferencesContextType | undefined>(undefined);

export const CLINIC_OPERATING_PREFERENCES_UPDATED_EVENT = 'clinic:operating-preferences-updated';

export const ClinicPreferencesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { availableClinics, selectedClinicId } = useClinic();

  const selectedClinic =
    selectedClinicId !== 'all'
      ? availableClinics.find((clinic) => clinic.id === selectedClinicId) ?? user?.clinic
      : availableClinics.find((clinic) => clinic.id === user?.defaultClinicId) ??
        availableClinics[0] ??
        user?.clinic;

  const clinicId = selectedClinic?.id;
  const fallbackPreferences = useMemo(
    () => defaultPreferencesForClinic(selectedClinic ?? user?.clinic),
    [selectedClinic?.currency, selectedClinic?.timezone, user?.clinic?.currency, user?.clinic?.timezone],
  );
  const [preferences, setPreferences] = useState<ClinicOperatingPreferences>(fallbackPreferences);
  const [loading, setLoading] = useState(false);

  const refreshPreferences = useCallback(async () => {
    if (!clinicId) {
      setPreferences(fallbackPreferences);
      return;
    }

    setLoading(true);
    try {
      const res = await clinicOperatingPreferencesService.get(clinicId);
      setPreferences(res.data.preferences || fallbackPreferences);
    } catch {
      setPreferences(fallbackPreferences);
    } finally {
      setLoading(false);
    }
  }, [clinicId, fallbackPreferences]);

  useEffect(() => {
    refreshPreferences();
  }, [refreshPreferences]);

  useEffect(() => {
    const handleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ clinicId?: string; preferences?: ClinicOperatingPreferences }>).detail;
      if (!detail?.preferences) return;
      if (!clinicId || detail.clinicId === clinicId) {
        setPreferences(detail.preferences);
      }
    };

    window.addEventListener(CLINIC_OPERATING_PREFERENCES_UPDATED_EVENT, handleUpdated);
    return () => window.removeEventListener(CLINIC_OPERATING_PREFERENCES_UPDATED_EVENT, handleUpdated);
  }, [clinicId]);

  const value = useMemo<ClinicPreferencesContextType>(() => ({
    preferences,
    loading,
    clinicId,
    defaultCurrency: preferences.currency,
    locale: preferences.locale,
    timezone: preferences.timezone,
    refreshPreferences,
    formatCurrency: (amount, currency, options) =>
      formatCurrencyWithPreference(amount, preferences, currency || preferences.currency, options),
    formatNumber: (amount, options) => formatNumberWithPreference(amount, preferences, options),
    formatDate: (date) => formatDateWithPreference(date, preferences),
    formatTime: (date) => formatTimeWithPreference(date, preferences),
    formatDateTime: (date) => formatDateTimeWithPreference(date, preferences),
  }), [clinicId, loading, preferences, refreshPreferences]);

  return (
    <ClinicPreferencesContext.Provider value={value}>
      {children}
    </ClinicPreferencesContext.Provider>
  );
};

export const useClinicPreferences = (): ClinicPreferencesContextType => {
  const ctx = useContext(ClinicPreferencesContext);
  if (!ctx) throw new Error('useClinicPreferences must be used within ClinicPreferencesProvider');
  return ctx;
};
