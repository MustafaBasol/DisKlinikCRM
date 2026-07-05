import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const plans = [
  { key: 'starter', featureCount: 5, highlighted: false },
  { key: 'professional', featureCount: 6, highlighted: true },
  { key: 'enterprise', featureCount: 6, highlighted: false },
] as const;

const PricingSection = () => {
  const { t } = useTranslation('landing');

  return (
    <section id="pricing" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('pricing.label')}</p>
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.35rem]">{t('pricing.title')}</h2>
          <p className="mt-4 text-base leading-8 text-[var(--landing-muted)]">{t('pricing.description')}</p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.key}
              className={`landing-surface relative flex flex-col rounded-2xl p-6 sm:p-7 ${
                plan.highlighted ? 'landing-shadow-md border-[var(--landing-teal)]' : ''
              }`}
            >
              {plan.highlighted ? (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--landing-teal)] px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                  {t('pricing.popularBadge')}
                </span>
              ) : null}
              <h3 className="text-lg font-semibold">{t(`pricing.plans.${plan.key}.name`)}</h3>
              <p className="mt-1.5 text-sm leading-6 text-[var(--landing-muted)]">{t(`pricing.plans.${plan.key}.description`)}</p>
              <p className="mt-5">
                <span className="text-3xl font-bold tracking-tight text-[var(--landing-heading)]">
                  {t(`pricing.plans.${plan.key}.price`)}
                </span>
                <span className="ml-1.5 text-sm text-[var(--landing-muted)]">{t(`pricing.plans.${plan.key}.period`)}</span>
              </p>
              <ul className="mt-6 flex-1 space-y-2.5">
                {Array.from({ length: plan.featureCount }, (_, index) => (
                  <li key={index} className="flex items-start gap-2.5 text-sm leading-6 text-[var(--landing-text)]">
                    <Check size={16} className="mt-1 shrink-0 text-[var(--landing-teal)]" />
                    {t(`pricing.plans.${plan.key}.features.${index}`)}
                  </li>
                ))}
              </ul>
              <a
                href="#demo"
                className={`mt-7 inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--landing-teal)] focus:ring-offset-2 ${
                  plan.highlighted
                    ? 'bg-[var(--landing-teal)] text-white hover:bg-[#0b7e71]'
                    : 'border border-[var(--landing-border)] text-[var(--landing-heading)] hover:bg-[var(--landing-surface-muted)]'
                }`}
              >
                {t(`pricing.plans.${plan.key}.cta`)}
              </a>
            </article>
          ))}
        </div>

        <p className="mt-6 text-center text-xs leading-5 text-[var(--landing-muted)]">{t('pricing.note')}</p>
      </div>
    </section>
  );
};

export default PricingSection;
