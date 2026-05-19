import React, { useMemo, useCallback } from 'react';

interface Doctor {
  id: string;
  firstName: string;
  lastName: string;
}

interface AppointmentItem {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  patient: { firstName: string; lastName: string };
  practitioner: { id: string; firstName: string; lastName: string };
  appointmentType: { name: string; color?: string };
}

interface MultiDoctorDayViewProps {
  appointments: AppointmentItem[];
  doctors: Doctor[];
  selectedDate: string;
  canEdit: boolean;
  onSlotClick: (doctorId: string, time: string) => void;
  onAppointmentClick: (appointment: AppointmentItem) => void;
}

const HOUR_START = 8;
const HOUR_END = 20;
const SLOT_MINUTES = 30;
const TOTAL_SLOTS = ((HOUR_END - HOUR_START) * 60) / SLOT_MINUTES;

function padTwo(n: number) {
  return String(n).padStart(2, '0');
}

function slotLabel(index: number) {
  const totalMins = HOUR_START * 60 + index * SLOT_MINUTES;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${padTwo(h)}:${padTwo(m)}`;
}

function getSlotIndex(isoTime: string, dateStr: string): number {
  const date = new Date(isoTime);
  const base = new Date(`${dateStr}T00:00:00Z`);
  // Use local wall clock derived from ISO string
  const local = new Date(isoTime);
  const h = local.getHours();
  const m = local.getMinutes();
  return ((h - HOUR_START) * 60 + m) / SLOT_MINUTES;
}

function getSlotSpan(isoStart: string, isoEnd: string): number {
  const start = new Date(isoStart);
  const end = new Date(isoEnd);
  const diffMs = end.getTime() - start.getTime();
  const diffSlots = diffMs / (SLOT_MINUTES * 60000);
  return Math.max(1, Math.round(diffSlots));
}

const STATUS_BG: Record<string, string> = {
  scheduled: 'bg-yellow-100 border-yellow-400 text-yellow-900',
  confirmed: 'bg-blue-100 border-blue-400 text-blue-900',
  completed: 'bg-green-100 border-green-400 text-green-900',
  cancelled: 'bg-red-100 border-red-400 text-red-900 opacity-50',
  no_show: 'bg-gray-100 border-gray-400 text-gray-700 opacity-50',
  rescheduled: 'bg-purple-100 border-purple-400 text-purple-900',
};

const MultiDoctorDayView: React.FC<MultiDoctorDayViewProps> = ({
  appointments,
  doctors,
  selectedDate,
  canEdit,
  onSlotClick,
  onAppointmentClick,
}) => {
  // Map: doctorId → list of appointments
  const apptsByDoctor = useMemo(() => {
    const map: Record<string, AppointmentItem[]> = {};
    for (const d of doctors) map[d.id] = [];
    for (const a of appointments) {
      if (map[a.practitioner.id]) {
        map[a.practitioner.id].push(a);
      }
    }
    return map;
  }, [appointments, doctors]);

  // Build slot → appointment lookup per doctor
  const slotMap = useMemo(() => {
    const result: Record<string, Record<number, AppointmentItem | 'occupied'>> = {};
    for (const d of doctors) {
      result[d.id] = {};
      for (const a of apptsByDoctor[d.id] || []) {
        const startSlot = getSlotIndex(a.startTime, selectedDate);
        const span = getSlotSpan(a.startTime, a.endTime);
        for (let i = 0; i < span; i++) {
          result[d.id][startSlot + i] = i === 0 ? a : 'occupied';
        }
      }
    }
    return result;
  }, [apptsByDoctor, doctors, selectedDate]);

  const slots = useMemo(() => Array.from({ length: TOTAL_SLOTS }, (_, i) => i), []);

  if (doctors.length === 0) {
    return (
      <div className="card p-8 text-center text-gray-400">
        <p>Kayıtlı hekim bulunamadı.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Header row: time | doctor columns */}
      <div className="overflow-x-auto">
        <div
          className="grid text-sm"
          style={{ gridTemplateColumns: `80px repeat(${doctors.length}, minmax(140px, 1fr))` }}
        >
          {/* Header */}
          <div className="bg-gray-50 border-b border-r border-gray-200 p-3 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky left-0 z-10">
            Saat
          </div>
          {doctors.map((doc) => (
            <div
              key={doc.id}
              className="bg-gray-50 border-b border-r border-gray-200 p-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wide"
            >
              {doc.firstName} {doc.lastName}
            </div>
          ))}

          {/* Time slots */}
          {slots.map((slotIdx) => {
            const label = slotLabel(slotIdx);
            const isHourStart = (slotIdx * SLOT_MINUTES) % 60 === 0;
            return (
              <React.Fragment key={slotIdx}>
                {/* Time label */}
                <div
                  className={`border-b border-r border-gray-100 p-2 text-right text-xs sticky left-0 z-10 bg-white ${
                    isHourStart ? 'font-semibold text-gray-700 border-gray-200' : 'text-gray-300'
                  }`}
                >
                  {isHourStart ? label : ''}
                </div>

                {/* Doctor columns */}
                {doctors.map((doc) => {
                  const cell = slotMap[doc.id]?.[slotIdx];

                  if (cell === 'occupied') {
                    return <div key={doc.id} className="border-b border-r border-gray-100" />;
                  }

                  if (cell && typeof cell !== 'string') {
                    const appt = cell as AppointmentItem;
                    const span = getSlotSpan(appt.startTime, appt.endTime);
                    const rowStart = slotIdx + 2; // 1-based, +1 for header row
                    const colStart = doctors.indexOf(doc) + 2; // +1 for time col, +1 for 1-based
                    const statusClass = STATUS_BG[appt.status] || STATUS_BG.scheduled;
                    return (
                      <div
                        key={doc.id}
                        className="border-b border-r border-gray-100 relative"
                      >
                        <button
                          type="button"
                          onClick={() => onAppointmentClick(appt)}
                          className={`absolute inset-0.5 rounded-lg border-l-4 text-left px-2 py-1 text-xs font-medium overflow-hidden hover:brightness-95 transition-all ${statusClass}`}
                          style={{
                            height: `calc(${span * 100}% - 4px)`,
                            zIndex: 5,
                          }}
                        >
                          <div className="font-bold truncate">
                            {appt.patient.firstName} {appt.patient.lastName}
                          </div>
                          <div className="truncate opacity-80">{appt.appointmentType.name}</div>
                        </button>
                      </div>
                    );
                  }

                  // Empty slot
                  return (
                    <div
                      key={doc.id}
                      className={`border-b border-r border-gray-100 ${isHourStart ? 'border-gray-200' : ''} ${
                        canEdit
                          ? 'hover:bg-primary-50/40 cursor-pointer transition-colors'
                          : ''
                      }`}
                      style={{ minHeight: 28 }}
                      onClick={() => canEdit && onSlotClick(doc.id, `${selectedDate}T${label}:00`)}
                    />
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MultiDoctorDayView;
