import React, { useState, useEffect } from 'react';
import { X, User, Briefcase, DollarSign, Calendar, CreditCard, AlertCircle, Loader2, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { patientService, treatmentCaseService, paymentService } from '../services/api';

interface PaymentFormProps {
  onClose: () => void;
  onSuccess: () => void;
  initialData?: any;
  patientId?: string;
  treatmentCaseId?: string;
}

const PaymentForm: React.FC<PaymentFormProps> = ({ onClose, onSuccess, initialData, patientId, treatmentCaseId }) => {
  const { t } = useTranslation(['payments', 'common']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [patients, setPatients] = useState<any[]>([]);
  const [treatmentCases, setTreatmentCases] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
    patientId: patientId || initialData?.patientId || '',
    treatmentCaseId: treatmentCaseId || initialData?.treatmentCaseId || '',
    amount: initialData?.amount || 0,
    currency: initialData?.currency || 'TRY',
    paymentMethod: initialData?.paymentMethod || 'cash',
    paymentStatus: initialData?.paymentStatus || 'paid',
    paidAt: initialData?.paidAt ? new Date(initialData.paidAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    notes: initialData?.notes || '',
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const patientsRes = await patientService.getAll();
        setPatients(patientsRes.data);
        
        if (formData.patientId) {
          const tcRes = await treatmentCaseService.getAll({ patientId: formData.patientId });
          setTreatmentCases(tcRes.data);
        }
      } catch (err) {
        console.error('Failed to fetch form data:', err);
      }
    };
    fetchData();
  }, [formData.patientId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (initialData?.id) {
        await paymentService.update(initialData.id, formData);
      } else {
        await paymentService.create(formData);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || t('common:errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  const methods = ['cash', 'card', 'bank_transfer', 'cheque', 'other'];
  const statuses = ['pending', 'partial', 'paid', 'refunded', 'cancelled'];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-primary-600 text-white">
          <h2 className="text-xl font-bold">
            {initialData ? t('payments:editPayment') : t('payments:addPayment')}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
              <AlertCircle size={18} />
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Patient Selector */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <User size={16} className="text-gray-400" />
                {t('payments:form.patient')}
              </label>
              <select
                required
                className="input-field"
                value={formData.patientId}
                onChange={(e) => setFormData({ ...formData, patientId: e.target.value, treatmentCaseId: '' })}
                disabled={!!patientId}
              >
                <option value="">{t('common:selectPlaceholder')}</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                ))}
              </select>
            </div>

            {/* Treatment Case Selector */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Briefcase size={16} className="text-gray-400" />
                {t('payments:form.treatment')}
              </label>
              <select
                className="input-field"
                value={formData.treatmentCaseId}
                onChange={(e) => setFormData({ ...formData, treatmentCaseId: e.target.value })}
                disabled={!formData.patientId || !!treatmentCaseId}
              >
                <option value="">{t('common:selectPlaceholder')}</option>
                {treatmentCases.map(tc => (
                  <option key={tc.id} value={tc.id}>{tc.title}</option>
                ))}
              </select>
            </div>

            {/* Amount & Currency */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <DollarSign size={16} className="text-gray-400" />
                  {t('payments:form.amount')}
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  className="input-field"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">{t('payments:form.currency')}</label>
                <select
                  className="input-field"
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                >
                  <option value="TRY">TRY</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                  <option value="CHF">CHF</option>
                </select>
              </div>
            </div>

            {/* Method & Status */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <CreditCard size={16} className="text-gray-400" />
                  {t('payments:form.method')}
                </label>
                <select
                  className="input-field"
                  value={formData.paymentMethod}
                  onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                >
                  {methods.map(m => (
                    <option key={m} value={m}>{t(`payments:methods.${m}`)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">{t('payments:form.status')}</label>
                <select
                  className="input-field"
                  value={formData.paymentStatus}
                  onChange={(e) => setFormData({ ...formData, paymentStatus: e.target.value })}
                >
                  {statuses.map(s => (
                    <option key={s} value={s}>{t(`payments:status.${s}`)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Paid At */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Calendar size={16} className="text-gray-400" />
                {t('payments:form.paidAt')}
              </label>
              <input
                type="date"
                className="input-field"
                value={formData.paidAt}
                onChange={(e) => setFormData({ ...formData, paidAt: e.target.value })}
              />
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <FileText size={16} className="text-gray-400" />
                {t('payments:form.notes')}
              </label>
              <textarea
                className="input-field min-h-[60px]"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="..."
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">{t('common:cancel')}</button>
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? <Loader2 className="animate-spin" size={20} /> : t('common:save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PaymentForm;
