import { useTranslation } from 'react-i18next';
import AddonPackageCard from './AddonPackageCard';
import { formatTRY } from '../../data/pricing';
import { channelAddons } from '../../data/pricingAddons';

const PricingChannelsSection = () => {
  const { t } = useTranslation('pricingPage');
  const vatSuffix = t('vatSuffix');

  return (
    <section id="channel-addons" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.1rem]">{t('channelAddons.title')}</h2>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {channelAddons.map((addon) => (
            <AddonPackageCard
              key={addon.key}
              name={t(`channelAddons.packages.${addon.key}.name`)}
              metaLine={`${t(`channelAddons.packages.${addon.key}.setupLabel`)}: ${formatTRY(addon.setupFee)} ${vatSuffix}`}
              priceLine={`${formatTRY(addon.monthly)} ${vatSuffix}`}
              cta={t('channelAddons.cta')}
            />
          ))}
        </div>

        <ul className="mx-auto mt-6 max-w-2xl space-y-1.5 text-center text-xs leading-5 text-[var(--landing-muted)]">
          {(t('channelAddons.notes', { returnObjects: true }) as string[]).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default PricingChannelsSection;
