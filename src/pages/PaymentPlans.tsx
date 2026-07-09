import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CreditCard, Plus, Loader2, CheckCircle2, Clock, AlertCircle,
  ChevronDown, ChevronRight, XCircle, Search, Calendar, X, ArrowLeft, Receipt,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { paymentPlanService, paymentService } from '../services/api';
import PaymentPlanForm from '../components/PaymentPlanForm';
import { useAuth } from '../context/AuthContext';
import { canManagePayments } from '../utils/permissions';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

const INSTALLMENT_STATUS_STYLES: Record<string, string> = {
  pending: 'text-amber-600 bg-amber-50',
  paid: 'text-green-600 bg-green-50',
  overdue: 'text-red-600 bg-red-50',
};

const PLAN_STATUS_STYLES: Record<string, string> = {
  active: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'cheque', 'other'] as const;

interface OverdueSummary {
  total: number;
  installmentAmount: number;
  installmentCount: number;
  paymentAmount: number;
  paymentCount: number;
}

interface OverdueItem {
  id: string;
  type: 'installment' | 'standalone';
  patientId: string;
  patientName: string;
  amount: number;
  currency: string;
  dueDate: string;
  status: string;
  planId: string | null;
  installmentId: string | null;
  paymentId: string | null;
}

function isOverdue(dueDate: string, status: string, paymentId?: string | null) {
  return (
    ['pending', 'overdue'].includes(status) &&
    !paymentId &&
    new Date(dueDate) < new Date()
  );
}

const PaymentPlans: React.FC = () => {
  const { t } = useTranslation(['payments', 'common']);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { defaultCurrency, formatCurrency, formatDate } = useClinicPreferences();
  const isAdmin = canManagePayments(user);
  const money = (amount: number, currency = defaultCurrency) => formatCurrency(amount, currency);
  const date = (value: string) => formatDate(value);
  const installmentStatusLabel = (status: string) => t(`payments:plansPage.installmentStatus.${status}`, { defaultValue: status });
  const planStatusLabel = (status: string) => t(`payments:plansPage.planStatus.${status}`, { defaultValue: status });
  const methodLabel = (method: string) => t(`payments:methods.${method}`, { defaultValue: method });
  const [searchParams, setSearchParams] = useSearchParams();

  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(() => searchParams.get('planId'));
  const [payingInstallment, setPayingInstallment] = useState<{ planId: string; installmentId: string } | null>(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // Read from URL so the dashboard "Gecikmiş Tahsilatlar" card link
  // (/payment-plans?overdueOnly=true) applies immediately and survives a refresh.
  const [overdueOnly, setOverdueOnly] = useState<boolean>(() => searchParams.get('overdueOnly') === 'true');

  // Standalone (non-installment) overdue payments — a Payment record is only ever
  // created for an installment once it's PAID, so any pending Payment is inherently
  // non-installment. Fetched only for the unified overdue view so this page's total
  // matches the dashboard "Gecikmiş Tahsilatlar" card, which sums both sources.
  const [overduePayments, setOverduePayments] = useState<any[]>([]);

  const fetchOverduePayments = async () => {
    try {
      const res = await paymentService.getAll({ paymentStatus: 'pending' });
      setOverduePayments(res.data || []);
    } catch {
      console.error('Failed to fetch overdue (non-installment) payments');
    }
  };

  useEffect(() => {
    if (overdueOnly) fetchOverduePayments();
  }, [overdueOnly]);

  const [overdueData, setOverdueData] = useState<{ summary: OverdueSummary; items: OverdueItem[] } | null>(null);
  const [overdueLoading, setOverdueLoading] = useState(true);
  const [overdueError, setOverdueError] = useState('');

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      const res = await paymentPlanService.getAll(params);
      setPlans(res.data || []);
    } catch {
      console.error('Failed to fetch payment plans');
    } finally {
      setLoading(false);
    }
  };

  const fetchOverdueCollections = async () => {
    setOverdueLoading(true);
    setOverdueError('');
    try {
      const clinicId = searchParams.get('clinicId');
      const res = await paymentPlanService.getOverdueCollections(clinicId ? { clinicId } : undefined);
      setOverdueData(res.data);
    } catch {
      setOverdueError(t('payments:overdueCollections.loadFailed'));
    } finally {
      setOverdueLoading(false);
    }
  };

  useEffect(() => {
    if (overdueOnly) {
      fetchOverdueCollections();
    } else {
      fetchPlans();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, overdueOnly]);

  const handleCreatePlan = async (data: any) => {
    await paymentPlanService.create(data);
    fetchPlans();
  };

  const handlePayInstallment = async (planId: string, installmentId: string) => {
    try {
      await paymentPlanService.payInstallment(planId, installmentId, { paymentMethod: payMethod });
      setPayingInstallment(null);
      fetchPlans();
    } catch (err: any) {
      alert(err?.response?.data?.error || t('payments:plansPage.errors.paymentSaveFailed'));
    }
  };

  const handleCancelPlan = async (planId: string) => {
    if (!window.confirm(t('payments:plansPage.confirmCancelPlan'))) return;
    try {
      await paymentPlanService.cancel(planId);
      fetchPlans();
    } catch {
      alert(t('payments:plansPage.errors.cancelFailed'));
    }
  };

  const paidCount = (plan: any) => plan.installments?.filter((i: any) => i.status === 'paid').length || 0;
  const overdueCount = (plan: any) => plan.installments?.filter((i: any) => isOverdue(i.dueDate, i.status, i.paymentId)).length || 0;
  const overdueAmount = (plan: any) => plan.installments?.filter((i: any) => isOverdue(i.dueDate, i.status, i.paymentId)).reduce((s: number, i: any) => s + i.amount, 0) || 0;
  const paidAmount = (plan: any) => plan.installments?.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + i.amount, 0) || 0;

  const totalOverdueAmount = plans.reduce((s, p) => s + overdueAmount(p), 0);
  const totalOverduePaymentsAmount = overduePayments.reduce((s, p) => s + p.amount, 0);
  // Grand total shown in the overdue-only banner — must match the dashboard card
  // (server/src/utils/overdueReceivables.ts sums the exact same two sources).
  const totalOverdueGrandTotal = totalOverdueAmount + totalOverduePaymentsAmount;

  const filteredPlans = plans.filter(p => {
    if (overdueOnly && overdueCount(p) === 0) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return `${p.patient?.firstName} ${p.patient?.lastName}`.toLowerCase().includes(q) ||
      (p.treatmentCase?.title || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q);
  });

  const clearOverdueFilter = () => {
    setOverdueOnly(false);
    const next = new URLSearchParams(searchParams);
    next.delete('overdueOnly');
    next.delete('clinicId');
    setSearchParams(next);
  };

  const openPaymentPlan = (planId: string | null) => {
    if (!planId) return;

    setOverdueOnly(false);
    setExpandedPlan(planId);

    const next = new URLSearchParams();
    next.set('planId', planId);
    setSearchParams(next);
  };

  const openPayment = (patientId: string | null) => {
    if (!patientId) {
      navigate('/payments?status=pending');
      return;
    }

    navigate(`/payments?patientId=${encodeURIComponent(patientId)}`);
  };

  // ── Unified overdue collections view (/payment-plans?overdueOnly=true) ─────
  if (overdueOnly) {
    const items = overdueData?.items || [];
    const summary = overdueData?.summary;

    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={clearOverdueFilter}
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-1"
            >
              <ArrowLeft size={14} /> {t('payments:overdueCollections.backToPlans')}
            </button>
            <h1 className="text-2xl font-bold text-gray-900">{t('payments:overdueCollections.title')}</h1>
            <p className="text-gray-500 mt-1">{t('payments:overdueCollections.subtitle')}</p>
          </div>
        </div>

        {overdueError && (
          <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{overdueError}</div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-500">{t('payments:overdueCollections.summary.totalOverdue')}</p>
              <AlertCircle size={20} className="text-red-600" />
            </div>
            <p className="text-2xl font-bold text-red-600">{money(summary?.total || 0)}</p>
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-500">{t('payments:overdueCollections.summary.overdueInstallments')}</p>
              <CreditCard size={20} className="text-orange-500" />
            </div>
            <p className="text-2xl font-bold text-orange-500">{money(summary?.installmentAmount || 0)}</p>
            <p className="text-xs text-gray-400 mt-1">{t('payments:overdueCollections.recordCount', { count: summary?.installmentCount || 0 })}</p>
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-500">{t('payments:overdueCollections.summary.standalonePayments')}</p>
              <Receipt size={20} className="text-amber-500" />
            </div>
            <p className="text-2xl font-bold text-amber-500">{money(summary?.paymentAmount || 0)}</p>
            <p className="text-xs text-gray-400 mt-1">{t('payments:overdueCollections.recordCount', { count: summary?.paymentCount || 0 })}</p>
          </div>
        </div>

        {/* Unified Table */}
        {overdueLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-primary-500" />
          </div>
        ) : items.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <CheckCircle2 size={40} className="mx-auto mb-3 opacity-30 text-green-400" />
            <p className="font-medium">{t('payments:overdueCollections.empty')}</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">{t('payments:overdueCollections.table.patient')}</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">{t('payments:overdueCollections.table.type')}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">{t('payments:overdueCollections.table.amount')}</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">{t('payments:overdueCollections.table.dueDate')}</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-500">{t('payments:overdueCollections.table.status')}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">{t('payments:overdueCollections.table.action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {items.map(item => (
                    <tr key={`${item.type}-${item.id}`} className="bg-red-50/30 dark:bg-red-900/10 hover:bg-red-50/60">
                      <td className="px-4 py-3 font-medium text-gray-900">{item.patientName}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${item.type === 'installment' ? 'bg-orange-50 text-orange-600' : 'bg-amber-50 text-amber-600'}`}>
                          {t(`payments:overdueCollections.types.${item.type}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{money(item.amount, item.currency)}</td>
                      <td className="px-4 py-3 text-gray-700">
                        <div className="flex items-center gap-1">
                          <Calendar size={14} className="text-gray-400" />
                          {date(item.dueDate)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs px-2 py-1 rounded-full font-medium text-red-600 bg-red-50">
                          {installmentStatusLabel('overdue')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {item.type === 'installment' ? (
                          <button
                            type="button"
                            onClick={() => openPaymentPlan(item.planId)}
                            className="text-xs bg-primary-50 text-primary-700 hover:bg-primary-100 px-3 py-1 rounded-lg font-medium transition-colors"
                          >
                            {t('payments:overdueCollections.viewPlan')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openPayment(item.patientId)}
                            className="text-xs bg-primary-50 text-primary-700 hover:bg-primary-100 px-3 py-1 rounded-lg font-medium transition-colors"
                          >
                            {t('payments:overdueCollections.viewPayment')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('payments:plansPage.title')}</h1>
          <p className="text-gray-500 mt-1">{t('payments:plansPage.subtitle')}</p>
        </div>
        <button onClick={() => setIsFormOpen(true)} className="btn-primary flex items-center gap-2 shrink-0">
          <Plus size={20} /> {t('payments:plansPage.newPlan')}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t('payments:plansPage.summary.totalPlans'), value: plans.length, color: 'text-blue-600', icon: CreditCard },
          { label: t('payments:plansPage.planStatus.active'), value: plans.filter(p => p.status === 'active').length, color: 'text-green-600', icon: Clock },
          {
            label: t('payments:plansPage.summary.overdueInstallments'),
            value: plans.reduce((s, p) => s + overdueCount(p), 0),
            subtitle: totalOverdueAmount > 0 ? money(totalOverdueAmount) : undefined,
            color: 'text-red-600',
            icon: AlertCircle,
          },
          { label: t('payments:plansPage.planStatus.completed'), value: plans.filter(p => p.status === 'completed').length, color: 'text-purple-600', icon: CheckCircle2 },
        ].map(card => (
          <div key={card.label} className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-500">{card.label}</p>
              <card.icon size={20} className={card.color} />
            </div>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            {card.subtitle && <p className="text-xs text-gray-400 mt-1">{card.subtitle}</p>}
          </div>
        ))}
      </div>

      {/* Overdue-only filter banner (from dashboard "Gecikmiş Tahsilatlar" card link) */}
      {overdueOnly && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
          <span className="flex items-center gap-2">
            <AlertCircle size={16} />
            {t('payments:plansPage.filters.overdueOnlyActive')}
          </span>
          <div className="flex items-center gap-4">
            <span className="font-bold">
              {t('payments:plansPage.filters.overdueGrandTotal')}: {money(totalOverdueGrandTotal)}
            </span>
            <button onClick={clearOverdueFilter} className="flex items-center gap-1 text-red-600 hover:text-red-800 font-medium">
              <X size={14} /> {t('payments:plansPage.filters.clear')}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" className="input-field pl-10" placeholder={t('payments:plansPage.searchPlaceholder')}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input-field w-full sm:w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">{t('payments:plansPage.filters.allStatuses')}</option>
          <option value="active">{t('payments:plansPage.planStatus.active')}</option>
          <option value="completed">{t('payments:plansPage.planStatus.completed')}</option>
          <option value="cancelled">{t('payments:plansPage.planStatus.cancelled')}</option>
        </select>
      </div>

      {/* Plans List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={32} className="animate-spin text-primary-500" />
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <CreditCard size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">{t('payments:plansPage.empty')}</p>
          <button onClick={() => setIsFormOpen(true)} className="btn-primary mt-4">{t('payments:plansPage.createFirst')}</button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPlans.map(plan => {
            const paid = paidCount(plan);
            const overdue = overdueCount(plan);
            const paidAmt = paidAmount(plan);
            const remaining = plan.totalAmount - paidAmt;
            const progress = plan.installmentCount > 0 ? (paid / plan.installmentCount) * 100 : 0;
            const isExpanded = expandedPlan === plan.id;
            const planStatusClass = PLAN_STATUS_STYLES[plan.status] || PLAN_STATUS_STYLES.active;

            return (
              <div key={plan.id} className="card overflow-hidden">
                {/* Plan Header */}
                <div
                  className="p-5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  onClick={() => setExpandedPlan(isExpanded ? null : plan.id)}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-primary-700 font-bold shrink-0">
                        {plan.patient?.firstName?.[0]}{plan.patient?.lastName?.[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900 truncate">{plan.patient?.firstName} {plan.patient?.lastName}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${planStatusClass}`}>{planStatusLabel(plan.status)}</span>
                          {overdue > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">{t('payments:plansPage.overdueCount', { count: overdue })}</span>}
                        </div>
                        {plan.treatmentCase?.title && <p className="text-sm text-gray-500 truncate">{plan.treatmentCase.title}</p>}
                        {plan.description && <p className="text-xs text-gray-400 truncate">{plan.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-sm text-gray-500">{t('payments:plansPage.installmentProgress', { paid, total: plan.installmentCount })}</p>
                        <p className="font-bold text-gray-900">{money(plan.totalAmount, plan.currency)}</p>
                        {remaining > 0 && plan.status === 'active' && (
                          <p className="text-xs text-amber-600">{t('payments:plansPage.remaining', { amount: money(remaining, plan.currency) })}</p>
                        )}
                      </div>
                      {isExpanded ? <ChevronDown size={20} className="text-gray-400" /> : <ChevronRight size={20} className="text-gray-400" />}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {plan.installmentCount > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>{t('payments:plansPage.paidAmount', { amount: money(paidAmt, plan.currency) })}</span>
                        <span>%{Math.round(progress)}</span>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                        <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Expanded: Installment Table */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium text-gray-500 w-10">#</th>
                            <th className="px-4 py-3 text-left font-medium text-gray-500">{t('payments:plansPage.dueDate')}</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-500">{t('payments:plansPage.amount')}</th>
                            <th className="px-4 py-3 text-center font-medium text-gray-500">{t('payments:plansPage.status')}</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-500">{t('common:actions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {(plan.installments || []).map((inst: any) => {
                            const overdue = isOverdue(inst.dueDate, inst.status, inst.paymentId);
                            const statusKey = overdue ? 'overdue' : inst.status;
                            const statusClass = INSTALLMENT_STATUS_STYLES[statusKey] || INSTALLMENT_STATUS_STYLES.pending;
                            const isPaying = payingInstallment?.planId === plan.id && payingInstallment?.installmentId === inst.id;

                            return (
                              <tr key={inst.id} className={`${overdue ? 'bg-red-50/30 dark:bg-red-900/10' : ''} hover:bg-gray-50/50`}>
                                <td className="px-4 py-3 text-gray-400">{inst.installmentNo}</td>
                                <td className="px-4 py-3 text-gray-700">
                                  <div className="flex items-center gap-1">
                                    <Calendar size={14} className="text-gray-400" />
                                    {date(inst.dueDate)}
                                  </div>
                                  {inst.paidAt && <p className="text-xs text-green-600 mt-0.5">{t('payments:plansPage.paidAt', { date: date(inst.paidAt) })}</p>}
                                </td>
                                <td className="px-4 py-3 text-right font-semibold text-gray-900">
                                  {money(inst.amount, plan.currency)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusClass}`}>
                                    {installmentStatusLabel(statusKey)}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {['pending', 'overdue'].includes(inst.status) && !inst.paymentId && plan.status !== 'cancelled' && (
                                    <>
                                      {isPaying ? (
                                        <div className="flex items-center gap-2 justify-end">
                                          <select className="input-field py-1 text-xs w-32" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                                            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{methodLabel(m)}</option>)}
                                          </select>
                                          <button onClick={() => handlePayInstallment(plan.id, inst.id)}
                                            className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700">
                                            {t('payments:plansPage.confirmPayment')}
                                          </button>
                                          <button onClick={() => setPayingInstallment(null)} className="text-xs text-gray-400 hover:text-gray-600">
                                            <XCircle size={16} />
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => setPayingInstallment({ planId: plan.id, installmentId: inst.id })}
                                          className="text-xs bg-primary-50 text-primary-700 hover:bg-primary-100 px-3 py-1 rounded-lg font-medium transition-colors"
                                        >
                                          {t('payments:plansPage.markPaid')}
                                        </button>
                                      )}
                                    </>
                                  )}
                                  {inst.status === 'paid' && (
                                    <CheckCircle2 size={18} className="text-green-500 ml-auto" />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Plan Actions */}
                    {isAdmin && plan.status === 'active' && (
                      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
                        <button onClick={() => handleCancelPlan(plan.id)}
                          className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                          <XCircle size={14} /> {t('payments:plansPage.cancelPlan')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unified overdue view: standalone (non-installment) overdue payments — the
          other half of the dashboard "Gecikmiş Tahsilatlar" total, alongside the
          overdue installment plans listed above. */}
      {overdueOnly && overduePayments.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-5 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900">{t('payments:plansPage.overduePaymentsSection.title')}</h3>
            <p className="text-sm text-gray-500 mt-1">{t('payments:plansPage.overduePaymentsSection.subtitle')}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t('payments:list.patient')}</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">{t('payments:list.amount')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t('payments:list.method')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t('payments:list.date')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {overduePayments.map((p) => (
                  <tr key={p.id} className="bg-red-50/30 dark:bg-red-900/10 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-gray-900 font-medium">{p.patient?.firstName} {p.patient?.lastName}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{money(p.amount, p.currency)}</td>
                    <td className="px-4 py-3 text-gray-600">{methodLabel(p.paymentMethod)}</td>
                    <td className="px-4 py-3 text-gray-600">{date(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 text-right">
            <Link to="/payments?status=pending" className="text-sm text-primary-600 hover:underline font-medium">
              {t('payments:plansPage.overduePaymentsSection.viewInPayments')}
            </Link>
          </div>
        </div>
      )}

      {isFormOpen && (
        <PaymentPlanForm onClose={() => setIsFormOpen(false)} onSave={handleCreatePlan} />
      )}
    </div>
  );
};

export default PaymentPlans;
