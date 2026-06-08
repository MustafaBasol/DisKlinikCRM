import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, CalendarOff, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { doctorAvailabilityService, doctorOffDayService, userService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { canManageUsers, normalizeRole } from '../utils/permissions';

const weekdays = [1, 2, 3, 4, 5, 6, 0];

const defaultRows = () => weekdays.map(weekday => ({
  weekday,
  startTime: weekday === 6 ? '10:00' : '09:00',
  endTime: weekday === 6 ? '14:00' : '17:30',
  isActive: weekday !== 0,
}));

const DoctorAvailabilityManager: React.FC = () => {
  const { t } = useTranslation(['settings', 'common']);
  const { user } = useAuth();
  const { locale, formatDate } = useClinicPreferences();
  const [doctors, setDoctors] = useState<any[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [rows, setRows] = useState(defaultRows());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Off-day state
  const [offDays, setOffDays] = useState<any[]>([]);
  const [offDayMode, setOffDayMode] = useState<'single' | 'range'>('single');
  const [offDayDate, setOffDayDate] = useState('');
  const [offDayDateEnd, setOffDayDateEnd] = useState('');
  const [offDayReason, setOffDayReason] = useState('');
  const [offDaySaving, setOffDaySaving] = useState(false);
  const [offDayError, setOffDayError] = useState('');

  const canSelectDoctor = canManageUsers(user);
  const userCanonicalRole = normalizeRole(user?.role ?? '', user?.canAccessAllClinics ?? false);
  const selectedDoctor = useMemo(() => doctors.find(d => d.id === selectedDoctorId), [doctors, selectedDoctorId]);

  const formatConflictDate = (date: string) => formatDate(`${date}T00:00:00`);
  const getConflictErrorMessage = (err: any, fallback: string) => {
    const data = err?.response?.data;
    const appointmentCount = Number(data?.appointmentCount || 1);
    const dates = Array.isArray(data?.dates)
      ? data.dates.map((date: string) => formatConflictDate(date)).join(', ')
      : data?.date
        ? formatConflictDate(data.date)
        : '';

    if (data?.code === 'AVAILABILITY_HAS_APPOINTMENTS') {
      return t('settings:availability.errors.appointmentsConflict', {
        count: appointmentCount,
        dates,
      });
    }

    if (data?.code === 'OFF_DAY_HAS_APPOINTMENTS') {
      return t('settings:availability.offDays.errors.appointmentsConflict', {
        count: appointmentCount,
        date: dates,
      });
    }

    return data?.error || fallback;
  };

  useEffect(() => {
    const fetchDoctors = async () => {
      setLoading(true);
      setError('');
      try {
        if (canSelectDoctor) {
          const res = await userService.getDoctors();
          setDoctors(res.data);
          setSelectedDoctorId(res.data[0]?.id || '');
        } else if (userCanonicalRole === 'DENTIST' && user) {
          setDoctors([user]);
          setSelectedDoctorId(user.id);
        }
      } catch {
        setError(t('settings:availability.errors.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    fetchDoctors();
  }, [canSelectDoctor, user, userCanonicalRole, t]);

  useEffect(() => {
    const fetchAvailability = async () => {
      if (!selectedDoctorId) return;
      setLoading(true);
      setError('');
      try {
        const res = await doctorAvailabilityService.getAll({ practitionerId: selectedDoctorId });
        const nextRows = defaultRows();
        for (const slot of res.data) {
          const index = nextRows.findIndex(row => row.weekday === slot.weekday);
          if (index >= 0) {
            nextRows[index] = {
              weekday: slot.weekday,
              startTime: slot.startTime,
              endTime: slot.endTime,
              isActive: slot.isActive,
            };
          }
        }
        setRows(nextRows);
      } catch {
        setError(t('settings:availability.errors.loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    fetchAvailability();
  }, [selectedDoctorId]);

  useEffect(() => {
    const fetchOffDays = async () => {
      if (!selectedDoctorId) return;
      try {
        const res = await doctorOffDayService.getAll({ practitionerId: selectedDoctorId });
        setOffDays(res.data);
      } catch {
        setOffDayError(t('settings:availability.offDays.errors.loadFailed'));
      }
    };
    fetchOffDays();
  }, [selectedDoctorId]);

  const updateRow = (weekday: number, patch: Partial<{ startTime: string; endTime: string; isActive: boolean }>) => {
    setRows(prev => prev.map(row => row.weekday === weekday ? { ...row, ...patch } : row));
  };

  const handleSave = async () => {
    if (!selectedDoctorId) return;
    setSaving(true);
    setError('');

    try {
      await doctorAvailabilityService.updateForPractitioner(
        selectedDoctorId,
        rows.filter(row => row.isActive)
      );
    } catch (err: any) {
      setError(getConflictErrorMessage(err, t('settings:availability.errors.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleAddOffDay = async () => {
    if (!selectedDoctorId || !offDayDate) return;

    if (offDayMode === 'range') {
      const end = offDayDateEnd || offDayDate;
      if (end < offDayDate) {
        setOffDayError(t('settings:availability.offDays.errors.invalidRange'));
        return;
      }
    }

    setOffDaySaving(true);
    setOffDayError('');

    try {
      const datesToAdd = offDayMode === 'range'
        ? expandDateRange(offDayDate, offDayDateEnd || offDayDate)
        : [offDayDate];

      const results = await Promise.allSettled(
        datesToAdd.map(date =>
          doctorOffDayService.create({
            practitionerId: selectedDoctorId,
            date,
            reason: offDayReason || undefined,
          })
        )
      );

      const newEntries = results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map(r => r.value.data);
      const failedEntries = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      setOffDays(prev =>
        [...prev.filter(d => !newEntries.find((n: any) => n.date === d.date)), ...newEntries]
          .sort((a, b) => a.date.localeCompare(b.date))
      );

      if (failedEntries.length > 0) {
        setOffDayError(getConflictErrorMessage(failedEntries[0].reason, t('settings:availability.offDays.errors.saveFailed')));
        return;
      }

      setOffDayDate('');
      setOffDayDateEnd('');
      setOffDayReason('');
    } catch (err: any) {
      setOffDayError(getConflictErrorMessage(err, t('settings:availability.offDays.errors.saveFailed')));
    } finally {
      setOffDaySaving(false);
    }
  };

  const handleDeleteOffDay = async (id: string) => {
    if (!window.confirm(t('settings:availability.offDays.confirmDelete'))) return;
    try {
      await doctorOffDayService.delete(id);
      setOffDays(prev => prev.filter(d => d.id !== id));
    } catch {
      setOffDayError(t('settings:availability.offDays.errors.loadFailed'));
    }
  };

  if (loading && !selectedDoctorId) {
    return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary-500" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">{t('settings:availability.title')}</h2>
          <p className="text-sm text-gray-500">{t('settings:availability.subtitle')}</p>
        </div>
        <button onClick={handleSave} disabled={saving || !selectedDoctorId} className="btn-primary">
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {t('common:save')}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {canSelectDoctor && (
        <div className="card p-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings:availability.fields.practitioner')}</label>
          <select className="input-field max-w-md" value={selectedDoctorId} onChange={e => setSelectedDoctorId(e.target.value)}>
            {doctors.map(doctor => (
              <option key={doctor.id} value={doctor.id}>{doctor.firstName} {doctor.lastName}</option>
            ))}
          </select>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
          <CalendarClock size={18} className="text-primary-600" />
          <div>
            <p className="font-bold text-gray-900">
              {selectedDoctor ? `${selectedDoctor.firstName} ${selectedDoctor.lastName}` : t('common:selectPlaceholder')}
            </p>
            <p className="text-xs text-gray-500">{t('settings:availability.weeklySchedule')}</p>
          </div>
        </div>

        <div className="divide-y divide-gray-50">
          {rows.map(row => (
            <div key={row.weekday} className="p-4 grid grid-cols-1 md:grid-cols-[1fr_120px_120px_120px] gap-3 md:items-center">
              <div>
                <p className="font-semibold text-gray-900">{weekdayLabel(row.weekday, locale)}</p>
                <p className="text-xs text-gray-500">{row.isActive ? t('settings:availability.available') : t('settings:availability.unavailable')}</p>
              </div>
              <input
                type="time"
                className="input-field"
                value={row.startTime}
                disabled={!row.isActive}
                onChange={e => updateRow(row.weekday, { startTime: e.target.value })}
              />
              <input
                type="time"
                className="input-field"
                value={row.endTime}
                disabled={!row.isActive}
                onChange={e => updateRow(row.weekday, { endTime: e.target.value })}
              />
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  checked={row.isActive}
                  onChange={e => updateRow(row.weekday, { isActive: e.target.checked })}
                />
                {t('settings:availability.fields.isAvailable')}
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Off Days Section */}
      <div className="card overflow-hidden">
        <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
          <CalendarOff size={18} className="text-red-500" />
          <div>
            <p className="font-bold text-gray-900">{t('settings:availability.offDays.title')}</p>
            <p className="text-xs text-gray-500">{t('settings:availability.offDays.subtitle')}</p>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {offDayError && (
            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2">
              <AlertCircle size={16} />
              {offDayError}
            </div>
          )}

          {/* Add new off day */}
          <div className="space-y-3">
            {/* Mode toggle */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setOffDayMode('single'); setOffDayDateEnd(''); }}
                className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${offDayMode === 'single' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {t('settings:availability.offDays.modeSingle')}
              </button>
              <button
                type="button"
                onClick={() => setOffDayMode('range')}
                className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${offDayMode === 'range' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {t('settings:availability.offDays.modeRange')}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {offDayMode === 'range' ? t('settings:availability.offDays.startDate') : t('common:date')}
                </label>
                <input
                  type="date"
                  className="input-field w-full"
                  value={offDayDate}
                  onChange={e => setOffDayDate(e.target.value)}
                  disabled={!selectedDoctorId}
                />
              </div>
              {offDayMode === 'range' && (
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {t('settings:availability.offDays.endDate')}
                  </label>
                  <input
                    type="date"
                    className="input-field w-full"
                    value={offDayDateEnd}
                    onChange={e => setOffDayDateEnd(e.target.value)}
                    min={offDayDate || undefined}
                    disabled={!selectedDoctorId || !offDayDate}
                  />
                </div>
              )}
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {t('settings:availability.offDays.reason')}
                </label>
                <input
                  type="text"
                  className="input-field w-full"
                  placeholder={t('settings:availability.offDays.reasonPlaceholder')}
                  value={offDayReason}
                  onChange={e => setOffDayReason(e.target.value)}
                  disabled={!selectedDoctorId}
                  maxLength={255}
                />
              </div>
              <button
                className="btn-primary shrink-0"
                onClick={handleAddOffDay}
                disabled={!selectedDoctorId || !offDayDate || (offDayMode === 'range' && !offDayDateEnd) || offDaySaving}
              >
                {offDaySaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {t('settings:availability.offDays.addDate')}
              </button>
            </div>
          </div>

          {/* Off days list */}
          {offDays.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">{t('settings:availability.offDays.noOffDays')}</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {offDays.map(od => (
                <div key={od.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="font-medium text-sm text-gray-800">
                      {formatDate(od.date + 'T00:00:00')}
                    </span>
                    {od.reason && (
                      <span className="ml-2 text-xs text-gray-500">— {od.reason}</span>
                    )}
                  </div>
                  <button
                    className="text-red-400 hover:text-red-600 transition-colors p-1"
                    onClick={() => handleDeleteOffDay(od.id)}
                    title={t('common:delete')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const weekdayLabel = (weekday: number, locale: string) => {
  const baseSunday = new Date(2026, 0, 4);
  const date = new Date(baseSunday);
  date.setDate(baseSunday.getDate() + weekday);
  return date.toLocaleDateString(locale, { weekday: 'long' });
};

/** Returns every YYYY-MM-DD date string from start to end (inclusive). */
const expandDateRange = (start: string, end: string): string[] => {
  const dates: string[] = [];
  const current = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (current <= last) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
};

export default DoctorAvailabilityManager;
