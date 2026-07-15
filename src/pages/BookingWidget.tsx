import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, User, Stethoscope, Phone, Mail, MessageSquare, CheckCircle, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { publicBookingService } from '../services/api';
import {
  DEFAULT_CLINIC_OPERATING_PREFERENCES,
  formatCurrencyWithPreference,
  formatDateWithPreference,
} from '../utils/clinicPreferences';
import type { ClinicOperatingPreferences } from '../utils/clinicPreferences';
import {
  normalizePublicSlots,
  selectableTimesForDoctor,
  removeStaleSlot,
  isSlotUnavailableError,
  isSelectedSlotStillOffered,
  type PublicSlot,
} from './bookingWidgetHelpers';

// ── Types ──────────────────────────────────────────────────────────────
interface Service {
  id: string;
  name: string;
  durationMinutes: number;
  basePrice?: number;
  currency?: string;
  category?: string;
  description?: string;
}

interface Doctor {
  id: string;
  firstName: string;
  lastName: string;
  availableWeekdays: number[];
}

interface ClinicInfo {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

interface LegalNotice {
  available: boolean;
  controllerName?: string;
  privacyContact?: string | null;
  noticeText?: string;
  noticeVersion?: string;
  noticeEffectiveDate?: string | null;
}

interface BookingData {
  clinic: ClinicInfo;
  services: Service[];
  doctors: Doctor[];
  operatingPreferences: ClinicOperatingPreferences;
  legalNotice: LegalNotice;
}

type RawObject = Record<string, unknown>;

function isRawObject(value: unknown): value is RawObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((weekday) => readNumber(weekday))
        .filter((weekday): weekday is number => weekday !== undefined && weekday >= 0 && weekday <= 6),
    ),
  );
}

function normalizeClinic(raw: unknown): ClinicInfo | null {
  if (!isRawObject(raw)) return null;
  const id = readString(raw.id);
  const name = readString(raw.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    phone: readString(raw.phone),
    email: readString(raw.email),
    address: readString(raw.address),
  };
}

function normalizeService(raw: unknown): Service | null {
  if (!isRawObject(raw)) return null;
  const id = readString(raw.id);
  const name = readString(raw.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    durationMinutes: readNumber(raw.durationMinutes) ?? 30,
    basePrice: readNumber(raw.basePrice),
    currency: readString(raw.currency),
    category: readString(raw.category),
    description: readString(raw.description),
  };
}

function normalizeDoctor(raw: unknown): Doctor | null {
  if (!isRawObject(raw)) return null;
  const id = readString(raw.id);
  if (!id) return null;

  return {
    id,
    firstName: readString(raw.firstName) ?? '',
    lastName: readString(raw.lastName) ?? '',
    availableWeekdays: readWeekdays(raw.availableWeekdays),
  };
}

function normalizeLegalNotice(raw: unknown): LegalNotice {
  if (!isRawObject(raw) || raw.available !== true) return { available: false };
  const noticeText = readString(raw.noticeText);
  const controllerName = readString(raw.controllerName);
  const noticeVersion = readString(raw.noticeVersion);
  if (!noticeText || !controllerName || !noticeVersion) return { available: false };

  return {
    available: true,
    controllerName,
    privacyContact: readString(raw.privacyContact) ?? null,
    noticeText,
    noticeVersion,
    noticeEffectiveDate: readString(raw.noticeEffectiveDate) ?? null,
  };
}

function normalizeBookingData(payload: unknown): BookingData | null {
  const response = isRawObject(payload) && isRawObject(payload.data) ? payload.data : payload;
  if (!isRawObject(response)) return null;

  const clinic = normalizeClinic(isRawObject(response.clinic) ? response.clinic : response);
  if (!clinic) return null;

  const services = Array.isArray(response.services)
    ? response.services
        .map(normalizeService)
        .filter((service): service is Service => Boolean(service))
    : [];

  const doctors = Array.isArray(response.doctors)
    ? response.doctors
        .map(normalizeDoctor)
        .filter((doctor): doctor is Doctor => Boolean(doctor))
    : [];

  return {
    clinic,
    services,
    doctors,
    operatingPreferences: isRawObject(response.operatingPreferences)
      ? { ...DEFAULT_CLINIC_OPERATING_PREFERENCES, ...response.operatingPreferences }
      : DEFAULT_CLINIC_OPERATING_PREFERENCES,
    legalNotice: normalizeLegalNotice(response.legalNotice),
  };
}

// ── Booking-session identifier (not a patient identifier) ────────────────
// Used only so the backend can idempotently reuse the same notice-evidence
// row across re-renders/refreshes within one browser tab session, instead
// of creating a new evidence row every time. Cleared when the tab session
// ends (sessionStorage), which is an acceptable and intentional boundary
// for a new "notice display" event.
const NOTICE_SESSION_STORAGE_KEY = 'noramedi_booking_notice_session';

function getOrCreateBookingSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(NOTICE_SESSION_STORAGE_KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(NOTICE_SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

const SUPPORTED_NOTICE_LANGUAGES = ['tr', 'en', 'fr', 'de'];

// ── Helpers ────────────────────────────────────────────────────────────
function getNext30Days(preferences: ClinicOperatingPreferences): { date: string; label: string; weekday: number; weekdayName: string }[] {
  const days: { date: string; label: string; weekday: number; weekdayName: string }[] = [];
  const today = new Date();
  for (let i = 1; i <= 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const weekday = d.getDay();
    const dateStr = d.toISOString().split('T')[0];
    const label = formatDateWithPreference(d, preferences);
    const weekdayName = new Intl.DateTimeFormat(preferences.locale, { weekday: 'long', timeZone: preferences.timezone }).format(d);
    days.push({ date: dateStr, label, weekday, weekdayName });
  }
  return days;
}

// ── Step components ────────────────────────────────────────────────────
const StepIndicator: React.FC<{ step: number; total: number }> = ({ step, total }) => (
  <div className="flex items-center justify-center gap-2 mb-6">
    {Array.from({ length: total }).map((_, i) => (
      <React.Fragment key={i}>
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors
            ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}
        >
          {i < step ? '✓' : i + 1}
        </div>
        {i < total - 1 && (
          <div className={`h-0.5 w-8 transition-colors ${i < step ? 'bg-emerald-500' : 'bg-gray-200'}`} />
        )}
      </React.Fragment>
    ))}
  </div>
);

// ── Main Widget ────────────────────────────────────────────────────────
const BookingWidget: React.FC = () => {
  const { t, i18n } = useTranslation(['booking', 'common']);
  const { clinicId: clinicIdParam } = useParams<{ clinicId: string }>();
  const clinicId = clinicIdParam || '';

  const [data, setData] = useState<BookingData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState(0); // 0=service 1=doctor+date 2=contact 3=success

  const [selectedService, setSelectedService] = useState<string>('');
  const [selectedDoctor, setSelectedDoctor] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [selectedSlotPractitionerId, setSelectedSlotPractitionerId] = useState<string>('');
  const [patientName, setPatientName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState('');

  // Real, conflict-checked slots for selectedDate (+ selectedService). Not
  // filtered by doctor client-side (see selectableTimesForDoctor) so switching
  // the doctor chip doesn't require a refetch.
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');

  // Automatic privacy-notice delivery evidence — not a consent/acknowledgment
  // flow. The token is issued silently once the clinic's published notice is
  // known to be displayable; no user action is required to obtain it.
  const [noticeToken, setNoticeToken] = useState('');
  const [noticeReady, setNoticeReady] = useState(false);
  const [showFullNotice, setShowFullNotice] = useState(false);

  useEffect(() => {
    if (!clinicId) { setLoadError(t('booking:errors.invalidLink')); setLoading(false); return; }
    publicBookingService
      .getClinicInfo(clinicId)
      .then((r) => {
        const normalizedData = normalizeBookingData(r.data);
        if (!normalizedData) throw new Error('Invalid public booking response');
        setData(normalizedData);
      })
      .catch(() => setLoadError(t('booking:errors.loadClinic')))
      .finally(() => setLoading(false));
  }, [clinicId, t]);

  useEffect(() => {
    if (!clinicId || !data?.legalNotice.available) return;
    const currentLanguage = i18n.language?.split('-')[0] ?? 'tr';
    const language = SUPPORTED_NOTICE_LANGUAGES.includes(currentLanguage) ? currentLanguage : 'tr';
    const sessionId = getOrCreateBookingSessionId();
    let cancelled = false;
    publicBookingService
      .getNoticeEvidence(clinicId, { sessionId, language })
      .then((r) => {
        if (cancelled) return;
        const token = isRawObject(r.data) ? readString(r.data.token) : undefined;
        if (token) {
          setNoticeToken(token);
          setNoticeReady(true);
        }
      })
      .catch(() => {
        // Leave noticeReady=false — submit stays disabled and the server
        // will safely reject any submission without valid evidence anyway.
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId, data?.legalNotice.available, i18n.language]);

  const fetchSlots = useCallback(() => {
    if (!clinicId || !selectedDate) return;
    setSlotsLoading(true);
    setSlotsError('');
    publicBookingService
      .getSlots(clinicId, { date: selectedDate, serviceId: selectedService || undefined })
      .then((r) => {
        const freshSlots = normalizePublicSlots(r.data);
        setSlots(freshSlots);
        // If a specific (practitioner, time) was selected, it must never
        // silently swap to a different practitioner just because this
        // refresh reordered the underlying slots. Only keep it if the exact
        // tuple is still offered; otherwise clear it explicitly so the
        // customer re-selects rather than submitting a stale pairing.
        if (
          selectedTime &&
          selectedSlotPractitionerId &&
          !isSelectedSlotStillOffered(freshSlots, { practitionerId: selectedSlotPractitionerId, localStartTime: selectedTime })
        ) {
          setSelectedTime('');
          setSelectedSlotPractitionerId('');
        }
      })
      .catch(() => {
        setSlots([]);
        setSlotsError(t('booking:schedule.slotsError'));
      })
      .finally(() => setSlotsLoading(false));
  }, [clinicId, selectedDate, selectedService, t, selectedTime, selectedSlotPractitionerId]);

  useEffect(() => {
    if (!selectedDate) {
      setSlots([]);
      return;
    }
    fetchSlots();
    // Selecting a new date invalidates any previously chosen time.
    setSelectedTime('');
    setSelectedSlotPractitionerId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, selectedDate, selectedService]);

  const preferences = data?.operatingPreferences ?? DEFAULT_CLINIC_OPERATING_PREFERENCES;
  const allDays = getNext30Days(preferences);

  // Filter available days for selected doctor
  const availableDays = allDays.filter((d) => {
    if (!selectedDoctor) return true;
    const doc = data?.doctors.find((x) => x.id === selectedDoctor);
    if (!doc || doc.availableWeekdays.length === 0) return true;
    return doc.availableWeekdays.includes(d.weekday);
  });

  const handleSubmit = async () => {
    if (!patientName.trim() || !phone.trim()) {
      setSubmitError(t('booking:errors.namePhoneRequired'));
      return;
    }
    if (!noticeReady || !noticeToken) {
      setSubmitError(t('booking:notice.notReady'));
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      await publicBookingService.submit(clinicId, {
        patientName: patientName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        serviceId: selectedService || undefined,
        practitionerId: selectedTime ? selectedSlotPractitionerId : selectedDoctor || undefined,
        preferredDate: selectedDate || undefined,
        preferredTime: selectedTime || undefined,
        notes: notes.trim() || undefined,
        noticeEvidenceToken: noticeToken,
      });
      setStep(3);
    } catch (err) {
      if (selectedTime && isSlotUnavailableError(err)) {
        // Stale slot — form data (name/phone/email/notes/service/doctor) is
        // intentionally left untouched. Only the rejected time is cleared.
        setSlots((prev) => removeStaleSlot(prev, { practitionerId: selectedSlotPractitionerId, localStartTime: selectedTime }));
        setSelectedTime('');
        setSelectedSlotPractitionerId('');
        setRecoveryNotice(t('booking:errors.slotUnavailable'));
        setStep(1);
        fetchSlots();
      } else {
        setSubmitError(t('booking:errors.submitFailed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-emerald-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center p-8">
          <p className="text-red-500 font-medium">{loadError || t('booking:errors.loading')}</p>
        </div>
      </div>
    );
  }

  // No published privacy notice for this clinic — do not collect or submit
  // any patient data. Neutral message only; no internal configuration
  // details are exposed.
  if (!data.legalNotice.available) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center p-8 max-w-sm">
          <p className="text-gray-700 font-medium">{t('booking:notice.unavailable')}</p>
          {data.clinic.phone && (
            <p className="text-sm text-gray-400 mt-3">
              <a href={`tel:${data.clinic.phone}`} className="text-blue-600 hover:underline">{data.clinic.phone}</a>
            </p>
          )}
        </div>
      </div>
    );
  }

  const { clinic, services, doctors, legalNotice } = data;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <Stethoscope size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">{clinic.name}</h1>
            <p className="text-xs text-gray-500">{t('booking:header.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        {step < 3 && <StepIndicator step={step} total={3} />}

        {/* ── Step 0: Select service ── */}
        {step === 0 && (
          <div>
            <h2 className="text-xl font-semibold text-gray-800 mb-1">{t('booking:service.title')}</h2>
            <p className="text-sm text-gray-500 mb-4">{t('booking:service.subtitle')}</p>
            <div className="space-y-2">
              {services.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedService(s.id); setStep(1); }}
                  className="w-full flex items-center justify-between p-4 bg-white rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:shadow-sm transition-all text-left group"
                >
                  <div>
                    <p className="font-medium text-gray-800 group-hover:text-blue-700">{s.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t('booking:service.duration', { minutes: s.durationMinutes })}
                      {s.basePrice ? ` • ${formatCurrencyWithPreference(s.basePrice, preferences, s.currency ?? preferences.currency)}` : ''}
                    </p>
                  </div>
                  <ChevronRight size={18} className="text-gray-300 group-hover:text-blue-500" />
                </button>
              ))}
              {services.length === 0 && (
                <p className="text-gray-500 text-center py-4">{t('booking:service.empty')}</p>
              )}
              <button
                onClick={() => { setSelectedService(''); setStep(1); }}
                className="w-full py-3 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              >
                {t('booking:service.continueWithoutService')}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: Doctor + date + time ── */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <button onClick={() => setStep(0)} className="text-sm text-blue-600 hover:underline mb-2">← {t('common:back')}</button>
              <h2 className="text-xl font-semibold text-gray-800 mb-1">{t('booking:schedule.title')}</h2>
              <p className="text-sm text-gray-500">{t('booking:schedule.optional')}</p>
            </div>

            {recoveryNotice && (
              <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">{recoveryNotice}</p>
            )}

            {/* Doctor selection */}
            {doctors.length > 0 && (
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                  <User size={14} /> {t('booking:schedule.doctorOptional')}
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedDoctor('')}
                    className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${!selectedDoctor ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}
                  >
                    {t('booking:schedule.anyDoctor')}
                  </button>
                  {doctors.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => { setSelectedDoctor(d.id); setSelectedDate(''); }}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${selectedDoctor === d.id ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}
                    >
                      Dr. {d.firstName} {d.lastName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Date selection */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                <Calendar size={14} /> {t('booking:schedule.dateOptional')}
              </label>
              <div className="grid grid-cols-3 gap-2 max-h-52 overflow-y-auto pr-1">
                {availableDays.map(({ date, label, weekdayName }) => (
                  <button
                    key={date}
                    onClick={() => setSelectedDate(selectedDate === date ? '' : date)}
                    className={`px-2 py-2 rounded-lg border text-xs transition-colors ${selectedDate === date ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-700 hover:border-blue-400 bg-white'}`}
                  >
                    <span className="block font-medium">{weekdayName}</span>
                    <span className="block text-[10px] opacity-75">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Time slot — real, conflict-checked availability for selectedDate */}
            {selectedDate && (
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                  <Clock size={14} /> {t('booking:schedule.timeOptional')}
                </label>
                {slotsLoading && (
                  <p className="text-sm text-gray-400">{t('booking:schedule.slotsLoading')}</p>
                )}
                {!slotsLoading && slotsError && (
                  <p className="text-sm text-red-500">{slotsError}</p>
                )}
                {!slotsLoading && !slotsError && selectableTimesForDoctor(slots, selectedDoctor).length === 0 && (
                  <p className="text-sm text-gray-400">{t('booking:schedule.slotsEmpty')}</p>
                )}
                {!slotsLoading && !slotsError && (
                  <div className="flex flex-wrap gap-2">
                    {selectableTimesForDoctor(slots, selectedDoctor).map((slot) => (
                      <button
                        key={`${slot.practitionerId}:${slot.localStartTime}`}
                        onClick={() => {
                          setRecoveryNotice('');
                          if (selectedTime === slot.localStartTime && selectedSlotPractitionerId === slot.practitionerId) {
                            setSelectedTime('');
                            setSelectedSlotPractitionerId('');
                          } else {
                            setSelectedTime(slot.localStartTime);
                            setSelectedSlotPractitionerId(slot.practitionerId);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${selectedTime === slot.localStartTime && selectedSlotPractitionerId === slot.practitionerId ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:border-blue-400 bg-white'}`}
                      >
                        {slot.localStartTime}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => { setRecoveryNotice(''); setStep(2); }}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
            >
              {t('booking:actions.continue')} →
            </button>
          </div>
        )}

        {/* ── Step 2: Contact info ── */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <button onClick={() => setStep(1)} className="text-sm text-blue-600 hover:underline mb-2">← {t('common:back')}</button>
              <h2 className="text-xl font-semibold text-gray-800 mb-1">{t('booking:contact.title')}</h2>
              <p className="text-sm text-gray-500">{t('booking:contact.subtitle')}</p>
            </div>

            {/* Summary */}
            <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-800 space-y-1">
              {selectedService && (
                <div>🦷 {services.find((s) => s.id === selectedService)?.name}</div>
              )}
              {selectedDoctor && (
                <div>👨‍⚕️ Dr. {doctors.find((d) => d.id === selectedDoctor)?.firstName} {doctors.find((d) => d.id === selectedDoctor)?.lastName}</div>
              )}
              {selectedDate && <div>📅 {selectedDate}{selectedTime ? ` ${selectedTime}` : ''}</div>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('booking:contact.fullName')} *</label>
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder={t('booking:contact.fullNamePlaceholder')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1"><Phone size={13} />{t('booking:contact.phone')} *</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="05xx xxx xx xx"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1"><Mail size={13} />{t('booking:contact.emailOptional')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ornek@email.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1"><MessageSquare size={13} />{t('booking:contact.noteOptional')}</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('booking:contact.notePlaceholder')}
                rows={3}
                maxLength={500}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Privacy-notice delivery — informational only, no acknowledgment
                or consent control. Evidence that this notice was displayed
                is recorded automatically by the server. */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-500 space-y-1.5">
              <p>
                {t('booking:notice.summary', { controller: legalNotice.controllerName })}
              </p>
              <button
                type="button"
                onClick={() => setShowFullNotice((v) => !v)}
                className="text-blue-600 hover:underline font-medium"
              >
                {showFullNotice ? t('booking:notice.hideFull') : t('booking:notice.viewFull')}
              </button>
              {showFullNotice && (
                <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white border border-gray-200 p-3 text-gray-600">
                  {legalNotice.noticeText}
                </div>
              )}
              <p className="text-[10px] text-gray-400">
                {t('booking:notice.version', { version: legalNotice.noticeVersion })}
              </p>
            </div>

            {submitError && (
              <p className="text-red-500 text-sm bg-red-50 rounded-lg p-3">{submitError}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || !noticeReady}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? <><Loader2 size={18} className="animate-spin" /> {t('booking:actions.submitting')}</> : t('booking:actions.submit')}
            </button>

            <p className="text-xs text-gray-400 text-center">
              {t('booking:contact.disclaimer')}
            </p>
          </div>
        )}

        {/* ── Step 3: Success ── */}
        {step === 3 && (
          <div className="text-center py-12 space-y-4">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle size={40} className="text-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800">{t('booking:success.title')}</h2>
            <p className="text-gray-500 max-w-sm mx-auto">
              {t('booking:success.body', { clinic: clinic.name, phone })}
            </p>
            {clinic.phone && (
              <p className="text-sm text-gray-400">
                {t('booking:success.questions')}: <a href={`tel:${clinic.phone}`} className="text-blue-600 hover:underline">{clinic.phone}</a>
              </p>
            )}
            <button
              onClick={() => { setStep(0); setSelectedService(''); setSelectedDoctor(''); setSelectedDate(''); setSelectedTime(''); setSelectedSlotPractitionerId(''); setRecoveryNotice(''); setPatientName(''); setPhone(''); setEmail(''); setNotes(''); }}
              className="mt-4 px-6 py-2 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {t('booking:success.newAppointment')}
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center py-6 text-xs text-gray-400">
        {clinic.address && <p>{clinic.address}</p>}
        {t('booking:footer.poweredBy')}
      </div>
    </div>
  );
};

export default BookingWidget;
