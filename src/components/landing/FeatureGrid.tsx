import { useTranslation } from 'react-i18next';
import { featureItems } from '../../data/landing';

const FeatureGrid = () => {
  const { t } = useTranslation('landing');

  return (
    <section id="features" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('features.label')}</p>
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.35rem]">{t('features.title')}</h2>
          <p className="mt-4 text-base leading-7 text-[var(--landing-muted)]">{t('features.description')}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {featureItems.map(({ icon: Icon, titleKey, descriptionKey }) => (
            <article
              key={titleKey}
              className="landing-surface rounded-2xl p-6 transition-transform duration-200 hover:-translate-y-1 hover:shadow-[var(--landing-shadow-md)]"
            >
              <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--landing-teal-soft)] text-[var(--landing-teal)]">
                <Icon size={21} />
              </span>
              <h3 className="text-lg font-semibold tracking-[-0.02em]">{t(titleKey)}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--landing-muted)]">{t(descriptionKey)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeatureGrid;
