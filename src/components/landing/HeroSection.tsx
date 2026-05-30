import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { heroHighlights } from '../../data/landing';
import DashboardMockup from './DashboardMockup';

const HeroSection = () => {
  const { t } = useTranslation('landing');

  return (
    <section className="relative overflow-hidden pb-16 pt-12 sm:pb-24 sm:pt-16 lg:pb-28 lg:pt-20">
      <div className="landing-hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="landing-container relative grid items-center gap-12 lg:grid-cols-[0.88fr_1.12fr] lg:gap-10">
        <div className="landing-enter">
          <p className="landing-accent-pill mb-5 inline-flex rounded-full border bg-[var(--landing-teal-soft)] px-3.5 py-1.5 text-xs font-bold tracking-[0.13em] text-[var(--landing-teal)]">
            {t('hero.eyebrow')}
          </p>
          <h1 className="max-w-xl text-[2.7rem] font-bold leading-[1.08] tracking-[-0.055em] sm:text-[3.45rem] lg:text-[3.7rem]">
            {t('hero.title')}
          </h1>
          <p className="mt-6 max-w-lg text-base leading-8 text-[var(--landing-muted)] sm:text-lg">
            {t('hero.description')}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="#demo"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--landing-teal)] px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#0b7e71] focus:outline-none focus:ring-2 focus:ring-[var(--landing-teal)] focus:ring-offset-2"
            >
              {t('actions.requestDemo')}
              <ArrowRight size={17} />
            </a>
            <a
              href="#features"
              className="landing-surface inline-flex items-center justify-center rounded-xl px-6 py-3.5 text-sm font-semibold text-[var(--landing-heading)] transition-colors hover:bg-[var(--landing-surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--landing-blue)] focus:ring-offset-2"
            >
              {t('actions.reviewFeatures')}
            </a>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-3">
            {heroHighlights.map((item) => (
              <span key={item} className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--landing-muted)] sm:text-sm">
                <CheckCircle2 size={16} className="text-[var(--landing-teal)]" />
                {t(item)}
              </span>
            ))}
          </div>
        </div>
        <div className="landing-enter-delayed">
          <DashboardMockup />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
