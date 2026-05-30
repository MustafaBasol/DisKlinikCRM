import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { integrationChannels, integrationProofPoints } from '../../data/landing';

const IntegrationSection = () => {
  const { t } = useTranslation('landing');

  return (
    <section id="integrations" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="rounded-[2rem] border border-[var(--landing-border)] bg-[var(--landing-surface)] p-5 sm:p-8 lg:p-12">
          <div className="grid items-start gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-12">
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">
                {t('integrations.label')}
              </p>
              <h2 className="text-3xl font-bold leading-tight tracking-[-0.045em] sm:text-[2.35rem]">
                {t('integrations.title')}
              </h2>
              <p className="mt-4 text-base leading-8 text-[var(--landing-muted)]">
                {t('integrations.description')}
              </p>
              <div className="mt-7 space-y-3.5">
                {integrationProofPoints.map((point) => (
                  <p key={point} className="flex gap-2.5 text-sm text-[var(--landing-muted)]">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--landing-teal)]" />
                    {t(point)}
                  </p>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {integrationChannels.map(({ icon: Icon, titleKey, descriptionKey, detailKeys, tone }) => (
                <article key={titleKey} className="rounded-2xl border border-[var(--landing-border)] bg-[var(--landing-bg)] p-5 sm:p-6">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <span className={`flex h-12 w-12 items-center justify-center rounded-xl landing-channel-${tone}`}>
                      <Icon size={23} />
                    </span>
                    <span className="landing-accent-pill rounded-full border bg-[var(--landing-teal-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--landing-teal)]">
                      {t('integrations.ready')}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold tracking-[-0.02em]">{t(titleKey)}</h3>
                  <p className="mt-3 text-sm leading-7 text-[var(--landing-muted)]">{t(descriptionKey)}</p>
                  <div className="mt-5 space-y-2 border-t border-[var(--landing-border)] pt-4">
                    {detailKeys.map((detail) => (
                      <p key={detail} className="flex items-center gap-2 text-xs font-medium text-[var(--landing-text)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--landing-teal)]" />
                        {t(detail)}
                      </p>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default IntegrationSection;
