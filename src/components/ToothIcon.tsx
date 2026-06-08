import React from 'react';
import { Activity, AlertTriangle, Check, CircleDot, Crown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getToothShape,
  PROCEDURE_STATUS_META,
  TOOTH_STATUS_META,
  ToothRecord,
  TreatmentProcedure,
  ToothStatus,
} from './dentalChart.types';

type ToothIconSize = 'regular' | 'large';

interface ToothIconProps {
  fdi: number;
  record?: ToothRecord;
  procedures?: TreatmentProcedure[];
  labelPosition: 'top' | 'bottom';
  isUpper?: boolean;
  isSelected?: boolean;
  size?: ToothIconSize;
  patientMode?: boolean;
  onSelect: (fdi: number) => void;
}

const TOOTH_PATHS = {
  molar: 'M18 10 C12 14 10 25 13 38 L18 67 C20 78 29 80 32 67 C36 80 45 78 47 67 L52 38 C55 25 52 14 45 10 C38 6 34 12 32 12 C30 12 25 6 18 10Z',
  premolar: 'M21 10 C15 15 14 27 17 40 L22 66 C24 77 30 78 32 66 C35 78 42 77 44 66 L49 40 C52 27 49 15 43 10 C37 6 34 12 32 12 C30 12 26 6 21 10Z',
  canine: 'M23 11 C16 18 16 31 20 44 L28 75 C30 82 34 82 36 75 L44 44 C48 31 48 18 41 11 C36 6 33 12 32 12 C31 12 28 6 23 11Z',
  incisor: 'M24 11 C18 17 18 31 22 45 L28 73 C30 80 34 80 36 73 L42 45 C46 31 46 17 40 11 C35 7 33 12 32 12 C31 12 29 7 24 11Z',
} as const;

function statusLabel(status: ToothStatus, t: ReturnType<typeof useTranslation>['t']) {
  return t(`patients:dentalChart.status.${status}`, {
    defaultValue: TOOTH_STATUS_META[status].fallback,
  });
}

function ToothStatusMark({ status }: { status?: ToothStatus }) {
  if (!status) return null;

  const baseClass =
    'absolute -right-1 top-5 flex h-5 w-5 items-center justify-center rounded-full border bg-white shadow-sm dark:bg-gray-800';

  if (status === 'planned') {
    return <span className={`${baseClass} border-amber-200 text-amber-600`} />;
  }

  if (status === 'in_progress') {
    return (
      <span className={`${baseClass} border-blue-200 text-blue-600`}>
        <Activity size={12} strokeWidth={2.5} />
      </span>
    );
  }

  if (status === 'treated') {
    return (
      <span className={`${baseClass} border-emerald-200 bg-emerald-500 text-white`}>
        <Check size={13} strokeWidth={3} />
      </span>
    );
  }

  if (status === 'issue') {
    return (
      <span className={`${baseClass} border-red-200 text-red-600`}>
        <AlertTriangle size={12} strokeWidth={2.5} />
      </span>
    );
  }

  if (status === 'missing') {
    return (
      <span className={`${baseClass} border-gray-200 text-gray-500`}>
        <X size={13} strokeWidth={2.5} />
      </span>
    );
  }

  if (status === 'crown') {
    return (
      <span className={`${baseClass} border-indigo-200 text-indigo-600`}>
        <Crown size={12} strokeWidth={2.4} />
      </span>
    );
  }

  return (
    <span className={`${baseClass} border-purple-200 text-purple-600`}>
      <CircleDot size={12} strokeWidth={2.5} />
    </span>
  );
}

const ToothIcon: React.FC<ToothIconProps> = ({
  fdi,
  record,
  procedures = [],
  labelPosition,
  isUpper = false,
  isSelected = false,
  size = 'regular',
  patientMode = false,
  onSelect,
}) => {
  const { t } = useTranslation(['patients']);
  const shape = getToothShape(fdi);
  const status = record?.status;
  const meta = status ? TOOTH_STATUS_META[status] : null;
  const buttonSize = size === 'large' ? 'h-[76px] w-[58px]' : 'h-[64px] w-[48px]';
  const tileSize = size === 'large' ? 'w-[66px]' : 'w-[54px]';
  const title = record
    ? `${fdi}: ${statusLabel(record.status, t)}${record.note ? ` - ${record.note}` : ''}`
    : t('patients:dentalChart.toothWithNumber', { number: fdi });

  const toothGroupTransform = isUpper ? 'translate(0 88) scale(1 -1)' : undefined;
  const strokeClass = meta?.stroke ?? 'stroke-slate-300 dark:stroke-slate-500';
  const fillClass = meta?.fill ?? 'fill-white dark:fill-gray-700';
  const statusClass = status ? `${meta?.border} ${meta?.soft}` : 'border-slate-200 bg-white dark:border-gray-600 dark:bg-gray-800';

  return (
    <div className={`relative flex ${tileSize} flex-col items-center gap-1`}>
      {labelPosition === 'top' && (
        <span className="h-4 text-[11px] font-semibold leading-4 text-slate-500 dark:text-slate-400">
          {fdi}
        </span>
      )}

      <button
        type="button"
        aria-pressed={isSelected}
        aria-label={title}
        title={title}
        onClick={() => onSelect(fdi)}
        className={[
          'relative flex items-center justify-center rounded-xl border transition-all duration-150',
          'hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2',
          'dark:focus:ring-offset-gray-900',
          buttonSize,
          statusClass,
          isSelected ? `ring-2 ${meta?.ring ?? 'ring-primary-200'} shadow-md` : '',
          patientMode ? 'cursor-pointer' : 'cursor-pointer',
        ].join(' ')}
      >
        <svg
          viewBox="0 0 64 88"
          role="presentation"
          className={[
            'h-[88%] w-[88%] drop-shadow-sm',
            status === 'missing' ? 'opacity-35' : 'opacity-100',
          ].join(' ')}
        >
          <g transform={toothGroupTransform}>
            {status === 'implant' && (
              <path
                d="M32 54 L32 84 M25 62 H39 M26 69 H38 M27 76 H37"
                className="stroke-purple-500 dark:stroke-purple-300"
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
              />
            )}
            <path
              d={TOOTH_PATHS[shape]}
              className={`${fillClass} ${strokeClass}`}
              strokeWidth={status === 'missing' ? 2.2 : 2.6}
              strokeDasharray={status === 'missing' ? '5 4' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {status === 'crown' && (
              <path
                d="M18 13 C25 5 29 12 32 12 C35 12 39 5 46 13 C48 18 48 23 46 27 C39 22 25 22 18 27 C16 23 16 18 18 13Z"
                className="fill-indigo-200 stroke-indigo-500 dark:fill-indigo-400/40 dark:stroke-indigo-300"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            )}
            {status === 'treated' && (
              <path
                d="M23 38 L30 45 L44 28"
                className="stroke-emerald-600 dark:stroke-emerald-200"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            )}
          </g>
          {status === 'missing' && (
            <path
              d="M20 44 H44"
              className="stroke-gray-400 dark:stroke-gray-300"
              strokeWidth="3"
              strokeLinecap="round"
            />
          )}
        </svg>

        <ToothStatusMark status={status} />
      </button>

      <div className="flex h-2.5 max-w-[48px] flex-wrap items-start justify-center gap-0.5">
        {procedures.slice(0, 4).map((procedure) => (
          <span
            key={procedure.id}
            title={`${procedure.procedureName} (${t(`patients:dentalChart.procedureStatus.${procedure.status}`, {
              defaultValue: PROCEDURE_STATUS_META[procedure.status]?.fallback ?? procedure.status,
            })})`}
            className={`h-1.5 w-1.5 rounded-full ${PROCEDURE_STATUS_META[procedure.status]?.dot ?? 'bg-gray-400'}`}
          />
        ))}
      </div>

      {labelPosition === 'bottom' && (
        <span className="h-4 text-[11px] font-semibold leading-4 text-slate-500 dark:text-slate-400">
          {fdi}
        </span>
      )}
    </div>
  );
};

export default ToothIcon;
