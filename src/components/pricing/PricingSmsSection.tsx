import { useTranslation } from 'react-i18next';
import { formatTRY } from '../../data/pricing';
import { smsPackages } from '../../data/pricingAddons';

const PricingSmsSection = () => {
  const { t } = useTranslation('pricingPage');
  const vatSuffix = t('vatSuffix');
  const usageNotes = t('sms.usageNotes', { returnObjects: true }) as string[];

  return (
    <section id="sms" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.1rem]">{t('sms.title')}</h2>
          <p className="mt-4 text-sm leading-7 text-[var(--landing-muted)]">{t('sms.subtitle')}</p>
          <p className="mt-3 text-sm leading-7 text-[var(--landing-muted)]">{t('sms.infoNote')}</p>
          <p className="mt-1 text-sm leading-7 text-[var(--landing-muted)]">{t('sms.trackingNote')}</p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {smsPackages.map((pkg) => (
            <div key={pkg.key} className="landing-surface rounded-xl p-5">
              <p className="text-sm font-semibold text-[var(--landing-heading)]">{t(`sms.packages.${pkg.key}.name`)}</p>
              <p className="mt-2 text-xs text-[var(--landing-muted)]">
                {new Intl.NumberFormat('tr-TR').format(pkg.smsCount)} {t('sms.unitLabel')}
              </p>
              <p className="mt-2 text-base font-bold text-[var(--landing-heading)]">
                {formatTRY(pkg.price)} {vatSuffix}
              </p>
            </div>
          ))}
          <div className="landing-surface rounded-xl p-5">
            <p className="text-sm font-semibold text-[var(--landing-heading)]">{t('sms.highVolume.name')}</p>
            <p className="mt-2 text-xs text-[var(--landing-muted)]">{t('sms.highVolume.count')} {t('sms.unitLabel')}</p>
            <p className="mt-2 text-base font-bold text-[var(--landing-teal)]">{t('sms.highVolume.price')}</p>
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-[var(--landing-muted)]">{t('sms.billingNote')}</p>

        <div className="mt-6 text-center">
          <a
            href="#demo"
            className="inline-flex items-center justify-center rounded-xl bg-[var(--landing-teal)] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0b7e71] focus:outline-none focus:ring-2 focus:ring-[var(--landing-teal)] focus:ring-offset-2"
          >
            {t('sms.cta')}
          </a>
          <p className="mx-auto mt-3 max-w-xl text-xs leading-5 text-[var(--landing-muted)]">{t('sms.activationNote')}</p>
        </div>

        <ul className="mx-auto mt-8 max-w-2xl space-y-2">
          {usageNotes.map((note) => (
            <li key={note} className="text-xs leading-5 text-[var(--landing-muted)]">{note}</li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default PricingSmsSection;
