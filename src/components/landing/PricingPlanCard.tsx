import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BillingPeriod, PricingPlanConfig } from '../../data/pricing';

interface PricingPlanCardProps {
  plan: PricingPlanConfig;
  billingPeriod: BillingPeriod;
}

const PricingPlanCard = ({ plan, billingPeriod }: PricingPlanCardProps) => {
  const { t } = useTranslation('landing');

  return (
    <article
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
      <div className="mt-5">
        {plan.hasFixedPrice ? (
          <p>
            <span className="text-3xl font-bold tracking-tight text-[var(--landing-heading)]">
              {t(`pricing.plans.${plan.key}.price`)}
            </span>
          </p>
        ) : (
          <>
            <p>
              <span className="text-3xl font-bold tracking-tight text-[var(--landing-heading)]">
                {t(`pricing.plans.${plan.key}.${billingPeriod}Price`)}
              </span>
              <span className="ml-1.5 text-sm text-[var(--landing-muted)]">
                {t(`pricing.plans.${plan.key}.${billingPeriod}Period`)}
              </span>
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--landing-muted)]">
              {t(`pricing.plans.${plan.key}.${billingPeriod}Note`)}
              {billingPeriod === 'yearly' ? (
                <span className="ml-1.5 font-semibold text-[var(--landing-teal)]">
                  {t('pricing.billing.yearlySaving')}
                </span>
              ) : null}
            </p>
          </>
        )}
      </div>
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
  );
};

export default PricingPlanCard;
