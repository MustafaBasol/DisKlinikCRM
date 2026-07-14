import { useTranslation } from 'react-i18next';

const PricingFinalCta = () => {
  const { t } = useTranslation('pricingPage');

  return (
    <section className="pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="landing-demo-panel rounded-[2rem] border p-6 text-center sm:p-10">
          <h2 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">{t('finalCta.title')}</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[var(--landing-muted)] sm:text-base">
            {t('finalCta.description')}
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#demo"
              className="inline-flex w-full items-center justify-center rounded-xl bg-[var(--landing-teal)] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0b7e71] focus:outline-none focus:ring-2 focus:ring-[var(--landing-teal)] focus:ring-offset-2 sm:w-auto"
            >
              {t('finalCta.demoButton')}
            </a>
            <a
              href="#demo"
              className="inline-flex w-full items-center justify-center rounded-xl border border-[var(--landing-border)] px-5 py-3 text-sm font-semibold text-[var(--landing-heading)] transition-colors hover:bg-[var(--landing-surface-muted)] sm:w-auto"
            >
              {t('finalCta.salesButton')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PricingFinalCta;
