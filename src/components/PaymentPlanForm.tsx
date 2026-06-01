import React, { useEffect, useState } from 'react';
import { X, Loader2, Calendar, DollarSign } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { patientService, treatmentCaseService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

interface PaymentPlanFormProps {
  patientId?: string;
  treatmentCaseId?: string;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function toDateInputValue(d: Date): string {
  return d.toISOString().split('T')[0];
}

const PaymentPlanForm: React.FC<PaymentPlanFormProps> = ({ patientId: initPatientId, treatmentCaseId: initTCId, onClose, onSave }) => {
  const { t } = useTranslation(['payments', 'common']);
  const { defaultCurrency, formatCurrency, formatDate: formatDisplayDate } = useClinicPreferences();
  const [saving, setSaving] = useState(false);
  const [patients, setPatients] = useState<any[]>([]);
  const [treatmentCases, setTreatmentCases] = useState<any[]>([]);
  const [loadingTC, setLoadingTC] = useState(false);

  const [patientId, setPatientId] = useState(initPatientId || '');
  const [treatmentCaseId, setTreatmentCaseId] = useState(initTCId || '');
  const [totalAmount, setTotalAmount] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [installmentCount, setInstallmentCount] = useState(3);
  const [firstDueDate, setFirstDueDate] = useState(toDateInputValue(new Date()));
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    patientService.getAll({ limit: 200 }).then(r => setPatients(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!patientId) { setTreatmentCases([]); return; }
    setLoadingTC(true);
    treatmentCaseService.getAll({ patientId })
      .then(r => setTreatmentCases((r.data || []).filter((tc: any) => !['completed', 'lost'].includes(tc.stage))))
      .catch(() => {})
      .finally(() => setLoadingTC(false));
  }, [patientId]);

  // Preview installments
  const preview = React.useMemo(() => {
    const total = parseFloat(totalAmount);
    const count = Math.max(1, Math.min(60, installmentCount));
    if (!total || total <= 0 || !firstDueDate) return [];
    const base = Math.round(total / count * 100) / 100;
    const rem = Math.round((total - base * count) * 100) / 100;
    const first = new Date(firstDueDate + 'T00:00:00');
    return Array.from({ length: count }, (_, i) => ({
      no: i + 1,
      date: toDateInputValue(addMonths(first, i)),
      amount: i === count - 1 ? Math.round((base + rem) * 100) / 100 : base,
    }));
  }, [totalAmount, installmentCount, firstDueDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!patientId) return setError(t('payments:planForm.errors.patientRequired'));
    if (!totalAmount || parseFloat(totalAmount) <= 0) return setError(t('payments:planForm.errors.amountRequired'));
    if (!firstDueDate) return setError(t('payments:planForm.errors.firstDueDateRequired'));

    setSaving(true);
    try {
      await onSave({
        patientId,
        treatmentCaseId: treatmentCaseId || undefined,
        totalAmount: parseFloat(totalAmount),
        currency,
        installmentCount,
        firstDueDate,
        description: description || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || t('payments:planForm.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-gray-100">{t('payments:planForm.newPlan')}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-500">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {/* Patient */}
          {!initPatientId && (
            <div>
              <label className="label">{t('payments:form.patient')} *</label>
              <select className="input-field" value={patientId} onChange={e => { setPatientId(e.target.value); setTreatmentCaseId(''); }} required>
                <option value="">{t('payments:planForm.selectPatient')}</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} — {p.phone || ''}</option>)}
              </select>
            </div>
          )}

          {/* Treatment Case */}
          <div>
            <label className="label">{t('payments:planForm.relatedTreatment')}</label>
            <select className="input-field" value={treatmentCaseId} onChange={e => setTreatmentCaseId(e.target.value)} disabled={!patientId || loadingTC}>
              <option value="">{t('payments:planForm.unlinkedPlan')}</option>
              {treatmentCases.map(tc => <option key={tc.id} value={tc.id}>{tc.title}</option>)}
            </select>
          </div>

          {/* Amount + Currency */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{t('payments:planForm.totalAmount')} *</label>
              <div className="relative">
                <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="number" min="0.01" step="0.01" className="input-field pl-9"
                  placeholder="0.00" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} required />
              </div>
            </div>
            <div>
              <label className="label">{t('payments:form.currency')}</label>
              <select className="input-field" value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="TRY">TRY ₺</option>
                <option value="EUR">EUR €</option>
                <option value="USD">USD $</option>
                <option value="GBP">GBP</option>
                <option value="CAD">CAD</option>
                <option value="CHF">CHF</option>
              </select>
            </div>
          </div>

          {/* Installment Count + First Due Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">{t('payments:planForm.installmentCount')} *</label>
              <input type="number" min={1} max={60} className="input-field"
                value={installmentCount} onChange={e => setInstallmentCount(Math.max(1, parseInt(e.target.value) || 1))} required />
            </div>
            <div>
              <label className="label">{t('payments:planForm.firstDueDate')} *</label>
              <div className="relative">
                <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="date" className="input-field pl-9" value={firstDueDate} onChange={e => setFirstDueDate(e.target.value)} required />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="label">{t('payments:form.notes')}</label>
            <input type="text" className="input-field" placeholder={t('payments:planForm.descriptionPlaceholder')}
              value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          {/* Preview */}
          {preview.length > 0 && (
            <div>
              <label className="label">{t('payments:planForm.preview')}</label>
              <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-500 w-12">#</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">{t('payments:planForm.dueDate')}</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">{t('payments:list.amount')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {preview.slice(0, 12).map(row => (
                      <tr key={row.no}>
                        <td className="px-4 py-2 text-gray-400">{row.no}</td>
                        <td className="px-4 py-2 text-gray-700">{formatDisplayDate(row.date + 'T00:00:00')}</td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-900">
                          {formatCurrency(row.amount, currency)}
                        </td>
                      </tr>
                    ))}
                    {preview.length > 12 && (
                      <tr>
                        <td colSpan={3} className="px-4 py-2 text-center text-gray-400 text-xs">
                          {t('payments:planForm.moreInstallments', { count: preview.length - 12 })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <td colSpan={2} className="px-4 py-2 font-bold text-gray-700">{t('payments:planForm.total')}</td>
                      <td className="px-4 py-2 text-right font-bold text-primary-700">
                        {formatCurrency(parseFloat(totalAmount) || 0, currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">{t('common:cancel')}</button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
              {saving && <Loader2 size={16} className="animate-spin" />}
              {t('payments:planForm.createPlan')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PaymentPlanForm;
