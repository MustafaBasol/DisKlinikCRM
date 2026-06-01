import React, { useEffect, useMemo, useState } from 'react';
import { X, Calendar, Clock, User, Stethoscope, Loader2, AlertCircle, Briefcase, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import {
  appointmentService,
  instagramInboxService,
  noShowService,
  patientService,
  scheduleService,
  serviceService,
  treatmentCaseService,
  userService,
} from '../services/api';
import { formatTimeInTimeZone, getDateKeyInTimeZone } from '../utils/dateTime';

export interface AppointmentFormPrefill {
  patientId?: string;
  practitionerId?: string;
  appointmentTypeId?: string;
  clinicId?: string;
  source?: string;
  previousAppointmentId?: string;
  instagramInboxEntryId?: string;
}

interface AppointmentFormProps {
  onClose: () => void;
  onSuccess: () => void;
  initialData?: any;
  prefill?: AppointmentFormPrefill;
}

interface AvailableSlot {
  start: string;
  end: string;
  startTime?: string;
  endTime?: string;
}

type SlotReason = 'doctor_availability_missing' | 'clinic_closed' | 'off_day' | string;

const toDateInputValue = (value?: string | Date, timeZone?: string) => {
  if (!value) return new Date().toISOString().split('T')[0];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().split('T')[0];
  return getDateKeyInTimeZone(parsed, timeZone);
};

const toTimeInputValue = (value?: string | Date, timeZone?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatTimeInTimeZone(parsed, 'en-GB', timeZone);
};

const AppointmentForm: React.FC<AppointmentFormProps> = ({ onClose, onSuccess, initialData, prefill }) => {
  const { t } = useTranslation(['appointments', 'common']);
  const { formatDate, formatDateTime, formatTime } = useClinicPreferences();
  const { user } = useAuth();
  const { availableClinics, selectedClinicId } = useClinic();
  const effectiveClinicId =
    initialData?.clinicId ||
    prefill?.clinicId ||
    (selectedClinicId !== 'all' ? selectedClinicId : user?.clinic?.id);
  const clinicTimeZone =
    availableClinics.find(clinic => clinic.id === effectiveClinicId)?.timezone ||
    user?.clinic?.timezone ||
    'Europe/Paris';
  const isEditMode = Boolean(initialData?.id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityWarning, setAvailabilityWarning] = useState(false);

  const [patients, setPatients] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [treatmentCases, setTreatmentCases] = useState<any[]>([]);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [slotReason, setSlotReason] = useState<SlotReason | null>(null);

  const [prevAppointment, setPrevAppointment] = useState<any>(null);
  const isNoShowReschedule = prefill?.source === 'no_show' && !!prefill?.previousAppointmentId;
  const isInstagramSource = prefill?.source === 'instagram' && !!prefill?.instagramInboxEntryId;

  const initialSelectedSlot = initialData?.startTime && initialData?.endTime
    ? {
        start: toTimeInputValue(initialData.startTime, clinicTimeZone),
        end: toTimeInputValue(initialData.endTime, clinicTimeZone),
        startTime: new Date(initialData.startTime).toISOString(),
        endTime: new Date(initialData.endTime).toISOString(),
      }
    : null;

  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(initialSelectedSlot);

  const [formData, setFormData] = useState({
    patientId: initialData?.patientId || prefill?.patientId || '',
    practitionerId: initialData?.practitionerId || prefill?.practitionerId || '',
    appointmentTypeId: initialData?.appointmentTypeId || prefill?.appointmentTypeId || '',
    date: toDateInputValue(initialData?.startTime, clinicTimeZone),
    notes: initialData?.notes || (isNoShowReschedule && prefill?.previousAppointmentId
      ? `Rescheduled from no-show appointment: ${prefill.previousAppointmentId}`
      : isInstagramSource
        ? t('appointments:form.instagramDefaultNote')
        : ''),
    treatmentCaseId: initialData?.treatmentCaseId || '',
  });

  const selectedPatient = useMemo(
    () => patients.find(patient => patient.id === formData.patientId),
    [patients, formData.patientId],
  );
  const selectedDoctor = useMemo(
    () => doctors.find(doctor => doctor.id === formData.practitionerId),
    [doctors, formData.practitionerId],
  );
  const selectedService = useMemo(
    () => types.find(type => type.id === formData.appointmentTypeId),
    [types, formData.appointmentTypeId],
  );

  const canFetchSlots = Boolean(formData.appointmentTypeId && formData.practitionerId && formData.date);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const clinicId = localStorage.getItem('hcrm_clinic_id');
        const [patientsRes, doctorsRes, typesRes] = await Promise.all([
          patientService.getAll(),
          clinicId && clinicId !== 'all'
            ? scheduleService.getClinicDoctors(clinicId)
            : userService.getDoctors(),
          serviceService.getAll({ onlyActive: true }),
        ]);
        setPatients(patientsRes.data);
        setDoctors(doctorsRes.data);
        setTypes(typesRes.data);

        if (prefill?.practitionerId) {
          const doctorList: any[] = doctorsRes.data;
          const found = doctorList.some((doctor: any) => doctor.id === prefill.practitionerId);
          if (!found) {
            setFormData(prev => ({ ...prev, practitionerId: '' }));
            console.warn('[AppointmentForm] prefill practitionerId not found in clinic doctor list - ignored');
          }
        }
      } catch (err) {
        console.error('Failed to fetch form data:', err);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (!isNoShowReschedule || !prefill?.previousAppointmentId) return;
    appointmentService.getById(prefill.previousAppointmentId)
      .then(res => setPrevAppointment(res.data))
      .catch(() => { /* Optional banner context. */ });
  }, [isNoShowReschedule, prefill?.previousAppointmentId]);

  useEffect(() => {
    if (!formData.patientId) {
      setTreatmentCases([]);
      return;
    }

    treatmentCaseService.getAll({ patientId: formData.patientId })
      .then(res => setTreatmentCases(res.data.filter((tc: any) => tc.deletedAt == null && tc.stage !== 'lost')))
      .catch(() => setTreatmentCases([]));
  }, [formData.patientId]);

  useEffect(() => {
    let isCurrent = true;

    if (!canFetchSlots) {
      setAvailableSlots([]);
      setSlotError(null);
      setSlotReason(null);
      setIsLoadingSlots(false);
      return () => {
        isCurrent = false;
      };
    }

    setIsLoadingSlots(true);
    setSlotError(null);
    setSlotReason(null);

    appointmentService.getAvailableSlots({
      doctorId: formData.practitionerId,
      serviceId: formData.appointmentTypeId,
      date: formData.date,
      excludeAppointmentId: isEditMode ? initialData.id : undefined,
    })
      .then(res => {
        if (!isCurrent) return;
        setAvailableSlots(res.data.slots ?? []);
        setSlotReason(res.data.reason ?? null);
      })
      .catch(() => {
        if (!isCurrent) return;
        setAvailableSlots([]);
        setSlotReason(null);
        setSlotError(t('appointments:form.slotError'));
      })
      .finally(() => {
        if (isCurrent) setIsLoadingSlots(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [canFetchSlots, formData.appointmentTypeId, formData.practitionerId, formData.date, initialData?.id, isEditMode, t]);

  const updateSlotDependency = (patch: Partial<typeof formData>) => {
    setSelectedSlot(null);
    setError(null);
    setFormData(prev => ({ ...prev, ...patch }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const validation = [
      { valid: Boolean(formData.patientId), message: t('appointments:form.patientRequired') },
      { valid: Boolean(formData.appointmentTypeId), message: t('appointments:form.serviceRequired') },
      { valid: Boolean(formData.practitionerId), message: t('appointments:form.practitionerRequired') },
      { valid: Boolean(formData.date), message: t('appointments:form.dateRequired') },
      { valid: Boolean(selectedSlot), message: t('appointments:form.selectSlotValidation') },
    ].find(item => !item.valid);

    if (validation) {
      setError(validation.message);
      setLoading(false);
      return;
    }

    const confirmedSlot = selectedSlot!;
    const fallbackStart = new Date(`${formData.date}T${confirmedSlot.start}`).toISOString();
    const fallbackEnd = new Date(`${formData.date}T${confirmedSlot.end}`).toISOString();

    const payload = {
      patientId: formData.patientId,
      practitionerId: formData.practitionerId,
      appointmentTypeId: formData.appointmentTypeId,
      startTime: confirmedSlot.startTime || fallbackStart,
      endTime: confirmedSlot.endTime || fallbackEnd,
      notes: formData.notes,
      treatmentCaseId: formData.treatmentCaseId || null,
    };

    try {
      if (isEditMode) {
        await appointmentService.update(initialData.id, payload);
      } else {
        await appointmentService.create(payload);
        if (isNoShowReschedule && prefill?.previousAppointmentId) {
          try {
            await noShowService.updateRecoveryStatus(prefill.previousAppointmentId, {
              status: 'recovered',
              note: t('appointments:form.noShowRecoveredNote'),
            });
            window.dispatchEvent(new CustomEvent('noShowRecovered'));
          } catch {
            console.warn('Could not auto-update no-show recovery status to recovered');
          }
        }
        if (isInstagramSource && prefill?.instagramInboxEntryId) {
          try {
            await instagramInboxService.markConverted(prefill.instagramInboxEntryId);
          } catch {
            console.warn('Could not mark Instagram inbox entry as converted');
          }
        }
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

  const slotMessage = !canFetchSlots
    ? t('appointments:form.slotPrerequisite')
    : isLoadingSlots
      ? t('appointments:form.loadingSlots')
      : slotError
        ? slotError
        : slotReason === 'doctor_availability_missing'
          ? t('appointments:form.doctorAvailabilityMissing')
          : slotReason === 'clinic_closed'
            ? t('appointments:form.clinicClosed')
            : slotReason === 'off_day'
              ? t('appointments:form.doctorOffDay')
              : availableSlots.length === 0
                ? t('appointments:form.noSlots')
                : null;
  const isNoSlotState = canFetchSlots && !isLoadingSlots && !slotError && !slotReason && availableSlots.length === 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(100vh-1.5rem)] overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
        <div className="p-5 sm:p-6 border-b border-primary-500/30 flex items-start justify-between gap-4 bg-primary-600 text-white">
          <div>
            <h2 className="text-xl font-bold">
              {isEditMode ? t('appointments:editAppointment') : t('appointments:newAppointment')}
            </h2>
            <p className="mt-1 text-sm text-white/80">
              {t('appointments:form.helperText')}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="p-5 sm:p-6 space-y-5 overflow-y-auto">
          {isNoShowReschedule && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-700/50 dark:text-amber-200">
              <Info size={16} className="mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold mb-0.5">{t('appointments:form.noShowRescheduleTitle')}</div>
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  {t('appointments:form.noShowRescheduleBody')}
                  {prevAppointment && (
                    <span>
                      {' '}{t('appointments:form.previousAppointmentDate')}{' '}
                      {formatDateTime(prevAppointment.startTime)}.
                    </span>
                  )}
                  {' '}{t('appointments:form.noShowRescheduleRecoveryHint')}
                </div>
              </div>
            </div>
          )}

          {isInstagramSource && (
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl flex items-start gap-2.5 text-sm text-purple-800 dark:bg-purple-900/20 dark:border-purple-700/50 dark:text-purple-200">
              <Info size={16} className="mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold mb-0.5">{t('appointments:form.instagramSourceTitle')}</div>
                <div className="text-xs text-purple-700 dark:text-purple-300">
                  {t('appointments:form.instagramSourceBody')}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
              <AlertCircle size={18} />
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
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
                {patients.map(patient => (
                  <option key={patient.id} value={patient.id}>
                    {patient.firstName} {patient.lastName}
                  </option>
                ))}
              </select>
            </div>

            {treatmentCases.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                  <Briefcase size={16} className="text-gray-400" />
                  {t('appointments:form.treatmentCase')} <span className="text-gray-400 font-normal">({t('appointments:form.optional')})</span>
                </label>
                <select
                  className="input-field"
                  value={formData.treatmentCaseId}
                  onChange={(e) => setFormData({ ...formData, treatmentCaseId: e.target.value })}
                >
                  <option value="">{t('appointments:form.selectTreatmentCaseOptional')}</option>
                  {treatmentCases.map(tc => (
                    <option key={tc.id} value={tc.id}>{tc.title}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                  <Clock size={16} className="text-gray-400" />
                  {t('appointments:form.selectType')}
                </label>
                <select
                  required
                  className="input-field"
                  value={formData.appointmentTypeId}
                  onChange={(e) => updateSlotDependency({ appointmentTypeId: e.target.value })}
                >
                  <option value="">{t('common:selectPlaceholder')}</option>
                  {types.map(type => (
                    <option key={type.id} value={type.id}>
                      {type.name} ({type.durationMinutes} dk) {type.basePrice ? `- ${type.basePrice} ${type.currency}` : ''}
                    </option>
                  ))}
                </select>
                {selectedService?.basePrice !== null && selectedService?.basePrice !== undefined && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('appointments:form.basePrice')}: {selectedService.basePrice} {selectedService.currency}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                  <Stethoscope size={16} className="text-gray-400" />
                  {t('appointments:form.selectPractitioner')}
                </label>
                <select
                  required
                  className="input-field"
                  value={formData.practitionerId}
                  onChange={(e) => updateSlotDependency({ practitionerId: e.target.value })}
                >
                  <option value="">{t('common:selectPlaceholder')}</option>
                  {doctors.map(doctor => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.firstName} {doctor.lastName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5 sm:max-w-xs">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
                <Calendar size={16} className="text-gray-400" />
                {t('common:date')}
              </label>
              <input
                type="date"
                required
                className="input-field"
                value={formData.date}
                onChange={(e) => updateSlotDependency({ date: e.target.value })}
              />
            </div>

            <section className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-900/30">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    {t('appointments:form.availableSlots')}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {selectedService
                      ? t('appointments:form.durationInfo', { minutes: selectedService.durationMinutes })
                      : t('appointments:form.selectServiceDurationHint')}
                  </p>
                </div>
                {availableSlots.length > 0 && !isLoadingSlots && !slotError && !slotReason && (
                  <button
                    type="button"
                    onClick={() => setSelectedSlot(availableSlots[0])}
                    className="inline-flex items-center justify-center rounded-lg border border-primary-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 dark:border-primary-500/40 dark:bg-gray-800 dark:text-primary-200"
                  >
                    {t('appointments:form.selectEarliestSlot')}
                  </button>
                )}
              </div>

              {slotMessage ? (
                <div className={`rounded-xl border px-3 py-3 text-sm ${
                  slotError
                    ? 'border-red-100 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200'
                    : 'border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`}>
                  <div className="flex items-center gap-2">
                    {isLoadingSlots && <Loader2 className="animate-spin text-primary-600" size={16} />}
                    <span>{slotMessage}</span>
                  </div>
                  {isNoSlotState && (
                    <p className="mt-1 text-xs opacity-80">{t('appointments:form.noSlotsSuggestion')}</p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {availableSlots.map(slot => {
                    const isSelected = selectedSlot?.start === slot.start && selectedSlot?.end === slot.end;
                    return (
                      <button
                        key={`${slot.start}-${slot.end}`}
                        type="button"
                        onClick={() => setSelectedSlot(slot)}
                        className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition-all ${
                          isSelected
                            ? 'border-primary-600 bg-primary-600 text-white shadow-md shadow-primary-200 dark:shadow-none'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-primary-300 hover:bg-primary-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700'
                        }`}
                        aria-pressed={isSelected}
                      >
                        {slot.start}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {selectedSlot && (
              <section className="rounded-2xl border border-primary-100 bg-primary-50/70 p-4 text-sm dark:border-primary-500/30 dark:bg-primary-500/10">
                <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-3">
                  {t('appointments:form.summaryTitle')}
                </h3>
                <div className="grid gap-2 text-gray-700 dark:text-gray-200">
                  <div>
                    <span className="font-semibold">{t('appointments:form.summaryPatient')}:</span>{' '}
                    {selectedPatient ? `${selectedPatient.firstName} ${selectedPatient.lastName}` : t('appointments:form.notSelected')}
                  </div>
                  <div>
                    <span className="font-semibold">{t('appointments:form.summaryService')}:</span>{' '}
                    {selectedService ? `${selectedService.name} · ${selectedService.durationMinutes} dk` : t('appointments:form.notSelected')}
                  </div>
                  <div>
                    <span className="font-semibold">{t('appointments:form.summaryPractitioner')}:</span>{' '}
                    {selectedDoctor ? `${selectedDoctor.firstName} ${selectedDoctor.lastName}` : t('appointments:form.notSelected')}
                  </div>
                  <div>
                    <span className="font-semibold">{t('appointments:form.summaryDateTime')}:</span>{' '}
                    {formatDate(`${formData.date}T00:00:00`)} · {selectedSlot.startTime ? formatTime(selectedSlot.startTime) : selectedSlot.start} - {selectedSlot.endTime ? formatTime(selectedSlot.endTime) : selectedSlot.end}
                  </div>
                </div>
              </section>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                {t('appointments:form.notes')}
              </label>
              <textarea
                className="input-field min-h-[90px]"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="..."
              />
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 btn-secondary justify-center"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 btn-primary justify-center"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                isEditMode ? t('appointments:form.saveChanges') : t('appointments:form.createSubmit')
              )}
            </button>
          </div>
        </form>
      </div>
      {availabilityWarning && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 flex-shrink-0">
                <AlertCircle size={22} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('appointments:availabilityWarning.title')}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{t('appointments:availabilityWarning.description')}</p>
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
