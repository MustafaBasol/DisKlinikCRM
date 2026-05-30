import { ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { branchMetrics, dashboardMetrics } from '../../data/landing';

const toneClasses = {
  blue: 'landing-stat-blue',
  teal: 'landing-stat-teal',
  navy: 'landing-stat-navy',
  amber: 'landing-stat-amber',
};

const DashboardMockup = () => {
  const { t } = useTranslation('landing');

  return (
    <div
      className="landing-surface landing-shadow-lg rounded-[1.6rem] p-3.5 sm:p-5"
      aria-label={t('dashboard.label')}
    >
      <div className="mb-4 flex items-center justify-between border-b border-[var(--landing-border)] pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--landing-primary)] text-white">
            <BarChart3 size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--landing-heading)]">{t('dashboard.title')}</p>
            <p className="text-xs text-[var(--landing-muted)]">{t('dashboard.label')}</p>
          </div>
        </div>
        <span className="rounded-full bg-[var(--landing-teal-soft)] px-3 py-1 text-xs font-semibold text-[var(--landing-teal)]">
          {t('dashboard.period')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        {dashboardMetrics.map((metric) => (
          <div key={metric.labelKey} className="rounded-xl border border-[var(--landing-border)] bg-[var(--landing-bg)] p-3">
            <p className="truncate text-[11px] font-medium text-[var(--landing-muted)]">
              {t(metric.labelKey)}
            </p>
            <div className="mt-2 flex items-end justify-between gap-2">
              <span className="text-lg font-bold tracking-tight text-[var(--landing-heading)] sm:text-xl">
                {metric.value}
              </span>
              <span className={`inline-flex items-center rounded-md px-1.5 py-1 text-[10px] font-bold ${toneClasses[metric.tone]}`}>
                {metric.change.startsWith('-') ? <ArrowDownRight size={11} /> : <ArrowUpRight size={11} />}
                {metric.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-xl border border-[var(--landing-border)] p-3.5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--landing-heading)]">{t('dashboard.branchesTitle')}</p>
              <p className="text-[11px] text-[var(--landing-muted)]">{t('dashboard.branchesCount')}</p>
            </div>
            <BuildingBars />
          </div>
          <div className="space-y-3">
            {branchMetrics.map((branch) => (
              <div key={branch.nameKey}>
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="font-medium text-[var(--landing-text)]">{t(branch.nameKey)}</span>
                  <span className="text-[var(--landing-muted)]">%{branch.occupancy}</span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--landing-surface-muted)]">
                  <div
                    className="h-full rounded-full bg-[var(--landing-teal)]"
                    style={{ width: `${branch.occupancy}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-[var(--landing-primary)] p-3.5 text-white">
          <div className="mb-4 flex items-center gap-2">
            <CalendarDays size={15} className="text-[#67e8d0]" />
            <div>
              <p className="text-xs font-semibold text-white">{t('dashboard.appointmentFlow')}</p>
              <p className="text-[10px] text-slate-300">{t('dashboard.appointmentFlowSummary')}</p>
            </div>
          </div>
          <div className="space-y-2.5">
            <ScheduleBar label={t('dashboard.slots.morning')} width="78%" value="18" />
            <ScheduleBar label={t('dashboard.slots.afternoon')} width="94%" value="21" />
            <ScheduleBar label={t('dashboard.slots.evening')} width="38%" value="3" />
          </div>
        </div>
      </div>
    </div>
  );
};

const ScheduleBar = ({ label, width, value }: { label: string; width: string; value: string }) => (
  <div>
    <div className="mb-1 flex justify-between text-[10px] text-slate-300">
      <span>{label}</span>
      <span>{value}</span>
    </div>
    <div className="h-1.5 rounded-full bg-white/15">
      <div className="h-full rounded-full bg-[#26c5ae]" style={{ width }} />
    </div>
  </div>
);

const BuildingBars = () => (
  <div className="flex items-end gap-1" aria-hidden="true">
    <span className="h-3 w-1.5 rounded-full bg-[#bfede6]" />
    <span className="h-5 w-1.5 rounded-full bg-[#68d4c5]" />
    <span className="h-7 w-1.5 rounded-full bg-[var(--landing-teal)]" />
  </div>
);

export default DashboardMockup;
