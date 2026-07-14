import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const faqKeys = [
  'yearlyDiscount',
  'setupPerClinic',
  'aiDeduction',
  'aiRollover',
  'metaFees',
  'smsFees',
  'ownChannels',
  'activePatientDefinition',
  'archivedPatients',
  'dicomStorage',
  'migrationPriceVariance',
  'planUpgrade',
  'addonPurchaseLater',
  'enterprisePricing',
  'yearlyAddonDiscount',
  'extraChannelAiQuota',
] as const;

const PricingFaqAccordion = () => {
  const { t } = useTranslation('pricingPage');
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <section id="faq" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.1rem]">{t('faq.title')}</h2>
        </div>
        <div className="mx-auto mt-8 max-w-3xl space-y-3">
          {faqKeys.map((key) => {
            const isOpen = openKey === key;
            const panelId = `pricing-faq-panel-${key}`;
            const buttonId = `pricing-faq-button-${key}`;
            return (
              <div key={key} className="landing-surface rounded-xl px-5 py-4">
                <h3>
                  <button
                    type="button"
                    id={buttonId}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenKey(isOpen ? null : key)}
                    className="flex w-full cursor-pointer list-none items-center justify-between gap-4 text-left text-sm font-semibold text-[var(--landing-heading)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--landing-teal)] focus-visible:ring-offset-2"
                  >
                    {t(`faq.items.${key}.question`)}
                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className={`shrink-0 text-[var(--landing-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                </h3>
                {isOpen ? (
                  <p id={panelId} role="region" aria-labelledby={buttonId} className="pr-8 pt-3 text-sm leading-7 text-[var(--landing-muted)]">
                    {t(`faq.items.${key}.answer`)}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default PricingFaqAccordion;
