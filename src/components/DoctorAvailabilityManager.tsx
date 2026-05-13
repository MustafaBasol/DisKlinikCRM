import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Loader2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { doctorAvailabilityService, userService } from '../services/api';
import { useAuth } from '../context/AuthContext';

const weekdays = [1, 2, 3, 4, 5, 6, 0];

const defaultRows = () => weekdays.map(weekday => ({
  weekday,
  startTime: weekday === 6 ? '10:00' : '09:00',
  endTime: weekday === 6 ? '14:00' : '17:30',
  isActive: weekday !== 0,
}));

const DoctorAvailabilityManager: React.FC = () => {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const { user } = useAuth();
  const [doctors, setDoctors] = useState<any[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [rows, setRows] = useState(defaultRows());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSelectDoctor = user?.role === 'admin';
  const selectedDoctor = useMemo(() => doctors.find(d => d.id === selectedDoctorId), [doctors, selectedDoctorId]);

  useEffect(() => {
    const fetchDoctors = async () => {
      setLoading(true);
      setError('');
      try {
        if (canSelectDoctor) {
          const res = await userService.getDoctors();
          setDoctors(res.data);
          setSelectedDoctorId(res.data[0]?.id || '');
        } else if (user?.role === 'doctor') {
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
  }, [canSelectDoctor, user?.id]);

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
      setError(err.response?.data?.error || t('settings:availability.errors.saveFailed'));
    } finally {
      setSaving(false);
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
              <option key={doctor.id} value={doctor.id}>Dt. {doctor.firstName} {doctor.lastName}</option>
            ))}
          </select>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
          <CalendarClock size={18} className="text-primary-600" />
          <div>
            <p className="font-bold text-gray-900">
              {selectedDoctor ? `Dt. ${selectedDoctor.firstName} ${selectedDoctor.lastName}` : t('common:selectPlaceholder')}
            </p>
            <p className="text-xs text-gray-500">{t('settings:availability.weeklySchedule')}</p>
          </div>
        </div>

        <div className="divide-y divide-gray-50">
          {rows.map(row => (
            <div key={row.weekday} className="p-4 grid grid-cols-1 md:grid-cols-[1fr_120px_120px_120px] gap-3 md:items-center">
              <div>
                <p className="font-semibold text-gray-900">{weekdayLabel(row.weekday, i18n.language)}</p>
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
    </div>
  );
};

const weekdayLabel = (weekday: number, locale: string) => {
  const baseSunday = new Date(2026, 0, 4);
  const date = new Date(baseSunday);
  date.setDate(baseSunday.getDate() + weekday);
  return date.toLocaleDateString(locale, { weekday: 'long' });
};

export default DoctorAvailabilityManager;
