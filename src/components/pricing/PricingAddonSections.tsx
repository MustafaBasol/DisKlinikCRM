import { useTranslation } from 'react-i18next';
import AddonPackageCard from './AddonPackageCard';
import { formatTRY, type BillingPeriod } from '../../data/pricing';
import { aiPackages, storagePackages, patientCapacityPackages } from '../../data/pricingAddons';

interface BillingAware {
  billingPeriod: BillingPeriod;
}

export const AiAddonsSection = ({ billingPeriod }: BillingAware) => {
  const { t } = useTranslation('pricingPage');
  const vatSuffix = t('vatSuffix');

  return (
    <section id="ai-addons" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('aiAddons.label')}</p>
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.1rem]">{t('aiAddons.title')}</h2>
          <p className="mt-4 text-base leading-8 text-[var(--landing-muted)]">{t('aiAddons.description')}</p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {aiPackages.map((pkg) => {
            const amount = billingPeriod === 'monthly' ? pkg.monthly : pkg.yearly;
            return (
              <AddonPackageCard
                key={pkg.key}
                name={t(`aiAddons.packages.${pkg.key}.name`)}
                metaLine={`${t('aiAddons.quotaLabel')}: +${new Intl.NumberFormat('tr-TR').format(pkg.extraQuota)} ${t('aiAddons.quotaUnit')}`}
                priceLine={`${formatTRY(amount)} ${vatSuffix}`}
                cta={t('aiAddons.cta')}
              />
            );
          })}
          <AddonPackageCard
            name={t('aiAddons.enterprise.name')}
            metaLine={t('aiAddons.enterprise.description')}
            priceLine={t('aiAddons.enterprise.price')}
            cta={t('aiAddons.cta')}
          />
        </div>

        <ul className="mx-auto mt-6 max-w-2xl space-y-1.5 text-center text-xs leading-5 text-[var(--landing-muted)]">
          {(t('aiAddons.notes', { returnObjects: true }) as string[]).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <p className="mx-auto mt-4 max-w-2xl text-center text-xs leading-5 text-[var(--landing-muted)]">{t('aiAddons.definition')}</p>
        <p className="mx-auto mt-1 max-w-2xl text-center text-xs leading-5 text-[var(--landing-muted)]">{t('aiAddons.definitionNote')}</p>
        <p className="mx-auto mt-1 max-w-2xl text-center text-xs leading-5 text-[var(--landing-muted)]">{t('aiAddons.sessionNote')}</p>
      </div>
    </section>
  );
};

export const StorageAddonsSection = ({ billingPeriod }: BillingAware) => {
  const { t } = useTranslation('pricingPage');
  const vatSuffix = t('vatSuffix');

  return (
    <section id="storage-addons" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.1rem]">{t('storageAddons.title')}</h2>
          <p className="mt-4 text-base leading-8 text-[var(--landing-muted)]">{t('storageAddons.description')}</p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {storagePackages.map((pkg) => {
            const amount = billingPeriod === 'monthly' ? pkg.monthly : pkg.yearly;
            return (
              <AddonPackageCard
                key={pkg.key}
                name={t(`storageAddons.packages.${pkg.key}.name`)}
                priceLine={`${formatTRY(amount)} ${vatSuffix}`}
                cta={t('storageAddons.cta')}
              />
            );
          })}
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-[var(--landing-muted)]">{t('storageAddons.dicomNote')}</p>
        <p className="mx-auto mt-1 max-w-2xl text-center text-xs leading-5 text-[var(--landing-muted)]">{t('storageAddons.dicomDescription')}</p>
      </div>
    </section>
  );
};

export const CapacityAddonsSection = ({ billingPeriod }: BillingAware) => {
  const { t } = useTranslation('pricingPage');
  const vatSuffix = t('vatSuffix');

  return (
    <section id="capacity-addons" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.1rem]">{t('capacity.title')}</h2>
          <p className="mt-4 text-sm leading-7 text-[var(--landing-muted)]">{t('capacity.definition')}</p>
          <p className="mt-2 text-sm leading-7 text-[var(--landing-muted)]">{t('capacity.archiveNote')}</p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {patientCapacityPackages.map((pkg) => {
            const amount = billingPeriod === 'monthly' ? pkg.monthly : pkg.yearly;
            return (
              <AddonPackageCard
                key={pkg.key}
                name={t(`capacity.packages.${pkg.key}.name`)}
                priceLine={`${formatTRY(amount)} ${vatSuffix}`}
                cta={t('aiAddons.cta')}
              />
            );
          })}
          <AddonPackageCard
            name={t('capacity.enterprise.name')}
            priceLine={t('capacity.enterprise.price')}
            cta={t('aiAddons.cta')}
          />
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-[var(--landing-muted)]">{t('capacity.note')}</p>
      </div>
    </section>
  );
};
