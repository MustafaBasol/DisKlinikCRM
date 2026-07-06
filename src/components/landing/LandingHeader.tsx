import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import PublicLanguageSelector from './PublicLanguageSelector';
import PublicThemeToggle from './PublicThemeToggle';

const navLinks = [
  { href: '#features', labelKey: 'nav.features' },
  { href: '#multi-clinic', labelKey: 'nav.multiClinic' },
  { href: '#integrations', labelKey: 'nav.integrations' },
  { href: '#workflow', labelKey: 'nav.workflow' },
  { href: '#pricing', labelKey: 'nav.pricing' },
  { href: '#faq', labelKey: 'nav.faq' },
];

const LandingHeader = () => {
  const { t } = useTranslation('landing');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="landing-header sticky top-0 z-30 border-b border-[var(--landing-border)] backdrop-blur-xl">
      <div className="landing-container flex h-[4.75rem] items-center justify-between gap-4">
        <a href="#top" className="flex shrink-0 items-center" aria-label={t('brand.name')}>
          <img
            src="/assets/brand/noramedi/logo-horizontal-light@2x.png"
            alt={t('brand.name')}
            className="h-9 w-auto dark:hidden"
          />
          <img
            src="/assets/brand/noramedi/logo-horizontal-dark@2x.png"
            alt={t('brand.name')}
            className="h-9 w-auto hidden dark:block"
          />
        </a>

        <nav className="hidden items-center gap-6 lg:flex" aria-label="Landing page">
          {navLinks.map((link) => (
            <a
              key={link.href}
              className="text-sm font-medium text-[var(--landing-muted)] transition-colors hover:text-[var(--landing-heading)]"
              href={link.href}
            >
              {t(link.labelKey)}
            </a>
          ))}
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
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg p-2 text-[var(--landing-heading)] transition-colors hover:bg-[var(--landing-surface-muted)] lg:hidden"
            aria-label={isMenuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
            aria-expanded={isMenuOpen}
            aria-controls="landing-mobile-menu"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            {isMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {isMenuOpen ? (
        <nav
          id="landing-mobile-menu"
          className="border-t border-[var(--landing-border)] bg-[var(--landing-surface)] lg:hidden"
          aria-label="Landing page mobile"
        >
          <div className="landing-container flex flex-col gap-1 py-4">
            {navLinks.map((link) => (
              <a
                key={link.href}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--landing-muted)] transition-colors hover:bg-[var(--landing-surface-muted)] hover:text-[var(--landing-heading)]"
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
              >
                {t(link.labelKey)}
              </a>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-[var(--landing-border)] pt-4">
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-xl border border-[var(--landing-border)] px-4 py-2.5 text-sm font-semibold text-[var(--landing-heading)] transition-colors hover:bg-[var(--landing-surface-muted)]"
                onClick={() => setIsMenuOpen(false)}
              >
                {t('nav.login')}
              </Link>
              <a
                href="#demo"
                className="inline-flex items-center justify-center rounded-xl bg-[var(--landing-teal)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0b7e71]"
                onClick={() => setIsMenuOpen(false)}
              >
                {t('actions.requestDemo')}
              </a>
            </div>
          </div>
        </nav>
      ) : null}
    </header>
  );
};

export default LandingHeader;
