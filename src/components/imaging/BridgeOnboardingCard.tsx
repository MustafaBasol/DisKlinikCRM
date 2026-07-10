import React from 'react';
import { Download, Laptop, Loader2, ShieldAlert, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface BridgeOnboardingInstaller {
  downloadUrl: string;
  version: string;
  sha256: string;
  signed: boolean;
  minimumWindowsBuild: number;
}

export interface BridgeOnboardingConfig {
  enabled: boolean;
  installerAvailable: boolean;
  installer: BridgeOnboardingInstaller | null;
}

interface BridgeOnboardingCardProps {
  loading: boolean;
  error: string | null;
  config: BridgeOnboardingConfig | null;
  onStartSetup: () => void;
  /** True while "All clinics" (or no clinic) is selected — setup is ambiguous without one explicit clinic. */
  clinicRequired: boolean;
}

/**
 * Girdi kartı: yalnızca canManageImagingDevices doğrulandıktan sonra
 * ImagingSettingsPanel tarafından render edilir (yetkisiz kullanıcılar bu
 * bileşeni hiç görmez ve /bridge-onboarding/config'e istek atılmaz). Config
 * yükleme durumu üst bileşende yönetilir — burada yalnızca sunum vardır,
 * onboarding devre dışıyken hiçbir istek/polling tetiklenmez.
 */
const BridgeOnboardingCard: React.FC<BridgeOnboardingCardProps> = ({ loading, error, config, onStartSetup, clinicRequired }) => {
  const { t } = useTranslation(['imaging', 'common']);

  return (
    <div className="card p-6">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
        <Laptop size={20} className="text-gray-400" /> {t('imaging:onboarding.card.title')}
      </h2>
      <p className="mb-1 text-sm text-gray-500">{t('imaging:onboarding.card.description')}</p>
      <p className="mb-4 text-xs text-gray-400">{t('imaging:onboarding.card.supportedSystems')}</p>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> {t('common:loading', { defaultValue: 'Yükleniyor...' })}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && config && !config.enabled && (
        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500">
          {t('imaging:onboarding.card.notAvailable')}
        </div>
      )}

      {!loading && !error && config?.enabled && !config.installerAvailable && (
        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500">
          {t('imaging:onboarding.card.installerUnavailable')}
        </div>
      )}

      {!loading && !error && config?.enabled && config.installerAvailable && config.installer && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">{t('imaging:onboarding.card.version', { version: config.installer.version })}</p>
          {!config.installer.signed && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <ShieldAlert size={15} className="mt-0.5 flex-shrink-0" />
              <span>{t('imaging:onboarding.card.unsignedWarning')}</span>
            </div>
          )}
          {clinicRequired && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <ShieldAlert size={15} className="mt-0.5 flex-shrink-0" />
              <span>{t('imaging:onboarding.card.clinicRequired')}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <a href={config.installer.downloadUrl} className="btn-secondary flex items-center gap-1.5 text-sm">
              <Download size={16} /> {t('imaging:onboarding.card.download')}
            </a>
            <button
              onClick={onStartSetup}
              disabled={clinicRequired}
              title={clinicRequired ? (t('imaging:onboarding.card.clinicRequired') as string) : undefined}
              className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Wrench size={16} /> {t('imaging:onboarding.card.setup')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BridgeOnboardingCard;
