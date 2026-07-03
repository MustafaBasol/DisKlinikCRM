import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlaskConical,
  RefreshCw,
  Plus,
  X,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Paperclip,
  Trash2,
  History,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { labOrderService, laboratoryService, patientService, userService } from '../services/api';
import { canViewLabOrders, canManageLabOrders } from '../utils/permissions';
import {
  LAB_WORK_TYPES,
  ALLOWED_STATUS_TRANSITIONS,
  LAB_ORDER_STATUS_BADGE,
  type LabWorkOrderStatus,
} from '../constants/labOrderStatuses';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LabOrderRow {
  id: string;
  status: LabWorkOrderStatus;
  workType: string;
  toothFdi: string | null;
  shade: string | null;
  material: string | null;
  notesForLab: string | null;
  revisionCount: number;
  expectedReturnDate: string | null;
  labCost: number | null;
  currency: string | null;
  isOverdue: boolean;
  patient: { id: string; firstName: string; lastName: string };
  laboratory: { id: string; name: string };
  practitioner: { id: string; firstName: string; lastName: string } | null;
}

interface DashboardSummary {
  pending: number;
  received: number;
  fittingPending: number;
  revisionRequested: number;
  overdue: number;
  completed: number;
  cancelled: number;
  total: number;
}

interface Laboratory {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
}

interface SimplePerson {
  id: string;
  firstName: string;
  lastName: string;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, revisionCount }: { status: LabWorkOrderStatus; revisionCount: number }) {
  const { t } = useTranslation(['labOrders']);
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${LAB_ORDER_STATUS_BADGE[status]}`}>
        {t(`labOrders:statuses.${status}`)}
      </span>
      {revisionCount > 0 && (
        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300 whitespace-nowrap">
          {t('labOrders:history.revisionBadge', { count: revisionCount })}
        </span>
      )}
    </span>
  );
}

function OverduePill() {
  const { t } = useTranslation(['labOrders']);
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
      <AlertTriangle className="w-3 h-3" /> {t('labOrders:filters.overdueOnly')}
    </span>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryTile({
  label, value, active, onClick, accent,
}: { label: string; value: number; active: boolean; onClick: () => void; accent?: 'red' }) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white dark:bg-gray-800 rounded-xl border p-4 transition-colors ${
        active
          ? accent === 'red' ? 'border-red-400 ring-1 ring-red-300' : 'border-primary-400 ring-1 ring-primary-300'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      <div className={`text-2xl font-bold ${accent === 'red' ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</div>
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type FilterBucket = 'all' | 'overdue' | 'received' | 'fittingPending' | 'revisionRequested' | 'completed';

export default function LabOrders() {
  const { user } = useAuth();
  const { selectedClinicId } = useClinic();
  const { t } = useTranslation(['labOrders', 'common']);
  const { formatCurrency, formatDate } = useClinicPreferences();

  const canManage = canManageLabOrders(user);

  const [orders, setOrders] = useState<LabOrderRow[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [laboratories, setLaboratories] = useState<Laboratory[]>([]);
  const [patients, setPatients] = useState<SimplePerson[]>([]);
  const [practitioners, setPractitioners] = useState<SimplePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState<FilterBucket>('all');
  const [laboratoryFilter, setLaboratoryFilter] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<LabOrderRow | null>(null);
  const [detailOrder, setDetailOrder] = useState<any | null>(null);
  const [labsModalOpen, setLabsModalOpen] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const clinicParams = selectedClinicId && selectedClinicId !== 'all' ? { clinicId: selectedClinicId } : {};
      const [ordersRes, summaryRes, labsRes] = await Promise.all([
        labOrderService.getAll(clinicParams),
        labOrderService.getDashboard(clinicParams),
        laboratoryService.getAll({ isActive: true, ...clinicParams }),
      ]);
      setOrders(ordersRes.data);
      setSummary(summaryRes.data);
      setLaboratories(labsRes.data);
    } catch {
      showToast(t('labOrders:errors.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedClinicId, t]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!canManage) return;
    (async () => {
      try {
        const [patientsRes, usersRes] = await Promise.all([
          patientService.getAll({ limit: 200 }),
          userService.getAll(),
        ]);
        const patientList = Array.isArray(patientsRes.data) ? patientsRes.data : (patientsRes.data?.patients ?? []);
        setPatients(patientList);
        const userList = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data?.users ?? []);
        setPractitioners(userList);
      } catch {
        // dropdown data is best-effort; form still usable if empty
      }
    })();
  }, [canManage]);

  const filteredOrders = useMemo(() => {
    let list = orders;
    if (laboratoryFilter) list = list.filter(o => o.laboratory.id === laboratoryFilter);
    switch (bucket) {
      case 'overdue': return list.filter(o => o.isOverdue);
      case 'received': return list.filter(o => o.status === 'received_from_lab');
      case 'fittingPending': return list.filter(o => o.status === 'fitting_or_trial');
      case 'revisionRequested': return list.filter(o => o.status === 'revision_requested');
      case 'completed': return list.filter(o => o.status === 'completed');
      default: return list;
    }
  }, [orders, bucket, laboratoryFilter]);

  const openCreate = () => { setEditingOrder(null); setFormOpen(true); };
  const openEdit = (order: LabOrderRow) => { setEditingOrder(order); setFormOpen(true); };

  const openDetail = async (id: string) => {
    try {
      const { data } = await labOrderService.getById(id);
      setDetailOrder(data);
    } catch {
      showToast(t('labOrders:errors.loadFailed'), 'error');
    }
  };

  const handleStatusChange = async (id: string, status: LabWorkOrderStatus) => {
    try {
      await labOrderService.updateStatus(id, { status });
      showToast(t('labOrders:success.statusUpdated'));
      fetchAll();
      if (detailOrder?.id === id) openDetail(id);
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? t('labOrders:errors.actionFailed'), 'error');
    }
  };

  if (!canViewLabOrders(user)) return null;

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium flex items-center gap-2 ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/50 dark:text-green-200 dark:border-green-700'
              : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/50 dark:text-red-200 dark:border-red-700'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FlaskConical className="w-6 h-6 text-primary-500" />
            {t('labOrders:title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('labOrders:subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              onClick={() => setLabsModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Building2 className="w-4 h-4" /> {t('labOrders:laboratory.manageButton')}
            </button>
          )}
          <button
            onClick={fetchAll}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {t('common:refresh')}
          </button>
          {canManage && (
            <button
              onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> {t('labOrders:actions.newOrder')}
            </button>
          )}
        </div>
      </div>

      {/* Dashboard summary tiles */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryTile label={t('labOrders:dashboard.pendingCount')} value={summary.pending} active={bucket === 'all'} onClick={() => setBucket('all')} />
          <SummaryTile label={t('labOrders:dashboard.receivedCount')} value={summary.received} active={bucket === 'received'} onClick={() => setBucket('received')} />
          <SummaryTile label={t('labOrders:dashboard.fittingPendingCount')} value={summary.fittingPending} active={bucket === 'fittingPending'} onClick={() => setBucket('fittingPending')} />
          <SummaryTile label={t('labOrders:dashboard.revisionRequestedCount')} value={summary.revisionRequested} active={bucket === 'revisionRequested'} onClick={() => setBucket('revisionRequested')} />
          <SummaryTile label={t('labOrders:dashboard.overdueCount')} value={summary.overdue} active={bucket === 'overdue'} onClick={() => setBucket('overdue')} accent="red" />
          <SummaryTile label={t('labOrders:dashboard.completedCount')} value={summary.completed} active={bucket === 'completed'} onClick={() => setBucket('completed')} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={bucket}
          onChange={e => setBucket(e.target.value as FilterBucket)}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          <option value="all">{t('labOrders:filters.all')}</option>
          <option value="overdue">{t('labOrders:filters.overdueOnly')}</option>
          <option value="received">{t('labOrders:statuses.received_from_lab')}</option>
          <option value="fittingPending">{t('labOrders:statuses.fitting_or_trial')}</option>
          <option value="revisionRequested">{t('labOrders:statuses.revision_requested')}</option>
          <option value="completed">{t('labOrders:statuses.completed')}</option>
        </select>

        <select
          value={laboratoryFilter}
          onChange={e => setLaboratoryFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          <option value="">{t('labOrders:filters.byLaboratory')}</option>
          {laboratories.map(lab => (
            <option key={lab.id} value={lab.id}>{lab.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
            {t('common:loading')}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center">
            <FlaskConical className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">{t('labOrders:empty.noOrders')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  {[
                    t('labOrders:table.patient'),
                    t('labOrders:table.laboratory'),
                    t('labOrders:table.workType'),
                    t('labOrders:table.status'),
                    t('labOrders:table.expectedReturnDate'),
                    t('labOrders:table.cost'),
                    t('common:actions'),
                  ].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {filteredOrders.map(order => (
                  <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <button onClick={() => openDetail(order.id)} className="font-medium text-primary-600 hover:underline text-left">
                        {order.patient.firstName} {order.patient.lastName}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{order.laboratory.name}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{t(`labOrders:workTypes.${order.workType}`)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={order.status} revisionCount={order.revisionCount} />
                        {order.isOverdue && <OverduePill />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {order.expectedReturnDate ? formatDate(order.expectedReturnDate) : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {order.labCost != null ? formatCurrency(order.labCost, order.currency ?? undefined) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {canManage && ALLOWED_STATUS_TRANSITIONS[order.status].length > 0 && (
                          <select
                            defaultValue=""
                            onChange={e => {
                              if (e.target.value) handleStatusChange(order.id, e.target.value as LabWorkOrderStatus);
                              e.target.value = '';
                            }}
                            className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                          >
                            <option value="" disabled>{t('labOrders:actions.changeStatus')}</option>
                            {ALLOWED_STATUS_TRANSITIONS[order.status].map(next => (
                              <option key={next} value={next}>{t(`labOrders:statuses.${next}`)}</option>
                            ))}
                          </select>
                        )}
                        {canManage && (
                          <button
                            onClick={() => openEdit(order)}
                            className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            {t('common:edit')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen && (
        <LabOrderFormModal
          order={editingOrder}
          laboratories={laboratories}
          patients={patients}
          practitioners={practitioners}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); fetchAll(); }}
          showToast={showToast}
        />
      )}

      {detailOrder && (
        <LabOrderDetailModal
          order={detailOrder}
          canManage={canManage}
          onClose={() => setDetailOrder(null)}
          onStatusChange={handleStatusChange}
          onChanged={() => openDetail(detailOrder.id)}
          showToast={showToast}
        />
      )}

      {labsModalOpen && (
        <LaboratoriesModal
          laboratories={laboratories}
          onClose={() => setLabsModalOpen(false)}
          onChanged={fetchAll}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ─── Create/Edit Modal ─────────────────────────────────────────────────────────

function LabOrderFormModal({
  order, laboratories, patients, practitioners, onClose, onSaved, showToast,
}: {
  order: LabOrderRow | null;
  laboratories: Laboratory[];
  patients: SimplePerson[];
  practitioners: SimplePerson[];
  onClose: () => void;
  onSaved: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const { t } = useTranslation(['labOrders', 'common']);
  const isEdit = !!order;

  const [patientId, setPatientId] = useState(order?.patient.id ?? '');
  const [laboratoryId, setLaboratoryId] = useState(order?.laboratory.id ?? '');
  const [practitionerId, setPractitionerId] = useState(order?.practitioner?.id ?? '');
  const [workType, setWorkType] = useState(order?.workType ?? LAB_WORK_TYPES[0]);
  const [toothFdi, setToothFdi] = useState(order?.toothFdi ?? '');
  const [shade, setShade] = useState(order?.shade ?? '');
  const [material, setMaterial] = useState(order?.material ?? '');
  const [expectedReturnDate, setExpectedReturnDate] = useState(order?.expectedReturnDate?.slice(0, 10) ?? '');
  const [labCost, setLabCost] = useState(order?.labCost != null ? String(order.labCost) : '');
  const [currency, setCurrency] = useState(order?.currency ?? '');
  const [notesForLab, setNotesForLab] = useState(order?.notesForLab ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: any = {
        patientId, laboratoryId, workType,
        practitionerId: practitionerId || null,
        toothFdi: toothFdi || null,
        shade: shade || null,
        material: material || null,
        notesForLab: notesForLab || null,
        expectedReturnDate: expectedReturnDate || null,
        labCost: labCost ? Number(labCost) : null,
        currency: currency || null,
      };
      if (isEdit) {
        await labOrderService.update(order!.id, payload);
        showToast(t('labOrders:success.updated'));
      } else {
        await labOrderService.create(payload);
        showToast(t('labOrders:success.created'));
      }
      onSaved();
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? t('labOrders:errors.actionFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            {isEdit ? t('labOrders:actions.editOrder') : t('labOrders:actions.newOrder')}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('labOrders:form.patient')}</label>
              <select
                required
                value={patientId}
                onChange={e => setPatientId(e.target.value)}
                disabled={isEdit}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 disabled:opacity-60"
              >
                <option value="">—</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('labOrders:form.laboratory')}</label>
              <select
                required
                value={laboratoryId}
                onChange={e => setLaboratoryId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
              >
                <option value="">—</option>
                {laboratories.map(lab => (
                  <option key={lab.id} value={lab.id}>{lab.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('labOrders:form.workType')}</label>
              <select
                value={workType}
                onChange={e => setWorkType(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
              >
                {LAB_WORK_TYPES.map(wt => (
                  <option key={wt} value={wt}>{t(`labOrders:workTypes.${wt}`)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('labOrders:form.practitioner')}</label>
              <select
                value={practitionerId}
                onChange={e => setPractitionerId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
              >
                <option value="">—</option>
                {practitioners.map(pr => (
                  <option key={pr.id} value={pr.id}>{pr.firstName} {pr.lastName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('labOrders:form.toothFdi')}</label>
              <input
                value={toothFdi}
                onChange={e => setToothFdi(e.target.value)}
                placeholder="14, 15"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('labOrders:form.shade')}</label>
              <input
                value={shade}
                onChange={e => setShade(e.target.value)}
                placeholder="A2"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('labOrders:form.material')}</label>
              <input
                value={material}
                onChange={e => setMaterial(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('labOrders:form.expectedReturnDate')}</label>
              <input
                type="date"
                value={expectedReturnDate}
                onChange={e => setExpectedReturnDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('labOrders:form.labCost')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={labCost}
                onChange={e => setLabCost(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('labOrders:form.currency')}</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
              >
                <option value="">—</option>
                {['USD', 'EUR', 'TRY', 'GBP', 'CAD', 'CHF'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('labOrders:form.notesForLab')}</label>
              <textarea
                value={notesForLab}
                onChange={e => setNotesForLab(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? t('common:saving') : t('common:save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Detail Modal (history + attachments) ──────────────────────────────────────

function LabOrderDetailModal({
  order, canManage, onClose, onStatusChange, onChanged, showToast,
}: {
  order: any;
  canManage: boolean;
  onClose: () => void;
  onStatusChange: (id: string, status: LabWorkOrderStatus) => void;
  onChanged: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const { t } = useTranslation(['labOrders', 'common']);
  const { formatDate, formatCurrency } = useClinicPreferences();
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await labOrderService.uploadAttachment(order.id, fd);
      showToast(t('labOrders:success.attachmentUploaded'));
      onChanged();
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? t('labOrders:errors.actionFailed'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAttachment = async (attId: string) => {
    try {
      await labOrderService.deleteAttachment(order.id, attId);
      onChanged();
    } catch {
      showToast(t('labOrders:errors.actionFailed'), 'error');
    }
  };

  const nextStatuses: LabWorkOrderStatus[] = ALLOWED_STATUS_TRANSITIONS[order.status as LabWorkOrderStatus] ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">
              {order.patient.firstName} {order.patient.lastName}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{order.laboratory.name} — {t(`labOrders:workTypes.${order.workType}`)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={order.status} revisionCount={order.revisionCount} />
            {order.isOverdue && <OverduePill />}
          </div>

          {canManage && nextStatuses.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {nextStatuses.map(next => (
                <button
                  key={next}
                  onClick={() => onStatusChange(order.id, next)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  {t(`labOrders:statuses.${next}`)}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-400">{t('labOrders:table.expectedReturnDate')}: </span>{order.expectedReturnDate ? formatDate(order.expectedReturnDate) : '-'}</div>
            <div><span className="text-gray-400">{t('labOrders:table.cost')}: </span>{order.labCost != null ? formatCurrency(order.labCost, order.currency ?? undefined) : '-'}</div>
            {order.toothFdi && <div><span className="text-gray-400">{t('labOrders:form.toothFdi')}: </span>{order.toothFdi}</div>}
            {order.practitioner && <div><span className="text-gray-400">{t('labOrders:form.practitioner')}: </span>{order.practitioner.firstName} {order.practitioner.lastName}</div>}
          </div>

          {/* Attachments */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5 mb-2">
              <Paperclip className="w-4 h-4" /> {t('labOrders:attachments.title')}
            </h3>
            <div className="space-y-1.5">
              {(order.attachments ?? []).map((att: any) => (
                <div key={att.id} className="flex items-center justify-between text-sm px-2 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-700/40">
                  <span className="truncate text-gray-700 dark:text-gray-300">{att.originalName}</span>
                  {canManage && (
                    <button onClick={() => handleDeleteAttachment(att.id)} className="text-gray-400 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {(order.attachments ?? []).length === 0 && (
                <p className="text-xs text-gray-400">{t('labOrders:attachments.empty')}</p>
              )}
            </div>
            {canManage && (
              <label className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
                {uploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                {t('labOrders:attachments.upload')}
                <input
                  type="file"
                  className="hidden"
                  disabled={uploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
                />
              </label>
            )}
          </div>

          {/* Status history */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5 mb-2">
              <History className="w-4 h-4" /> {t('labOrders:history.title')}
            </h3>
            <div className="space-y-2">
              {(order.statusHistory ?? []).map((h: any) => (
                <div key={h.id} className="text-xs text-gray-600 dark:text-gray-400 flex items-center justify-between">
                  <span>{h.fromStatus ? `${t(`labOrders:statuses.${h.fromStatus}`)} → ` : ''}{t(`labOrders:statuses.${h.toStatus}`)}</span>
                  <span className="text-gray-400">{formatDate(h.createdAt)}</span>
                </div>
              ))}
              {(order.statusHistory ?? []).length === 0 && (
                <p className="text-xs text-gray-400">{t('labOrders:history.empty')}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Manage Laboratories Modal ─────────────────────────────────────────────────

function LaboratoriesModal({
  laboratories, onClose, onChanged, showToast,
}: {
  laboratories: Laboratory[];
  onClose: () => void;
  onChanged: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const { t } = useTranslation(['labOrders', 'common']);
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await laboratoryService.create({ name, contactPerson: contactPerson || null, phone: phone || null, email: email || null });
      setName(''); setContactPerson(''); setPhone(''); setEmail('');
      showToast(t('labOrders:success.laboratoryCreated'));
      onChanged();
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? t('labOrders:errors.actionFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    try {
      await laboratoryService.delete(id);
      onChanged();
    } catch {
      showToast(t('labOrders:errors.actionFailed'), 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">{t('labOrders:laboratory.title')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            {laboratories.map(lab => (
              <div key={lab.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/40">
                <div>
                  <div className="font-medium text-gray-800 dark:text-gray-200">{lab.name}</div>
                  {(lab.contactPerson || lab.phone) && (
                    <div className="text-xs text-gray-400">{[lab.contactPerson, lab.phone].filter(Boolean).join(' · ')}</div>
                  )}
                </div>
                <button onClick={() => handleDeactivate(lab.id)} className="text-gray-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {laboratories.length === 0 && <p className="text-xs text-gray-400">{t('labOrders:laboratory.empty')}</p>}
          </div>

          <form onSubmit={handleAdd} className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
            <input
              placeholder={t('labOrders:laboratory.name') as string}
              value={name}
              onChange={e => setName(e.target.value)}
              className="col-span-2 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
            />
            <input
              placeholder={t('labOrders:laboratory.contactPerson') as string}
              value={contactPerson}
              onChange={e => setContactPerson(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
            />
            <input
              placeholder={t('labOrders:laboratory.phone') as string}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
            />
            <input
              placeholder={t('labOrders:laboratory.email') as string}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="col-span-2 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
            />
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="col-span-2 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {t('labOrders:laboratory.add')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
