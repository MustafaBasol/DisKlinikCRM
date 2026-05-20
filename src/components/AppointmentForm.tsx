import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, User, Stethoscope, Loader2, AlertCircle, Briefcase } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { patientService, userService, serviceService, appointmentService, treatmentCaseService, scheduleService } from '../services/api';

interface AppointmentFormProps {
  onClose: () => void;
  onSuccess: () => void;
  initialData?: any;
}

const AppointmentForm: React.FC<AppointmentFormProps> = ({ onClose, onSuccess, initialData }) => {
  const { t } = useTranslation(['appointments', 'common']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityWarning, setAvailabilityWarning] = useState(false);
  
  const [patients, setPatients] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [treatmentCases, setTreatmentCases] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
    patientId: initialData?.patientId || '',
    practitionerId: initialData?.practitionerId || '',
    appointmentTypeId: initialData?.appointmentTypeId || '',
    date: initialData?.startTime ? new Date(initialData.startTime).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    startTime: initialData?.startTime ? new Date(initialData.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '09:00',
    endTime: initialData?.endTime ? new Date(initialData.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '09:30',
    notes: initialData?.notes || '',
    treatmentCaseId: initialData?.treatmentCaseId || '',
  });
  const selectedService = types.find(t => t.id === formData.appointmentTypeId);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const clinicId = localStorage.getItem('hcrm_clinic_id');
        const [patientsRes, doctorsRes, typesRes] = await Promise.all([
          patientService.getAll(),
          clinicId && clinicId !== 'all'
            ? scheduleService.getClinicDoctors(clinicId)
            : userService.getDoctors(),
          serviceService.getAll({ onlyActive: true })
        ]);
        setPatients(patientsRes.data);
        setDoctors(doctorsRes.data);
        setTypes(typesRes.data);
      } catch (err) {
        console.error('Failed to fetch form data:', err);
      }
    };
    fetchData();
  }, []);

  // Load treatment cases when patientId changes
  useEffect(() => {
    if (!formData.patientId) { setTreatmentCases([]); return; }
    treatmentCaseService.getAll({ patientId: formData.patientId })
      .then(res => setTreatmentCases(res.data.filter((tc: any) => tc.deletedAt == null && tc.stage !== 'lost')))
      .catch(() => setTreatmentCases([]));
  }, [formData.patientId]);

  // Auto-calculate end time when type or start time changes
  useEffect(() => {
    if (formData.appointmentTypeId && formData.startTime) {
      const selectedType = types.find(t => t.id === formData.appointmentTypeId);
      if (selectedType) {
        const [hours, minutes] = formData.startTime.split(':').map(Number);
        const startDate = new Date();
        startDate.setHours(hours, minutes, 0);
        const endDate = new Date(startDate.getTime() + selectedType.durationMinutes * 60000);
        setFormData(prev => ({
          ...prev,
          endTime: endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        }));
      }
    }
  }, [formData.appointmentTypeId, formData.startTime, types]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const start = new Date(`${formData.date}T${formData.startTime}`);
    const end = new Date(`${formData.date}T${formData.endTime}`);

    const payload = {
      patientId: formData.patientId,
      practitionerId: formData.practitionerId,
      appointmentTypeId: formData.appointmentTypeId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      notes: formData.notes,
      treatmentCaseId: formData.treatmentCaseId || null,
    };

    try {
      if (initialData?.id) {
        await appointmentService.update(initialData.id, payload);
      } else {
        await appointmentService.create(payload);
      }
      onSuccess();
    } catch (err: any) {
      if (err.response?.data?.code === 'APPOINTMENT_OUTSIDE_AVAILABILITY') {
        setAvailabilityWarning(true);
      } else if (err.response?.status === 409) {
        setError(t('appointments:form.overlapError'));
      } else {
        setError(err.response?.data?.error || t('common:errorGeneric'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-primary-600 text-white">
          <h2 className="text-xl font-bold">
            {initialData ? t('appointments:editAppointment') : t('appointments:newAppointment')}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
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
                {t('appointments:form.selectPatient')}
              </label>
              <select
                required
                className="input-field"
                value={formData.patientId}
                onChange={(e) => setFormData({ ...formData, patientId: e.target.value })}
              >
                <option value="">{t('common:selectPlaceholder')}</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                ))}
              </select>
            </div>

            {/* Treatment Case Selector (optional, shown when patient is selected) */}
            {treatmentCases.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Briefcase size={16} className="text-gray-400" />
                  Tedavi Dosyası <span className="text-gray-400 font-normal">(isteğe bağlı)</span>
                </label>
                <select
                  className="input-field"
                  value={formData.treatmentCaseId}
                  onChange={(e) => setFormData({ ...formData, treatmentCaseId: e.target.value })}
                >
                  <option value="">Tedavi dosyası seçin (isteğe bağlı)</option>
                  {treatmentCases.map(tc => (
                    <option key={tc.id} value={tc.id}>{tc.title}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Practitioner Selector */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Stethoscope size={16} className="text-gray-400" />
                {t('appointments:form.selectPractitioner')}
              </label>
              <select
                required
                className="input-field"
                value={formData.practitionerId}
                onChange={(e) => setFormData({ ...formData, practitionerId: e.target.value })}
              >
                <option value="">{t('common:selectPlaceholder')}</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
                ))}
              </select>
            </div>

            {/* Clinic Service */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Clock size={16} className="text-gray-400" />
                {t('common:service')}
              </label>
              <select
                required
                className="input-field"
                value={formData.appointmentTypeId}
                onChange={(e) => setFormData({ ...formData, appointmentTypeId: e.target.value })}
              >
                <option value="">{t('common:selectPlaceholder')}</option>
                {types.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.durationMinutes} dk) {t.basePrice ? `- ${t.basePrice} ${t.currency}` : ''}
                  </option>
                ))}
              </select>
              {selectedService?.basePrice !== null && selectedService?.basePrice !== undefined && (
                <p className="text-xs text-gray-500">
                  {t('appointments:form.basePrice')}: {selectedService.basePrice} {selectedService.currency}
                </p>
              )}
            </div>

            {/* Date and Time */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="space-y-1 col-span-1">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Calendar size={16} className="text-gray-400" />
                  {t('common:date')}
                </label>
                <input
                  type="date"
                  required
                  className="input-field"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">
                  {t('appointments:form.startTime')}
                </label>
                <input
                  type="time"
                  required
                  className="input-field"
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">
                  {t('appointments:form.endTime')}
                </label>
                <input
                  type="time"
                  required
                  className="input-field"
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">
                {t('appointments:form.notes')}
              </label>
              <textarea
                className="input-field min-h-[80px]"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="..."
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-secondary"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 btn-primary"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : t('common:save')}
            </button>
          </div>
        </form>
      </div>
      {availabilityWarning && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 flex-shrink-0">
                <AlertCircle size={22} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">{t('appointments:availabilityWarning.title')}</h3>
                <p className="text-sm text-gray-600 mt-2">{t('appointments:availabilityWarning.description')}</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setAvailabilityWarning(false)} className="btn-primary">
                {t('appointments:availabilityWarning.ok')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppointmentForm;
