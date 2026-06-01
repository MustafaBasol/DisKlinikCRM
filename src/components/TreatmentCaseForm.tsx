import React, { useState, useEffect } from 'react';
import { X, User, Stethoscope, Briefcase, DollarSign, Calendar, AlertCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { patientService, userService, treatmentCaseService, serviceService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';

interface TreatmentCaseFormProps {
  onClose: () => void;
  onSuccess: () => void;
  initialData?: any;
  patientId?: string;
  practitionerId?: string;
}

const TreatmentCaseForm: React.FC<TreatmentCaseFormProps> = ({ onClose, onSuccess, initialData, patientId, practitionerId }) => {
  const { t } = useTranslation(['treatmentCases', 'common']);
  const { defaultCurrency } = useClinicPreferences();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [patients, setPatients] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
    patientId: patientId || initialData?.patientId || '',
    practitionerId: practitionerId || initialData?.practitionerId || '',
    appointmentTypeId: initialData?.appointmentTypeId || '',
    title: initialData?.title || '',
    description: initialData?.description || '',
    stage: initialData?.stage || 'new',
    estimatedAmount: initialData?.estimatedAmount != null ? String(initialData.estimatedAmount) : '',
    acceptedAmount: initialData?.acceptedAmount != null ? String(initialData.acceptedAmount) : '',
    currency: initialData?.currency || defaultCurrency,
    expectedStartDate: initialData?.expectedStartDate ? new Date(initialData.expectedStartDate).toISOString().split('T')[0] : '',
    lostReason: initialData?.lostReason || '',
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [patientsRes, doctorsRes, servicesRes] = await Promise.all([
          patientService.getAll(),
          userService.getDoctors(),
          serviceService.getAll({ onlyActive: true })
        ]);
        setPatients(patientsRes.data);
        setDoctors(doctorsRes.data);
        setServices(servicesRes.data);
      } catch (err) {
        console.error('Failed to fetch form data:', err);
      }
    };
    fetchData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Basic validation
    if (formData.stage === 'lost' && !formData.lostReason) {
      setError(t('treatmentCases:form.lostReasonRequired', { defaultValue: 'Lost reason is required' }));
      setLoading(false);
      return;
    }

    try {
      if (initialData?.id) {
        await treatmentCaseService.update(initialData.id, {
          ...formData,
          estimatedAmount: parseFloat(formData.estimatedAmount as any) || 0,
          acceptedAmount: parseFloat(formData.acceptedAmount as any) || 0,
        });
      } else {
        await treatmentCaseService.create({
          ...formData,
          estimatedAmount: parseFloat(formData.estimatedAmount as any) || 0,
          acceptedAmount: parseFloat(formData.acceptedAmount as any) || 0,
        });
      }
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || t('common:errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  const stages = [
    'new', 'consultation_scheduled', 'consultation_done', 
    'quote_sent', 'waiting_patient_decision', 'accepted', 
    'in_progress', 'completed', 'lost'
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-primary-600 text-white">
          <h2 className="text-xl font-bold">
            {initialData ? t('treatmentCases:editCase') : t('treatmentCases:newCase')}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
              <AlertCircle size={18} />
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Clinic Service / Title */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Briefcase size={16} className="text-gray-400" />
                  {t('treatmentCases:form.service')}
                </label>
                <select
                  className="input-field"
                  value={formData.appointmentTypeId}
                  onChange={(e) => {
                    const val = e.target.value;
                    const service = services.find(s => s.id === val);
                    if (service) {
                      setFormData(prev => ({
                        ...prev,
                        appointmentTypeId: val,
                        title: prev.title || service.name,
                        estimatedAmount: prev.estimatedAmount || String(service.basePrice || ''),
                        currency: service.currency || prev.currency
                      }));
                    } else {
                      setFormData(prev => ({ ...prev, appointmentTypeId: val }));
                    }
                  }}
                >
                  <option value="">{t('treatmentCases:form.noSpecificService')}</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Briefcase size={16} className="text-gray-400" />
                  {t('treatmentCases:form.title')} *
                </label>
                <input
                  required
                  className="input-field"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder={t('treatmentCases:form.title')}
                />
              </div>
            </div>

            {/* Patient & Practitioner */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <User size={16} className="text-gray-400" />
                  {t('treatmentCases:form.patient')}
                </label>
                <select
                  required
                  className="input-field"
                  value={formData.patientId}
                  onChange={(e) => setFormData({ ...formData, patientId: e.target.value })}
                  disabled={!!patientId}
                >
                  <option value="">{t('common:selectPlaceholder')}</option>
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Stethoscope size={16} className="text-gray-400" />
                  {t('treatmentCases:form.practitioner')}
                </label>
                <select
                  className="input-field"
                  value={formData.practitionerId}
                  onChange={(e) => setFormData({ ...formData, practitionerId: e.target.value })}
                  disabled={!!practitionerId}
                >
                  <option value="">{t('common:selectPlaceholder')}</option>
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Stage */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">{t('treatmentCases:form.stage')}</label>
              <select
                className="input-field"
                value={formData.stage}
                onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
              >
                {stages.map(s => (
                  <option key={s} value={s}>{t(`treatmentCases:stages.${s}`)}</option>
                ))}
              </select>
            </div>

            {/* Amounts */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <DollarSign size={16} className="text-gray-400" />
                  {t('treatmentCases:form.estimatedAmount')}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input-field"
                  placeholder="0"
                  value={formData.estimatedAmount}
                  onChange={(e) => setFormData({ ...formData, estimatedAmount: e.target.value })}
                  onFocus={(e) => { if (e.target.value === '0') e.target.select(); }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <DollarSign size={16} className="text-gray-400" />
                  {t('treatmentCases:form.acceptedAmount')}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input-field"
                  placeholder="0"
                  value={formData.acceptedAmount}
                  onChange={(e) => setFormData({ ...formData, acceptedAmount: e.target.value })}
                  onFocus={(e) => { if (e.target.value === '0') e.target.select(); }}
                />
              </div>
            </div>

            {/* Currency & Date */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">{t('treatmentCases:form.currency')}</label>
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
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Calendar size={16} className="text-gray-400" />
                  {t('treatmentCases:form.expectedStartDate')}
                </label>
                <input
                  type="date"
                  className="input-field"
                  value={formData.expectedStartDate}
                  onChange={(e) => setFormData({ ...formData, expectedStartDate: e.target.value })}
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">{t('treatmentCases:form.description')}</label>
              <textarea
                className="input-field min-h-[80px]"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="..."
              />
            </div>

            {/* Lost Reason */}
            {formData.stage === 'lost' && (
              <div className="space-y-1 animate-in slide-in-from-top-2 duration-200">
                <label className="text-sm font-semibold text-red-600">{t('treatmentCases:form.lostReason')}</label>
                <textarea
                  required
                  className="input-field border-red-200 focus:ring-red-500"
                  value={formData.lostReason}
                  onChange={(e) => setFormData({ ...formData, lostReason: e.target.value })}
                  placeholder={t('treatmentCases:form.lostReason')}
                />
              </div>
            )}
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

export default TreatmentCaseForm;
