import React, { useEffect, useState } from 'react';
import { 
  CreditCard, 
  Plus, 
  Search, 
  Filter, 
  Eye, 
  Edit2, 
  XCircle, 
  Loader2,
  DollarSign,
  TrendingUp,
  User,
  Briefcase,
  Calendar,
  CheckCircle2,
  ArrowRight,
  FileText,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { paymentService, patientService } from '../services/api';
import PaymentForm from '../components/PaymentForm';
import ReceiptModal from '../components/ReceiptModal';

const Payments: React.FC = () => {
  const { t } = useTranslation(['payments', 'common']);
  
  const [payments, setPayments] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<any>(null);
  const [receiptPaymentId, setReceiptPaymentId] = useState<string | null>(null);
  
  // Filters
  const [patientId, setPatientId] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchPayments = async () => {
    setLoading(true);
    try {
      const response = await paymentService.getAll({
        patientId: patientId || undefined,
        paymentStatus: status || undefined,
        paymentMethod: method || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setPayments(response.data);
    } catch (error) {
      console.error('Failed to fetch payments:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, [patientId, status, method, dateFrom, dateTo]);

  useEffect(() => {
    const fetchPatients = async () => {
      try {
        const res = await patientService.getAll();
        setPatients(res.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchPatients();
  }, []);

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'paid': return 'bg-green-50 text-green-700 border-green-100';
      case 'pending': return 'bg-amber-50 text-amber-700 border-amber-100';
      case 'partial': return 'bg-blue-50 text-blue-700 border-blue-100';
      case 'refunded': return 'bg-purple-50 text-purple-700 border-purple-100';
      case 'cancelled': return 'bg-red-50 text-red-700 border-red-100';
      default: return 'bg-gray-50 text-gray-700 border-gray-100';
    }
  };

  const totalPaid = payments.filter(p => p.paymentStatus === 'paid').reduce((acc, curr) => acc + curr.amount, 0);
  const totalPending = payments.filter(p => p.paymentStatus === 'pending').reduce((acc, curr) => acc + curr.amount, 0);
  const summaryCurrency = payments[0]?.currency || 'TRY';

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('payments:title')}</h1>
          <p className="text-gray-500 mt-1">{t('payments:subtitle')}</p>
        </div>
        <button 
          onClick={() => {
            setEditingPayment(null);
            setIsFormOpen(true);
          }} 
          className="btn-primary"
        >
          <Plus size={20} />
          {t('payments:addPayment')}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card p-6 bg-gradient-to-br from-green-500 to-green-600 text-white border-none">
          <div className="flex items-center justify-between mb-4">
            <CheckCircle2 size={24} className="opacity-80" />
            <span className="text-xs font-bold uppercase tracking-wider opacity-80">{t('payments:summary.totalCollected')}</span>
          </div>
          <p className="text-3xl font-bold">{totalPaid.toLocaleString()} <span className="text-lg font-normal opacity-80">{summaryCurrency}</span></p>
          <p className="text-sm mt-2 opacity-80">{t('payments:summary.fromPaidRecords')}</p>
        </div>
        <div className="card p-6 bg-white border-amber-100">
          <div className="flex items-center justify-between mb-4 text-amber-500">
            <Clock size={24} className="opacity-80" />
            <span className="text-xs font-bold uppercase tracking-wider opacity-80">{t('payments:summary.pending')}</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{totalPending.toLocaleString()} <span className="text-lg font-normal text-gray-400">{summaryCurrency}</span></p>
          <p className="text-sm mt-2 text-gray-500">{t('payments:summary.awaitingPayment')}</p>
        </div>
        <div className="card p-6 bg-white">
          <div className="flex items-center justify-between mb-4 text-primary-500">
            <TrendingUp size={24} className="opacity-80" />
            <span className="text-xs font-bold uppercase tracking-wider opacity-80">{t('payments:summary.transactions')}</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{payments.length}</p>
          <p className="text-sm mt-2 text-gray-500">{t('payments:summary.totalRecords')}</p>
        </div>
        <div className="card p-6 bg-white">
          <div className="flex items-center justify-between mb-4 text-purple-500">
            <DollarSign size={24} className="opacity-80" />
            <span className="text-xs font-bold uppercase tracking-wider opacity-80">{t('payments:summary.average')}</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">
            {payments.length > 0 ? (totalPaid / payments.length).toFixed(0) : 0}
          </p>
          <p className="text-sm mt-2 text-gray-500">{t('payments:summary.perTransaction')}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <select className="input-field" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
          <option value="">{t('payments:list.patient')}</option>
          {patients.map(p => (
            <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
          ))}
        </select>

        <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('payments:filters.allStatus')}</option>
          {['pending', 'partial', 'paid', 'refunded', 'cancelled'].map(s => (
            <option key={s} value={s}>{t(`payments:status.${s}`)}</option>
          ))}
        </select>

        <select className="input-field" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">{t('payments:filters.allMethods')}</option>
          {['cash', 'card', 'bank_transfer', 'cheque', 'other'].map(m => (
            <option key={m} value={m}>{t(`payments:methods.${m}`)}</option>
          ))}
        </select>

        <input 
          type="date" 
          className="input-field" 
          value={dateFrom} 
          onChange={(e) => setDateFrom(e.target.value)}
          title="From Date"
        />
        <input 
          type="date" 
          className="input-field" 
          value={dateTo} 
          onChange={(e) => setDateTo(e.target.value)}
          title="To Date"
        />
      </div>

      {/* Table View */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('payments:list.patient')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider hidden lg:table-cell">{t('payments:list.treatment')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider hidden lg:table-cell">{t('common:practitioner')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('payments:list.amount')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider hidden sm:table-cell">{t('payments:list.method')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('payments:list.status')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider hidden md:table-cell">{t('payments:list.date')}</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center">
                    <Loader2 className="animate-spin text-primary-600 mx-auto" size={32} />
                  </td>
                </tr>
              ) : payments.length > 0 ? (
                payments.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                          {p.patient.firstName[0]}{p.patient.lastName[0]}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">{p.patient.firstName} {p.patient.lastName}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 hidden lg:table-cell">
                      {p.treatmentCase ? (
                        <span className="text-sm text-gray-700">{p.treatmentCase.title}</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="p-4 hidden lg:table-cell">
                      {p.treatmentCase?.practitioner ? (
                        <span className="text-sm text-gray-700">{p.treatmentCase.practitioner.firstName} {p.treatmentCase.practitioner.lastName}</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-bold text-gray-900">{p.amount.toLocaleString()} {p.currency}</p>
                    </td>
                    <td className="p-4 hidden sm:table-cell">
                      <span className="text-xs font-medium text-gray-600 flex items-center gap-2">
                        <CreditCard size={14} className="text-gray-400" />
                        {t(`payments:methods.${p.paymentMethod}`)}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wider ${getStatusColor(p.paymentStatus)}`}>
                        {t(`payments:status.${p.paymentStatus}`)}
                      </span>
                    </td>
                    <td className="p-4 hidden md:table-cell">
                      <p className="text-xs text-gray-600">{new Date(p.paidAt).toLocaleDateString()}</p>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setReceiptPaymentId(p.id)}
                          className="p-2 text-gray-400 hover:bg-white hover:text-indigo-600 rounded-lg transition-all shadow-sm"
                          title="Makbuz"
                        >
                          <FileText size={18} />
                        </button>
                        <button 
                          onClick={() => { setEditingPayment(p); setIsFormOpen(true); }}
                          className="p-2 text-gray-400 hover:bg-white hover:text-blue-600 rounded-lg transition-all shadow-sm"
                        >
                          <Edit2 size={18} />
                        </button>
                        {p.paymentStatus !== 'cancelled' && (
                          <button 
                            onClick={async () => {
                              if (window.confirm(t('payments:confirmCancel'))) {
                                await paymentService.cancel(p.id);
                                fetchPayments();
                              }
                            }}
                            className="p-2 text-gray-400 hover:bg-white hover:text-red-600 rounded-lg transition-all shadow-sm"
                          >
                            <XCircle size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-gray-400">
                    <CreditCard size={48} className="mx-auto mb-3 opacity-20" />
                    <p>{t('common:noData')}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isFormOpen && (
        <PaymentForm 
          onClose={() => setIsFormOpen(false)} 
          onSuccess={() => {
            setIsFormOpen(false);
            fetchPayments();
          }}
          initialData={editingPayment}
        />
      )}
      {receiptPaymentId && (
        <ReceiptModal paymentId={receiptPaymentId} onClose={() => setReceiptPaymentId(null)} />
      )}
    </div>
  );
};

// Internal icon component for the summary cards
const Clock: React.FC<any> = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
);

export default Payments;
