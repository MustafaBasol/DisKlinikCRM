import { useTranslation } from 'react-i18next';
import { trustItems } from '../../data/landing';

const TrustSection = () => {
  const { t } = useTranslation('landing');

  return (
    <section className="pb-16 sm:pb-24">
      <div className="landing-container grid gap-8 lg:grid-cols-[0.84fr_1.16fr] lg:gap-14">
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('trust.label')}</p>
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.35rem]">{t('trust.title')}</h2>
          <p className="mt-4 max-w-lg text-base leading-8 text-[var(--landing-muted)]">{t('trust.description')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {trustItems.map(({ icon: Icon, titleKey, descriptionKey }) => (
            <article key={titleKey} className="landing-surface rounded-2xl p-5">
              <Icon size={20} className="mb-4 text-[var(--landing-teal)]" />
              <h3 className="text-sm font-semibold">{t(titleKey)}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--landing-muted)]">{t(descriptionKey)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrustSection;
