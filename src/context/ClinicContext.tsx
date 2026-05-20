import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';

interface ClinicOption {
  id: string;
  name: string;
  slug?: string;
  status: string;
  memberRole?: string;
}

interface ClinicContextType {
  availableClinics: ClinicOption[];
  selectedClinicId: string;        // "all" | clinicId
  setSelectedClinicId: (id: string) => void;
  canAccessAllClinics: boolean;
  hasMultipleClinics: boolean;
  selectedClinicName: string;      // Seçili klinik adı veya "Tüm Klinikler"
}

const ClinicContext = createContext<ClinicContextType | undefined>(undefined);

const STORAGE_KEY = 'hcrm_clinic_id';

export const ClinicProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const [selectedClinicId, setSelectedClinicIdState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? 'all'
  );

  const availableClinics: ClinicOption[] = user?.clinics ?? (user?.clinic ? [{ ...user.clinic, status: 'active' }] : []);
  const canAccessAllClinics = user?.canAccessAllClinics ?? false;
  const hasMultipleClinics = availableClinics.length > 1;

  // Kullanıcı değişince veya klinik listesi güncellenince geçersiz seçimi düzelt
  useEffect(() => {
    if (!user) return;
    if (selectedClinicId === 'all') return;
    // Seçilen klinik mevcut listede yok ve canAccessAllClinics false ise varsayılana dön
    const valid = availableClinics.some(c => c.id === selectedClinicId);
    if (!valid) {
      const fallback = availableClinics[0]?.id ?? 'all';
      setSelectedClinicIdState(fallback);
      localStorage.setItem(STORAGE_KEY, fallback);
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSelectedClinicId = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setSelectedClinicIdState(id);
  };

  const selectedClinicName =
    selectedClinicId === 'all'
      ? 'Tüm Klinikler'
      : (availableClinics.find(c => c.id === selectedClinicId)?.name ?? 'Klinik');

  return (
    <ClinicContext.Provider
      value={{
        availableClinics,
        selectedClinicId,
        setSelectedClinicId,
        canAccessAllClinics,
        hasMultipleClinics,
        selectedClinicName,
      }}
    >
      {children}
    </ClinicContext.Provider>
  );
};

export const useClinic = (): ClinicContextType => {
  const ctx = useContext(ClinicContext);
  if (!ctx) throw new Error('useClinic must be used within ClinicProvider');
  return ctx;
};
