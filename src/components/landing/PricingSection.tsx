import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import BillingPeriodToggle from './BillingPeriodToggle';
import PricingPlanCard from './PricingPlanCard';
import { pricingPlans, type BillingPeriod } from '../../data/pricing';

const PricingSection = () => {
  const { t } = useTranslation('landing');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');

  return (
    <section id="pricing" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('pricing.label')}</p>
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.35rem]">{t('pricing.title')}</h2>
          <p className="mt-4 text-base leading-8 text-[var(--landing-muted)]">{t('pricing.description')}</p>
          <p className="mt-3 text-sm font-semibold text-[var(--landing-heading)]">{t('pricing.commonNote')}</p>

          <BillingPeriodToggle value={billingPeriod} onChange={setBillingPeriod} />
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {pricingPlans.map((plan) => (
            <PricingPlanCard key={plan.key} plan={plan} billingPeriod={billingPeriod} />
          ))}
        </div>

        <div className="mx-auto mt-8 max-w-2xl space-y-1.5 text-center text-xs leading-5 text-[var(--landing-muted)]">
          <p>{t('pricing.aiNote1')}</p>
          <p>{t('pricing.aiNote2')}</p>
        </div>
        <p className="mt-4 text-center text-xs leading-5 text-[var(--landing-muted)]">{t('pricing.note')}</p>
        <p className="mt-3 text-center text-sm">
          <Link
            to="/fiyatlandirma"
            className="font-semibold text-[var(--landing-teal)] underline-offset-4 hover:underline"
          >
            {t('pricing.detailedLink')}
          </Link>
        </p>
      </div>
    </section>
  );
};

export default PricingSection;
