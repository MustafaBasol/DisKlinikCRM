import React, { useEffect, useState } from 'react';
import {
  CreditCard, Plus, Loader2, CheckCircle2, Clock, AlertCircle,
  ChevronDown, ChevronRight, XCircle, Search, Calendar,
} from 'lucide-react';
import { paymentPlanService } from '../services/api';
import PaymentPlanForm from '../components/PaymentPlanForm';
import { useAuth } from '../context/AuthContext';
import { canManagePayments } from '../utils/permissions';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Bekliyor', color: 'text-amber-600 bg-amber-50' },
  paid: { label: 'Ödendi', color: 'text-green-600 bg-green-50' },
  overdue: { label: 'Gecikmiş', color: 'text-red-600 bg-red-50' },
};

const PLAN_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: 'Aktif', color: 'bg-blue-50 text-blue-700' },
  completed: { label: 'Tamamlandı', color: 'bg-green-50 text-green-700' },
  cancelled: { label: 'İptal', color: 'bg-gray-100 text-gray-500' },
};

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Nakit' },
  { value: 'card', label: 'Kart' },
  { value: 'bank_transfer', label: 'Havale/EFT' },
  { value: 'cheque', label: 'Çek' },
  { value: 'other', label: 'Diğer' },
];

function formatCurrency(amount: number, currency = 'TRY') {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency }).format(amount);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isOverdue(dueDate: string, status: string) {
  return status === 'pending' && new Date(dueDate) < new Date();
}

const PaymentPlans: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = canManagePayments(user);

  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [payingInstallment, setPayingInstallment] = useState<{ planId: string; installmentId: string } | null>(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

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

  useEffect(() => { fetchPlans(); }, [statusFilter]); // eslint-disable-line

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
      alert(err?.response?.data?.error || 'Ödeme kaydedilemedi.');
    }
  };

  const handleCancelPlan = async (planId: string) => {
    if (!window.confirm('Bu taksit planını iptal etmek istediğinizden emin misiniz?')) return;
    try {
      await paymentPlanService.cancel(planId);
      fetchPlans();
    } catch {
      alert('Plan iptal edilemedi.');
    }
  };

  const filteredPlans = plans.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return `${p.patient?.firstName} ${p.patient?.lastName}`.toLowerCase().includes(q) ||
      (p.treatmentCase?.title || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q);
  });

  const paidCount = (plan: any) => plan.installments?.filter((i: any) => i.status === 'paid').length || 0;
  const overdueCount = (plan: any) => plan.installments?.filter((i: any) => isOverdue(i.dueDate, i.status)).length || 0;
  const paidAmount = (plan: any) => plan.installments?.filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + i.amount, 0) || 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Taksit Planları</h1>
          <p className="text-gray-500 mt-1">Ödeme planları ve taksit takibi</p>
        </div>
        <button onClick={() => setIsFormOpen(true)} className="btn-primary flex items-center gap-2 shrink-0">
          <Plus size={20} /> Yeni Taksit Planı
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Toplam Plan', value: plans.length, color: 'text-blue-600', icon: CreditCard },
          { label: 'Aktif', value: plans.filter(p => p.status === 'active').length, color: 'text-green-600', icon: Clock },
          { label: 'Gecikmiş Taksit', value: plans.reduce((s, p) => s + overdueCount(p), 0), color: 'text-red-600', icon: AlertCircle },
          { label: 'Tamamlanan', value: plans.filter(p => p.status === 'completed').length, color: 'text-purple-600', icon: CheckCircle2 },
        ].map(card => (
          <div key={card.label} className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-500">{card.label}</p>
              <card.icon size={20} className={card.color} />
            </div>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" className="input-field pl-10" placeholder="Hasta adı, tedavi veya açıklama ara..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input-field w-full sm:w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Tüm Durumlar</option>
          <option value="active">Aktif</option>
          <option value="completed">Tamamlandı</option>
          <option value="cancelled">İptal</option>
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
          <p className="font-medium">Taksit planı bulunamadı.</p>
          <button onClick={() => setIsFormOpen(true)} className="btn-primary mt-4">İlk Planı Oluştur</button>
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
            const planStatusInfo = PLAN_STATUS[plan.status] || PLAN_STATUS.active;

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
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${planStatusInfo.color}`}>{planStatusInfo.label}</span>
                          {overdue > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-medium">{overdue} gecikmiş</span>}
                        </div>
                        {plan.treatmentCase?.title && <p className="text-sm text-gray-500 truncate">{plan.treatmentCase.title}</p>}
                        {plan.description && <p className="text-xs text-gray-400 truncate">{plan.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-sm text-gray-500">{paid}/{plan.installmentCount} taksit</p>
                        <p className="font-bold text-gray-900">{formatCurrency(plan.totalAmount, plan.currency)}</p>
                        {remaining > 0 && plan.status === 'active' && (
                          <p className="text-xs text-amber-600">Kalan: {formatCurrency(remaining, plan.currency)}</p>
                        )}
                      </div>
                      {isExpanded ? <ChevronDown size={20} className="text-gray-400" /> : <ChevronRight size={20} className="text-gray-400" />}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {plan.installmentCount > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>{formatCurrency(paidAmt, plan.currency)} ödendi</span>
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
                            <th className="px-4 py-3 text-left font-medium text-gray-500">Vade</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-500">Tutar</th>
                            <th className="px-4 py-3 text-center font-medium text-gray-500">Durum</th>
                            <th className="px-4 py-3 text-right font-medium text-gray-500">İşlem</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {(plan.installments || []).map((inst: any) => {
                            const overdue = isOverdue(inst.dueDate, inst.status);
                            const statusKey = overdue ? 'overdue' : inst.status;
                            const statusInfo = STATUS_LABELS[statusKey] || STATUS_LABELS.pending;
                            const isPaying = payingInstallment?.planId === plan.id && payingInstallment?.installmentId === inst.id;

                            return (
                              <tr key={inst.id} className={`${overdue ? 'bg-red-50/30 dark:bg-red-900/10' : ''} hover:bg-gray-50/50`}>
                                <td className="px-4 py-3 text-gray-400">{inst.installmentNo}</td>
                                <td className="px-4 py-3 text-gray-700">
                                  <div className="flex items-center gap-1">
                                    <Calendar size={14} className="text-gray-400" />
                                    {formatDate(inst.dueDate)}
                                  </div>
                                  {inst.paidAt && <p className="text-xs text-green-600 mt-0.5">Ödendi: {formatDate(inst.paidAt)}</p>}
                                </td>
                                <td className="px-4 py-3 text-right font-semibold text-gray-900">
                                  {formatCurrency(inst.amount, plan.currency)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusInfo.color}`}>
                                    {overdue ? 'Gecikmiş' : statusInfo.label}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {inst.status === 'pending' && plan.status !== 'cancelled' && (
                                    <>
                                      {isPaying ? (
                                        <div className="flex items-center gap-2 justify-end">
                                          <select className="input-field py-1 text-xs w-32" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                                            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                          </select>
                                          <button onClick={() => handlePayInstallment(plan.id, inst.id)}
                                            className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700">
                                            Onayla
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
                                          Ödendi
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
                          <XCircle size={14} /> Planı İptal Et
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

      {isFormOpen && (
        <PaymentPlanForm onClose={() => setIsFormOpen(false)} onSave={handleCreatePlan} />
      )}
    </div>
  );
};

export default PaymentPlans;
