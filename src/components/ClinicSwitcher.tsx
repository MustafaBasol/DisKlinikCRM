import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Building2, Check, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useClinic } from '../context/ClinicContext';

const ClinicSwitcher: React.FC = () => {
  const { t } = useTranslation('common');
  const { availableClinics, selectedClinicId, setSelectedClinicId, canAccessAllClinics, hasMultipleClinics, selectedClinicName } = useClinic();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const displayedClinicName = selectedClinicId === 'all'
    ? t('allClinics')
    : selectedClinicName === t('clinic')
      ? t('clinic')
      : selectedClinicName;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Tek klinik — etkileşimsiz rozet
  if (!hasMultipleClinics && !canAccessAllClinics) {
    return (
      <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-xs font-bold border border-primary-100 dark:border-primary-800">
        <span className="w-2 h-2 bg-primary-500 rounded-full animate-pulse" />
        <Building2 size={12} />
        {displayedClinicName}
      </div>
    );
  }

  // Çok klinik / sahip → açılır menü
  return (
    <div className="relative hidden lg:block" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-1.5 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full text-xs font-bold border border-primary-100 dark:border-primary-800 hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors"
      >
        {selectedClinicId === 'all' ? <Globe size={12} /> : <Building2 size={12} />}
        <span className="max-w-[160px] truncate">{displayedClinicName}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 py-1 z-50">
          {/* Tüm Klinikler seçeneği — sadece yetkili kullanıcılar */}
          {canAccessAllClinics && (
            <button
              onClick={() => { setSelectedClinicId('all'); setOpen(false); }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
            >
              <Globe size={14} className="text-primary-500 shrink-0" />
              <span className="flex-1 text-left font-medium text-gray-700 dark:text-gray-200">{t('allClinics')}</span>
              {selectedClinicId === 'all' && <Check size={14} className="text-primary-500" />}
            </button>
          )}

          {availableClinics.length > 0 && canAccessAllClinics && (
            <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          )}

          {availableClinics.map(clinic => (
            <button
              key={clinic.id}
              onClick={() => { setSelectedClinicId(clinic.id); setOpen(false); }}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
            >
              <Building2 size={14} className="text-gray-400 shrink-0" />
              <span className="flex-1 text-left text-gray-700 dark:text-gray-200 truncate">{clinic.name}</span>
              {selectedClinicId === clinic.id && <Check size={14} className="text-primary-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ClinicSwitcher;
