import { useTranslation } from 'react-i18next';
import type { BillingPeriod } from '../../data/pricing';

interface BillingPeriodToggleProps {
  value: BillingPeriod;
  onChange: (value: BillingPeriod) => void;
}

const BillingPeriodToggle = ({ value, onChange }: BillingPeriodToggleProps) => {
  const { t } = useTranslation('landing');

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <div
        role="group"
        aria-label={t('pricing.billing.groupLabel')}
        className="inline-flex items-center rounded-full border border-[var(--landing-border)] bg-[var(--landing-surface-muted)] p-1"
      >
        <button
          type="button"
          aria-pressed={value === 'monthly'}
          onClick={() => onChange('monthly')}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--landing-teal)] focus-visible:ring-offset-2 ${
            value === 'monthly'
              ? 'bg-[var(--landing-teal)] text-white'
              : 'text-[var(--landing-muted)] hover:text-[var(--landing-heading)]'
          }`}
        >
          {t('pricing.billing.monthly')}
        </button>
        <button
          type="button"
          aria-pressed={value === 'yearly'}
          onClick={() => onChange('yearly')}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--landing-teal)] focus-visible:ring-offset-2 ${
            value === 'yearly'
              ? 'bg-[var(--landing-teal)] text-white'
              : 'text-[var(--landing-muted)] hover:text-[var(--landing-heading)]'
          }`}
        >
          {t('pricing.billing.yearly')}
        </button>
      </div>
      <span
        className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
          value === 'yearly'
            ? 'bg-[var(--landing-teal)]/10 text-[var(--landing-teal)]'
            : 'text-[var(--landing-muted)]'
        }`}
      >
        {t('pricing.billing.yearlySaving')}
      </span>
    </div>
  );
};

export default BillingPeriodToggle;
