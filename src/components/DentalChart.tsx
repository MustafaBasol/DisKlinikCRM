import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
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
import { getChartOrder, Odontogram } from './odontogram';
import {
  Dentition,
  getToothDentition,
  isToothStatus,
  PROCEDURE_STATUS_META,
  resolveInitialDentition,
  TOOTH_STATUSES,
  TOOTH_STATUS_META,
  ToothRecord,
  ToothStatus,
  TreatmentProcedure,
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
  /**
   * Optional — only ever used to pick which chart opens FIRST for a patient
   * with no records yet (see resolveInitialDentition). The chart is fully
   * usable without it, so every existing call site stays valid.
   */
  dateOfBirth?: string | Date | null;
}

type ChartSize = 'regular' | 'large' | 'presentation';

function statusLabel(status: ToothStatus, t: ReturnType<typeof useTranslation>['t']) {
  return t(`patients:dentalChart.status.${status}`, {
    defaultValue: TOOTH_STATUS_META[status].fallback,
  });
}

const DentalChart: React.FC<DentalChartProps> = ({
  patientId,
  patientName,
  readOnly = false,
  showTreatmentPlan = true,
  dateOfBirth = null,
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
  // null until the first load resolves an initial dentition from the patient's
  // own records (see resolveInitialDentition). Once the clinician switches
  // manually their choice sticks for the rest of the visit — the resolver only
  // ever fills the initial null.
  const [dentition, setDentition] = useState<Dentition | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDentalChart() {
      setLoading(true);
      setDentition(null);
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
          let hasPrimaryRecords = false;
          let hasPermanentRecords = false;
          for (const rawRecord of chartRes.value.data) {
            const safeStatus = isToothStatus(rawRecord.status) ? rawRecord.status : 'planned';
            nextRecords.set(rawRecord.toothFdi, { ...rawRecord, status: safeStatus });
            if (getToothDentition(rawRecord.toothFdi) === 'primary') hasPrimaryRecords = true;
            else hasPermanentRecords = true;
          }
          setRecords(nextRecords);
          setDentition(
            resolveInitialDentition({ dateOfBirth, hasPermanentRecords, hasPrimaryRecords }),
          );
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
    // dateOfBirth is deliberately NOT a dependency: it only seeds the initial
    // view, and re-running on a prop identity change would yank a clinician
    // back out of a chart they had switched to mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Falls back to the adult arch while the initial resolution is still null so
  // the chart never renders an empty arch during the first paint.
  const activeDentition: Dentition = dentition ?? 'permanent';
  const isPrimaryView = activeDentition === 'primary';

  /**
   * How many records exist in EACH dentition. Surfaced on the switch itself so
   * a clinician can see at a glance that a mixed-dentition child has charted
   * teeth on the arch they are not currently looking at — without that cue the
   * other arch's records are invisible and look lost.
   */
  const dentitionCounts = useMemo(() => {
    let permanent = 0;
    let primary = 0;
    for (const fdi of records.keys()) {
      if (getToothDentition(fdi) === 'primary') primary += 1;
      else permanent += 1;
    }
    return { permanent, primary };
  }, [records]);

  // Status tallies are scoped to the arch on screen: showing adult totals over
  // a paediatric chart would misreport what the clinician is looking at.
  const counts = useMemo(() => {
    const nextCounts = Object.fromEntries(TOOTH_STATUSES.map((status) => [status, 0])) as Record<ToothStatus, number>;
    for (const [fdi, record] of records.entries()) {
      if ((getToothDentition(fdi) === 'primary') !== isPrimaryView) continue;
      nextCounts[record.status] += 1;
    }
    return nextCounts;
  }, [records, isPrimaryView]);

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
  const displayPatientName = patientName?.trim();

  const handleSelectTooth = useCallback(
    (fdi: number) => {
      const existing = records.get(fdi);
      setSelectedTooth(fdi);
      setEditStatus(existing?.status ?? 'planned');
      setEditNote(existing?.note ?? '');
    },
    [records],
  );

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

  /**
   * Switching arches clears the selection: a tooth selected on the adult chart
   * has no counterpart on the paediatric one, and leaving the detail panel
   * pointing at an off-screen tooth is how a note gets saved against the wrong
   * tooth. Nothing is persisted by switching — records for both arches stay
   * loaded and untouched.
   */
  const handleDentitionChange = (next: Dentition) => {
    if (next === activeDentition) return;
    setDentition(next);
    setSelectedTooth(null);
    setEditStatus('planned');
    setEditNote('');
    setJumpValue('');
    setJumpInvalid(false);
  };

  /**
   * Prev/next-tooth + jump-to-FDI (US: DENTAL-CHART-UX-001-R2 item 10). Pure
   * local-selection navigation — reuses handleSelectTooth so it never issues
   * a new API call and never mutates a record; jumping to an FDI that is not
   * part of the arch currently on screen surfaces jumpInvalid instead of
   * silently switching dentition or crashing.
   */
  const chartOrder = useMemo(() => getChartOrder(activeDentition), [activeDentition]);
  const [jumpValue, setJumpValue] = useState('');
  const [jumpInvalid, setJumpInvalid] = useState(false);

  const handlePreviousTooth = () => {
    if (chartOrder.length === 0) return;
    const currentIndex = selectedTooth !== null ? chartOrder.indexOf(selectedTooth) : -1;
    const previousIndex = currentIndex <= 0 ? chartOrder.length - 1 : currentIndex - 1;
    handleSelectTooth(chartOrder[previousIndex]);
  };

  const handleNextTooth = () => {
    if (chartOrder.length === 0) return;
    const currentIndex = selectedTooth !== null ? chartOrder.indexOf(selectedTooth) : -1;
    const nextIndex = currentIndex === -1 || currentIndex === chartOrder.length - 1 ? 0 : currentIndex + 1;
    handleSelectTooth(chartOrder[nextIndex]);
  };

  const handleJumpToFdi = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fdi = Number(jumpValue.trim());
    if (!Number.isInteger(fdi) || !chartOrder.includes(fdi)) {
      setJumpInvalid(true);
      return;
    }
    setJumpInvalid(false);
    setJumpValue('');
    handleSelectTooth(fdi);
  };

  const renderDentitionSwitch = () => {
    const options: { value: Dentition; label: string; count: number }[] = [
      {
        value: 'permanent',
        label: t('patients:dentalChart.dentition.permanent', { defaultValue: 'Adult' }),
        count: dentitionCounts.permanent,
      },
      {
        value: 'primary',
        label: t('patients:dentalChart.dentition.primary', { defaultValue: 'Primary' }),
        count: dentitionCounts.primary,
      },
    ];

    return (
      <div
        role="group"
        aria-label={t('patients:dentalChart.dentition.switchLabel', { defaultValue: 'Dentition' })}
        className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-gray-900"
      >
        {options.map((option) => {
          const active = activeDentition === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              data-dentition={option.value}
              onClick={() => handleDentitionChange(option.value)}
              className={[
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition',
                active
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200',
              ].join(' ')}
            >
              {option.label}
              {option.count > 0 && (
                <span
                  className={[
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none',
                    active ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-600 dark:bg-gray-700 dark:text-slate-300',
                  ].join(' ')}
                >
                  {option.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const renderToothNav = () => {
    if (patientMode) return null;
    const jumpErrorId = 'dental-chart-jump-error';
    return (
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-gray-900">
          <button
            type="button"
            onClick={handlePreviousTooth}
            aria-label={t('patients:dentalChart.navigation.previousTooth', { defaultValue: 'Previous tooth' })}
            title={t('patients:dentalChart.navigation.previousTooth', { defaultValue: 'Previous tooth' })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-800 dark:hover:bg-gray-700 dark:hover:text-white"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={handleNextTooth}
            aria-label={t('patients:dentalChart.navigation.nextTooth', { defaultValue: 'Next tooth' })}
            title={t('patients:dentalChart.navigation.nextTooth', { defaultValue: 'Next tooth' })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-800 dark:hover:bg-gray-700 dark:hover:text-white"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <form onSubmit={handleJumpToFdi} className="flex items-center gap-1.5">
          <label htmlFor="dental-chart-jump-fdi" className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('patients:dentalChart.navigation.jumpLabel', { defaultValue: 'Go to FDI' })}
          </label>
          <input
            id="dental-chart-jump-fdi"
            type="text"
            inputMode="numeric"
            value={jumpValue}
            onChange={(event) => {
              setJumpValue(event.target.value);
              if (jumpInvalid) setJumpInvalid(false);
            }}
            placeholder={t('patients:dentalChart.navigation.jumpPlaceholder', { defaultValue: 'e.g. 36' })}
            aria-invalid={jumpInvalid}
            aria-describedby={jumpInvalid ? jumpErrorId : undefined}
            className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 dark:border-gray-600 dark:bg-gray-800 dark:text-slate-200"
          />
          <button
            type="submit"
            className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 dark:bg-gray-800 dark:text-slate-300 dark:hover:bg-gray-700"
          >
            {t('patients:dentalChart.navigation.jumpLabel', { defaultValue: 'Go to FDI' })}
          </button>
        </form>
        {jumpInvalid && (
          <span id={jumpErrorId} role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
            {t('patients:dentalChart.navigation.jumpInvalid', { defaultValue: 'That tooth is not in this dentition.' })}
          </span>
        )}
      </div>
    );
  };

  const renderLegend = (compact = false, patientFriendly = false) => (
    <div className={patientFriendly ? 'flex flex-wrap items-center gap-1.5' : 'flex flex-wrap items-center gap-2'}>
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
            {!patientFriendly && counts[status] > 0 && <span className="font-bold">({counts[status]})</span>}
          </span>
        );
      })}
      {showTreatmentPlan && !patientFriendly && (
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

  const renderChartStage = (size: ChartSize) => (
    <div
      className={[
        'rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/40 md:p-4',
        size === 'large' || size === 'presentation' ? 'lg:p-6' : '',
      ].join(' ')}
    >
      <Odontogram
        dentition={activeDentition}
        records={records}
        procedureMap={procedureMap}
        selectedTooth={selectedTooth}
        onSelect={handleSelectTooth}
        size={size}
        patientMode={patientMode}
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
              <div className="flex flex-wrap items-center gap-3">
                {renderDentitionSwitch()}
                {renderToothNav()}
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isPrimaryView
                    ? t('patients:dentalChart.dentition.primaryHint', {
                        defaultValue: 'Primary (deciduous) teeth, FDI 51-85.',
                      })
                    : t('patients:dentalChart.dentition.permanentHint', {
                        defaultValue: 'Permanent teeth, FDI 11-48.',
                      })}
                </p>
              </div>
              {renderLegend(false, patientMode)}
              <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0">{renderChartStage('regular')}</div>
                {!patientMode || selectedTooth !== null ? <div>{renderDetailPanel('card')}</div> : null}
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
        patientName={displayPatientName}
        patientMode={patientMode}
        showDetailPanel={!patientMode || selectedTooth !== null}
        onPatientModeChange={setPatientMode}
        onClose={() => setFullscreenOpen(false)}
        toolbar={
          <>
            {renderDentitionSwitch()}
            {renderToothNav()}
          </>
        }
        legend={renderLegend(true, patientMode)}
        chart={renderChartStage('presentation')}
        detailPanel={renderDetailPanel('fullscreen')}
      />
    </>
  );
};

export default DentalChart;
