import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import PublicLanguageSelector from './PublicLanguageSelector';
import PublicThemeToggle from './PublicThemeToggle';

const LandingHeader = () => {
  const { t } = useTranslation('landing');

  return (
    <header className="landing-header sticky top-0 z-30 border-b border-[var(--landing-border)] backdrop-blur-xl">
      <div className="landing-container flex h-[4.75rem] items-center justify-between gap-4">
        <a href="#top" className="flex shrink-0 items-center gap-2.5" aria-label={t('brand.name')}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--landing-primary)] text-white">
            <Activity size={21} strokeWidth={2.4} />
          </span>
          <span className="hidden text-[1.05rem] font-bold tracking-[-0.03em] text-[var(--landing-heading)] sm:inline">
            {t('brand.name')}
          </span>
        </a>

        <nav className="hidden items-center gap-6 lg:flex" aria-label="Landing page">
          <a className="text-sm font-medium text-[var(--landing-muted)] transition-colors hover:text-[var(--landing-heading)]" href="#features">
            {t('nav.features')}
          </a>
          <a className="text-sm font-medium text-[var(--landing-muted)] transition-colors hover:text-[var(--landing-heading)]" href="#multi-clinic">
            {t('nav.multiClinic')}
          </a>
          <a className="text-sm font-medium text-[var(--landing-muted)] transition-colors hover:text-[var(--landing-heading)]" href="#integrations">
            {t('nav.integrations')}
          </a>
          <a className="text-sm font-medium text-[var(--landing-muted)] transition-colors hover:text-[var(--landing-heading)]" href="#workflow">
            {t('nav.workflow')}
          </a>
          <a className="text-sm font-medium text-[var(--landing-muted)] transition-colors hover:text-[var(--landing-heading)]" href="#faq">
            {t('nav.faq')}
          </a>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <PublicLanguageSelector label={t('nav.languageSelector')} />
          <PublicThemeToggle label={t('nav.themeToggle')} />
          <Link
            to="/login"
            className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-[var(--landing-heading)] transition-colors hover:bg-[var(--landing-surface-muted)] sm:inline-flex"
          >
            {t('nav.login')}
          </Link>
          <a
            href="#demo"
            className="hidden items-center justify-center rounded-xl bg-[var(--landing-teal)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0b7e71] focus:outline-none focus:ring-2 focus:ring-[var(--landing-teal)] focus:ring-offset-2 sm:inline-flex"
          >
            {t('actions.requestDemo')}
          </a>
        </div>
      </div>
    </header>
  );
};

export default LandingHeader;
