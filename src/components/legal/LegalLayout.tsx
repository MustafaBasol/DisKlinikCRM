import React, { type ReactNode } from 'react';
import { ArrowLeft, ExternalLink, Info } from 'lucide-react';
import { NavLink, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../landing/landing.css';
import PublicLanguageSelector from '../landing/PublicLanguageSelector';
import PublicThemeToggle from '../landing/PublicThemeToggle';
import './legal.css';

export interface LegalTableRow {
  label: string;
  value: string;
}

export interface LegalSource {
  label: string;
  href: string;
}

interface LegalLayoutProps {
  title: string;
  description: string;
  metaTitle: string;
  children: ReactNode;
}

const legalNav = [
  { path: '/legal', key: 'nav.center', end: true },
  { path: '/legal/privacy', key: 'nav.privacy', end: false },
  { path: '/legal/cookies', key: 'nav.cookies', end: false },
  { path: '/legal/communications', key: 'nav.communications', end: false },
];

const LegalLayout = ({ title, description, metaTitle, children }: LegalLayoutProps) => {
  const { t } = useTranslation('legal');

  React.useEffect(() => {
    const previousTitle = document.title;
    document.title = metaTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [metaTitle]);

  return (
    <div className="landing-page legal-page min-h-screen">
      <header className="border-b border-[var(--landing-border)] bg-[var(--landing-surface)]">
        <div className="landing-container flex min-h-[4.75rem] flex-wrap items-center justify-between gap-4 py-3">
          <Link to="/landing" className="flex flex-col items-start gap-0.5" aria-label={t('brand.name')}>
            <img
              src="/assets/brand/noramedi/logo-horizontal-light.svg"
              alt={t('brand.name')}
              className="h-9 w-auto dark:hidden"
            />
            <img
              src="/assets/brand/noramedi/logo-horizontal-dark.svg"
              alt={t('brand.name')}
              className="h-9 w-auto hidden dark:block"
            />
          </Link>
          <div className="flex items-center gap-2">
            <PublicLanguageSelector label={t('shared.languageSelector')} />
            <PublicThemeToggle label={t('shared.themeToggle')} />
            <Link
              to="/landing"
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--landing-heading)] transition-colors hover:bg-[var(--landing-surface-muted)]"
            >
              <ArrowLeft size={16} />
              {t('shared.back')}
            </Link>
          </div>
        </div>
      </header>

      <div className="landing-container legal-grid py-8 sm:py-12">
        <aside aria-label={t('nav.label')} className="legal-sidebar">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.15em] text-[var(--landing-muted)]">
            {t('nav.label')}
          </p>
          <nav className="legal-nav" aria-label={t('nav.label')}>
            {legalNav.map(({ path, key, end }) => (
              <NavLink
                key={path}
                to={path}
                end={end}
                className={({ isActive }) => `legal-nav-link${isActive ? ' legal-nav-link-active' : ''}`}
              >
                {t(key)}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0">
          <LegalNotice title={t('shared.draftTitle')}>
            {t('shared.draftBody')}
          </LegalNotice>
          <p className="mt-8 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('shared.label')}</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-[-0.045em] sm:text-4xl">{title}</h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--landing-muted)]">{description}</p>
          <p className="mt-4 text-sm font-medium text-[var(--landing-muted)]">{t('shared.reviewDate')}</p>
          <div className="legal-content mt-10">{children}</div>
        </main>
      </div>

      <footer className="mt-8 border-t border-[var(--landing-border)] bg-[var(--landing-surface)]">
        <div className="landing-container flex flex-col justify-between gap-4 py-7 text-sm text-[var(--landing-muted)] sm:flex-row sm:items-center">
          <span>&copy; 2026 {t('brand.name')}</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link className="hover:text-[var(--landing-heading)]" to="/legal/privacy">{t('nav.privacy')}</Link>
            <Link className="hover:text-[var(--landing-heading)]" to="/legal/cookies">{t('nav.cookies')}</Link>
            <Link className="hover:text-[var(--landing-heading)]" to="/legal/communications">{t('nav.communications')}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export const LegalNotice = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="legal-notice" role="note">
    <Info className="mt-0.5 shrink-0 text-[var(--landing-teal)]" size={19} />
    <div>
      <p className="font-semibold text-[var(--landing-heading)]">{title}</p>
      <p className="mt-1 text-sm leading-7 text-[var(--landing-muted)]">{children}</p>
    </div>
  </div>
);

export const LegalSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="legal-section">
    <h2 className="text-xl font-bold tracking-[-0.025em]">{title}</h2>
    <div className="legal-body mt-4">{children}</div>
  </section>
);

export const LegalList = ({ items }: { items: string[] }) => (
  <ul className="legal-list">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

export const LegalTable = ({ rows }: { rows: LegalTableRow[] }) => (
  <div className="overflow-x-auto rounded-2xl border border-[var(--landing-border)]">
    <table className="legal-table">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const LegalSources = ({ items }: { items: LegalSource[] }) => {
  const { t } = useTranslation('legal');

  return (
    <LegalSection title={t('shared.sources')}>
      <p>{t('shared.sourcesDescription')}</p>
      <ul className="legal-sources mt-4">
        {items.map((source) => (
          <li key={source.href}>
            <a href={source.href} target="_blank" rel="noreferrer">
              {source.label}
              <ExternalLink size={15} />
            </a>
          </li>
        ))}
      </ul>
    </LegalSection>
  );
};

export default LegalLayout;
