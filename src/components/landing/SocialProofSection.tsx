import { Quote } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const testimonialKeys = ['manager', 'dentist', 'reception'] as const;
const statKeys = ['appointments', 'channels', 'branches', 'languages'] as const;

const SocialProofSection = () => {
  const { t } = useTranslation('landing');

  return (
    <section id="social-proof" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('socialProof.label')}</p>
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.35rem]">{t('socialProof.title')}</h2>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statKeys.map((key) => (
            <div key={key} className="landing-surface rounded-2xl p-5 text-center">
              <p className="text-2xl font-bold tracking-tight text-[var(--landing-teal)]">{t(`socialProof.stats.${key}.value`)}</p>
              <p className="mt-1.5 text-sm text-[var(--landing-muted)]">{t(`socialProof.stats.${key}.label`)}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {testimonialKeys.map((key) => (
            <figure key={key} className="landing-surface flex flex-col rounded-2xl p-6">
              <Quote size={20} className="mb-4 text-[var(--landing-teal)]" aria-hidden="true" />
              <blockquote className="flex-1 text-sm leading-7 text-[var(--landing-text)]">
                {t(`socialProof.testimonials.${key}.quote`)}
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3 border-t border-[var(--landing-border)] pt-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--landing-teal-soft)] text-xs font-bold text-[var(--landing-teal)]">
                  {t(`socialProof.testimonials.${key}.initials`)}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-[var(--landing-heading)]">
                    {t(`socialProof.testimonials.${key}.role`)}
                  </span>
                  <span className="block text-xs text-[var(--landing-muted)]">
                    {t(`socialProof.testimonials.${key}.clinic`)}
                  </span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="mt-6 text-center text-xs leading-5 text-[var(--landing-muted)]">{t('socialProof.note')}</p>
      </div>
    </section>
  );
};

export default SocialProofSection;
