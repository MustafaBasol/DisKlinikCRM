import { useTranslation } from 'react-i18next';
import { problemItems } from '../../data/landing';

const ProblemSection = () => {
  const { t } = useTranslation('landing');

  return (
    <section className="pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="rounded-3xl border border-[var(--landing-border)] bg-[var(--landing-surface)] px-5 py-8 sm:px-8 sm:py-10 lg:px-12">
          <div className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr] lg:gap-12">
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('problem.label')}</p>
              <h2 className="text-2xl font-bold leading-tight tracking-[-0.04em] sm:text-[2rem]">{t('problem.title')}</h2>
              <p className="mt-4 text-sm leading-7 text-[var(--landing-muted)]">{t('problem.description')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {problemItems.map(({ icon: Icon, titleKey, descriptionKey }) => (
                <article key={titleKey} className="rounded-2xl bg-[var(--landing-bg)] p-5">
                  <Icon size={20} className="mb-4 text-[var(--landing-teal)]" />
                  <h3 className="text-sm font-semibold">{t(titleKey)}</h3>
                  <p className="mt-2 text-xs leading-6 text-[var(--landing-muted)]">{t(descriptionKey)}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ProblemSection;
