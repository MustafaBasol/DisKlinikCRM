import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { patientService } from '../services/api';
import { useTranslation } from 'react-i18next';
import { useClinic } from '../context/ClinicContext';

interface PatientFormProps {
  patient?: any;
  onClose: () => void;
  onSuccess: () => void;
}

const PatientForm: React.FC<PatientFormProps> = ({ patient, onClose, onSuccess }) => {
  const { t } = useTranslation(['patients', 'common']);
  const { selectedClinicId } = useClinic();
  const [phoneDuplicates, setPhoneDuplicates] = useState<Array<{ id: string; firstName: string; lastName: string }>>([]);
  const phoneCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    address: '',
    city: '',
    postalCode: '',
    country: '',
    patientStatus: 'new',
    source: 'other',
    notes: '',
    communicationConsent: false,
    marketingConsent: false,
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<any>({});

  useEffect(() => {
    if (patient) {
      setFormData({
        ...patient,
        dateOfBirth: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().split('T')[0] : '',
      });
    }
  }, [patient]);

  const checkPhoneDuplicate = (phone: string) => {
    if (phoneCheckTimer.current) clearTimeout(phoneCheckTimer.current);
    if (!phone.trim()) { setPhoneDuplicates([]); return; }
    phoneCheckTimer.current = setTimeout(async () => {
      try {
        const clinicId = selectedClinicId && selectedClinicId !== 'all' ? selectedClinicId : undefined;
        const res = await patientService.checkPhoneDuplicate({
          phone: phone.trim(),
          clinicId,
          excludePatientId: patient?.id,
        });
        setPhoneDuplicates(res.data?.duplicates ?? []);
      } catch {
        setPhoneDuplicates([]);
      }
    }, 500);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFormData(prev => ({ ...prev, [name]: val }));
    if (errors[name]) setErrors((prev: any) => ({ ...prev, [name]: null }));
    if (name === 'phone') checkPhoneDuplicate(value as string);
    if (name === 'dateOfBirth' && value && new Date(value) > new Date()) {
      setErrors((prev: any) => ({ ...prev, dateOfBirth: { _errors: ['t('patients:form.dobFutureError')'] } }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.dateOfBirth && new Date(formData.dateOfBirth) > new Date()) {
      setErrors({ dateOfBirth: { _errors: ['t('patients:form.dobFutureError')'] } });
      return;
    }
    setLoading(true);
    setErrors({});

    try {
      if (patient) {
        await patientService.update(patient.id, formData);
      } else {
        await patientService.create(formData);
      }
      onSuccess();
    } catch (err: any) {
      if (err.response?.status === 400) {
        setErrors(err.response.data.error);
      } else {
        setErrors({ general: t('common:errorGeneric') });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-xl font-bold text-gray-900">{patient ? t('patients:editPatient') : t('patients:addPatient')}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-8 space-y-6 sm:space-y-8">
          {errors.general && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
              <AlertCircle size={18} />
              {errors.general}
            </div>
          )}

          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="label">{t('patients:form.firstName')} *</label>
              <input
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                className={`input-field ${errors.firstName ? 'border-red-500' : ''}`}
                placeholder="Mehmet"
              />
              {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName._errors[0]}</p>}
            </div>
            <div>
              <label className="label">{t('patients:form.lastName')} *</label>
              <input
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                className={`input-field ${errors.lastName ? 'border-red-500' : ''}`}
                placeholder="Aydın"
              />
              {errors.lastName && <p className="text-xs text-red-500 mt-1">{errors.lastName._errors[0]}</p>}
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="label">{t('patients:form.email')}</label>
              <input
                name="email"
                type="email"
                value={formData.email || ''}
                onChange={handleChange}
                className={`input-field ${errors.email ? 'border-red-500' : ''}`}
                placeholder="hasta@example.com"
              />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email._errors[0]}</p>}
            </div>
            <div>
              <label className="label">{t('patients:form.phone')}</label>
              <input
                name="phone"
                value={formData.phone || ''}
                onChange={handleChange}
                className="input-field"
                placeholder="+90 532 000 00 00"
              />
              {phoneDuplicates.length > 0 && (
                <div className="mt-1.5 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <p className="font-medium mb-1">⚠️ Bu telefon numarası başka hastalarda da kayıtlı:</p>
                  <ul className="space-y-0.5 mb-1">
                    {phoneDuplicates.map(d => (
                      <li key={d.id}>• {d.firstName} {d.lastName}</li>
                    ))}
                  </ul>
                  <p className="text-amber-700">Bu durum çocuklar veya aile üyeleri için normaldir. Yine de kaydedebilirsiniz.</p>
                </div>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="label">{t('patients:form.dob')}</label>
              <input
                name="dateOfBirth"
                type="date"
                value={formData.dateOfBirth}
                onChange={handleChange}
                max={new Date().toISOString().split('T')[0]}
                className={`input-field ${errors.dateOfBirth ? 'border-red-500' : ''}`}
              />
              {errors.dateOfBirth && <p className="text-xs text-red-500 mt-1">{errors.dateOfBirth._errors[0]}</p>}
            </div>
            <div>
              <label className="label">{t('patients:form.status')}</label>
              <select name="patientStatus" value={formData.patientStatus} onChange={handleChange} className="input-field">
                <option value="new">{t('patients:status.new')}</option>
                <option value="active">{t('patients:status.active')}</option>
                <option value="inactive">{t('patients:status.inactive')}</option>
                <option value="archived">{t('patients:status.archived')}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">{t('patients:form.source')}</label>
            <select name="source" value={formData.source || 'other'} onChange={handleChange} className="input-field">
              <option value="google">Google</option>
              <option value="referral">{t('patients:source.referral')}</option>
              <option value="social_media">{t('patients:source.social_media')}</option>
              <option value="instagram">{t('patients:source.instagram')}</option>
              <option value="website">{t('patients:source.website')}</option>
              <option value="phone">{t('patients:source.phone')}</option>
              <option value="walk_in">{t('patients:source.walk_in')}</option>
              <option value="doctolib">Doctolib</option>
              <option value="other">{t('patients:source.other')}</option>
            </select>
          </div>

          {/* Consents */}
          <div className="space-y-4 pt-4 border-t border-gray-50">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                name="communicationConsent"
                checked={formData.communicationConsent}
                onChange={handleChange}
                className="w-5 h-5 rounded-lg border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700 group-hover:text-gray-900">{t('patients:form.communicationConsent')}</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                name="marketingConsent"
                checked={formData.marketingConsent}
                onChange={handleChange}
                className="w-5 h-5 rounded-lg border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700 group-hover:text-gray-900">{t('patients:form.marketingConsent')}</span>
            </label>
          </div>

          <div className="pt-8 flex gap-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-secondary py-3 justify-center"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 btn-primary py-3 justify-center gap-2"
            >
              {loading && <Loader2 className="animate-spin" size={18} />}
              {patient ? t('common:save') : t('patients:addPatient')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PatientForm;
