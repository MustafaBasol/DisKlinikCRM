import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const LandingFooter = () => {
  const { t } = useTranslation('landing');

  return (
    <footer className="border-t border-[var(--landing-border)] bg-[var(--landing-surface)]">
      <div className="landing-container grid gap-10 py-10 md:grid-cols-[1.4fr_0.72fr_0.72fr]">
        <div className="max-w-sm">
          <div className="flex items-center">
            <img
              src="/assets/brand/noramedi/logo-horizontal-light.svg"
              alt={t('brand.name')}
              className="h-8 w-auto dark:hidden"
            />
            <img
              src="/assets/brand/noramedi/logo-horizontal-dark.svg"
              alt={t('brand.name')}
              className="h-8 w-auto hidden dark:block"
            />
          </div>
          <p className="mt-4 text-sm leading-7 text-[var(--landing-muted)]">{t('brand.description')}</p>
          <p className="mt-4 text-xs leading-6 text-[var(--landing-muted)]">{t('footer.privacyNote')}</p>
        </div>
        <FooterColumn title={t('footer.product')}>
          <a href="#features">{t('footer.links.features')}</a>
          <a href="#multi-clinic">{t('footer.links.multiClinic')}</a>
          <a href="#integrations">{t('footer.links.integrations')}</a>
          <a href="#pricing">{t('footer.links.pricing')}</a>
          <a href="#demo">{t('footer.links.demo')}</a>
        </FooterColumn>
        <FooterColumn title={t('footer.company')}>
          <Link to="/login">{t('footer.links.login')}</Link>
          <Link to="/legal">{t('footer.links.legal')}</Link>
          <Link to="/legal/privacy">{t('footer.links.privacy')}</Link>
          <Link to="/legal/cookies">{t('footer.links.cookies')}</Link>
          <Link to="/legal/communications">{t('footer.links.communications')}</Link>
        </FooterColumn>
      </div>
      <div className="landing-container border-t border-[var(--landing-border)] py-5 text-xs text-[var(--landing-muted)]">
        &copy; 2026 {t('footer.copyright')}
      </div>
    </footer>
  );
};

const FooterColumn = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex flex-col gap-3 text-sm text-[var(--landing-muted)] [&_a:hover]:text-[var(--landing-heading)]">
    <p className="mb-1 font-semibold text-[var(--landing-heading)]">{title}</p>
    {children}
  </div>
);

export default LandingFooter;
