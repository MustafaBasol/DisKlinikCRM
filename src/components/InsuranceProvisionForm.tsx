import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { insuranceProvisionService, patientService, treatmentCaseService, userService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

interface InsuranceProvisionFormProps {
  onClose: () => void;
  onSuccess: () => void;
  initialData?: any;
  patientId?: string;
  treatmentCaseId?: string;
  requestedAmount?: number;
  currency?: string;
}

const types = ['sgk', 'tss', 'oss', 'private', 'corporate', 'other'];
const statuses = ['draft', 'pending_documents', 'submitted', 'waiting_response', 'approved', 'partially_approved', 'rejected', 'cancelled'];

const InsuranceProvisionForm: React.FC<InsuranceProvisionFormProps> = ({
  onClose,
  onSuccess,
  initialData,
  patientId,
  treatmentCaseId,
  requestedAmount,
  currency,
}) => {
  const { t } = useTranslation(['insurance', 'common']);
  const { defaultCurrency } = useClinicPreferences();
  const [patients, setPatients] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    patientId: patientId || initialData?.patientId || '',
    treatmentCaseId: treatmentCaseId || initialData?.treatmentCaseId || '',
    insuranceProviderName: initialData?.insuranceProviderName || '',
    insuranceType: initialData?.insuranceType || 'tss',
    policyNumber: initialData?.policyNumber || '',
    provisionNumber: initialData?.provisionNumber || '',
    status: initialData?.status || 'draft',
    requestedAmount: initialData?.requestedAmount ?? requestedAmount ?? 0,
    approvedAmount: initialData?.approvedAmount ?? '',
    patientResponsibilityAmount: initialData?.patientResponsibilityAmount ?? '',
    currency: initialData?.currency || currency || defaultCurrency,
    submittedAt: initialData?.submittedAt ? new Date(initialData.submittedAt).toISOString().slice(0, 10) : '',
    respondedAt: initialData?.respondedAt ? new Date(initialData.respondedAt).toISOString().slice(0, 10) : '',
    rejectionReason: initialData?.rejectionReason || '',
    notes: initialData?.notes || '',
    assignedToId: initialData?.assignedToId || '',
  });

  useEffect(() => {
    const fetchData = async () => {
      const [patientsRes, usersRes] = await Promise.all([
        patientService.getAll(),
        userService.getAll(),
      ]);
      setPatients(patientsRes.data);
      setUsers(usersRes.data);
    };
    fetchData().catch(() => setError(t('insurance:errors.loadFailed')));
  }, []);

  useEffect(() => {
    if (!formData.patientId) {
      setCases([]);
      return;
    }
    treatmentCaseService.getAll({ patientId: formData.patientId })
      .then(res => setCases(res.data))
      .catch(() => setCases([]));
  }, [formData.patientId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    const payload = {
      ...formData,
      treatmentCaseId: formData.treatmentCaseId || null,
      assignedToId: formData.assignedToId || null,
      requestedAmount: Number(formData.requestedAmount),
      approvedAmount: formData.approvedAmount === '' ? null : Number(formData.approvedAmount),
      patientResponsibilityAmount: formData.patientResponsibilityAmount === '' ? null : Number(formData.patientResponsibilityAmount),
      submittedAt: formData.submittedAt || null,
      respondedAt: formData.respondedAt || null,
      policyNumber: formData.policyNumber || null,
      provisionNumber: formData.provisionNumber || null,
      rejectionReason: formData.rejectionReason || null,
      notes: formData.notes || null,
    };

    try {
      if (initialData?.id) {
        await insuranceProvisionService.update(initialData.id, payload);
      } else {
        await insuranceProvisionService.create(payload);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.response?.data?.error || t('insurance:errors.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-primary-600 text-white">
          <div className="flex items-center gap-3">
            <ShieldCheck size={22} />
            <h2 className="text-xl font-bold">{initialData ? t('insurance:editProvision') : t('insurance:newProvision')}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2"><AlertCircle size={16} />{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.patient')} *</label>
              <select required className="input-field mt-1" value={formData.patientId} disabled={!!patientId} onChange={e => setFormData({ ...formData, patientId: e.target.value, treatmentCaseId: '' })}>
                <option value="">{t('common:noData')}</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.treatmentCase')}</label>
              <select className="input-field mt-1" value={formData.treatmentCaseId} disabled={!!treatmentCaseId || !formData.patientId} onChange={e => setFormData({ ...formData, treatmentCaseId: e.target.value })}>
                <option value="">{t('insurance:noTreatmentCase')}</option>
                {cases.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.provider')} *</label>
              <input required className="input-field mt-1" value={formData.insuranceProviderName} onChange={e => setFormData({ ...formData, insuranceProviderName: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.type')} *</label>
              <select className="input-field mt-1" value={formData.insuranceType} onChange={e => setFormData({ ...formData, insuranceType: e.target.value })}>
                {types.map(type => <option key={type} value={type}>{t(`insurance:types.${type}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.status')}</label>
              <select className="input-field mt-1" value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                {statuses.map(status => <option key={status} value={status}>{t(`insurance:statuses.${status}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.assignedTo')}</label>
              <select className="input-field mt-1" value={formData.assignedToId} onChange={e => setFormData({ ...formData, assignedToId: e.target.value })}>
                <option value="">{t('common:noData')}</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.policyNumber')}</label>
              <input className="input-field mt-1" value={formData.policyNumber} onChange={e => setFormData({ ...formData, policyNumber: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.provisionNumber')}</label>
              <input className="input-field mt-1" value={formData.provisionNumber} onChange={e => setFormData({ ...formData, provisionNumber: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.requestedAmount')} *</label>
              <input required type="number" min="0" step="0.01" className="input-field mt-1" value={formData.requestedAmount} onChange={e => setFormData({ ...formData, requestedAmount: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.currency')}</label>
              <select className="input-field mt-1" value={formData.currency} onChange={e => setFormData({ ...formData, currency: e.target.value })}>
                {['TRY', 'EUR', 'USD', 'GBP', 'CAD', 'CHF'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.approvedAmount')}</label>
              <input type="number" min="0" step="0.01" className="input-field mt-1" value={formData.approvedAmount} onChange={e => setFormData({ ...formData, approvedAmount: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.patientResponsibility')}</label>
              <input type="number" min="0" step="0.01" className="input-field mt-1" value={formData.patientResponsibilityAmount} onChange={e => setFormData({ ...formData, patientResponsibilityAmount: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.submittedAt')}</label>
              <input type="date" className="input-field mt-1" value={formData.submittedAt} onChange={e => setFormData({ ...formData, submittedAt: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.respondedAt')}</label>
              <input type="date" className="input-field mt-1" value={formData.respondedAt} onChange={e => setFormData({ ...formData, respondedAt: e.target.value })} />
            </div>
          </div>

          {formData.status === 'rejected' && (
            <div>
              <label className="text-sm font-semibold text-red-600">{t('insurance:fields.rejectionReason')} *</label>
              <textarea required className="input-field mt-1 min-h-[80px]" value={formData.rejectionReason} onChange={e => setFormData({ ...formData, rejectionReason: e.target.value })} />
            </div>
          )}

          <div>
            <label className="text-sm font-semibold text-gray-700">{t('insurance:fields.notes')}</label>
            <textarea className="input-field mt-1 min-h-[80px]" value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} />
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">{t('common:cancel')}</button>
            <button type="submit" disabled={loading} className="flex-1 btn-primary">{loading ? <Loader2 className="animate-spin" size={18} /> : t('common:save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InsuranceProvisionForm;
