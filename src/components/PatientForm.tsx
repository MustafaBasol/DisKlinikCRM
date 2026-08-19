import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { patientService, userService } from '../services/api';
import { useTranslation } from 'react-i18next';
import { useClinic } from '../context/ClinicContext';
import { useAuth } from '../context/AuthContext';
import { normalizeRole, canManagePatientIdentity } from '../utils/permissions';

interface PatientFormProps {
  patient?: any;
  onClose: () => void;
  onSuccess: () => void;
}

// GET /api/users authorize() list (server/src/routes/users.ts) minus DENTIST
// — DENTIST cannot list clinic staff, so the practitioner picker falls back
// to a read-only display for that role. Kept local: this is a UX gate only,
// the server is the real enforcement point.
const PRACTITIONER_PICKER_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'];

const PatientForm: React.FC<PatientFormProps> = ({ patient, onClose, onSuccess }) => {
  const { t } = useTranslation(['patients', 'common']);
  const { selectedClinicId } = useClinic();
  const { user } = useAuth();
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
    gender: '',
    chartNumber: '',
    primaryPractitionerId: '',
    communicationConsent: false,
    marketingConsent: false,
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<any>({});

  // F3-DATA-MIG-TODAY-001-UI-001-R1: T.C. Kimlik No is never part of
  // `formData` / patientService.update() — it goes through the separate,
  // narrowly role-gated identity endpoints. `identityValue` only ever holds
  // what the user is actively typing (create, or an explicit "change" on
  // edit) and is never persisted anywhere client-side (no localStorage).
  const canManageIdentity = canManagePatientIdentity(user);
  const [identityValue, setIdentityValue] = useState('');
  const [identityChangeMode, setIdentityChangeMode] = useState(false);
  const [existingIdentity, setExistingIdentity] = useState<{ present: boolean; maskedValue: string | null } | null>(null);
  const [identityError, setIdentityError] = useState('');

  useEffect(() => {
    if (!patient?.id || !canManageIdentity) { setExistingIdentity(null); return; }
    let cancelled = false;
    patientService.getIdentity(patient.id)
      .then(res => { if (!cancelled) setExistingIdentity(res.data); })
      .catch(() => { if (!cancelled) setExistingIdentity(null); });
    return () => { cancelled = true; };
  }, [patient?.id, canManageIdentity]);

  // The clinic the practitioner picker (and its tenant-scoped fetch) is
  // bound to: the patient's own clinic when editing, or the currently
  // selected branch when creating. Left undefined when creating from an
  // "all branches" view — a picker cannot be tenant-scoped to nothing, so it
  // stays hidden until a specific branch is known (server/src/routes/patients.ts
  // still enforces this even if the UI gate is ever bypassed).
  const targetClinicId: string | undefined = patient?.clinicId
    || (selectedClinicId && selectedClinicId !== 'all' ? selectedClinicId : undefined);
  const canPickPractitioner = PRACTITIONER_PICKER_ROLES.includes(normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false));
  const [practitioners, setPractitioners] = useState<Array<{ id: string; firstName: string; lastName: string }>>([]);
  const [practitionersLoading, setPractitionersLoading] = useState(false);

  useEffect(() => {
    if (!canPickPractitioner || !targetClinicId) {
      setPractitioners([]);
      return;
    }
    let cancelled = false;
    setPractitionersLoading(true);
    userService.getDoctors(targetClinicId)
      .then(res => {
        if (cancelled) return;
        const list = (res.data ?? []).filter((u: any) => u.isActive !== false);
        setPractitioners(list);
      })
      .catch(() => { if (!cancelled) setPractitioners([]); })
      .finally(() => { if (!cancelled) setPractitionersLoading(false); });
    return () => { cancelled = true; };
  }, [canPickPractitioner, targetClinicId]);

  useEffect(() => {
    if (patient) {
      setFormData({
        ...patient,
        dateOfBirth: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString().split('T')[0] : '',
        gender: patient.gender || '',
        chartNumber: patient.chartNumber || '',
        primaryPractitionerId: patient.primaryPractitionerId || '',
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
      setErrors((prev: any) => ({ ...prev, dateOfBirth: { _errors: [t('patients:form.dobFutureError')] } }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.dateOfBirth && new Date(formData.dateOfBirth) > new Date()) {
      setErrors({ dateOfBirth: { _errors: [t('patients:form.dobFutureError')] } });
      return;
    }

    const clientErrors: any = {};
    if (!formData.firstName.trim()) {
      clientErrors.firstName = { _errors: [t('patients:form.firstNameRequired')] };
    }
    if (!formData.lastName.trim()) {
      clientErrors.lastName = { _errors: [t('patients:form.lastNameRequired')] };
    }
    if (formData.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      clientErrors.email = { _errors: [t('patients:form.emailInvalid')] };
    }
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }

    setLoading(true);
    setErrors({});
    setIdentityError('');

    try {
      if (patient) {
        await patientService.update(patient.id, formData);

        // T.C. Kimlik No change is a SEPARATE request against the identity
        // sub-resource, deliberately not bundled into the patient PATCH —
        // an unrelated field edit (e.g. phone) never touches the identity
        // document because this block only runs when the user explicitly
        // opened "change identity number" and typed something.
        if (canManageIdentity && identityChangeMode && identityValue.trim()) {
          try {
            const identityRes = await patientService.putIdentity(patient.id, identityValue.trim());
            setExistingIdentity(identityRes.data);
            setIdentityChangeMode(false);
            setIdentityValue('');
          } catch (identityErr: any) {
            setIdentityError(
              typeof identityErr.response?.data?.error === 'string'
                ? identityErr.response.data.error
                : t('patients:form.identity.saveFailed'),
            );
            setLoading(false);
            return;
          }
        }
      } else {
        const payload = canManageIdentity && identityValue.trim()
          ? { ...formData, tckn: identityValue.trim() }
          : formData;
        await patientService.create(payload);
      }
      onSuccess();
    } catch (err: any) {
      const status = err.response?.status;
      if ((status === 400 || status === 409) && err.response?.data?.error && typeof err.response.data.error === 'object') {
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
                  <p className="font-medium mb-1">⚠️ {t('patients:form.phoneDuplicateTitle')}</p>
                  <ul className="space-y-0.5 mb-1">
                    {phoneDuplicates.map(d => (
                      <li key={d.id}>• {d.firstName} {d.lastName}</li>
                    ))}
                  </ul>
                  <p className="text-amber-700">{t('patients:form.phoneDuplicateBody')}</p>
                </div>
              )}
            </div>
          </div>

          {!formData.email?.trim() && !formData.phone?.trim() && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-800 text-sm">
              <AlertCircle size={16} className="shrink-0" />
              {t('patients:form.noContactInfoWarning')}
            </div>
          )}

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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="label">{t('patients:form.gender')}</label>
              <select name="gender" value={formData.gender || ''} onChange={handleChange} className="input-field">
                <option value="">{t('patients:form.genderUnspecified')}</option>
                <option value="male">{t('patients:gender.male')}</option>
                <option value="female">{t('patients:gender.female')}</option>
                <option value="other">{t('patients:gender.other')}</option>
              </select>
            </div>
            <div>
              <label className="label">{t('patients:form.chartNumber')}</label>
              <input
                name="chartNumber"
                value={formData.chartNumber || ''}
                onChange={handleChange}
                className="input-field"
                placeholder={t('patients:form.chartNumberPlaceholder')}
              />
            </div>
          </div>

          {/* T.C. Kimlik No — F3-DATA-MIG-TODAY-001-UI-001-R1. Sensitive
              identity field: never persisted client-side, autoComplete off,
              read/write gated to canManagePatientIdentity roles only. */}
          {canManageIdentity && (
            <div>
              <label className="label">
                {t('patients:form.identity.label')}
                <span className="ml-2 text-xs font-normal text-gray-400">{t('patients:form.identity.sensitiveHint')}</span>
              </label>
              {!patient ? (
                <input
                  name="tckn"
                  value={identityValue}
                  onChange={(e) => setIdentityValue(e.target.value)}
                  className={`input-field ${errors.tckn ? 'border-red-500' : ''}`}
                  placeholder={t('patients:form.identity.placeholder')}
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={11}
                />
              ) : identityChangeMode ? (
                <div className="space-y-2">
                  <input
                    name="tckn"
                    value={identityValue}
                    onChange={(e) => setIdentityValue(e.target.value)}
                    className="input-field"
                    placeholder={t('patients:form.identity.placeholder')}
                    autoComplete="off"
                    inputMode="numeric"
                    maxLength={11}
                  />
                  <button
                    type="button"
                    onClick={() => { setIdentityChangeMode(false); setIdentityValue(''); setIdentityError(''); }}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    {t('patients:form.identity.cancelChange')}
                  </button>
                </div>
              ) : (
                <div className="input-field bg-gray-50 flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-600">
                    {existingIdentity?.present
                      ? existingIdentity.maskedValue
                      : t('patients:form.identity.notProvided')}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <button type="button" onClick={() => setIdentityChangeMode(true)} className="text-xs text-primary-600 hover:text-primary-700">
                      {t('patients:form.identity.change')}
                    </button>
                  </div>
                </div>
              )}
              {errors.tckn && <p className="text-xs text-red-500 mt-1">{errors.tckn._errors[0]}</p>}
              {identityError && <p className="text-xs text-red-500 mt-1">{identityError}</p>}
            </div>
          )}

          <div>
            <label className="label">{t('patients:form.primaryPractitioner')}</label>
            {canPickPractitioner && targetClinicId ? (
              <>
                <select
                  name="primaryPractitionerId"
                  value={formData.primaryPractitionerId || ''}
                  onChange={handleChange}
                  disabled={practitionersLoading}
                  className={`input-field ${errors.primaryPractitionerId ? 'border-red-500' : ''}`}
                >
                  <option value="">{t('patients:form.primaryPractitionerUnassigned')}</option>
                  {practitioners.map(p => (
                    <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                  ))}
                </select>
                {errors.primaryPractitionerId && <p className="text-xs text-red-500 mt-1">{errors.primaryPractitionerId._errors[0]}</p>}
              </>
            ) : (
              <p className="input-field bg-gray-50 text-gray-500 flex items-center">
                {patient?.primaryPractitioner
                  ? `${patient.primaryPractitioner.firstName} ${patient.primaryPractitioner.lastName}`
                  : t('patients:form.primaryPractitionerUnassigned')}
                {!canPickPractitioner && (
                  <span className="ml-2 text-xs text-gray-400">{t('patients:form.primaryPractitionerReadOnlyHint')}</span>
                )}
              </p>
            )}
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
