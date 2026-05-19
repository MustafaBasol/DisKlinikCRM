import React, { useRef, useCallback } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventClickArg, EventDropArg, EventContentArg } from '@fullcalendar/core';
import { appointmentService } from '../services/api';

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
  const calendarRef = useRef<FullCalendar>(null);

  const events = appointments.map((appt) => ({
    id: appt.id,
    title: `${appt.patient.firstName} ${appt.patient.lastName}`,
    start: appt.startTime,
    end: appt.endTime,
    backgroundColor: appt.appointmentType.color || '#6366f1',
    borderColor: STATUS_BORDER_COLORS[appt.status] || '#6366f1',
    extendedProps: { appointment: appt },
    editable: canEdit && ['scheduled', 'confirmed'].includes(appt.status),
  }));

  const handleEventDrop = useCallback(async (info: EventDropArg) => {
    const appt: CalendarAppointment = info.event.extendedProps.appointment;
    try {
      await appointmentService.update(appt.id, {
        startTime: info.event.startStr,
        endTime: info.event.endStr || new Date(new Date(info.event.startStr).getTime() + 30 * 60000).toISOString(),
      });
      onRefresh();
    } catch {
      info.revert();
    }
  }, [onRefresh]);

  const handleEventResize = useCallback(async (info: any) => {
    const appt: CalendarAppointment = info.event.extendedProps.appointment;
    try {
      await appointmentService.update(appt.id, {
        startTime: info.event.startStr,
        endTime: info.event.endStr,
      });
      onRefresh();
    } catch {
      info.revert();
    }
  }, [onRefresh]);

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
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
        initialView="timeGridDay"
        initialDate={selectedDate}
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
        datesSet={(info) => {
          if (info.view.type === 'timeGridDay') {
            onDateChange(info.startStr.slice(0, 10));
          }
        }}
      />
    </div>
  );
};

export default CalendarTimelineView;
