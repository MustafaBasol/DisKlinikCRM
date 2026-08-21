import React from 'react';
import { Activity, AlertTriangle, Check, CircleDot, Crown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getToothDentition,
  getToothShape,
  PROCEDURE_STATUS_META,
  TOOTH_STATUS_META,
  ToothRecord,
  TreatmentProcedure,
  ToothStatus,
} from './dentalChart.types';
import {
  CROWN_MARGIN_PATH,
  getToothGeometry,
  IMPLANT_FIXTURE_PATH,
  IMPLANT_THREAD_PATH,
} from './toothGeometry';

type ToothIconSize = 'regular' | 'large' | 'presentation';

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
  const dentition = getToothDentition(fdi);
  const geometry = getToothGeometry(shape, dentition, isUpper);
  const status = record?.status;
  const meta = status ? TOOTH_STATUS_META[status] : null;
  const buttonSize =
    size === 'presentation' ? 'h-[104px] w-[70px]' : size === 'large' ? 'h-[82px] w-[62px]' : 'h-[64px] w-[48px]';
  const tileSize =
    size === 'presentation' ? 'w-[78px]' : size === 'large' ? 'w-[70px]' : 'w-[54px]';
  const labelClass =
    size === 'presentation'
      ? 'h-5 text-[13px] font-bold leading-5 text-slate-600 dark:text-slate-300'
      : 'h-4 text-[11px] font-semibold leading-4 text-slate-500 dark:text-slate-400';
  const title = record
    ? `${fdi}: ${statusLabel(record.status, t)}${record.note ? ` - ${record.note}` : ''}`
    : t('patients:dentalChart.patientNoRecord', {
        defaultValue: 'No procedure record has been added for this tooth yet.',
      });

  const toothGroupTransform = isUpper ? 'translate(0 88) scale(1 -1)' : undefined;
  const strokeClass = meta?.stroke ?? 'stroke-slate-400 dark:stroke-slate-500';
  const fillClass = meta?.fill ?? 'fill-white dark:fill-gray-700';
  // A full-coverage crown restores the whole clinical crown, so `crown` status
  // fills the entire crown path with a solid (not tinted-white) indigo rather
  // than drawing a separate cap on top of an otherwise natural-looking tooth.
  const crownFillClass =
    status === 'crown' ? 'fill-indigo-200 dark:fill-indigo-500/40' : fillClass;
  const isMissing = status === 'missing';
  const statusClass = status ? `${meta?.border} ${meta?.soft}` : 'border-slate-200 bg-white dark:border-gray-600 dark:bg-gray-800';

  return (
    <div className={`relative flex ${tileSize} flex-col items-center gap-1`}>
      {labelPosition === 'top' && (
        <span className={labelClass}>
          {fdi}
        </span>
      )}

      <button
        type="button"
        aria-pressed={isSelected}
        aria-label={title}
        title={title}
        data-tooth-fdi={fdi}
        data-tooth-dentition={dentition}
        onClick={() => onSelect(fdi)}
        className={[
          'relative flex items-center justify-center rounded-xl border transition-all duration-150',
          'hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2',
          'dark:focus:ring-offset-gray-900',
          buttonSize,
          statusClass,
          isSelected ? `ring-2 ${meta?.ring ?? 'ring-primary-200'} shadow-md` : '',
        ].join(' ')}
      >
        <svg
          viewBox="0 0 64 88"
          role="presentation"
          className={[
            'h-[88%] w-[88%] drop-shadow-sm',
            isMissing ? 'opacity-35' : 'opacity-100',
          ].join(' ')}
        >
          {/*
            Draw order is anatomical: roots first so the crown overlaps them at
            the cervical line, then surface detail on top of the crown. The
            whole group is flipped for upper teeth by the transform below —
            the paths themselves are always authored crown-up.
          */}
          <g transform={toothGroupTransform}>
            {status === 'implant' ? (
              <>
                <path
                  d={IMPLANT_FIXTURE_PATH}
                  className="fill-purple-200 stroke-purple-600 dark:fill-purple-500/40 dark:stroke-purple-300"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path
                  d={IMPLANT_THREAD_PATH}
                  className="stroke-purple-600 opacity-70 dark:stroke-purple-200"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  fill="none"
                />
              </>
            ) : (
              geometry.roots.map((rootPath, index) => (
                <path
                  key={index}
                  d={rootPath}
                  className={`${fillClass} ${strokeClass} opacity-75`}
                  strokeWidth={isMissing ? 1.6 : 1.9}
                  strokeDasharray={isMissing ? '4 3' : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))
            )}

            <path
              d={geometry.crown}
              className={`${crownFillClass} ${strokeClass}`}
              strokeWidth={isMissing ? 1.9 : 2.3}
              strokeDasharray={isMissing ? '5 4' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {!isMissing && (
              <>
                <path
                  d={geometry.surface}
                  className={`${strokeClass} opacity-45`}
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d={geometry.cervical}
                  className={`${strokeClass} opacity-35`}
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  fill="none"
                />
              </>
            )}

            {status === 'crown' && (
              <path
                d={CROWN_MARGIN_PATH}
                className="stroke-indigo-600 dark:stroke-indigo-200"
                strokeWidth="1.8"
                strokeLinecap="round"
                fill="none"
              />
            )}
          </g>

          {/*
            Status marks that must stay upright regardless of jaw — they live
            OUTSIDE the flip group on purpose (a mirrored tick reads as wrong).
          */}
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
          {isMissing && (
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

      {!patientMode && (
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
      )}

      {labelPosition === 'bottom' && (
        <span className={labelClass}>
          {fdi}
        </span>
      )}
    </div>
  );
};

export default ToothIcon;
