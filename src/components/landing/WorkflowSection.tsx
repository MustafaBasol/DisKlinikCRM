import { useTranslation } from 'react-i18next';
import { workflowItems } from '../../data/landing';

const WorkflowSection = () => {
  const { t } = useTranslation('landing');

  return (
    <section id="workflow" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="mb-10 max-w-2xl">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('workflow.label')}</p>
          <h2 className="text-3xl font-bold tracking-[-0.045em] sm:text-[2.35rem]">{t('workflow.title')}</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {workflowItems.map(({ icon: Icon, titleKey, descriptionKey }, index) => (
            <article key={titleKey} className="relative rounded-2xl border border-[var(--landing-border)] bg-[var(--landing-surface)] p-6">
              <span className="landing-step-number absolute right-6 top-6 text-4xl font-bold tracking-[-0.06em]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="mb-10 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--landing-teal-soft)] text-[var(--landing-teal)]">
                <Icon size={21} />
              </span>
              <h3 className="max-w-[15rem] text-lg font-semibold tracking-[-0.02em]">{t(titleKey)}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--landing-muted)]">{t(descriptionKey)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default WorkflowSection;
