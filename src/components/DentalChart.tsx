import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Maximize2,
  Plus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DentalChartFullscreenModal from './DentalChartFullscreenModal';
import ToothDetailPanel from './ToothDetailPanel';
import ToothIcon from './ToothIcon';
import {
  isToothStatus,
  LOWER_LEFT,
  LOWER_RIGHT,
  PROCEDURE_STATUS_META,
  TOOTH_STATUSES,
  TOOTH_STATUS_META,
  ToothRecord,
  ToothStatus,
  TreatmentProcedure,
  UPPER_LEFT,
  UPPER_RIGHT,
} from './dentalChart.types';
import { useAuth } from '../context/AuthContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { dentalChartService, treatmentPlanProceduresService } from '../services/api';
import { normalizeRole } from '../utils/permissions';

interface DentalChartProps {
  patientId: string;
  patientName?: string;
  readOnly?: boolean;
  showTreatmentPlan?: boolean;
}

interface QuadrantProps {
  label: string;
  teeth: number[];
  align: 'start' | 'end';
  isUpper: boolean;
  labelPosition: 'top' | 'bottom';
  records: Map<number, ToothRecord>;
  procedureMap: Map<number, TreatmentProcedure[]>;
  selectedTooth: number | null;
  size: 'regular' | 'large';
  patientMode: boolean;
  onSelect: (fdi: number) => void;
}

interface JawRowProps {
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftTeeth: number[];
  rightTeeth: number[];
  isUpper: boolean;
  labelPosition: 'top' | 'bottom';
  records: Map<number, ToothRecord>;
  procedureMap: Map<number, TreatmentProcedure[]>;
  selectedTooth: number | null;
  size: 'regular' | 'large';
  patientMode: boolean;
  onSelect: (fdi: number) => void;
}

function statusLabel(status: ToothStatus, t: ReturnType<typeof useTranslation>['t']) {
  return t(`patients:dentalChart.status.${status}`, {
    defaultValue: TOOTH_STATUS_META[status].fallback,
  });
}

const Quadrant: React.FC<QuadrantProps> = ({
  label,
  teeth,
  align,
  isUpper,
  labelPosition,
  records,
  procedureMap,
  selectedTooth,
  size,
  patientMode,
  onSelect,
}) => (
  <div className={`flex min-w-0 flex-col gap-2 ${align === 'end' ? 'items-end' : 'items-start'}`}>
    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
    <div
      className={[
        'flex max-w-full flex-wrap gap-1.5 sm:gap-2',
        align === 'end' ? 'justify-end' : 'justify-start',
      ].join(' ')}
    >
      {teeth.map((fdi) => (
        <ToothIcon
          key={fdi}
          fdi={fdi}
          record={records.get(fdi)}
          procedures={procedureMap.get(fdi)}
          labelPosition={labelPosition}
          isUpper={isUpper}
          isSelected={selectedTooth === fdi}
          size={size}
          patientMode={patientMode}
          onSelect={onSelect}
        />
      ))}
    </div>
  </div>
);

const JawRow: React.FC<JawRowProps> = ({
  title,
  leftLabel,
  rightLabel,
  leftTeeth,
  rightTeeth,
  isUpper,
  labelPosition,
  records,
  procedureMap,
  selectedTooth,
  size,
  patientMode,
  onSelect,
}) => (
  <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800/80 md:p-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h4>
      <span className="text-[11px] font-medium text-slate-400">
        {leftLabel} / {rightLabel}
      </span>
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-start">
      <Quadrant
        label={leftLabel}
        teeth={leftTeeth}
        align="end"
        isUpper={isUpper}
        labelPosition={labelPosition}
        records={records}
        procedureMap={procedureMap}
        selectedTooth={selectedTooth}
        size={size}
        patientMode={patientMode}
        onSelect={onSelect}
      />
      <div className="hidden h-full w-px rounded-full bg-slate-200 dark:bg-gray-700 lg:block" />
      <Quadrant
        label={rightLabel}
        teeth={rightTeeth}
        align="start"
        isUpper={isUpper}
        labelPosition={labelPosition}
        records={records}
        procedureMap={procedureMap}
        selectedTooth={selectedTooth}
        size={size}
        patientMode={patientMode}
        onSelect={onSelect}
      />
    </div>
  </section>
);

const DentalChart: React.FC<DentalChartProps> = ({
  patientId,
  patientName,
  readOnly = false,
  showTreatmentPlan = true,
}) => {
  const { t } = useTranslation(['patients', 'common']);
  const { user } = useAuth();
  const { formatCurrency, formatDateTime } = useClinicPreferences();
  const canonicalRole = normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false);
  const canEdit =
    !readOnly &&
    ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST'].includes(canonicalRole);

  const [records, setRecords] = useState<Map<number, ToothRecord>>(new Map());
  const [procedures, setProcedures] = useState<TreatmentProcedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState<ToothStatus>('planned');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeProcTab, setActiveProcTab] = useState<'chart' | 'plan'>('chart');
  const [patientMode, setPatientMode] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadDentalChart() {
      setLoading(true);
      try {
        const [chartRes, procRes] = await Promise.allSettled([
          dentalChartService.getAll(patientId),
          showTreatmentPlan
            ? treatmentPlanProceduresService.getPatientProcedures(patientId)
            : Promise.resolve({ data: [] }),
        ]);

        if (cancelled) return;

        if (chartRes.status === 'fulfilled') {
          const nextRecords = new Map<number, ToothRecord>();
          for (const rawRecord of chartRes.value.data) {
            const safeStatus = isToothStatus(rawRecord.status) ? rawRecord.status : 'planned';
            nextRecords.set(rawRecord.toothFdi, { ...rawRecord, status: safeStatus });
          }
          setRecords(nextRecords);
        }

        if (procRes.status === 'fulfilled') {
          setProcedures(procRes.value.data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDentalChart();

    return () => {
      cancelled = true;
    };
  }, [patientId, showTreatmentPlan]);

  const procedureMap = useMemo(() => {
    const nextMap = new Map<number, TreatmentProcedure[]>();
    for (const procedure of procedures) {
      if (!procedure.toothFdi) continue;
      const existing = nextMap.get(procedure.toothFdi) ?? [];
      existing.push(procedure);
      nextMap.set(procedure.toothFdi, existing);
    }
    return nextMap;
  }, [procedures]);

  const counts = useMemo(() => {
    const nextCounts = Object.fromEntries(TOOTH_STATUSES.map((status) => [status, 0])) as Record<ToothStatus, number>;
    for (const record of records.values()) {
      nextCounts[record.status] += 1;
    }
    return nextCounts;
  }, [records]);

  const activeProcedures = useMemo(
    () => procedures.filter((procedure) => procedure.status !== 'cancelled'),
    [procedures],
  );

  const proceduresByCase = useMemo(() => {
    return procedures.reduce<Record<string, { caseTitle: string; caseStage: string; items: TreatmentProcedure[] }>>(
      (groups, procedure) => {
        const caseId = procedure.treatmentCase?.id ?? 'unknown';
        if (!groups[caseId]) {
          groups[caseId] = {
            caseTitle:
              procedure.treatmentCase?.title ??
              t('patients:dentalChart.treatmentCaseFallback', { defaultValue: 'Treatment Case' }),
            caseStage: procedure.treatmentCase?.stage ?? '',
            items: [],
          };
        }
        groups[caseId].items.push(procedure);
        return groups;
      },
      {},
    );
  }, [procedures, t]);

  const selectedRecord = selectedTooth !== null ? records.get(selectedTooth) : undefined;
  const selectedProcedures = selectedTooth !== null ? procedureMap.get(selectedTooth) ?? [] : [];
  const showChart = patientMode || !showTreatmentPlan || activeProcTab === 'chart';
  const showPlan = !patientMode && showTreatmentPlan && activeProcTab === 'plan';

  const handleSelectTooth = (fdi: number) => {
    const existing = records.get(fdi);
    setSelectedTooth(fdi);
    setEditStatus(existing?.status ?? 'planned');
    setEditNote(existing?.note ?? '');
  };

  const saveToothRecord = async (status: ToothStatus, note: string) => {
    if (!selectedTooth || !canEdit) return;
    setSaving(true);
    try {
      const response = await dentalChartService.upsert(patientId, selectedTooth, {
        status,
        note,
      });
      const safeStatus = isToothStatus(response.data.status) ? response.data.status : status;
      const nextRecord: ToothRecord = { ...response.data, status: safeStatus };
      setRecords((previous) => new Map(previous).set(selectedTooth, nextRecord));
      setEditStatus(safeStatus);
      setEditNote(nextRecord.note ?? '');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => saveToothRecord(editStatus, editNote);

  const handleQuickStatusSave = (status: ToothStatus) => {
    if (!canEdit) return;
    saveToothRecord(status, editNote);
  };

  const handleDelete = async () => {
    if (!selectedTooth || !canEdit) return;
    setSaving(true);
    try {
      await dentalChartService.delete(patientId, selectedTooth);
      setRecords((previous) => {
        const nextRecords = new Map(previous);
        nextRecords.delete(selectedTooth);
        return nextRecords;
      });
      setSelectedTooth(null);
      setEditStatus('planned');
      setEditNote('');
    } finally {
      setSaving(false);
    }
  };

  const renderLegend = (compact = false) => (
    <div className="flex flex-wrap items-center gap-2">
      {TOOTH_STATUSES.map((status) => {
        const meta = TOOTH_STATUS_META[status];
        return (
          <span
            key={status}
            className={[
              'inline-flex items-center gap-1.5 rounded-full border font-semibold',
              compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs',
              meta.badge,
            ].join(' ')}
          >
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
            {statusLabel(status, t)}
            {counts[status] > 0 && <span className="font-bold">({counts[status]})</span>}
          </span>
        );
      })}
      {showTreatmentPlan && (
        <div className="flex flex-wrap items-center gap-2 border-l border-slate-200 pl-2 dark:border-gray-700">
          {Object.entries(PROCEDURE_STATUS_META).map(([status, meta]) => (
            <span key={status} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
              {t(`patients:dentalChart.procedureStatus.${status}`, { defaultValue: meta.fallback })}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  const renderChartStage = (size: 'regular' | 'large') => (
    <div
      className={[
        'rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/40 md:p-4',
        size === 'large' ? 'space-y-5 lg:p-6' : 'space-y-4',
      ].join(' ')}
    >
      <JawRow
        title={t('patients:dentalChart.upperJaw', { defaultValue: 'Upper Jaw' })}
        leftLabel={t('patients:dentalChart.upperRight', { defaultValue: 'Upper Right' })}
        rightLabel={t('patients:dentalChart.upperLeft', { defaultValue: 'Upper Left' })}
        leftTeeth={UPPER_RIGHT}
        rightTeeth={UPPER_LEFT}
        isUpper
        labelPosition="top"
        records={records}
        procedureMap={procedureMap}
        selectedTooth={selectedTooth}
        size={size}
        patientMode={patientMode}
        onSelect={handleSelectTooth}
      />
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4">
        <div className="h-px flex-1 border-t border-dashed border-slate-300 dark:border-gray-600" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          FDI
        </span>
        <div className="h-px flex-1 border-t border-dashed border-slate-300 dark:border-gray-600" />
      </div>
      <JawRow
        title={t('patients:dentalChart.lowerJaw', { defaultValue: 'Lower Jaw' })}
        leftLabel={t('patients:dentalChart.lowerRight', { defaultValue: 'Lower Right' })}
        rightLabel={t('patients:dentalChart.lowerLeft', { defaultValue: 'Lower Left' })}
        leftTeeth={LOWER_RIGHT}
        rightTeeth={LOWER_LEFT}
        isUpper={false}
        labelPosition="bottom"
        records={records}
        procedureMap={procedureMap}
        selectedTooth={selectedTooth}
        size={size}
        patientMode={patientMode}
        onSelect={handleSelectTooth}
      />
    </div>
  );

  const renderDetailPanel = (mode: 'card' | 'fullscreen') => (
    <ToothDetailPanel
      selectedTooth={selectedTooth}
      record={selectedRecord}
      procedures={selectedProcedures}
      editStatus={editStatus}
      editNote={editNote}
      canEdit={canEdit}
      patientMode={patientMode}
      saving={saving}
      formatDateTime={formatDateTime}
      formatCurrency={formatCurrency}
      onStatusChange={setEditStatus}
      onQuickStatusSave={handleQuickStatusSave}
      onNoteChange={setEditNote}
      onSave={handleSave}
      onDelete={handleDelete}
      onClose={() => setSelectedTooth(null)}
    />
  );

  if (loading) {
    return (
      <div className="card flex justify-center py-12">
        <Loader2 className="animate-spin text-primary-500" size={32} />
      </div>
    );
  }

  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 dark:border-gray-700 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-950 dark:text-white">
              {t('patients:dentalChart.title')}
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t('patients:dentalChart.subtitle', {
                defaultValue: 'Click teeth to manage status and treatment notes.',
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPatientMode((current) => !current)}
              className={[
                'btn-secondary min-h-10',
                patientMode ? 'border-primary-200 bg-primary-50 text-primary-700 dark:bg-primary-900/20' : '',
              ].join(' ')}
            >
              {patientMode ? <EyeOff size={16} /> : <Eye size={16} />}
              {patientMode
                ? t('patients:dentalChart.technicalView', { defaultValue: 'Clinical View' })
                : t('patients:dentalChart.patientView', { defaultValue: 'Patient View' })}
            </button>
            <button type="button" onClick={() => setFullscreenOpen(true)} className="btn-primary min-h-10">
              <Maximize2 size={16} />
              {t('patients:dentalChart.fullscreen', { defaultValue: 'Fullscreen' })}
            </button>
          </div>
        </div>

        <div className="space-y-5 p-4 md:p-5">
          {showTreatmentPlan && !patientMode && (
            <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-gray-900">
              <button
                type="button"
                onClick={() => setActiveProcTab('chart')}
                className={[
                  'rounded-lg px-4 py-1.5 text-sm font-semibold transition',
                  activeProcTab === 'chart'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-gray-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200',
                ].join(' ')}
              >
                {t('patients:dentalChart.title')}
              </button>
              <button
                type="button"
                onClick={() => setActiveProcTab('plan')}
                className={[
                  'inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition',
                  activeProcTab === 'plan'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-gray-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200',
                ].join(' ')}
              >
                <ClipboardList size={14} />
                {t('patients:dentalChart.treatmentPlan')}
                {activeProcedures.length > 0 && (
                  <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] leading-none text-white">
                    {activeProcedures.length}
                  </span>
                )}
              </button>
            </div>
          )}

          {showChart && (
            <>
              {renderLegend()}
              <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0">{renderChartStage('regular')}</div>
                <div>{renderDetailPanel('card')}</div>
              </div>
            </>
          )}

          {showPlan && (
            <div className="space-y-4">
              {Object.keys(proceduresByCase).length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-slate-400 dark:border-gray-700 dark:bg-gray-900/30">
                  <ClipboardList size={40} className="mx-auto mb-3 opacity-25" />
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">
                    {t('patients:dentalChart.noProcedures')}
                  </p>
                  <p className="mx-auto mt-2 max-w-sm text-xs text-slate-400">
                    {t('patients:dentalChart.addProcedureHelp')}
                  </p>
                  <Link
                    to="#"
                    onClick={(event) => {
                      event.preventDefault();
                      document.querySelector<HTMLButtonElement>('[data-tab="treatments"]')?.click();
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary-700"
                  >
                    <ExternalLink size={13} />
                    {t('patients:dentalChart.goToTreatments')}
                  </Link>
                </div>
              ) : (
                Object.entries(proceduresByCase).map(([caseId, group]) => {
                  const hasCaseLink = caseId !== 'unknown';
                  return (
                    <section
                      key={caseId}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
                    >
                      <div className="mb-3 flex items-center gap-2">
                        {hasCaseLink ? (
                          <Link
                            to={`/treatment-cases/${caseId}`}
                            className="text-sm font-bold text-slate-800 transition hover:text-primary-600 dark:text-slate-100 dark:hover:text-primary-300"
                          >
                            {group.caseTitle}
                          </Link>
                        ) : (
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                            {group.caseTitle}
                          </span>
                        )}
                        {group.caseStage && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-gray-700 dark:text-slate-300">
                            {group.caseStage}
                          </span>
                        )}
                        {hasCaseLink && (
                          <Link
                            to={`/treatment-cases/${caseId}`}
                            className="ml-auto flex flex-shrink-0 items-center gap-1 text-xs font-semibold text-primary-600 hover:underline"
                            title={t('patients:dentalChart.addProcedureTitle')}
                          >
                            <Plus size={12} />
                            {t('patients:dentalChart.addProcedure')}
                          </Link>
                        )}
                      </div>
                      <div className="space-y-2">
                        {group.items.map((procedure) => {
                          const meta = PROCEDURE_STATUS_META[procedure.status] ?? PROCEDURE_STATUS_META.planned;
                          return (
                            <div
                              key={procedure.id}
                              className={`rounded-lg border p-3 ${meta.bg} ${meta.border}`}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                  {procedure.procedureName}
                                </span>
                                {procedure.toothFdi && (
                                  <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-xs dark:border-gray-600 dark:bg-gray-700">
                                    {t('patients:dentalChart.toothWithNumber', { number: procedure.toothFdi })}
                                  </span>
                                )}
                                <span className={`text-xs font-semibold ${meta.text}`}>
                                  {t(`patients:dentalChart.procedureStatus.${procedure.status}`, {
                                    defaultValue: meta.fallback,
                                  })}
                                </span>
                              </div>
                              {procedure.notes && (
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{procedure.notes}</p>
                              )}
                              {procedure.estimatedCost ? (
                                <p className="mt-1 text-xs text-slate-400">
                                  {t('patients:dentalChart.estimated')}: {formatCurrency(procedure.estimatedCost)}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      <DentalChartFullscreenModal
        open={fullscreenOpen}
        patientName={patientName}
        patientMode={patientMode}
        onPatientModeChange={setPatientMode}
        onClose={() => setFullscreenOpen(false)}
        legend={renderLegend(true)}
        chart={renderChartStage('large')}
        detailPanel={renderDetailPanel('fullscreen')}
      />
    </>
  );
};

export default DentalChart;
