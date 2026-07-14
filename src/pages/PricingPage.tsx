import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import LandingHeader from '../components/landing/LandingHeader';
import LandingFooter from '../components/landing/LandingFooter';
import DemoCtaSection from '../components/landing/DemoCtaSection';
import BillingPeriodToggle from '../components/landing/BillingPeriodToggle';
import PricingPlanCard from '../components/landing/PricingPlanCard';
import PricingComparisonTable from '../components/pricing/PricingComparisonTable';
import { AiAddonsSection, StorageAddonsSection, CapacityAddonsSection } from '../components/pricing/PricingAddonSections';
import PricingChannelsSection from '../components/pricing/PricingChannelsSection';
import PricingSmsSection from '../components/pricing/PricingSmsSection';
import { SetupSection, MigrationSection, TrainingSection } from '../components/pricing/PricingServicesSections';
import PricingFaqAccordion from '../components/pricing/PricingFaqAccordion';
import PricingFinalCta from '../components/pricing/PricingFinalCta';
import { pricingPlans, type BillingPeriod } from '../data/pricing';
import '../components/landing/landing.css';

const PricingPage = () => {
  const { t } = useTranslation('pricingPage');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');

  useEffect(() => {
    const previousTitle = document.title;
    document.title = t('meta.title');

    const descriptionTag = document.querySelector('meta[name="description"]');
    const previousDescription = descriptionTag?.getAttribute('content') ?? null;
    if (descriptionTag) {
      descriptionTag.setAttribute('content', t('meta.description'));
    }

    return () => {
      document.title = previousTitle;
      if (descriptionTag && previousDescription !== null) {
        descriptionTag.setAttribute('content', previousDescription);
      }
    };
  }, [t]);

  return (
    <div className="landing-page min-h-screen">
      <LandingHeader />
      <main id="top">
        <section className="landing-anchor pb-16 pt-14 sm:pb-24 sm:pt-20">
          <div className="landing-container">
            <div className="mx-auto max-w-3xl text-center">
              <Link to="/" className="text-xs font-semibold text-[var(--landing-teal)] hover:underline">
                {t('backToHome')}
              </Link>
              <h1 className="mt-4 text-4xl font-bold tracking-[-0.045em] sm:text-5xl">{t('hero.title')}</h1>
              <p className="mt-4 text-base leading-8 text-[var(--landing-muted)] sm:text-lg">{t('hero.subtitle')}</p>
              <p className="mt-3 text-sm font-semibold text-[var(--landing-heading)]">{t('hero.commonNote')}</p>
              <p className="mt-1 text-xs text-[var(--landing-muted)]">{t('hero.priceNote')}</p>

              <BillingPeriodToggle value={billingPeriod} onChange={setBillingPeriod} />
            </div>

            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {pricingPlans.map((plan) => (
                <PricingPlanCard key={plan.key} plan={plan} billingPeriod={billingPeriod} />
              ))}
            </div>
          </div>
        </section>

        <PricingComparisonTable />
        <AiAddonsSection billingPeriod={billingPeriod} />
        <StorageAddonsSection billingPeriod={billingPeriod} />
        <PricingChannelsSection />
        <PricingSmsSection />
        <SetupSection />
        <MigrationSection />
        <TrainingSection />
        <CapacityAddonsSection billingPeriod={billingPeriod} />
        <PricingFaqAccordion />
        <PricingFinalCta />
        <DemoCtaSection />

        <section className="pb-16 sm:pb-24">
          <div className="landing-container">
            <div className="mx-auto max-w-3xl rounded-2xl border border-[var(--landing-border)] p-6">
              <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--landing-heading)]">
                {t('generalNotes.title')}
              </h2>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--landing-muted)]">
                {(t('generalNotes.items', { returnObjects: true }) as string[]).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
};

export default PricingPage;
