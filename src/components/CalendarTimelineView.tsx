import React, { useRef, useCallback, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventClickArg, EventDropArg, EventContentArg } from '@fullcalendar/core';
import trLocale from '@fullcalendar/core/locales/tr';
import deLocale from '@fullcalendar/core/locales/de';
import frLocale from '@fullcalendar/core/locales/fr';
import { useTranslation } from 'react-i18next';
import { appointmentService } from '../services/api';
import { getErrorMessage } from '../utils/errors';

/**
 * Resolves the payload sent after an eventDrop/eventResize.
 *
 * Uses the FullCalendar event's actual `Date` objects (`.toISOString()`), not
 * `.startStr`/`.endStr`: with the default `timeZone: 'local'`, those *Str
 * getters format wall-clock time with no UTC offset, and the backend then
 * parses that naive string using the server's local timezone (not the
 * browser's) — silently shifting the appointment by the server/browser
 * offset. `.toISOString()` always carries an explicit UTC 'Z', so the round
 * trip is unambiguous regardless of where the browser or server run.
 *
 * Falls back to the appointment's original duration (not a hardcoded value)
 * when FullCalendar reports no end time.
 */
export function resolveDragDropTimes(
  event: { start: Date | null; end: Date | null },
  original: { startTime: string; endTime: string },
): { startTime: string; endTime: string } {
  const originalDurationMs = new Date(original.endTime).getTime() - new Date(original.startTime).getTime();
  const start = event.start ?? new Date(original.startTime);
  const end = event.end ?? new Date(start.getTime() + originalDurationMs);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

interface CalendarAppointment {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  patient: { firstName: string; lastName: string };
  practitioner: { firstName: string; lastName: string };
  appointmentType: { name: string; color?: string };
}

interface CalendarTimelineViewProps {
  appointments: CalendarAppointment[];
  selectedDate: string;
  locale: string;
  canEdit: boolean;
  onDateChange: (date: string) => void;
  onAppointmentClick: (appointment: CalendarAppointment) => void;
  onRefresh: () => void;
}

const STATUS_BORDER_COLORS: Record<string, string> = {
  scheduled:   '#f59e0b', // amber
  confirmed:   '#10b981', // emerald
  in_progress: '#3b82f6', // blue
  completed:   '#6b7280', // gray
  cancelled:   '#ef4444', // red
  no_show:     '#f97316', // orange
};

const STATUS_DOT_CLASSES: Record<string, string> = {
  scheduled:   'bg-amber-400',
  confirmed:   'bg-emerald-400',
  in_progress: 'bg-blue-400',
  completed:   'bg-gray-400',
  cancelled:   'bg-red-400',
  no_show:     'bg-orange-400',
};

const STATUS_OPACITY: Record<string, string> = {
  cancelled: 'opacity-50',
  no_show:   'opacity-60',
  completed: 'opacity-75',
};

const CalendarTimelineView: React.FC<CalendarTimelineViewProps> = ({
  appointments,
  selectedDate,
  locale,
  canEdit,
  onDateChange,
  onAppointmentClick,
  onRefresh,
}) => {
  const { t } = useTranslation(['appointments', 'common']);
  const calendarRef = useRef<FullCalendar>(null);
  const lastReportedDateRef = useRef<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const events = useMemo(() => appointments.map((appt) => ({
    id: appt.id,
    title: `${appt.patient.firstName} ${appt.patient.lastName}`,
    start: appt.startTime,
    end: appt.endTime,
    backgroundColor: appt.appointmentType.color || '#6366f1',
    borderColor: STATUS_BORDER_COLORS[appt.status] || '#6366f1',
    extendedProps: { appointment: appt },
    editable: canEdit && ['scheduled', 'confirmed'].includes(appt.status),
  })), [appointments, canEdit]);

  const handleDatesSet = useCallback((info: { view: { type: string }; startStr: string }) => {
    if (info.view.type !== 'timeGridDay') return;
    const nextDate = info.startStr.slice(0, 10);
    if (lastReportedDateRef.current === nextDate) return;
    lastReportedDateRef.current = nextDate;
    onDateChange(nextDate);
  }, [onDateChange]);

  const handleEventDrop = useCallback(async (info: EventDropArg) => {
    const appt: CalendarAppointment = info.event.extendedProps.appointment;
    try {
      await appointmentService.update(appt.id, resolveDragDropTimes(info.event, appt));
      setActionError(null);
      onRefresh();
    } catch (err) {
      info.revert();
      setActionError(getErrorMessage(err, t('appointments:calendar.moveFailed')));
    }
  }, [onRefresh, t]);

  const handleEventResize = useCallback(async (info: any) => {
    const appt: CalendarAppointment = info.event.extendedProps.appointment;
    try {
      await appointmentService.update(appt.id, resolveDragDropTimes(info.event, appt));
      setActionError(null);
      onRefresh();
    } catch (err) {
      info.revert();
      setActionError(getErrorMessage(err, t('appointments:calendar.resizeFailed')));
    }
  }, [onRefresh, t]);

  const handleEventClick = useCallback((info: EventClickArg) => {
    onAppointmentClick(info.event.extendedProps.appointment);
  }, [onAppointmentClick]);

  const handleDateClick = useCallback((info: any) => {
    onDateChange(info.dateStr.slice(0, 10));
  }, [onDateChange]);

  const renderEventContent = (info: EventContentArg) => {
    const appt: CalendarAppointment = info.event.extendedProps.appointment;
    const opacityClass = STATUS_OPACITY[appt.status] || '';
    const dotClass = STATUS_DOT_CLASSES[appt.status] || 'bg-indigo-400';
    return (
      <div className={`px-1 py-0.5 text-white text-xs leading-tight overflow-hidden h-full ${opacityClass}`}>
        <div className="flex items-center gap-1">
          <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />
          <span className="font-semibold truncate">{info.event.title}</span>
        </div>
        <div className="truncate opacity-90">{appt.appointmentType.name}</div>
        <div className="truncate opacity-75">{appt.practitioner.lastName}</div>
      </div>
    );
  };

  return (
    <div className="card p-4 fc-wrapper">
      {actionError && (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 text-red-700 hover:text-red-900 dark:text-red-200 dark:hover:text-white"
            aria-label={t('common:close')}
          >
            &times;
          </button>
        </div>
      )}
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
        initialView="timeGridDay"
        initialDate={selectedDate}
        locales={[trLocale, deLocale, frLocale]}
        locale={locale.startsWith('tr') ? 'tr' : locale.startsWith('de') ? 'de' : locale.startsWith('fr') ? 'fr' : 'en'}
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'timeGridDay,timeGridWeek,dayGridMonth',
        }}
        events={events}
        editable={canEdit}
        droppable={canEdit}
        eventDrop={handleEventDrop}
        eventResize={handleEventResize}
        eventClick={handleEventClick}
        dateClick={handleDateClick}
        eventContent={renderEventContent}
        slotMinTime="07:00:00"
        slotMaxTime="21:00:00"
        slotDuration="00:15:00"
        snapDuration="00:15:00"
        height="auto"
        allDaySlot={false}
        nowIndicator
        datesSet={handleDatesSet}
      />
    </div>
  );
};

export default CalendarTimelineView;
