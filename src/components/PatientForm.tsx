import React, { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { patientService } from '../services/api';
import { useTranslation } from 'react-i18next';

interface PatientFormProps {
  patient?: any;
  onClose: () => void;
  onSuccess: () => void;
}

const PatientForm: React.FC<PatientFormProps> = ({ patient, onClose, onSuccess }) => {
  const { t } = useTranslation(['patients', 'common']);
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFormData(prev => ({ ...prev, [name]: val }));
    if (errors[name]) setErrors((prev: any) => ({ ...prev, [name]: null }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        setErrors({ general: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.' });
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

        <form onSubmit={handleSubmit} className="p-8 space-y-8">
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
                className="input-field"
              />
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
