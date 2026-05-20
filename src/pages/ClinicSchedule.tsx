import { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  UserCheck,
  ChevronLeft,
  Loader2,
  AlertCircle,
  CheckCircle,
  Save,
  Calendar,
} from 'lucide-react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { scheduleService, doctorAvailabilityService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { canManageClinicSchedule } from '../utils/permissions';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkingHoursEntry {
  id: string | null;
  clinicId: string;
  dayOfWeek: number;
  isClosed: boolean;
}

interface Doctor {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isActive: boolean;
}

const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

const DEFAULT_HOURS: WorkingHoursEntry[] = Array.from({ length: 7 }, (_, i) => ({
  id: null,
  clinicId: '',
  dayOfWeek: i,
  isClosed: i === 0, // Pazar kapalı
}));

// ── Component ─────────────────────────────────────────────────────────────────

const ClinicSchedule: React.FC = () => {
  const { clinicId } = useParams<{ clinicId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [tab, setTab] = useState<'hours' | 'doctors'>('hours');
  const [hours, setHours] = useState<WorkingHoursEntry[]>(DEFAULT_HOURS);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [doctorAvailabilities, setDoctorAvailabilities] = useState<Record<string, any[]>>({});
  const [loadingDoctorId, setLoadingDoctorId] = useState<string | null>(null);

  if (!canManageClinicSchedule(user)) {
    return <Navigate to="/" replace />;
  }

  const fetchHours = useCallback(async () => {
    if (!clinicId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await scheduleService.getWorkingHours(clinicId);
      setHours(res.data);
    } catch {
      setError('Çalışma saatleri yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  const fetchDoctors = useCallback(async () => {
    if (!clinicId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await scheduleService.getClinicDoctors(clinicId);
      setDoctors(res.data);
    } catch {
      setError('Doktor listesi yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    if (tab === 'hours') fetchHours();
    else fetchDoctors();
  }, [tab, fetchHours, fetchDoctors]);

  const handleHourChange = (dayOfWeek: number, field: 'isClosed', value: boolean) => {
    setHours(prev =>
      prev.map(h => (h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h))
    );
    setSaveSuccess(false);
  };

  const handleSaveHours = async () => {
    if (!clinicId) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      await scheduleService.updateWorkingHours(
        clinicId,
        hours.map(h => ({
          dayOfWeek: h.dayOfWeek,
          isClosed: h.isClosed,
        }))
      );
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setError('Çalışma saatleri kaydedilemedi');
    } finally {
      setSaving(false);
    }
  };

  const fetchDoctorAvailability = async (doctorId: string) => {
    if (!clinicId) return;
    setLoadingDoctorId(doctorId);
    try {
      const res = await doctorAvailabilityService.getAll({ practitionerId: doctorId, clinicId });
      setDoctorAvailabilities(prev => ({ ...prev, [doctorId]: res.data }));
    } catch {
      // Sessizce başarısız
    } finally {
      setLoadingDoctorId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/branches')}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Klinik Programı</h1>
          <p className="text-sm text-gray-500">Çalışma saatleri ve doktor müsaitlikleri</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6 w-fit">
        <button
          onClick={() => setTab('hours')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'hours'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          <Clock size={16} />
          Çalışma Saatleri
        </button>
        <button
          onClick={() => setTab('doctors')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'doctors'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          <UserCheck size={16} />
          Doktorlar
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Success */}
      {saveSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 text-sm">
          <CheckCircle size={16} />
          Çalışma saatleri başarıyla kaydedildi
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-blue-600" size={28} />
        </div>
      )}

      {/* Working Hours Tab */}
      {!loading && tab === 'hours' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Haftalık Çalışma Saatleri</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Kapalı günlerde randevu oluşturulamaz
            </p>
          </div>

          <div className="divide-y divide-gray-50">
            {hours.map(h => (
              <div key={h.dayOfWeek} className="flex items-center gap-4 px-6 py-3">
                <div className="w-28">
                  <span className={`text-sm font-medium ${h.isClosed ? 'text-gray-400' : 'text-gray-800'}`}>
                    {DAY_NAMES[h.dayOfWeek]}
                  </span>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={h.isClosed}
                    onChange={e => handleHourChange(h.dayOfWeek, 'isClosed', e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-500">Kapalı</span>
                </label>

                {h.isClosed && (
                  <span className="ml-4 text-sm text-gray-400 italic">Kapalı gün</span>
                )}
              </div>
            ))}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
            <button
              onClick={handleSaveHours}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Kaydet
            </button>
          </div>
        </div>
      )}

      {/* Doctors Tab */}
      {!loading && tab === 'doctors' && (
        <div className="space-y-4">
          {doctors.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <UserCheck size={32} className="mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500 text-sm">Bu klinike atanmış doktor bulunmuyor</p>
              <p className="text-gray-400 text-xs mt-1">
                Kullanıcı yönetiminden doktor ataması yapabilirsiniz
              </p>
            </div>
          ) : (
            doctors.map(doc => (
              <div key={doc.id} className="bg-white rounded-xl border border-gray-200">
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-700 font-semibold text-sm">
                        {doc.firstName[0]}{doc.lastName[0]}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-800 text-sm">
                        Dr. {doc.firstName} {doc.lastName}
                      </p>
                      <p className="text-xs text-gray-400">{doc.email}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => fetchDoctorAvailability(doc.id)}
                    disabled={loadingDoctorId === doc.id}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors disabled:opacity-50"
                  >
                    {loadingDoctorId === doc.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Calendar size={12} />
                    )}
                    Programını Görüntüle
                  </button>
                </div>

                {doctorAvailabilities[doc.id] && (
                  <div className="px-5 pb-4">
                    <div className="border-t border-gray-50 pt-3">
                      {doctorAvailabilities[doc.id].length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Program tanımlı değil</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {[0, 1, 2, 3, 4, 5, 6].map(day => {
                            const slots = doctorAvailabilities[doc.id].filter(
                              (s: any) => s.weekday === day
                            );
                            if (slots.length === 0) return null;
                            return (
                              <div key={day} className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                                <p className="text-xs font-semibold text-blue-700 mb-1">
                                  {DAY_NAMES[day]}
                                </p>
                                {slots.map((s: any) => (
                                  <p key={s.id} className="text-xs text-blue-600">
                                    {s.startTime} — {s.endTime}
                                  </p>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ClinicSchedule;
