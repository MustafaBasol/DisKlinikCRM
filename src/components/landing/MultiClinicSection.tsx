import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { branchMetrics } from '../../data/landing';

const pointKeys = [
  'multiClinic.points.comparison',
  'multiClinic.points.visibility',
  'multiClinic.points.teams',
];

const MultiClinicSection = () => {
  const { t } = useTranslation('landing');

  return (
    <section id="multi-clinic" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="overflow-hidden rounded-[2rem] bg-[var(--landing-primary)] px-5 py-9 text-white sm:px-9 sm:py-12 lg:px-12">
          <div className="grid items-center gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-12">
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[#67e8d0]">
                {t('multiClinic.label')}
              </p>
              <h2 className="landing-heading-inverse text-3xl font-bold leading-tight tracking-[-0.045em] sm:text-[2.35rem]">
                {t('multiClinic.title')}
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-300 sm:text-base">
                {t('multiClinic.description')}
              </p>
              <div className="mt-7 space-y-3.5">
                {pointKeys.map((point) => (
                  <p key={point} className="flex gap-2.5 text-sm text-slate-200">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#42cdbc]" />
                    {t(point)}
                  </p>
                ))}
              </div>
            </div>

            <div className="landing-comparison-card rounded-2xl p-3 text-[var(--landing-text)] shadow-[0_18px_50px_rgba(2,10,23,0.26)] sm:p-5">
              <div className="mb-4 flex items-center justify-between px-1">
                <p className="text-sm font-semibold text-[var(--landing-heading)]">{t('multiClinic.tableLabel')}</p>
                <span className="rounded-full bg-[var(--landing-teal-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--landing-teal)]">
                  {t('dashboard.period')}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[600px] w-full border-separate border-spacing-0 text-left text-xs">
                  <caption className="sr-only">{t('multiClinic.tableLabel')}</caption>
                  <thead>
                    <tr className="text-[11px] font-semibold uppercase tracking-wide text-[var(--landing-muted)]">
                      <th className="border-b border-[var(--landing-border)] px-3 pb-3">{t('multiClinic.columns.branch')}</th>
                      <th className="border-b border-[var(--landing-border)] px-3 pb-3">{t('multiClinic.columns.appointments')}</th>
                      <th className="border-b border-[var(--landing-border)] px-3 pb-3">{t('multiClinic.columns.patients')}</th>
                      <th className="border-b border-[var(--landing-border)] px-3 pb-3">{t('multiClinic.columns.collections')}</th>
                      <th className="border-b border-[var(--landing-border)] px-3 pb-3">{t('multiClinic.columns.noShow')}</th>
                      <th className="border-b border-[var(--landing-border)] px-3 pb-3">{t('multiClinic.columns.occupancy')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchMetrics.map((branch) => (
                      <tr key={branch.nameKey} className="text-[var(--landing-text)]">
                        <th className="border-b border-[var(--landing-border)] px-3 py-4 font-semibold">
                          {t(branch.nameKey)}
                        </th>
                        <td className="border-b border-[var(--landing-border)] px-3 py-4">{branch.appointments}</td>
                        <td className="border-b border-[var(--landing-border)] px-3 py-4">{branch.patients}</td>
                        <td className="border-b border-[var(--landing-border)] px-3 py-4 font-semibold">{branch.collections}</td>
                        <td className="border-b border-[var(--landing-border)] px-3 py-4">{branch.noShow}</td>
                        <td className="border-b border-[var(--landing-border)] px-3 py-4">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-12 rounded-full bg-[var(--landing-surface-muted)]">
                              <div
                                className="h-full rounded-full bg-[var(--landing-teal)]"
                                style={{ width: `${branch.occupancy}%` }}
                              />
                            </div>
                            <span>%{branch.occupancy}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 px-1 text-[11px] text-[var(--landing-muted)]">{t('multiClinic.sampleNote')}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default MultiClinicSection;
