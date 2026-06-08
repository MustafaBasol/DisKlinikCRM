import React from 'react';
import {
  CalendarClock,
  ClipboardList,
  Info,
  Loader2,
  Save,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getToothShape,
  PROCEDURE_STATUS_META,
  TOOTH_STATUSES,
  TOOTH_STATUS_META,
  ToothRecord,
  ToothStatus,
  TreatmentProcedure,
} from './dentalChart.types';

interface ToothDetailPanelProps {
  selectedTooth: number | null;
  record?: ToothRecord;
  procedures: TreatmentProcedure[];
  editStatus: ToothStatus;
  editNote: string;
  canEdit: boolean;
  patientMode: boolean;
  saving: boolean;
  formatDateTime: (value: string) => string;
  formatCurrency: (amount: number, currency?: string, options?: Intl.NumberFormatOptions) => string;
  onStatusChange: (status: ToothStatus) => void;
  onQuickStatusSave: (status: ToothStatus) => void;
  onNoteChange: (note: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function statusLabel(status: ToothStatus, t: ReturnType<typeof useTranslation>['t']) {
  return t(`patients:dentalChart.status.${status}`, {
    defaultValue: TOOTH_STATUS_META[status].fallback,
  });
}

const ToothDetailPanel: React.FC<ToothDetailPanelProps> = ({
  selectedTooth,
  record,
  procedures,
  editStatus,
  editNote,
  canEdit,
  patientMode,
  saving,
  formatDateTime,
  formatCurrency,
  onStatusChange,
  onQuickStatusSave,
  onNoteChange,
  onSave,
  onDelete,
  onClose,
}) => {
  const { t } = useTranslation(['patients', 'common']);

  if (selectedTooth === null) {
    return (
      <aside className="rounded-xl border border-dashed border-slate-200 bg-white/70 p-5 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800/70">
        <Info size={24} className="mx-auto mb-3 text-slate-400" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t('patients:dentalChart.panelHint', {
            defaultValue: 'Select a tooth to view status, notes, and treatment plan.',
          })}
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t('patients:dentalChart.subtitle', {
            defaultValue: 'Click teeth to manage status and treatment notes.',
          })}
        </p>
      </aside>
    );
  }

  const activeMeta = TOOTH_STATUS_META[editStatus];
  const recordMeta = record ? TOOTH_STATUS_META[record.status] : activeMeta;
  const shape = getToothShape(selectedTooth);
  const lastUpdated = record?.updatedAt ? formatDateTime(record.updatedAt) : null;
  const displayStatus = record?.status ?? editStatus;
  const displayMeta = record ? TOOTH_STATUS_META[record.status] : activeMeta;
  const showPatientNote = patientMode && Boolean(record?.note);

  return (
    <aside className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4 dark:border-gray-700">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl border ${recordMeta.badge}`}>
            <span className="text-[10px] font-semibold uppercase leading-none opacity-70">
              {t('patients:dentalChart.toothShort', { defaultValue: 'Tooth' })}
            </span>
            <span className="mt-1 text-xl font-black leading-none">{selectedTooth}</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-slate-400">
              {t('patients:dentalChart.selectedTooth', { defaultValue: 'Selected Tooth' })}
            </p>
            <h4 className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">
              {t(`patients:dentalChart.toothShape.${shape}`, { defaultValue: shape })}
            </h4>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              FDI {selectedTooth}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-gray-700 dark:hover:text-white"
          aria-label={t('common:close', { defaultValue: 'Close' })}
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {!record && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-slate-300">
            {patientMode
              ? t('patients:dentalChart.patientNoRecord', {
                  defaultValue: 'No procedure record has been added for this tooth yet.',
                })
              : t('patients:dentalChart.noRecord', {
                  defaultValue: 'No record has been added for this tooth yet.',
                })}
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
            {t('patients:dentalChart.currentStatus', { defaultValue: 'Current Status' })}
          </p>
          <div className={`flex items-center gap-3 rounded-xl border p-4 ${record ? displayMeta.badge : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-slate-300'}`}>
            <span className={`h-3 w-3 shrink-0 rounded-full ${record ? displayMeta.dot : 'bg-slate-300'}`} />
            <span className="text-base font-bold">
              {record
                ? statusLabel(displayStatus, t)
                : patientMode
                  ? t('patients:dentalChart.patientNoRecordShort', { defaultValue: 'No procedure record' })
                  : t('patients:dentalChart.noRecordShort', { defaultValue: 'No record' })}
            </span>
          </div>
        </div>

        {canEdit && !patientMode && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
              {t('patients:dentalChart.quickStatus', { defaultValue: 'Quick Status' })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {TOOTH_STATUSES.map((status) => {
                const meta = TOOTH_STATUS_META[status];
                const active = editStatus === status;
                return (
                  <button
                    key={status}
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      onStatusChange(status);
                      onQuickStatusSave(status);
                    }}
                    className={[
                      'min-h-10 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary-400',
                      active
                        ? `${meta.badge} ring-1 ${meta.ring}`
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-gray-700 dark:bg-gray-800 dark:text-slate-300 dark:hover:bg-gray-700',
                    ].join(' ')}
                  >
                    <span className={`mr-2 inline-block h-2 w-2 rounded-full ${meta.dot}`} />
                    {statusLabel(status, t)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(!patientMode || showPatientNote) && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
            <StickyNote size={13} />
            {t('patients:dentalChart.notes', { defaultValue: 'Notes' })}
          </div>
          {canEdit && !patientMode ? (
            <textarea
              value={editNote}
              onChange={(event) => onNoteChange(event.target.value)}
              rows={4}
              maxLength={300}
              placeholder={t('patients:dentalChart.notePlaceholder')}
              className="input-field resize-none"
            />
          ) : (
            <p className="min-h-12 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-slate-300">
              {record?.note || t('patients:dentalChart.noNote', { defaultValue: 'No note added.' })}
            </p>
          )}
        </div>
        )}

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
            <ClipboardList size={13} />
            {t('patients:dentalChart.treatmentPlanForTooth', { defaultValue: 'Treatment Plan' })}
          </div>
          {procedures.length === 0 ? (
            <p className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-slate-400">
              {patientMode
                ? t('patients:dentalChart.patientNoTreatmentForTooth', {
                    defaultValue: 'No planned procedure is shown for this tooth.',
                  })
                : t('patients:dentalChart.noTreatmentForTooth', {
                    defaultValue: 'No treatment plan item is linked to this tooth.',
                  })}
            </p>
          ) : (
            <div className="space-y-2">
              {procedures.map((procedure) => {
                const meta = PROCEDURE_STATUS_META[procedure.status] ?? PROCEDURE_STATUS_META.planned;
                return (
                  <div
                    key={procedure.id}
                    className={`rounded-lg border p-3 ${meta.bg} ${meta.border}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {procedure.procedureName}
                        </p>
                        {procedure.treatmentCase?.title && (
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {procedure.treatmentCase.title}
                          </p>
                        )}
                      </div>
                      <span className={`whitespace-nowrap text-xs font-semibold ${meta.text}`}>
                        {t(`patients:dentalChart.procedureStatus.${procedure.status}`, {
                          defaultValue: meta.fallback,
                        })}
                      </span>
                    </div>
                    {procedure.notes && (
                      <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{procedure.notes}</p>
                    )}
                    {procedure.estimatedCost ? (
                      <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        {t('patients:dentalChart.estimated')}: {formatCurrency(procedure.estimatedCost)}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {lastUpdated && (
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-gray-900/40 dark:text-slate-400">
            <CalendarClock size={14} />
            {t('patients:dentalChart.lastUpdated', { defaultValue: 'Last update' })}: {lastUpdated}
          </div>
        )}

        {canEdit && !patientMode && (
          <div className="flex items-center gap-2 border-t border-slate-100 pt-4 dark:border-gray-700">
            <button type="button" onClick={onSave} disabled={saving} className="btn-primary flex-1">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {t('common:save')}
            </button>
            {record && (
              <button
                type="button"
                onClick={onDelete}
                disabled={saving}
                className="btn-danger px-3"
                title={t('patients:dentalChart.deleteRecord')}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};

export default ToothDetailPanel;
