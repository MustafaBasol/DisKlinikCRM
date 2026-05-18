import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Calendar as CalendarIcon, 
  Plus, 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  Search,
  CheckCircle2,
  XCircle,
  MoreVertical,
  Clock,
  User,
  CalendarCheck,
  LayoutList,
  CalendarDays,
  Users
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { appointmentService, userService } from '../services/api';
import { useAuth } from '../context/AuthContext';
import AppointmentForm from '../components/AppointmentForm';
import CalendarTimelineView from '../components/CalendarTimelineView';
import MultiDoctorDayView from '../components/MultiDoctorDayView';
import { formatTimeInTimeZone, getDateKeyInTimeZone } from '../utils/dateTime';

const Appointments: React.FC = () => {
  const { t, i18n } = useTranslation(['appointments', 'common']);
  const { user } = useAuth();
  const clinicTimeZone = user?.clinic?.timezone || 'Europe/Paris';
  
  const [appointments, setAppointments] = useState<any[]>([]);
  const [monthAppointments, setMonthAppointments] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<any>(null);
  
  // View mode
  const [viewMode, setViewMode] = useState<'list' | 'timeline' | 'multidoctor'>('list');

  // Filters
  const [search, setSearch] = useState('');
  const [selectedDate, setSelectedDate] = useState(toLocalDateString(new Date()));
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [status, setStatus] = useState('');
  const [practitionerId, setPractitionerId] = useState('');

  const fetchAppointments = async () => {
    setLoading(true);
    try {
      const { start, end } = getDayRange(selectedDate);
      const response = await appointmentService.getAll({
        start,
        end,
        status: status || undefined,
        practitionerId: practitionerId || undefined,
        search: search || undefined
      });
      setAppointments(response.data);
    } catch (error) {
      console.error('Failed to fetch appointments:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMonthAppointments = async () => {
    setCalendarLoading(true);
    try {
      const monthStart = startOfMonth(calendarMonth);
      const monthEnd = endOfMonth(calendarMonth);
      const response = await appointmentService.getAll({
        start: startOfDay(monthStart).toISOString(),
        end: endOfDay(monthEnd).toISOString(),
        status: status || undefined,
        practitionerId: practitionerId || undefined,
      });
      setMonthAppointments(response.data);
    } catch (error) {
      console.error('Failed to fetch month appointments:', error);
    } finally {
      setCalendarLoading(false);
    }
  };

  useEffect(() => {
    fetchAppointments();
  }, [selectedDate, status, practitionerId]);

  useEffect(() => {
    fetchMonthAppointments();
  }, [calendarMonth, status, practitionerId]);

  // Debounced search
  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchAppointments();
    }, 500);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        const res = await userService.getDoctors();
        setDoctors(res.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchDoctors();
  }, []);

  const changeDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(toLocalDateString(d));
    setCalendarMonth(startOfMonth(d));
  };

  const changeMonth = (months: number) => {
    const next = new Date(calendarMonth);
    next.setMonth(next.getMonth() + months);
    setCalendarMonth(startOfMonth(next));
  };

  const handleCalendarDayClick = (date: Date) => {
    setSelectedDate(toLocalDateString(date));
    setCalendarMonth(startOfMonth(date));
  };

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      await appointmentService.updateStatus(id, newStatus);
      fetchAppointments();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleSlotClick = (doctorId: string, time: string) => {
    setEditingAppointment({ practitionerId: doctorId, startTime: time });
    setIsFormOpen(true);
  };

  const handleAppointmentClickInCalendar = (appointment: any) => {
    if (canEdit) {
      setEditingAppointment(appointment);
      setIsFormOpen(true);
    }
  };

  const canEdit = user?.role === 'admin' || user?.role === 'receptionist';
  const isDoctor = user?.role === 'doctor';
  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  const appointmentCounts = useMemo(() => {
    return monthAppointments.reduce<Record<string, number>>((acc, appointment) => {
      const key = getDateKeyInTimeZone(appointment.startTime, clinicTimeZone);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [monthAppointments, clinicTimeZone]);
  const selectedDateLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString(i18n.language, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const monthLabel = calendarMonth.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
  const weekdayLabels = getWeekdayLabels(i18n.language);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('appointments:title')}</h1>
          <p className="text-gray-500 mt-1">{t('appointments:subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {/* View Mode Toggle */}
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'list'
                  ? 'bg-white shadow-sm text-primary-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              title="Liste görünümü"
            >
              <LayoutList size={16} />
              <span className="hidden sm:inline">Liste</span>
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'timeline'
                  ? 'bg-white shadow-sm text-primary-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              title="Takvim görünümü"
            >
              <CalendarDays size={16} />
              <span className="hidden sm:inline">Takvim</span>
            </button>
            <button
              onClick={() => setViewMode('multidoctor')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                viewMode === 'multidoctor'
                  ? 'bg-white shadow-sm text-primary-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              title="Çoklu hekim görünümü"
            >
              <Users size={16} />
              <span className="hidden sm:inline">Çoklu Hekim</span>
            </button>
          </div>

          {canEdit && (
            <button 
              onClick={() => {
                setEditingAppointment(null);
                setIsFormOpen(true);
              }} 
              className="btn-primary shadow-lg shadow-primary-200"
            >
              <Plus size={20} />
              {t('appointments:newAppointment')}
            </button>
          )}
        </div>
      </div>

      {/* Month Calendar — only in list mode */}
      {viewMode === 'list' && <div className="card overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center text-primary-600">
              <CalendarIcon size={20} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">{t('appointments:calendar.monthView')}</h2>
              <p className="text-sm text-gray-500">{t('appointments:calendar.clickDayHint')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-50 rounded-lg transition-colors text-gray-500" title={t('appointments:calendar.previousMonth')}>
              <ChevronLeft size={20} />
            </button>
            <div className="min-w-[160px] text-center font-bold text-gray-800 capitalize">
              {monthLabel}
            </div>
            <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-50 rounded-lg transition-colors text-gray-500" title={t('appointments:calendar.nextMonth')}>
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-7 gap-2 mb-2">
            {weekdayLabels.map((label) => (
              <div key={label} className="text-center text-xs font-bold uppercase text-gray-400 py-2">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map((date) => {
              const dateKey = toLocalDateString(date);
              const count = appointmentCounts[dateKey] || 0;
              const isCurrentMonth = date.getMonth() === calendarMonth.getMonth();
              const isSelected = dateKey === selectedDate;
              const isToday = dateKey === toLocalDateString(new Date());

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => handleCalendarDayClick(date)}
                  className={`min-h-[86px] rounded-xl border p-2 text-left transition-all ${
                    isSelected
                      ? 'border-primary-500 bg-primary-50 shadow-sm'
                      : isCurrentMonth
                        ? 'border-gray-100 bg-white hover:border-primary-200 hover:bg-primary-50/40'
                        : 'border-gray-50 bg-gray-50/60 text-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-sm font-bold ${isSelected ? 'text-primary-700' : isToday ? 'text-primary-600' : isCurrentMonth ? 'text-gray-700' : 'text-gray-300'}`}>
                      {date.getDate()}
                    </span>
                    {isToday && <span className="w-2 h-2 rounded-full bg-primary-500 mt-1" />}
                  </div>
                  <div className="mt-4">
                    {count > 0 ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-bold ${
                        isSelected ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {t('appointments:calendar.appointmentCount', { count })}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">{t('appointments:calendar.noAppointments')}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {calendarLoading && (
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <Loader2 size={14} className="animate-spin" />
              {t('common:loading')}
            </div>
          )}
        </div>
      </div>}

      {/* Filter Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder={t('appointments:filters.searchPatient')}
            className="input-field pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
          <button onClick={() => changeDate(-1)} className="p-2 hover:bg-gray-50 rounded-lg transition-colors text-gray-500">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1 text-center font-bold text-gray-700 min-w-[120px]">
            {selectedDateLabel}
          </div>
          <button onClick={() => changeDate(1)} className="p-2 hover:bg-gray-50 rounded-lg transition-colors text-gray-500">
            <ChevronRight size={20} />
          </button>
        </div>

        <select 
          className="input-field"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('appointments:filters.allStatus')}</option>
          {['scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled', 'no_show'].map(s => (
            <option key={s} value={s}>{t(`appointments:status.${s}`)}</option>
          ))}
        </select>

        {!isDoctor && (
          <select 
            className="input-field"
            value={practitionerId}
            onChange={(e) => setPractitionerId(e.target.value)}
          >
            <option value="">{t('appointments:filters.allPractitioners')}</option>
            {doctors.map(d => (
              <option key={d.id} value={d.id}>Dt. {d.firstName} {d.lastName}</option>
            ))}
          </select>
        )}
      </div>

      {/* Appointment List — only in list mode */}
      {viewMode === 'list' && <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-primary-600" size={32} />
          </div>
        ) : appointments.length > 0 ? (
          appointments.map((appt) => (
            <div key={appt.id} className="card p-5 flex flex-col md:flex-row md:items-center gap-6 group hover:shadow-lg transition-all border-l-4" style={{ borderLeftColor: appt.appointmentType.color }}>
              <div className="flex items-center gap-4 md:w-32 flex-shrink-0">
                <div className="bg-gray-50 p-2 rounded-lg text-gray-600 font-bold flex flex-col items-center">
                  <Clock size={16} className="mb-1 text-primary-500" />
                  <span className="text-sm">{formatTimeInTimeZone(appt.startTime, i18n.language, clinicTimeZone)}</span>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <Link to={`/appointments/${appt.id}`} className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg hover:text-primary-600 transition-colors truncate">
                      {appt.patient.firstName} {appt.patient.lastName}
                    </h3>
                    <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <CalendarCheck size={14} className="text-primary-500" />
                        {appt.appointmentType.name}
                      </span>
                      <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                      <span className="flex items-center gap-1">
                        <User size={14} className="text-primary-500" />
                        Dt. {appt.practitioner.lastName}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`badge ${
                      appt.status === 'completed' ? 'badge-green' : 
                      appt.status === 'confirmed' ? 'badge-blue' : 
                      appt.status === 'cancelled' ? 'badge-red' : 
                      appt.status === 'no_show' ? 'badge-gray' : 'badge-yellow'
                    }`}>
                      {t(`appointments:status.${appt.status}`)}
                    </span>
                  </div>
                </Link>
              </div>

              <div className="flex items-center gap-2 pt-4 md:pt-0 border-t md:border-t-0 border-gray-100">
                {/* Status-specific actions */}
                {appt.status === 'scheduled' && (user?.role !== 'billing') && (
                  <button 
                    onClick={() => handleStatusUpdate(appt.id, 'confirmed')}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title={t('appointments:actions.confirm')}
                  >
                    <CheckCircle2 size={20} />
                  </button>
                )}
                
                {(appt.status === 'scheduled' || appt.status === 'confirmed') && (
                  <button 
                    onClick={() => handleStatusUpdate(appt.id, 'completed')}
                    className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    title={t('appointments:actions.complete')}
                  >
                    <CalendarCheck size={20} />
                  </button>
                )}

                {(appt.status === 'scheduled' || appt.status === 'confirmed') && (user?.role !== 'doctor') && (
                  <>
                    <button 
                      onClick={() => handleStatusUpdate(appt.id, 'cancelled')}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title={t('appointments:actions.cancel')}
                    >
                      <XCircle size={20} />
                    </button>
                    <button 
                      onClick={() => {
                        setEditingAppointment(appt);
                        setIsFormOpen(true);
                      }}
                      className="p-2 text-gray-400 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                      <MoreVertical size={20} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="card p-20 text-center text-gray-500 bg-gray-50/50 border-dashed border-2">
            <div className="flex flex-col items-center gap-3">
              <CalendarIcon size={48} className="text-gray-300" />
              <p className="text-lg font-medium">{t('common:noData')}</p>
              <p className="text-sm">{t('appointments:noAppointmentsFound')}</p>
            </div>
          </div>
        )}
      </div>}

      {/* Timeline / FullCalendar view */}
      {viewMode === 'timeline' && (
        <CalendarTimelineView
          appointments={appointments}
          selectedDate={selectedDate}
          locale={i18n.language}
          canEdit={canEdit}
          onDateChange={(date) => {
            setSelectedDate(date);
            setCalendarMonth(startOfMonth(new Date(date)));
          }}
          onAppointmentClick={handleAppointmentClickInCalendar}
          onRefresh={fetchAppointments}
        />
      )}

      {/* Multi-doctor day view */}
      {viewMode === 'multidoctor' && (
        <MultiDoctorDayView
          appointments={appointments}
          doctors={doctors}
          selectedDate={selectedDate}
          canEdit={canEdit}
          onSlotClick={handleSlotClick}
          onAppointmentClick={handleAppointmentClickInCalendar}
        />
      )}

      {isFormOpen && (
        <AppointmentForm 
          onClose={() => setIsFormOpen(false)} 
          onSuccess={() => {
            setIsFormOpen(false);
            fetchAppointments();
          }}
          initialData={editingAppointment}
        />
      )}
    </div>
  );
};

export default Appointments;

function toLocalDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function getDayRange(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  return {
    start: startOfDay(date).toISOString(),
    end: endOfDay(date).toISOString(),
  };
}

function buildCalendarDays(monthDate: Date) {
  const firstDay = startOfMonth(monthDate);
  const lastDay = endOfMonth(monthDate);
  const start = new Date(firstDay);
  const startOffset = (firstDay.getDay() + 6) % 7;
  start.setDate(firstDay.getDate() - startOffset);

  const end = new Date(lastDay);
  const endOffset = (7 - ((lastDay.getDay() + 6) % 7) - 1) % 7;
  end.setDate(lastDay.getDate() + endOffset);

  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function getWeekdayLabels(locale: string) {
  const baseMonday = new Date(2026, 0, 5);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(baseMonday);
    date.setDate(baseMonday.getDate() + index);
    return date.toLocaleDateString(locale, { weekday: 'short' });
  });
}
