import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Trash2, Save, X, ClipboardList, CheckCircle2, Circle, AlertCircle, Plus, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dentalChartService, treatmentPlanProceduresService } from '../services/api';
import { useAuth } from '../context/AuthContext';

// ── Types ──────────────────────────────────────────────────────────────
export type ToothStatus = 'planned' | 'treated' | 'issue' | 'missing' | 'crown' | 'implant';

interface ToothRecord {
  id: string;
  toothFdi: number;
  status: ToothStatus;
  note?: string;
  createdBy?: { firstName: string; lastName: string };
  updatedAt?: string;
}

export interface TreatmentProcedure {
  id: string;
  toothFdi?: number | null;
  procedureName: string;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  notes?: string;
  estimatedCost?: number;
  treatmentCase?: { id: string; title: string; stage: string };
  service?: { id: string; name: string };
  createdAt: string;
}

interface Props {
  patientId: string;
  readOnly?: boolean;
  showTreatmentPlan?: boolean; // show treatment plan overlay layer
}

// ── Procedure status config ────────────────────────────────────────────
const PROC_STATUS_CONFIG = {
  planned:     { dot: 'bg-amber-400',   text: 'text-amber-700',  bg: 'bg-amber-50',  icon: Circle },
  in_progress: { dot: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50',   icon: AlertCircle },
  completed:   { dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50',icon: CheckCircle2 },
  cancelled:   { dot: 'bg-gray-400',    text: 'text-gray-500',   bg: 'bg-gray-50',   icon: X },
} as const;

// ── Status config ──────────────────────────────────────────────────────
const STATUS_CONFIG: Record<
  ToothStatus,
  { bg: string; text: string; border: string; darkBg: string }
> = {
  planned:  { bg: 'bg-amber-100',  text: 'text-amber-800',  border: 'border-amber-400',  darkBg: 'dark:bg-amber-900/40' },
  treated:  { bg: 'bg-green-100', text: 'text-green-800',  border: 'border-green-400',  darkBg: 'dark:bg-green-900/40' },
  issue:    { bg: 'bg-red-100',    text: 'text-red-800',    border: 'border-red-400',    darkBg: 'dark:bg-red-900/40'   },
  missing:  { bg: 'bg-gray-200',   text: 'text-gray-600',   border: 'border-gray-400',   darkBg: 'dark:bg-gray-700'      },
  crown:    { bg: 'bg-blue-100',   text: 'text-blue-800',   border: 'border-blue-400',   darkBg: 'dark:bg-blue-900/40'  },
  implant:  { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-400', darkBg: 'dark:bg-purple-900/40'},
};

// ── FDI layout (upper jaw left→right, lower jaw left→right) ───────────
// Upper: 18..11 | 21..28  (display right-to-left for upper right)
// Lower: 48..41 | 31..38
const UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11];
const UPPER_LEFT  = [21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41];
const LOWER_LEFT  = [31, 32, 33, 34, 35, 36, 37, 38];

// ── Tooth shape helper (molar/premolar/canine/incisor) ────────────────
function toothShape(fdi: number): 'molar' | 'premolar' | 'canine' | 'incisor' {
  const n = fdi % 10;
  if (n >= 6) return 'molar';
  if (n >= 4) return 'premolar';
  if (n === 3) return 'canine';
  return 'incisor';
}

const SHAPE_SIZE: Record<string, string> = {
  molar:    'w-9 h-10',
  premolar: 'w-8 h-9',
  canine:   'w-7 h-9',
  incisor:  'w-6 h-8',
};

// ── Single tooth button ───────────────────────────────────────────────
interface ToothProps {
  fdi: number;
  record?: ToothRecord;
  procedures?: TreatmentProcedure[];
  onClick: (fdi: number) => void;
}

const Tooth: React.FC<ToothProps> = ({ fdi, record, procedures = [], onClick }) => {
  const { t } = useTranslation(['patients']);
  const shape = toothShape(fdi);
  const sizeClass = SHAPE_SIZE[shape];
  const cfg = record ? STATUS_CONFIG[record.status] : null;

  return (
    <div className="flex flex-col items-center gap-0.5 relative">
      <button
        onClick={() => onClick(fdi)}
        title={record ? `${fdi}: ${t(`patients:dentalChart.status.${record.status}`)}${record.note ? ` - ${record.note}` : ''}` : t('patients:dentalChart.toothWithNumber', { number: fdi })}
        className={[
          'rounded-lg border-2 flex items-center justify-center text-[10px] font-bold transition-all hover:scale-110 hover:shadow-md',
          sizeClass,
          cfg
            ? `${cfg.bg} ${cfg.text} ${cfg.border} ${cfg.darkBg}`
            : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-500 dark:text-gray-400 hover:border-primary-400',
        ].join(' ')}
      >
        {record?.status === 'missing' ? '✕' : fdi % 10}
      </button>
      {/* Treatment procedure dots */}
      {procedures.length > 0 && (
        <div className="flex gap-0.5 flex-wrap justify-center max-w-[36px]">
          {procedures.slice(0, 3).map((p) => (
            <span
              key={p.id}
              title={`${p.procedureName} (${t(`patients:dentalChart.procedureStatus.${p.status}`, { defaultValue: p.status })})`}
              className={`w-1.5 h-1.5 rounded-full ${PROC_STATUS_CONFIG[p.status]?.dot ?? 'bg-gray-400'}`}
            />
          ))}
        </div>
      )}
      <span className="text-[9px] text-gray-400 dark:text-gray-500 leading-none">{fdi}</span>
    </div>
  );
};

// ── Jaw row ────────────────────────────────────────────────────────────
interface JawRowProps {
  left: number[];
  right: number[];
  records: Map<number, ToothRecord>;
  procedureMap: Map<number, TreatmentProcedure[]>;
  onTooth: (fdi: number) => void;
  label: string;
}

const JawRow: React.FC<JawRowProps> = ({ left, right, records, procedureMap, onTooth, label }) => (
  <div className="flex items-center gap-1">
    <span className="text-[10px] text-gray-400 w-12 text-right flex-shrink-0">{label}</span>
    <div className="flex items-end gap-0.5 justify-end">
      {left.map((fdi) => (
        <Tooth key={fdi} fdi={fdi} record={records.get(fdi)} procedures={procedureMap.get(fdi)} onClick={onTooth} />
      ))}
    </div>
    <div className="w-px h-8 bg-gray-200 dark:bg-gray-600 mx-1 flex-shrink-0" />
    <div className="flex items-end gap-0.5">
      {right.map((fdi) => (
        <Tooth key={fdi} fdi={fdi} record={records.get(fdi)} procedures={procedureMap.get(fdi)} onClick={onTooth} />
      ))}
    </div>
    <span className="text-[10px] text-gray-400 w-12 flex-shrink-0" />
  </div>
);

// ── Main component ─────────────────────────────────────────────────────
const DentalChart: React.FC<Props> = ({ patientId, readOnly = false, showTreatmentPlan = true }) => {
  const { t, i18n } = useTranslation(['patients', 'common']);
  const { user } = useAuth();
  const canEdit = !readOnly && ['admin', 'receptionist', 'doctor'].includes(user?.role || '');

  const [records, setRecords] = useState<Map<number, ToothRecord>>(new Map());
  const [procedures, setProcedures] = useState<TreatmentProcedure[]>([]);
  const [procedureMap, setProcedureMap] = useState<Map<number, TreatmentProcedure[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState<ToothStatus>('planned');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeProcTab, setActiveProcTab] = useState<'chart' | 'plan'>('chart');
  const popoverRef = useRef<HTMLDivElement>(null);

  // Load chart + treatment procedures
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [chartRes, procRes] = await Promise.allSettled([
          dentalChartService.getAll(patientId),
          showTreatmentPlan ? treatmentPlanProceduresService.getPatientProcedures(patientId) : Promise.resolve({ data: [] }),
        ]);

        if (chartRes.status === 'fulfilled') {
          const map = new Map<number, ToothRecord>();
          for (const r of chartRes.value.data) map.set(r.toothFdi, r);
          setRecords(map);
        }

        if (procRes.status === 'fulfilled') {
          const procs: TreatmentProcedure[] = procRes.value.data;
          setProcedures(procs);
          const pMap = new Map<number, TreatmentProcedure[]>();
          for (const p of procs) {
            if (p.toothFdi) {
              const arr = pMap.get(p.toothFdi) ?? [];
              arr.push(p);
              pMap.set(p.toothFdi, arr);
            }
          }
          setProcedureMap(pMap);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [patientId, showTreatmentPlan]);

  // Close popover on outside click
  useEffect(() => {
    if (!selected) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSelected(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selected]);

  const handleToothClick = (fdi: number) => {
    if (!canEdit) return;
    const existing = records.get(fdi);
    setEditStatus(existing?.status || 'planned');
    setEditNote(existing?.note || '');
    setSelected(fdi);
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await dentalChartService.upsert(patientId, selected, {
        status: editStatus,
        note: editNote,
      });
      setRecords((prev) => new Map(prev).set(selected, res.data));
      setSelected(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await dentalChartService.delete(patientId, selected);
      setRecords((prev) => {
        const next = new Map(prev);
        next.delete(selected);
        return next;
      });
      setSelected(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-primary-500" size={32} />
      </div>
    );
  }

  // Legend count
  const counts = Object.fromEntries(
    (Object.keys(STATUS_CONFIG) as ToothStatus[]).map((s) => [
      s,
      [...records.values()].filter((r) => r.status === s).length,
    ]),
  );

  // Procedures grouped by treatment case
  const procByCase = procedures.reduce<Record<string, { caseTitle: string; caseStage: string; items: TreatmentProcedure[] }>>(
    (acc, p) => {
      const caseId = p.treatmentCase?.id ?? 'unknown';
      if (!acc[caseId]) {
        acc[caseId] = { caseTitle: p.treatmentCase?.title ?? t('patients:dentalChart.treatmentCaseFallback'), caseStage: p.treatmentCase?.stage ?? '', items: [] };
      }
      acc[caseId].items.push(p);
      return acc;
    },
    {},
  );

  const activeProcedures = procedures.filter((p) => p.status !== 'cancelled');

  return (
    <div className="space-y-6">
      {/* Tab selector when treatment plan is enabled */}
      {showTreatmentPlan && (
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveProcTab('chart')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeProcTab === 'chart' ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            {t('patients:dentalChart.title')}
          </button>
          <button
            onClick={() => setActiveProcTab('plan')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${activeProcTab === 'plan' ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            <ClipboardList size={14} />
            {t('patients:dentalChart.treatmentPlan')}
            {activeProcedures.length > 0 && (
              <span className="bg-blue-600 text-white text-[10px] rounded-full px-1.5 py-0.5 leading-none">{activeProcedures.length}</span>
            )}
          </button>
        </div>
      )}
      {/* ── CHART TAB ── */}
      {(!showTreatmentPlan || activeProcTab === 'chart') && (
        <>
          {/* Legend */}
          <div className="flex flex-wrap gap-2">
            {(Object.entries(STATUS_CONFIG) as [ToothStatus, typeof STATUS_CONFIG[ToothStatus]][]).map(
              ([status, cfg]) => (
                <span
                  key={status}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.text} ${cfg.border} ${cfg.darkBg}`}
                >
                  {t(`patients:dentalChart.status.${status}`)}
                  {counts[status] > 0 && (
                    <span className="font-bold">({counts[status]})</span>
                  )}
                </span>
              ),
            )}
            {showTreatmentPlan && (
              <div className="flex items-center gap-2 ml-2 border-l border-gray-200 dark:border-gray-700 pl-2">
                {Object.entries(PROC_STATUS_CONFIG).map(([s, cfg]) => (
                  <span key={s} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    {t(`patients:dentalChart.procedureStatus.${s}`, { defaultValue: s })}
                  </span>
                ))}
              </div>
            )}
            {canEdit && (
              <span className="text-xs text-gray-400 dark:text-gray-500 self-center ml-2">
                {t('patients:dentalChart.clickHint')}
              </span>
            )}
          </div>

          {/* Chart */}
          <div className="overflow-x-auto">
            <div className="inline-block min-w-max space-y-1 px-2">
              <JawRow
                label={t('patients:dentalChart.upperRight')}
                left={UPPER_RIGHT}
                right={UPPER_LEFT}
                records={records}
                procedureMap={procedureMap}
                onTooth={handleToothClick}
              />
              <div className="flex items-center gap-1 my-1">
                <span className="w-12" />
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-600 border-dashed border-t border-gray-300 dark:border-gray-500" />
                <span className="w-12" />
              </div>
              <JawRow
                label={t('patients:dentalChart.lowerRight')}
                left={LOWER_RIGHT}
                right={LOWER_LEFT}
                records={records}
                procedureMap={procedureMap}
                onTooth={handleToothClick}
              />
            </div>
          </div>

          {/* Summary table */}
          {records.size > 0 && (
            <div className="card p-4">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('patients:dentalChart.recordedTeeth')}</h4>
              <div className="divide-y dark:divide-gray-700">
                {[...records.values()].map((r) => {
                  const cfg = STATUS_CONFIG[r.status];
                  const toothProcs = procedureMap.get(r.toothFdi) ?? [];
                  return (
                    <div
                      key={r.toothFdi}
                      className="flex items-center gap-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg px-2 -mx-2"
                      onClick={() => canEdit && handleToothClick(r.toothFdi)}
                    >
                      <span className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center text-xs font-bold flex-shrink-0 ${cfg.bg} ${cfg.text} ${cfg.border} ${cfg.darkBg}`}>
                        {r.toothFdi % 10}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('patients:dentalChart.toothWithNumber', { number: r.toothFdi })}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text} ${cfg.darkBg}`}>{t(`patients:dentalChart.status.${r.status}`)}</span>
                          {toothProcs.length > 0 && (
                            <span className="text-xs text-blue-600 flex items-center gap-0.5">
                              <ClipboardList size={11} /> {t('patients:dentalChart.procedureCount', { count: toothProcs.length })}
                            </span>
                          )}
                        </div>
                        {r.note && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{r.note}</p>}
                      </div>
                      {r.createdBy && (
                        <span className="text-xs text-gray-400 flex-shrink-0">
                          {r.createdBy.firstName} {r.createdBy.lastName}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TREATMENT PLAN TAB ── */}
      {showTreatmentPlan && activeProcTab === 'plan' && (
        <div className="space-y-4">
          {Object.keys(procByCase).length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <ClipboardList size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium text-gray-500">{t('patients:dentalChart.noProcedures')}</p>
              <p className="text-xs mt-2 text-gray-400 max-w-xs mx-auto">
                {t('patients:dentalChart.addProcedureHelp')}
              </p>
              <Link
                to="#"
                onClick={(e) => { e.preventDefault(); document.querySelector<HTMLButtonElement>('[data-tab="treatments"]')?.click(); }}
                className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 bg-primary-600 text-white text-xs font-semibold rounded-lg hover:bg-primary-700 transition-colors"
              >
                <ExternalLink size={13} />
                {t('patients:dentalChart.goToTreatments')}
              </Link>
            </div>
          ) : (
            Object.entries(procByCase).map(([caseId, group]) => (
              <div key={caseId} className="card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Link
                    to={`/treatment-cases/${caseId}`}
                    className="text-sm font-semibold text-gray-800 dark:text-gray-200 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  >
                    {group.caseTitle}
                  </Link>
                  <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full text-gray-500">{group.caseStage}</span>
                  <Link
                    to={`/treatment-cases/${caseId}`}
                    className="ml-auto flex items-center gap-1 text-xs text-primary-600 font-semibold hover:underline flex-shrink-0"
                    title={t('patients:dentalChart.addProcedureTitle')}
                  >
                    <Plus size={12} /> {t('patients:dentalChart.addProcedure')}
                  </Link>
                </div>
                <div className="space-y-2">
                  {group.items.map((p) => {
                    const cfg = PROC_STATUS_CONFIG[p.status] ?? PROC_STATUS_CONFIG.planned;
                    const Icon = cfg.icon;
                    return (
                      <div key={p.id} className={`flex items-start gap-3 p-2.5 rounded-lg ${cfg.bg}`}>
                        <Icon size={15} className={`${cfg.text} mt-0.5 flex-shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{p.procedureName}</span>
                            {p.toothFdi && (
                              <span className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 rounded font-mono">
                                {t('patients:dentalChart.toothWithNumber', { number: p.toothFdi })}
                              </span>
                            )}
                            <span className={`text-xs font-medium ${cfg.text}`}>{t(`patients:dentalChart.procedureStatus.${p.status}`, { defaultValue: p.status })}</span>
                          </div>
                          {p.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{p.notes}</p>}
                          {p.estimatedCost && (
                            <p className="text-xs text-gray-400 mt-0.5">{t('patients:dentalChart.estimated')}: {p.estimatedCost.toLocaleString(i18n.language)} ₺</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tooth edit popover */}
      {selected !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
          <div ref={popoverRef} className="card p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">
                {t('patients:dentalChart.toothWithNumber', { number: selected })}
                <span className="ml-2 text-sm font-normal text-gray-500">
                  {t(`patients:dentalChart.toothShape.${toothShape(selected)}`)}
                </span>
              </h3>
              <button onClick={() => setSelected(null)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <div className="mb-4">
              <label className="label">{t('patients:dentalChart.statusLabel')}</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.entries(STATUS_CONFIG) as [ToothStatus, typeof STATUS_CONFIG[ToothStatus]][]).map(([status, cfg]) => (
                  <button
                    key={status}
                    onClick={() => setEditStatus(status)}
                    className={[
                      'px-2 py-1.5 rounded-lg border-2 text-xs font-medium transition-all',
                      editStatus === status
                        ? `${cfg.bg} ${cfg.text} ${cfg.border} ${cfg.darkBg} ring-2 ring-offset-1 ring-current`
                        : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-300',
                    ].join(' ')}
                  >
                    {t(`patients:dentalChart.status.${status}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-5">
              <label className="label">{t('patients:dentalChart.noteOptional')}</label>
              <textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder={t('patients:dentalChart.notePlaceholder')}
                className="input-field resize-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {t('common:save')}
              </button>
              {records.has(selected) && (
                <button onClick={handleDelete} disabled={saving} className="btn-danger" title={t('patients:dentalChart.deleteRecord')}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DentalChart;
