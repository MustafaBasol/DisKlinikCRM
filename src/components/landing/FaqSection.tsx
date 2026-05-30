import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { faqItems } from '../../data/landing';

const FaqSection = () => {
  const { t } = useTranslation('landing');

  return (
    <section id="faq" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:gap-14">
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('faq.label')}</p>
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.35rem]">{t('faq.title')}</h2>
        </div>
        <div className="space-y-3">
          {faqItems.map((item) => (
            <details key={item} className="landing-surface group rounded-xl px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-[var(--landing-heading)]">
                {t(`faq.items.${item}.question`)}
                <ChevronDown size={18} className="shrink-0 text-[var(--landing-muted)] transition-transform group-open:rotate-180" />
              </summary>
              <p className="pr-8 pt-3 text-sm leading-7 text-[var(--landing-muted)]">
                {t(`faq.items.${item}.answer`)}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FaqSection;
