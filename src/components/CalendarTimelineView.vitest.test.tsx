/**
 * CalendarTimelineView.vitest.test.tsx — US-03.3 drag/resize verification.
 *
 * `@fullcalendar/react` is mocked to a prop-capturing stub so the tests can
 * invoke `eventDrop`/`eventResize` directly with a synthetic `EventDropArg`-
 * shaped object, instead of simulating real HTML5 drag gestures against the
 * real calendar grid (which jsdom cannot do reliably).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import CalendarTimelineView, { resolveDragDropTimes } from './CalendarTimelineView';
import { appointmentService } from '../services/api';

vi.mock('../services/api', () => ({
  appointmentService: { update: vi.fn() },
}));

const mockT = (key: string, opts?: any) => opts?.defaultValue ?? key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));

let capturedProps: any = null;
vi.mock('@fullcalendar/react', () => ({
  default: React.forwardRef((props: any, _ref: any) => {
    capturedProps = props;
    return null;
  }),
}));
vi.mock('@fullcalendar/timegrid', () => ({ default: {} }));
vi.mock('@fullcalendar/daygrid', () => ({ default: {} }));
vi.mock('@fullcalendar/interaction', () => ({ default: {} }));
vi.mock('@fullcalendar/core/locales/tr', () => ({ default: {} }));
vi.mock('@fullcalendar/core/locales/de', () => ({ default: {} }));
vi.mock('@fullcalendar/core/locales/fr', () => ({ default: {} }));

const svc = appointmentService as unknown as { update: ReturnType<typeof vi.fn> };

const BASE_APPOINTMENT = {
  id: 'appt-1',
  startTime: '2026-03-05T09:00:00.000Z',
  endTime: '2026-03-05T09:30:00.000Z',
  status: 'scheduled',
  patient: { firstName: 'Ada', lastName: 'Lovelace' },
  practitioner: { firstName: 'Grace', lastName: 'Hopper' },
  appointmentType: { name: 'Checkup', color: '#6366f1' },
};

function renderCalendar(overrides: Partial<React.ComponentProps<typeof CalendarTimelineView>> = {}) {
  const onRefresh = vi.fn();
  const onDateChange = vi.fn();
  const onAppointmentClick = vi.fn();
  render(
    <CalendarTimelineView
      appointments={[BASE_APPOINTMENT]}
      selectedDate="2026-03-05"
      locale="en"
      canEdit
      onDateChange={onDateChange}
      onAppointmentClick={onAppointmentClick}
      onRefresh={onRefresh}
      {...overrides}
    />
  );
  return { onRefresh, onDateChange, onAppointmentClick };
}

// A local-timezone-naive ISO string (no 'Z'/offset) is exactly what
// FullCalendar's `startStr`/`endStr` produce under the default `timeZone:
// 'local'` — the bug this fix removes reliance on.
function makeEvent(startIso: string, endIso: string | null) {
  return {
    start: new Date(startIso),
    end: endIso ? new Date(endIso) : null,
    startStr: startIso.replace('Z', ''),
    endStr: endIso ? endIso.replace('Z', '') : '',
    extendedProps: { appointment: BASE_APPOINTMENT },
  };
}

beforeEach(() => {
  capturedProps = null;
  vi.clearAllMocks();
});

describe('resolveDragDropTimes', () => {
  it('serializes start/end as unambiguous UTC ISO strings, not the local wall-clock *Str fields', () => {
    const event = makeEvent('2026-03-05T12:00:00.000Z', '2026-03-05T12:30:00.000Z');
    const result = resolveDragDropTimes(event, BASE_APPOINTMENT);
    expect(result.startTime).toBe('2026-03-05T12:00:00.000Z');
    expect(result.endTime).toBe('2026-03-05T12:30:00.000Z');
  });

  it('falls back to the appointment original duration (not a hardcoded value) when end is missing', () => {
    // Original appointment is 45 minutes long.
    const original = { startTime: '2026-03-05T09:00:00.000Z', endTime: '2026-03-05T09:45:00.000Z' };
    const event = makeEvent('2026-03-05T14:00:00.000Z', null);
    const result = resolveDragDropTimes(event, original);
    expect(result.startTime).toBe('2026-03-05T14:00:00.000Z');
    expect(result.endTime).toBe('2026-03-05T14:45:00.000Z');
  });
});

describe('CalendarTimelineView eventDrop', () => {
  it('on success, sends UTC-safe times and refreshes', async () => {
    svc.update.mockResolvedValueOnce({ data: {} });
    const { onRefresh } = renderCalendar();

    const event = makeEvent('2026-03-06T10:00:00.000Z', '2026-03-06T10:30:00.000Z');
    const info = { event, revert: vi.fn() };
    await act(async () => { await capturedProps.eventDrop(info); });

    expect(svc.update).toHaveBeenCalledWith('appt-1', {
      startTime: '2026-03-06T10:00:00.000Z',
      endTime: '2026-03-06T10:30:00.000Z',
    });
    expect(info.revert).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });

  it('on API failure, reverts the calendar event and does not refresh', async () => {
    svc.update.mockRejectedValueOnce({ response: { data: { error: 'Overlap detected with another appointment' } } });
    const { onRefresh } = renderCalendar();

    const event = makeEvent('2026-03-06T10:00:00.000Z', '2026-03-06T10:30:00.000Z');
    const info = { event, revert: vi.fn() };
    await act(async () => { await capturedProps.eventDrop(info); });

    expect(info.revert).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('CalendarTimelineView eventResize', () => {
  it('on API failure, reverts the calendar event and does not refresh', async () => {
    svc.update.mockRejectedValueOnce(new Error('network error'));
    const { onRefresh } = renderCalendar();

    const event = makeEvent('2026-03-05T09:00:00.000Z', '2026-03-05T10:00:00.000Z');
    const info = { event, revert: vi.fn() };
    await act(async () => { await capturedProps.eventResize(info); });

    expect(info.revert).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('on success, sends the resized duration and refreshes', async () => {
    svc.update.mockResolvedValueOnce({ data: {} });
    const { onRefresh } = renderCalendar();

    const event = makeEvent('2026-03-05T09:00:00.000Z', '2026-03-05T10:00:00.000Z');
    const info = { event, revert: vi.fn() };
    await act(async () => { await capturedProps.eventResize(info); });

    expect(svc.update).toHaveBeenCalledWith('appt-1', {
      startTime: '2026-03-05T09:00:00.000Z',
      endTime: '2026-03-05T10:00:00.000Z',
    });
    expect(onRefresh).toHaveBeenCalled();
  });
});
