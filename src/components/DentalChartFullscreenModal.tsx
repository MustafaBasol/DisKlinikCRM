import React, { useEffect } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DentalChartFullscreenModalProps {
  open: boolean;
  patientName?: string;
  patientMode: boolean;
  onPatientModeChange: (enabled: boolean) => void;
  onClose: () => void;
  legend: React.ReactNode;
  chart: React.ReactNode;
  detailPanel: React.ReactNode;
}

const DentalChartFullscreenModal: React.FC<DentalChartFullscreenModalProps> = ({
  open,
  patientName,
  patientMode,
  onPatientModeChange,
  onClose,
  legend,
  chart,
  detailPanel,
}) => {
  const { t } = useTranslation(['patients', 'common']);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/70 p-3 backdrop-blur-sm md:p-5">
      <div className="mx-auto flex h-full max-w-[1440px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-slate-50 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <header className="flex flex-col gap-4 border-b border-slate-200 bg-white px-5 py-4 dark:border-gray-700 dark:bg-gray-800 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('patients:dentalChart.patientPresentation', { defaultValue: 'Patient presentation' })}
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-950 dark:text-white">
              {patientName || t('patients:dentalChart.title')}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onPatientModeChange(!patientMode)}
              className={[
                'btn-secondary min-h-10',
                patientMode ? 'border-primary-200 bg-primary-50 text-primary-700 dark:bg-primary-900/20' : '',
              ].join(' ')}
            >
              {patientMode ? <EyeOff size={16} /> : <Eye size={16} />}
              {patientMode
                ? t('patients:dentalChart.technicalView', { defaultValue: 'Clinical View' })
                : t('patients:dentalChart.patientView', { defaultValue: 'Patient View' })}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-primary-400 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              <X size={16} />
              {t('common:close', { defaultValue: 'Close' })}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="mb-4">{legend}</div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0">{chart}</div>
            <div className="xl:sticky xl:top-0">{detailPanel}</div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default DentalChartFullscreenModal;
