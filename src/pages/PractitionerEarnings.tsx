import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, Users, CheckCircle, Clock, XCircle, Plus,
  ChevronDown, ChevronUp, AlertCircle, Loader2, Settings,
  Pencil, Trash2, CreditCard,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import {
  compensationRuleService,
  practitionerEarningService,
  practitionerPayoutService,
  userService,
  serviceService,
} from '../services/api';

type Tab = 'summary' | 'earnings' | 'payouts' | 'settings';

const STATUS_KEYS = ['pending', 'approved', 'paid', 'cancelled'] as const;
const COMP_TYPE_KEYS = ['fixed', 'percentage', 'fixed_plus_percentage', 'per_service'] as const;
const CALC_BASE_KEYS = ['collected', 'billed'] as const;
const METHOD_KEYS = ['cash', 'bank_transfer', 'card', 'other'] as const;

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  paid: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
};

function currentPeriod() {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const SummaryTab: React.FC<{ periodMonth: number; periodYear: number; practitioners: any[] }> = ({
  periodMonth, periodYear, practitioners,
}) => {
  const { t } = useTranslation(['earnings', 'common']);
  const { formatCurrency } = useClinicPreferences();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterPractitioner, setFilterPractitioner] = useState('');
  const formatAmount = (n: number) => formatCurrency(n);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { periodMonth, periodYear };
      if (filterPractitioner) params.practitionerId = filterPractitioner;
      const res = await practitionerEarningService.getSummary(params);
      setData(res.data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [periodMonth, periodYear, filterPractitioner]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <select
          value={filterPractitioner}
          onChange={e => setFilterPractitioner(e.target.value)}
          className="input-field w-52"
        >
          <option value="">{t('earnings:filters.allDoctors')}</option>
          {practitioners.map(p => (
            <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
          ))}
        </select>
        <button onClick={load} className="btn-secondary text-sm">{t('common:refresh')}</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
      ) : data.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">{t('earnings:summaryTab.empty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th className="text-left py-3 pl-4 pr-4">{t('earnings:columns.doctor')}</th>
                <th className="text-right py-3 pr-4">{t('earnings:columns.grossAmount')}</th>
                <th className="text-right py-3 pr-4">{t('earnings:columns.collection')}</th>
                <th className="text-right py-3 pr-4">{t('earnings:columns.calculatedEarning')}</th>
                <th className="text-right py-3 pr-4">{t('earnings:summary.approved')}</th>
                <th className="text-right py-3 pr-4">{t('earnings:summary.paid')}</th>
                <th className="text-right py-3 pr-4">{t('earnings:columns.remaining')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map(row => {
                const remaining = row.totalEarning - row.paidEarning;
                return (
                  <tr key={row.practitionerId} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-3 pl-4 pr-4 font-medium text-gray-900 dark:text-white">{row.practitionerName}</td>
                    <td className="py-3 pr-4 text-right text-gray-700 dark:text-gray-300">{formatAmount(row.totalGross)}</td>
                    <td className="py-3 pr-4 text-right text-gray-700 dark:text-gray-300">{formatAmount(row.totalCollected)}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-gray-900 dark:text-white">{formatAmount(row.totalEarning)}</td>
                    <td className="py-3 pr-4 text-right text-blue-600 dark:text-blue-400">{formatAmount(row.approvedEarning)}</td>
                    <td className="py-3 pr-4 text-right text-green-600 dark:text-green-400">{formatAmount(row.paidEarning)}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-orange-600 dark:text-orange-400">{formatAmount(remaining > 0 ? remaining : 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const EarningsTab: React.FC<{ practitioners: any[] }> = ({ practitioners }) => {
  const { t } = useTranslation(['earnings', 'common']);
  const { formatCurrency } = useClinicPreferences();
  const [earnings, setEarnings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterPractitioner, setFilterPractitioner] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMonth, setFilterMonth] = useState(currentPeriod().month);
  const [filterYear, setFilterYear] = useState(currentPeriod().year);
  const [adjustTarget, setAdjustTarget] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const formatAmount = (n: number) => formatCurrency(n);
  const statusLabel = (status: string) => t(`earnings:status.${status}`, { defaultValue: status });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params: any = { limit: 100, periodMonth: filterMonth, periodYear: filterYear };
      if (filterPractitioner) params.practitionerId = filterPractitioner;
      if (filterStatus) params.status = filterStatus;
      const res = await practitionerEarningService.getAll(params);
      setEarnings(res.data.earnings || res.data);
    } catch {
      setError(t('earnings:errors.earningsListLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [filterPractitioner, filterStatus, filterMonth, filterYear, t]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (action: () => Promise<any>) => {
    try { await action(); load(); } catch { setError(t('earnings:errors.actionFailed')); }
  };

  const doAdjust = async () => {
    if (!adjustTarget) return;
    await doAction(() => practitionerEarningService.adjust(adjustTarget.id, {
      adminAdjustmentAmount: parseFloat(adjustAmount),
      adminAdjustmentReason: adjustReason,
    }));
    setAdjustTarget(null); setAdjustAmount(''); setAdjustReason('');
  };

  const effectiveAmount = (e: any) => e.adminAdjustmentAmount ?? e.earningAmount;

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = [2024, 2025, 2026, 2027];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))} className="input-field w-32">
          {months.map(m => <option key={m} value={m}>{t('earnings:period.monthOption', { month: m })}</option>)}
        </select>
        <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))} className="input-field w-24">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filterPractitioner} onChange={e => setFilterPractitioner(e.target.value)} className="input-field w-48">
          <option value="">{t('earnings:filters.allDoctors')}</option>
          {practitioners.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input-field w-36">
          <option value="">{t('earnings:filters.allStatuses')}</option>
          {STATUS_KEYS.map(k => <option key={k} value={k}>{statusLabel(k)}</option>)}
        </select>
        <button onClick={load} className="btn-secondary text-sm">{t('common:refresh')}</button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
      ) : earnings.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">{t('earnings:management.empty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th className="text-left py-3 pl-4 pr-3">{t('earnings:columns.doctor')}</th>
                <th className="text-left py-3 pr-3">{t('earnings:columns.patient')}</th>
                <th className="text-left py-3 pr-3">{t('earnings:columns.service')}</th>
                <th className="text-right py-3 pr-3">{t('earnings:columns.collection')}</th>
                <th className="text-right py-3 pr-3">{t('earnings:columns.earning')}</th>
                <th className="text-right py-3 pr-3">{t('earnings:columns.adjustedEarning')}</th>
                <th className="text-center py-3 pr-3">{t('earnings:columns.status')}</th>
                <th className="text-center py-3 pr-4">{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map(e => (
                <tr key={e.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="py-3 pl-4 pr-3 font-medium text-gray-900 dark:text-white">
                    {e.practitioner?.firstName} {e.practitioner?.lastName}
                  </td>
                  <td className="py-3 pr-3 text-gray-600 dark:text-gray-400">
                    {e.patient ? `${e.patient.firstName} ${e.patient.lastName}` : '—'}
                  </td>
                  <td className="py-3 pr-3 text-gray-600 dark:text-gray-400">
                    {e.service?.name ?? (e.treatmentCase?.title ?? '—')}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <div className="flex flex-col items-end">
                      <span>{formatAmount(e.collectedAmount)}</span>
                      {e.grossAmount > 0 && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 ${
                          e.collectedAmount >= e.grossAmount ? 'bg-green-100 text-green-700' :
                          e.collectedAmount > 0 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-600'
                        }`}>
                          {t('earnings:management.collectionRate', { rate: Math.round((e.collectedAmount / e.grossAmount) * 100) })}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-right">{formatAmount(e.earningAmount)}</td>
                  <td className="py-3 pr-3 text-right font-semibold text-gray-900 dark:text-white">
                    {e.adminAdjustmentAmount != null ? formatAmount(e.adminAdjustmentAmount) : '—'}
                  </td>
                  <td className="py-3 pr-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[e.status] || STATUS_STYLES.pending}`}>
                      {statusLabel(e.status)}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {e.status === 'pending' && (
                        <button
                          onClick={() => doAction(() => practitionerEarningService.approve(e.id))}
                          className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-200"
                          title={t('earnings:actions.approve')}
                        >{t('earnings:actions.approve')}</button>
                      )}
                      {(e.status === 'pending' || e.status === 'approved') && (
                        <button
                          onClick={() => { setAdjustTarget(e); setAdjustAmount(String(effectiveAmount(e))); setAdjustReason(''); }}
                          className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 hover:bg-yellow-200"
                          title={t('common:edit')}
                        ><Pencil size={12} /></button>
                      )}
                      {e.status === 'approved' && (
                        <button
                          onClick={() => doAction(() => practitionerEarningService.markPaid(e.id))}
                          className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-200"
                          title={t('earnings:actions.markPaid')}
                        >{t('earnings:actions.paid')}</button>
                      )}
                      {e.status !== 'paid' && e.status !== 'cancelled' && (
                        <button
                          onClick={() => { if (window.confirm(t('earnings:confirm.cancelEarning'))) doAction(() => practitionerEarningService.cancel(e.id)); }}
                          className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-200"
                          title={t('common:cancel')}
                        ><XCircle size={12} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Adjust Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('earnings:management.adjustTitle')}</h3>
            <div className="space-y-4">
              <div>
                <label className="label">{t('earnings:management.adjustedAmount')}</label>
                <input
                  type="number" min="0" step="0.01"
                  value={adjustAmount}
                  onChange={e => setAdjustAmount(e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="label">{t('earnings:management.adjustmentReason')} <span className="text-red-500">*</span></label>
                <textarea
                  value={adjustReason}
                  onChange={e => setAdjustReason(e.target.value)}
                  rows={3}
                  className="input-field"
                  placeholder={t('earnings:management.adjustmentPlaceholder')}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button onClick={() => setAdjustTarget(null)} className="btn-secondary">{t('common:cancel')}</button>
              <button
                onClick={doAdjust}
                disabled={!adjustAmount || !adjustReason}
                className="btn-primary disabled:opacity-50"
              >{t('common:save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PayoutsTab: React.FC<{ practitioners: any[] }> = ({ practitioners }) => {
  const { t } = useTranslation(['earnings', 'common', 'payments']);
  const { formatCurrency, formatDate } = useClinicPreferences();
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [approvedEarnings, setApprovedEarnings] = useState<any[]>([]);
  const [selectedEarnings, setSelectedEarnings] = useState<string[]>([]);
  const [form, setForm] = useState({
    practitionerId: '', amount: '', paymentDate: new Date().toISOString().split('T')[0],
    periodMonth: String(currentPeriod().month), periodYear: String(currentPeriod().year),
    method: 'bank_transfer', note: '',
  });
  const [formError, setFormError] = useState('');
  const formatAmount = (n: number) => formatCurrency(n);
  const methodLabel = (method: string) => t(`payments:methods.${method}`, { defaultValue: method });

  const load = async () => {
    setLoading(true);
    try {
      const res = await practitionerPayoutService.getAll();
      setPayouts(res.data);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const loadApprovedEarnings = async (practitionerId: string, month: number, year: number) => {
    if (!practitionerId) { setApprovedEarnings([]); return; }
    try {
      const res = await practitionerEarningService.getAll({
        practitionerId, status: 'approved', periodMonth: month, periodYear: year, limit: 200,
      });
      setApprovedEarnings(res.data.earnings || res.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const handlePractitionerChange = (pid: string) => {
    setForm(f => ({ ...f, practitionerId: pid }));
    setSelectedEarnings([]);
    loadApprovedEarnings(pid, Number(form.periodMonth), Number(form.periodYear));
  };

  const toggleEarning = (id: string) => {
    setSelectedEarnings(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const handleSubmit = async () => {
    setFormError('');
    if (!form.practitionerId || !form.amount || !form.paymentDate) {
      setFormError(t('earnings:errors.requiredFields'));
      return;
    }
    try {
      await practitionerPayoutService.create({
        practitionerId: form.practitionerId,
        amount: parseFloat(form.amount),
        paymentDate: form.paymentDate,
        periodMonth: Number(form.periodMonth),
        periodYear: Number(form.periodYear),
        method: form.method,
        note: form.note || null,
        earningIds: selectedEarnings,
      });
      setShowForm(false);
      setSelectedEarnings([]);
      setApprovedEarnings([]);
      load();
    } catch {
      setFormError(t('earnings:errors.payoutSaveFailed'));
    }
  };

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = [2024, 2025, 2026, 2027];
  const effectiveAmount = (e: any) => e.adminAdjustmentAmount ?? e.earningAmount;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} />{t('earnings:payouts.recordPayment')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-500" size={32} /></div>
      ) : payouts.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">{t('earnings:payouts.empty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th className="text-left py-3 pl-4 pr-4">{t('earnings:columns.doctor')}</th>
                <th className="text-left py-3 pr-4">{t('earnings:payouts.period')}</th>
                <th className="text-left py-3 pr-4">{t('earnings:payouts.paymentDate')}</th>
                <th className="text-right py-3 pr-4">{t('earnings:payouts.amount')}</th>
                <th className="text-left py-3 pr-4">{t('earnings:payouts.method')}</th>
                <th className="text-left py-3 pr-4">{t('earnings:payouts.note')}</th>
                <th className="text-left py-3 pr-4">{t('earnings:payouts.recordedBy')}</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map(p => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="py-3 pl-4 pr-4 font-medium text-gray-900 dark:text-white">
                    {p.practitioner?.firstName} {p.practitioner?.lastName}
                  </td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{p.periodMonth}/{p.periodYear}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">
                    {formatDate(p.paymentDate)}
                  </td>
                  <td className="py-3 pr-4 text-right font-semibold text-green-600 dark:text-green-400">{formatAmount(p.amount)}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{methodLabel(p.method)}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400 max-w-xs truncate">{p.note || '—'}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">
                    {p.createdBy?.firstName} {p.createdBy?.lastName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Payout Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-lg my-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('earnings:payouts.recordPayment')}</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('earnings:columns.doctor')} <span className="text-red-500">*</span></label>
                  <select value={form.practitionerId} onChange={e => handlePractitionerChange(e.target.value)} className="input-field">
                    <option value="">{t('common:select')}</option>
                    {practitioners.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('earnings:payouts.amount')} <span className="text-red-500">*</span></label>
                  <input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="input-field" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('earnings:payouts.periodMonth')}</label>
                  <select value={form.periodMonth} onChange={e => { setForm(f => ({ ...f, periodMonth: e.target.value })); loadApprovedEarnings(form.practitionerId, Number(e.target.value), Number(form.periodYear)); }} className="input-field">
                    {months.map(m => <option key={m} value={m}>{t('earnings:period.monthOption', { month: m })}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('earnings:payouts.periodYear')}</label>
                  <select value={form.periodYear} onChange={e => { setForm(f => ({ ...f, periodYear: e.target.value })); loadApprovedEarnings(form.practitionerId, Number(form.periodMonth), Number(e.target.value)); }} className="input-field">
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('earnings:payouts.paymentDate')} <span className="text-red-500">*</span></label>
                  <input type="date" value={form.paymentDate} onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="label">{t('earnings:payouts.method')}</label>
                  <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))} className="input-field">
                    {METHOD_KEYS.map(k => <option key={k} value={k}>{methodLabel(k)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">{t('earnings:payouts.note')}</label>
                <input type="text" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} className="input-field" placeholder={t('earnings:payouts.optional')} />
              </div>

              {/* Approved earnings to mark as paid */}
              {approvedEarnings.length > 0 && (
                <div>
                  <label className="label">{t('earnings:payouts.markApprovedAsPaid')}</label>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-48 overflow-y-auto">
                    {approvedEarnings.map(e => (
                      <label key={e.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEarnings.includes(e.id)}
                          onChange={() => toggleEarning(e.id)}
                          className="rounded"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">
                          {e.patient ? `${e.patient.firstName} ${e.patient.lastName}` : e.treatmentCase?.title || '—'}
                          {e.service ? ` — ${e.service.name}` : ''}
                        </span>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{formatAmount(effectiveAmount(e))}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {formError && <p className="text-sm text-red-500">{formError}</p>}
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button onClick={() => { setShowForm(false); setApprovedEarnings([]); setSelectedEarnings([]); }} className="btn-secondary">{t('common:cancel')}</button>
              <button onClick={handleSubmit} className="btn-primary">{t('common:save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SettingsTab: React.FC<{ practitioners: any[]; services: any[] }> = ({ practitioners, services }) => {
  const { t } = useTranslation(['earnings', 'common']);
  const { formatCurrency } = useClinicPreferences();
  const [rules, setRules] = useState<any[]>([]);
  const [serviceRules, setServiceRules] = useState<any[]>([]);
  const [filterPractitioner, setFilterPractitioner] = useState('');
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [showServiceRuleForm, setShowServiceRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState({
    practitionerId: '', compensationType: 'percentage', fixedMonthlyAmount: '',
    defaultPercentage: '', calculationBase: 'collected', isActive: true,
    startDate: '', endDate: '',
  });
  const [serviceRuleForm, setServiceRuleForm] = useState({
    practitionerId: '', serviceId: '', percentage: '', fixedAmount: '', isActive: true,
  });
  const [error, setError] = useState('');
  const formatAmount = (n: number) => formatCurrency(n);
  const compTypeLabel = (type: string) => t(`earnings:settings.compTypes.${type}`, { defaultValue: type });
  const calcBaseLabel = (base: string) => t(`earnings:settings.calcBases.${base}`, { defaultValue: base });

  const load = async () => {
    try {
      const [r, sr] = await Promise.all([
        compensationRuleService.getAll(filterPractitioner ? { practitionerId: filterPractitioner } : undefined),
        compensationRuleService.getServiceRules(filterPractitioner ? { practitionerId: filterPractitioner } : undefined),
      ]);
      setRules(r.data);
      setServiceRules(sr.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, [filterPractitioner]); // eslint-disable-line

  const handleSaveRule = async () => {
    setError('');
    try {
      const data: any = {
        practitionerId: ruleForm.practitionerId,
        compensationType: ruleForm.compensationType,
        calculationBase: ruleForm.calculationBase,
        isActive: ruleForm.isActive,
      };
      if (ruleForm.fixedMonthlyAmount) data.fixedMonthlyAmount = parseFloat(ruleForm.fixedMonthlyAmount);
      if (ruleForm.defaultPercentage) data.defaultPercentage = parseFloat(ruleForm.defaultPercentage);
      if (ruleForm.startDate) data.startDate = ruleForm.startDate;
      if (ruleForm.endDate) data.endDate = ruleForm.endDate;
      if (editingRuleId) {
        await compensationRuleService.update(editingRuleId, data);
      } else {
        await compensationRuleService.create(data);
      }
      setShowRuleForm(false);
      setEditingRuleId(null);
      setRuleForm({ practitionerId: '', compensationType: 'percentage', fixedMonthlyAmount: '', defaultPercentage: '', calculationBase: 'collected', isActive: true, startDate: '', endDate: '' });
      load();
    } catch { setError(t('earnings:errors.ruleSaveFailed')); }
  };

  const handleSaveServiceRule = async () => {
    setError('');
    try {
      const data: any = {
        practitionerId: serviceRuleForm.practitionerId,
        serviceId: serviceRuleForm.serviceId,
        isActive: serviceRuleForm.isActive,
      };
      if (serviceRuleForm.percentage) data.percentage = parseFloat(serviceRuleForm.percentage);
      if (serviceRuleForm.fixedAmount) data.fixedAmount = parseFloat(serviceRuleForm.fixedAmount);
      await compensationRuleService.upsertServiceRule(data);
      setShowServiceRuleForm(false);
      setServiceRuleForm({ practitionerId: '', serviceId: '', percentage: '', fixedAmount: '', isActive: true });
      load();
    } catch { setError(t('earnings:errors.serviceRuleSaveFailed')); }
  };

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <select value={filterPractitioner} onChange={e => setFilterPractitioner(e.target.value)} className="input-field w-52">
          <option value="">{t('earnings:filters.allDoctors')}</option>
          {practitioners.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
        </select>
      </div>

      {/* Default Compensation Rules */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 dark:text-white">{t('earnings:settings.doctorCommissionRules')}</h3>
          <button onClick={() => setShowRuleForm(true)} className="btn-primary text-sm flex items-center gap-1">
            <Plus size={14} />{t('earnings:settings.addRule')}
          </button>
        </div>
        {rules.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('earnings:settings.noRules')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                  <th className="text-left py-2 pl-4 pr-4">{t('earnings:columns.doctor')}</th>
                  <th className="text-left py-2 pr-4">{t('earnings:settings.type')}</th>
                  <th className="text-right py-2 pr-4">{t('earnings:settings.fixedMonthly')}</th>
                  <th className="text-right py-2 pr-4">{t('earnings:settings.percent')}</th>
                  <th className="text-left py-2 pr-4">{t('earnings:settings.calculationBase')}</th>
                  <th className="text-left py-2 pr-4">{t('earnings:columns.status')}</th>
                  <th className="text-center py-2 pr-4">{t('common:actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pl-4 pr-4 font-medium text-gray-900 dark:text-white">
                      {r.practitioner?.firstName} {r.practitioner?.lastName}
                    </td>
                    <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{compTypeLabel(r.compensationType)}</td>
                    <td className="py-2 pr-4 text-right">{r.fixedMonthlyAmount != null ? formatAmount(r.fixedMonthlyAmount) : '—'}</td>
                    <td className="py-2 pr-4 text-right">{r.defaultPercentage != null ? `${r.defaultPercentage}%` : '—'}</td>
                    <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{calcBaseLabel(r.calculationBase)}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700'}`}>
                        {r.isActive ? t('common:active') : t('common:inactive')}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => {
                            setEditingRuleId(r.id);
                            setRuleForm({
                              practitionerId: r.practitionerId,
                              compensationType: r.compensationType,
                              fixedMonthlyAmount: r.fixedMonthlyAmount?.toString() ?? '',
                              defaultPercentage: r.defaultPercentage?.toString() ?? '',
                              calculationBase: r.calculationBase,
                              isActive: r.isActive,
                              startDate: r.startDate ? r.startDate.substring(0, 10) : '',
                              endDate: r.endDate ? r.endDate.substring(0, 10) : '',
                            });
                            setShowRuleForm(true);
                          }}
                          className="text-blue-500 hover:text-blue-700"
                          title={t('common:edit')}
                        ><Pencil size={14} /></button>
                        <button
                          onClick={() => { if (window.confirm(t('earnings:confirm.deleteRule'))) compensationRuleService.remove(r.id).then(load); }}
                          className="text-red-500 hover:text-red-700"
                          title={t('common:delete')}
                        ><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Service-Specific Rules */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 dark:text-white">{t('earnings:settings.serviceCommissionRules')}</h3>
          <button onClick={() => setShowServiceRuleForm(true)} className="btn-primary text-sm flex items-center gap-1">
            <Plus size={14} />{t('earnings:settings.addServiceRule')}
          </button>
        </div>
        {serviceRules.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('earnings:settings.noServiceRules')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                  <th className="text-left py-2 pl-4 pr-4">{t('earnings:columns.doctor')}</th>
                  <th className="text-left py-2 pr-4">{t('common:service')}</th>
                  <th className="text-right py-2 pr-4">{t('earnings:settings.percent')}</th>
                  <th className="text-right py-2 pr-4">{t('earnings:settings.fixedAmount')}</th>
                  <th className="text-left py-2 pr-4">{t('earnings:columns.status')}</th>
                  <th className="text-center py-2 pr-4">{t('common:actions')}</th>
                </tr>
              </thead>
              <tbody>
                {serviceRules.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pl-4 pr-4 font-medium text-gray-900 dark:text-white">
                      {r.practitioner?.firstName} {r.practitioner?.lastName}
                    </td>
                    <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{r.service?.name}</td>
                    <td className="py-2 pr-4 text-right">{r.percentage != null ? `${r.percentage}%` : '—'}</td>
                    <td className="py-2 pr-4 text-right">{r.fixedAmount != null ? formatAmount(r.fixedAmount) : '—'}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700'}`}>
                        {r.isActive ? t('common:active') : t('common:inactive')}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-center">
                      <button
                        onClick={() => { if (window.confirm(t('earnings:confirm.deleteRule'))) compensationRuleService.removeServiceRule(r.id).then(load); }}
                        className="text-red-500 hover:text-red-700"
                        title={t('common:delete')}
                      ><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Default Rule Modal */}
      {showRuleForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{editingRuleId ? t('earnings:settings.editRuleTitle') : t('earnings:settings.addRuleTitle')}</h3>
            <div className="space-y-3">
              <div>
                <label className="label">{t('earnings:columns.doctor')} <span className="text-red-500">*</span></label>
                <select value={ruleForm.practitionerId} onChange={e => setRuleForm(f => ({ ...f, practitionerId: e.target.value }))} className="input-field">
                  <option value="">{t('common:select')}</option>
                  {practitioners.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('earnings:settings.commissionType')}</label>
                  <select value={ruleForm.compensationType} onChange={e => setRuleForm(f => ({ ...f, compensationType: e.target.value }))} className="input-field">
                    {COMP_TYPE_KEYS.map(k => <option key={k} value={k}>{compTypeLabel(k)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('earnings:settings.calculationBase')}</label>
                  <select value={ruleForm.calculationBase} onChange={e => setRuleForm(f => ({ ...f, calculationBase: e.target.value }))} className="input-field">
                    {CALC_BASE_KEYS.map(k => <option key={k} value={k}>{calcBaseLabel(k)}</option>)}
                  </select>
                </div>
              </div>
              {(ruleForm.compensationType === 'percentage' || ruleForm.compensationType === 'fixed_plus_percentage') && (
                <div>
                  <label className="label">{t('earnings:settings.percentage')}</label>
                  <input type="number" min="0" max="100" step="0.01" value={ruleForm.defaultPercentage} onChange={e => setRuleForm(f => ({ ...f, defaultPercentage: e.target.value }))} className="input-field" />
                </div>
              )}
              {(ruleForm.compensationType === 'fixed' || ruleForm.compensationType === 'fixed_plus_percentage') && (
                <div>
                  <label className="label">{t('earnings:settings.fixedMonthlyAmount')}</label>
                  <input type="number" min="0" step="0.01" value={ruleForm.fixedMonthlyAmount} onChange={e => setRuleForm(f => ({ ...f, fixedMonthlyAmount: e.target.value }))} className="input-field" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('earnings:settings.startDate')}</label>
                  <input type="date" value={ruleForm.startDate} onChange={e => setRuleForm(f => ({ ...f, startDate: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="label">{t('earnings:settings.endDate')}</label>
                  <input type="date" value={ruleForm.endDate} onChange={e => setRuleForm(f => ({ ...f, endDate: e.target.value }))} className="input-field" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="ruleActive" checked={ruleForm.isActive} onChange={e => setRuleForm(f => ({ ...f, isActive: e.target.checked }))} className="rounded" />
                <label htmlFor="ruleActive" className="text-sm text-gray-700 dark:text-gray-300">{t('common:active')}</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button onClick={() => { setShowRuleForm(false); setEditingRuleId(null); setRuleForm({ practitionerId: '', compensationType: 'percentage', fixedMonthlyAmount: '', defaultPercentage: '', calculationBase: 'collected', isActive: true, startDate: '', endDate: '' }); }} className="btn-secondary">{t('common:cancel')}</button>
              <button onClick={handleSaveRule} disabled={!ruleForm.practitionerId} className="btn-primary disabled:opacity-50">{t('common:save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Service Rule Modal */}
      {showServiceRuleForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('earnings:settings.addServiceRuleTitle')}</h3>
            <div className="space-y-3">
              <div>
                <label className="label">{t('earnings:columns.doctor')} <span className="text-red-500">*</span></label>
                <select value={serviceRuleForm.practitionerId} onChange={e => setServiceRuleForm(f => ({ ...f, practitionerId: e.target.value }))} className="input-field">
                  <option value="">{t('common:select')}</option>
                  {practitioners.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('common:service')} <span className="text-red-500">*</span></label>
                <select value={serviceRuleForm.serviceId} onChange={e => setServiceRuleForm(f => ({ ...f, serviceId: e.target.value }))} className="input-field">
                  <option value="">{t('common:select')}</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('earnings:settings.percentage')}</label>
                  <input type="number" min="0" max="100" step="0.01" value={serviceRuleForm.percentage} onChange={e => setServiceRuleForm(f => ({ ...f, percentage: e.target.value }))} className="input-field" />
                </div>
                <div>
                  <label className="label">{t('earnings:settings.fixedAmount')}</label>
                  <input type="number" min="0" step="0.01" value={serviceRuleForm.fixedAmount} onChange={e => setServiceRuleForm(f => ({ ...f, fixedAmount: e.target.value }))} className="input-field" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="srActive" checked={serviceRuleForm.isActive} onChange={e => setServiceRuleForm(f => ({ ...f, isActive: e.target.checked }))} className="rounded" />
                <label htmlFor="srActive" className="text-sm text-gray-700 dark:text-gray-300">{t('common:active')}</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button onClick={() => setShowServiceRuleForm(false)} className="btn-secondary">{t('common:cancel')}</button>
              <button onClick={handleSaveServiceRule} disabled={!serviceRuleForm.practitionerId || !serviceRuleForm.serviceId} className="btn-primary disabled:opacity-50">{t('common:save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main Page ───────────────────────────────────────────────────────────────

const PractitionerEarnings: React.FC = () => {
  const { t } = useTranslation(['earnings']);
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('summary');
  const [practitioners, setPractitioners] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [periodMonth, setPeriodMonth] = useState(currentPeriod().month);
  const [periodYear, setPeriodYear] = useState(currentPeriod().year);

  useEffect(() => {
    userService.getDoctors().then(r => setPractitioners(r.data)).catch(() => {});
    serviceService.getAll({ onlyActive: true }).then(r => setServices(r.data)).catch(() => {});
  }, []);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'summary',  label: t('earnings:tabs.summary'), icon: <DollarSign size={16} /> },
    { key: 'earnings', label: t('earnings:tabs.earnings'), icon: <Clock size={16} /> },
    { key: 'payouts',  label: t('earnings:tabs.payouts'), icon: <CreditCard size={16} /> },
    { key: 'settings', label: t('earnings:tabs.settings'), icon: <Settings size={16} /> },
  ];

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = [2024, 2025, 2026, 2027];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('earnings:management.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('earnings:management.subtitle')}</p>
        </div>
        {tab === 'summary' && (
          <div className="flex items-center gap-2">
            <select value={periodMonth} onChange={e => setPeriodMonth(Number(e.target.value))} className="input-field w-28">
              {months.map(m => <option key={m} value={m}>{t('earnings:period.monthOption', { month: m })}</option>)}
            </select>
            <select value={periodYear} onChange={e => setPeriodYear(Number(e.target.value))} className="input-field w-20">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
            ].join(' ')}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="card p-4 sm:p-6">
        {tab === 'summary' && <SummaryTab periodMonth={periodMonth} periodYear={periodYear} practitioners={practitioners} />}
        {tab === 'earnings' && <EarningsTab practitioners={practitioners} />}
        {tab === 'payouts' && <PayoutsTab practitioners={practitioners} />}
        {tab === 'settings' && <SettingsTab practitioners={practitioners} services={services} />}
      </div>
    </div>
  );
};

export default PractitionerEarnings;
