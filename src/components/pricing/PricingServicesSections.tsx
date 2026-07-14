import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ServiceCardProps {
  title: string;
  priceLabel?: string;
  items: string[];
  description?: string;
}

const ServiceCard = ({ title, priceLabel, items, description }: ServiceCardProps) => (
  <div className="landing-surface flex flex-col rounded-xl p-5">
    <h3 className="text-base font-semibold text-[var(--landing-heading)]">{title}</h3>
    {priceLabel ? <p className="mt-1.5 text-lg font-bold text-[var(--landing-heading)]">{priceLabel}</p> : null}
    <ul className="mt-3 flex-1 space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm leading-6 text-[var(--landing-text)]">
          <Check size={15} className="mt-1 shrink-0 text-[var(--landing-teal)]" aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
    {description ? <p className="mt-3 text-xs leading-5 text-[var(--landing-muted)]">{description}</p> : null}
  </div>
);

export const SetupSection = () => {
  const { t } = useTranslation('pricingPage');

  return (
    <section id="setup" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.1rem]">{t('setup.title')}</h2>
        </div>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <ServiceCard
            title={t('setup.starter.title')}
            priceLabel={t('setup.starter.priceLabel')}
            items={t('setup.starter.items', { returnObjects: true }) as string[]}
          />
          <ServiceCard
            title={t('setup.professional.title')}
            priceLabel={t('setup.professional.priceLabel')}
            items={t('setup.professional.items', { returnObjects: true }) as string[]}
          />
          <ServiceCard
            title={t('setup.enterprise.title')}
            items={t('setup.enterprise.items', { returnObjects: true }) as string[]}
            description={t('setup.enterprise.description')}
          />
        </div>
      </div>
    </section>
  );
};

export const MigrationSection = () => {
  const { t } = useTranslation('pricingPage');

  return (
    <section id="migration" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.1rem]">{t('migration.title')}</h2>
          <p className="mt-4 text-sm leading-7 text-[var(--landing-muted)]">{t('migration.topNote')}</p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ServiceCard title={t('migration.basic.title')} priceLabel={t('migration.basic.priceLabel')} items={t('migration.basic.items', { returnObjects: true }) as string[]} />
          <ServiceCard title={t('migration.standard.title')} priceLabel={t('migration.standard.priceLabel')} items={t('migration.standard.items', { returnObjects: true }) as string[]} />
          <ServiceCard title={t('migration.advanced.title')} priceLabel={t('migration.advanced.priceLabel')} items={t('migration.advanced.items', { returnObjects: true }) as string[]} />
          <ServiceCard title={t('migration.custom.title')} priceLabel={t('migration.custom.priceLabel')} items={t('migration.custom.items', { returnObjects: true }) as string[]} />
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-[var(--landing-muted)]">{t('migration.note')}</p>
        <p className="mx-auto mt-2 max-w-2xl text-center text-xs leading-5 text-[var(--landing-muted)]">{t('migration.generalDescription')}</p>
        <div className="mt-6 text-center">
          <a
            href="#demo"
            className="inline-flex items-center justify-center rounded-xl bg-[var(--landing-teal)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0b7e71] focus:outline-none focus:ring-2 focus:ring-[var(--landing-teal)] focus:ring-offset-2"
          >
            {t('migration.cta')}
          </a>
        </div>
      </div>
    </section>
  );
};

export const TrainingSection = () => {
  const { t } = useTranslation('pricingPage');
  const itemKeys = ['onlineExtra', 'onSite', 'customReport', 'customAutomation', 'customApi', 'sla'] as const;

  return (
    <section id="training" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.1rem]">{t('training.title')}</h2>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {itemKeys.map((key) => (
            <div key={key} className="landing-surface rounded-xl p-5">
              <p className="text-sm font-semibold text-[var(--landing-heading)]">{t(`training.items.${key}.name`)}</p>
              <p className="mt-2 text-base font-bold text-[var(--landing-heading)]">{t(`training.items.${key}.priceLabel`)}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-[var(--landing-muted)]">{t('training.note')}</p>
      </div>
    </section>
  );
};
