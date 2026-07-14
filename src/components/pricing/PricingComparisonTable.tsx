import { Fragment } from 'react';
import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { comparisonCategories, type ComparisonCell } from '../../data/pricingComparison';
import type { PlanKey } from '../../data/pricing';

const planColumns: PlanKey[] = ['starter', 'professional', 'enterprise'];

const ComparisonCellContent = ({ cell, rowKey, plan }: { cell: ComparisonCell; rowKey: string; plan: PlanKey }) => {
  const { t } = useTranslation('pricingPage');

  if (cell.type === 'check') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--landing-teal)]">
        <Check size={16} aria-hidden="true" />
        <span className="sr-only">{t('comparison.cellIncluded')}</span>
      </span>
    );
  }

  if (cell.type === 'cross') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[var(--landing-muted)]">
        <X size={16} aria-hidden="true" />
        <span className="sr-only">{t('comparison.cellExcluded')}</span>
      </span>
    );
  }

  return <span>{t(`comparison.rows.${rowKey}.values.${plan}`)}</span>;
};

const PricingComparisonTable = () => {
  const { t } = useTranslation('pricingPage');

  return (
    <section id="comparison" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('comparison.label')}</p>
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.1rem]">{t('comparison.title')}</h2>
          <p className="mt-4 text-base leading-8 text-[var(--landing-muted)]">{t('comparison.description')}</p>
        </div>

        <p className="mt-6 text-center text-xs text-[var(--landing-muted)] lg:hidden">{t('comparison.mobileHint')}</p>

        <div className="landing-comparison-card mt-6 overflow-hidden rounded-2xl p-2 sm:p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
              <caption className="sr-only">{t('comparison.title')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 border-b border-[var(--landing-border)] bg-[var(--landing-surface)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--landing-muted)]">
                    {t('comparison.columns.feature')}
                  </th>
                  {planColumns.map((plan) => (
                    <th
                      key={plan}
                      scope="col"
                      className="border-b border-[var(--landing-border)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--landing-muted)]"
                    >
                      {t(`comparison.columns.${plan}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonCategories.map((category) => (
                  <Fragment key={category.key}>
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={planColumns.length + 1}
                        className="sticky left-0 border-b border-[var(--landing-border)] bg-[var(--landing-surface-muted)] px-4 py-2 text-left text-xs font-bold uppercase tracking-wide text-[var(--landing-heading)]"
                      >
                        {t(`comparison.categories.${category.key}`)}
                      </th>
                    </tr>
                    {category.rows.map((row) => (
                      <tr key={row.key}>
                        <th scope="row" className="sticky left-0 border-b border-[var(--landing-border)] bg-[var(--landing-surface)] px-4 py-3 font-medium text-[var(--landing-text)]">
                          {t(`comparison.rows.${row.key}.label`)}
                        </th>
                        {planColumns.map((plan) => (
                          <td key={plan} className="border-b border-[var(--landing-border)] px-4 py-3 text-[var(--landing-text)]">
                            <ComparisonCellContent cell={row[plan]} rowKey={row.key} plan={plan} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PricingComparisonTable;
