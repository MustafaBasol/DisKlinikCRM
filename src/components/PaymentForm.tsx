import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, User, Briefcase, DollarSign, Calendar, CreditCard, AlertCircle, Loader2, FileText, Search, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { patientService, treatmentCaseService, paymentService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { getErrorMessage } from '../utils/errors';
import { useAuth } from '../context/AuthContext';

interface PaymentFormProps {
  onClose: () => void;
  onSuccess: () => void;
  initialData?: any;
  patientId?: string;
  treatmentCaseId?: string;
}

const PaymentForm: React.FC<PaymentFormProps> = ({ onClose, onSuccess, initialData, patientId, treatmentCaseId }) => {
  const { t } = useTranslation(['payments', 'common']);
  const { defaultCurrency } = useClinicPreferences();
  const { user } = useAuth();
  const isBillingEdit = !!initialData?.id && (user?.normalizedRole === 'BILLING' || user?.role?.toUpperCase() === 'BILLING');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<any[]>([]);
  const [patientDropdownOpen, setPatientDropdownOpen] = useState(false);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [selectedPatientLabel, setSelectedPatientLabel] = useState('');
  const patientSearchRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [treatmentCases, setTreatmentCases] = useState<any[]>([]);
  const [treatmentCasesLoading, setTreatmentCasesLoading] = useState(false);
  const [treatmentCasesError, setTreatmentCasesError] = useState(false);

  const [formData, setFormData] = useState({
    patientId: patientId || initialData?.patientId || '',
    treatmentCaseId: treatmentCaseId || initialData?.treatmentCaseId || '',
    amount: initialData?.amount || 0,
    currency: initialData?.currency || defaultCurrency,
    paymentMethod: initialData?.paymentMethod || 'cash',
    paymentStatus: initialData?.paymentStatus || 'paid',
    paidAt: initialData?.paidAt ? new Date(initialData.paidAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    notes: initialData?.notes || '',
  });

  // Load initial patient name when editing or when patientId is pre-set
  useEffect(() => {
    const presetId = patientId || initialData?.patientId;
    if (!presetId) return;
    patientService.getById(presetId)
      .then(r => {
        const p = r.data;
        setSelectedPatientLabel(`${p.firstName} ${p.lastName}`);
      })
      .catch(() => {});
  }, []);

  // Debounced patient search
  const searchPatients = useCallback((q: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!q.trim()) {
      setPatientResults([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setPatientSearchLoading(true);
      try {
        const res = await patientService.getAll({ search: q, limit: 20 });
        setPatientResults(res.data || []);
      } catch {
        setPatientResults([]);
      } finally {
        setPatientSearchLoading(false);
      }
    }, 300);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (patientSearchRef.current && !patientSearchRef.current.contains(e.target as Node)) {
        setPatientDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch treatment cases when patient changes (restricted financial selector — safe for BILLING)
  useEffect(() => {
    if (!formData.patientId) {
      setTreatmentCases([]);
      setTreatmentCasesError(false);
      return;
    }
    setTreatmentCasesLoading(true);
    setTreatmentCasesError(false);
    treatmentCaseService.getFinancialSelect({ patientId: formData.patientId })
      .then(r => setTreatmentCases(r.data || []))
      .catch(() => {
        setTreatmentCases([]);
        setTreatmentCasesError(true);
      })
      .finally(() => setTreatmentCasesLoading(false));
  }, [formData.patientId]);

  const validate = (): string | null => {
    if (!formData.patientId) return t('payments:form.errors.patientRequired');
    if (!formData.amount || formData.amount <= 0) return t('payments:form.errors.amountInvalid');
    if (!formData.paymentMethod) return t('payments:form.errors.methodRequired');
    if (!formData.paidAt) return t('payments:form.errors.paidAtRequired');
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const normalizedTreatmentCaseId = formData.treatmentCaseId || undefined;
      const basePayload = { ...formData, treatmentCaseId: normalizedTreatmentCaseId };
      if (initialData?.id) {
        const updatePayload = isBillingEdit
          ? { amount: formData.amount, currency: formData.currency, paymentMethod: formData.paymentMethod, paymentStatus: formData.paymentStatus, paidAt: formData.paidAt, notes: formData.notes }
          : basePayload;
        await paymentService.update(initialData.id, updatePayload);
      } else {
        await paymentService.create(basePayload);
      }
      onSuccess();
    } catch (err) {
      const msg = getErrorMessage(err, t('payments:form.errors.saveFailed'));
      const lowerMsg = msg.toLowerCase();
      if (lowerMsg.includes('uuid') || lowerMsg.includes('treatment case') || lowerMsg.includes('invalid treatment')) {
        setError(t('payments:form.errors.treatmentCaseInvalid'));
      } else {
        setError(msg);
      }
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
            <div className="space-y-1" ref={patientSearchRef}>
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <User size={16} className="text-gray-400" />
                {t('payments:form.patient')}
              </label>
              {isBillingEdit || patientId ? (
                <div className="input-field text-gray-700">{selectedPatientLabel}</div>
              ) : (
                <div className="relative">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      required={!formData.patientId}
                      className="input-field pl-9 pr-8"
                      placeholder={t('common:selectPlaceholder')}
                      value={patientDropdownOpen ? patientSearch : selectedPatientLabel}
                      onFocus={() => {
                        setPatientDropdownOpen(true);
                        setPatientSearch('');
                        setPatientResults([]);
                      }}
                      onChange={(e) => {
                        setPatientSearch(e.target.value);
                        searchPatients(e.target.value);
                      }}
                    />
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    {/* Hidden input to satisfy form required validation */}
                    <input type="text" required value={formData.patientId} onChange={() => {}} className="sr-only" tabIndex={-1} />
                  </div>
                  {patientDropdownOpen && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                      {patientSearchLoading && (
                        <div className="flex items-center justify-center py-3 text-gray-400">
                          <Loader2 size={16} className="animate-spin" />
                        </div>
                      )}
                      {!patientSearchLoading && patientSearch && patientResults.length === 0 && (
                        <div className="px-4 py-3 text-sm text-gray-400">{t('common:noResultsFound')}</div>
                      )}
                      {!patientSearchLoading && !patientSearch && (
                        <div className="px-4 py-3 text-sm text-gray-400">{t('common:typeToSearch')}</div>
                      )}
                      {patientResults.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          className="w-full text-left px-4 py-2.5 text-sm hover:bg-primary-50 hover:text-primary-700 transition-colors"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setFormData({ ...formData, patientId: p.id, treatmentCaseId: '' });
                            setSelectedPatientLabel(`${p.firstName} ${p.lastName}`);
                            setPatientDropdownOpen(false);
                            setPatientSearch('');
                          }}
                        >
                          <span className="font-medium">{p.firstName} {p.lastName}</span>
                          {p.phone && <span className="ml-2 text-gray-400">{p.phone}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Treatment Case Selector */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Briefcase size={16} className="text-gray-400" />
                {t('payments:form.treatment')}
              </label>
              {isBillingEdit ? (
                <div className="input-field text-gray-500 cursor-not-allowed">
                  {formData.treatmentCaseId
                    ? (treatmentCases.find(tc => tc.id === formData.treatmentCaseId)?.title
                        || initialData?.treatmentCase?.title
                        || formData.treatmentCaseId)
                    : t('payments:form.noTreatmentCases')}
                </div>
              ) : (
                <>
                  <select
                    className="input-field"
                    value={formData.treatmentCaseId}
                    onChange={(e) => setFormData({ ...formData, treatmentCaseId: e.target.value })}
                    disabled={!formData.patientId || !!treatmentCaseId || treatmentCasesLoading}
                  >
                    <option value="">{t('common:selectPlaceholder')}</option>
                    {treatmentCases.map(tc => (
                      <option key={tc.id} value={tc.id}>{tc.title}</option>
                    ))}
                  </select>
                  {treatmentCasesLoading && (
                    <p className="text-xs text-gray-400">{t('common:loading')}</p>
                  )}
                  {!treatmentCasesLoading && treatmentCasesError && (
                    <p className="text-xs text-red-500">{t('payments:form.treatmentLoadError')}</p>
                  )}
                  {!treatmentCasesLoading && !treatmentCasesError && formData.patientId && treatmentCases.length === 0 && (
                    <p className="text-xs text-gray-400">{t('payments:form.noTreatmentCases')}</p>
                  )}
                </>
              )}
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
                  min="0.01"
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
                  <option value="CAD">CAD</option>
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
