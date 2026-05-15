import assert from 'node:assert/strict';
import { buildClarificationMessage } from '../services/whatsappClarification.js';
import {
  handleAwaitingServiceStep,
  handleAwaitingTimeStep,
  type BookingServiceOption,
  type BookingStateJson,
} from '../services/whatsappBookingFlow.js';
import type { SavedAvailableSlot } from '../services/whatsappAvailability.js';
import { routeResolvedWhatsAppIntent } from '../services/whatsappResolvedIntentRouter.js';
import { getWebhookIgnoreReason, normalizeEvolutionWebhookPayload } from '../services/whatsappWebhookPayload.js';
import {
  validateOptionalWebhookSecret,
  validateWhatsappApiSecret,
  whatsappAppointmentLookupQuerySchema,
  whatsappAppointmentRequestSchema,
  whatsappAvailabilityQuerySchema,
} from '../services/whatsappPublicApi.js';

const clinicId = 'clinic-1';
const phone = '+905551112233';
const customerName = 'Ayse Demir';
const selectedDate = '2026-05-16';

const baseServices: BookingServiceOption[] = [
  { id: 'svc-1', name: 'Dis Temizligi', durationMinutes: 30 },
  { id: 'svc-2', name: 'Dis Beyazlatma', durationMinutes: 45 },
  { id: 'svc-3', name: 'Implant Muayenesi', durationMinutes: 60 },
];

const createSlot = (localStartTime: string, practitionerId: string, practitionerName: string): SavedAvailableSlot => ({
  practitionerId,
  practitionerName,
  startTime: `2026-05-16T${localStartTime}:00.000Z`,
  endTime: `2026-05-16T${localStartTime}:00.000Z`,
  localStartTime,
  localEndTime: localStartTime,
});

const createStateRecorder = () => {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    upsertState: async (data: Record<string, unknown>) => {
      calls.push(data);
      return data;
    },
  };
};

const defaultFindSlotMatches = () => ({
  extractedTime: null,
  hasPractitionerFragment: false,
  matches: [] as Array<{ slot: SavedAvailableSlot; index: number }>,
});

const extractNumericSelection = (text: string) => {
  const match = text.trim().match(/^\d+$/);
  return match ? Number(match[0]) : null;
};

const minutesToTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const formatAvailabilityMessage = (date: string, slots: SavedAvailableSlot[]) => [
  `${date} icin uygun saatler:`,
  ...slots.map((slot, index) => `${index + 1}. ${slot.localStartTime} (${slot.practitionerName})`),
].join('\n');

const runFixture = async (name: string, test: () => Promise<void> | void) => {
  await test();
  console.log(`PASS ${name}`);
};

const run = async () => {
  await runFixture('clarification routes booking requests to awaiting_service', () => {
    const result = buildClarificationMessage({
      intent: 'unknown',
      appointmentTypeName: null,
      appointmentTypeId: null,
      dateText: null,
      exactTime: '15:00',
      afterTime: null,
      timePreference: 'afternoon',
      clarificationReason: 'Tam olarak hangi hizmeti istediğinizi anlayamadim.',
    }, null, customerName);

    assert.equal(result.nextState?.step, 'awaiting_service');
    assert.equal(result.nextState?.currentIntent, 'book_appointment');
    assert.match(result.message, /hangi hizmet/i);
  });

  await runFixture('clarification routes service-known booking requests to awaiting_date', () => {
    const result = buildClarificationMessage({
      intent: 'book_appointment',
      appointmentTypeName: null,
      appointmentTypeId: null,
      dateText: null,
      exactTime: '16:00',
      afterTime: null,
      timePreference: null,
      clarificationReason: null,
    }, {
      currentIntent: 'book_appointment',
      selectedAppointmentTypeId: 'svc-1',
      selectedAppointmentTypeName: 'Dis Temizligi',
      selectedDate: null,
    }, customerName);

    assert.equal(result.nextState?.step, 'awaiting_date');
    assert.equal(result.nextState?.selectedAppointmentTypeId, 'svc-1');
    assert.match(result.message, /hangi gün/i);
  });

  await runFixture('awaiting_service keeps multiple matching services in state', async () => {
    const recorder = createStateRecorder();
    const message = await handleAwaitingServiceStep({
      text: 'dis',
      phone,
      customerName,
      services: baseServices,
      state: {},
      stateJson: {},
      extractNumericSelection,
      findServiceMatches: () => [baseServices[0], baseServices[1]],
      upsertState: recorder.upsertState,
    });

    assert.match(message, /Birden fazla uygun hizmet buldum/i);
    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].step, 'awaiting_service');
    assert.deepEqual(recorder.calls[0].stateJson, {
      matchedServices: [
        { id: 'svc-1', name: 'Dis Temizligi' },
        { id: 'svc-2', name: 'Dis Beyazlatma' },
      ],
    });
  });

  await runFixture('awaiting_time finds afternoon slots beyond the initial shown list', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('09:00', 'p1', 'Dr. Sabah 1'),
      createSlot('09:30', 'p2', 'Dr. Sabah 2'),
      createSlot('10:00', 'p3', 'Dr. Sabah 3'),
      createSlot('10:30', 'p4', 'Dr. Sabah 4'),
      createSlot('11:00', 'p5', 'Dr. Sabah 5'),
      createSlot('11:30', 'p6', 'Dr. Sabah 6'),
      createSlot('12:00', 'p7', 'Dr. Oglen'),
      createSlot('12:30', 'p8', 'Dr. Oglen 2'),
      createSlot('13:30', 'p9', 'Dr. Ikindi'),
      createSlot('15:00', 'p10', 'Dr. Ikindi 2'),
    ];
    const stateJson: BookingStateJson = {
      availableSlots,
      lastShownSlots: availableSlots.slice(0, 8),
    };

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: 'ogleden sonra olsun',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate,
      },
      stateJson,
      extractNumericSelection,
      findSlotMatches: defaultFindSlotMatches,
      formatAvailabilityMessage,
      minutesToTime,
      logAvailabilitySave: () => undefined,
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => ({ appointmentType: { name: 'Dis Temizligi' } }),
    });

    assert.match(message, /öğleden sonraki uygun saatler/i);
    assert.match(message, /13:30/);
    assert.match(message, /15:00/);
    assert.ok(!message.includes('09:00'));
    assert.equal(recorder.calls.length, 1);
    const updatedState = recorder.calls[0].stateJson as BookingStateJson;
    assert.equal(updatedState.lastShownSlots?.[0]?.localStartTime, '12:00');
    assert.equal(updatedState.lastShownSlots?.[2]?.localStartTime, '13:30');
  });

  await runFixture('awaiting_time offers next unseen slots for more-options requests', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('09:00', 'p1', 'Dr. A'),
      createSlot('09:30', 'p2', 'Dr. B'),
      createSlot('10:00', 'p3', 'Dr. C'),
      createSlot('10:30', 'p4', 'Dr. D'),
      createSlot('11:00', 'p5', 'Dr. E'),
      createSlot('11:30', 'p6', 'Dr. F'),
      createSlot('12:00', 'p7', 'Dr. G'),
      createSlot('12:30', 'p8', 'Dr. H'),
      createSlot('13:00', 'p9', 'Dr. I'),
      createSlot('13:30', 'p10', 'Dr. J'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: 'baska saat var mi',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate,
      },
      stateJson: {
        availableSlots,
        lastShownSlots: availableSlots.slice(0, 8),
      },
      extractNumericSelection,
      findSlotMatches: defaultFindSlotMatches,
      formatAvailabilityMessage,
      minutesToTime,
      logAvailabilitySave: () => undefined,
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => ({ appointmentType: { name: 'Dis Temizligi' } }),
    });

    assert.match(message, /başka uygun saatler/i);
    assert.match(message, /13:00/);
    assert.match(message, /13:30/);
    assert.ok(!message.includes('09:00'));
    const updatedState = recorder.calls[0].stateJson as BookingStateJson;
    assert.equal(updatedState.lastShownSlots?.length, 2);
    assert.equal(updatedState.lastShownSlots?.[0]?.localStartTime, '13:00');
  });

  await runFixture('awaiting_time returns nearby alternatives when exact time is unavailable', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('14:30', 'p1', 'Dr. A'),
      createSlot('15:15', 'p2', 'Dr. B'),
      createSlot('16:00', 'p3', 'Dr. C'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: '15:00 olur mu',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate,
      },
      stateJson: {
        availableSlots,
        lastShownSlots: availableSlots,
      },
      extractNumericSelection,
      findSlotMatches: defaultFindSlotMatches,
      formatAvailabilityMessage,
      minutesToTime,
      logAvailabilitySave: () => undefined,
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => ({ appointmentType: { name: 'Dis Temizligi' } }),
    });

    assert.match(message, /yakın saatler/i);
    assert.match(message, /14:30/);
    assert.match(message, /15:15/);
    assert.equal(recorder.calls.length, 1);
  });

  await runFixture('resolved intent router sends booking requests into awaiting_service', async () => {
    const recorder = createStateRecorder();
    let resetCalls = 0;
    const message = await routeResolvedWhatsAppIntent({
      extraction: {
        intent: 'book_appointment',
        appointmentTypeName: null,
        appointmentTypeId: null,
        dateText: null,
        exactTime: null,
        afterTime: null,
        timePreference: null,
        clarificationReason: null,
        confidence: 0.98,
        needsClarification: false,
      },
      state: null,
      customerName,
      clinicName: 'Disklinik',
      inputText: 'randevu almak istiyorum',
      services: baseServices,
      upsertState: recorder.upsertState,
      resetState: async () => {
        resetCalls += 1;
      },
      getAppointments: async () => [],
      formatAppointmentLookup: () => 'appointments',
      formatServiceList: services => services.map(service => service.name).join(', '),
      formatMainMenu: () => 'main menu',
      handleCancelIntent: async () => 'cancel',
    });

    assert.equal(resetCalls, 0);
    assert.equal(message, 'Dis Temizligi, Dis Beyazlatma, Implant Muayenesi');
    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].step, 'awaiting_service');
    assert.equal(recorder.calls[0].currentIntent, 'book_appointment');
  });

  await runFixture('resolved intent router resets state for appointment lookup', async () => {
    const recorder = createStateRecorder();
    let resetCalls = 0;
    const message = await routeResolvedWhatsAppIntent({
      extraction: {
        intent: 'check_appointment',
        appointmentTypeName: null,
        appointmentTypeId: null,
        dateText: null,
        exactTime: null,
        afterTime: null,
        timePreference: null,
        clarificationReason: null,
        confidence: 0.92,
        needsClarification: false,
      },
      state: { currentIntent: 'book_appointment', step: 'awaiting_time' },
      customerName,
      clinicName: 'Disklinik',
      inputText: 'randevumu sorgula',
      services: baseServices,
      upsertState: recorder.upsertState,
      resetState: async () => {
        resetCalls += 1;
      },
      getAppointments: async () => [{
        id: 'apt-1',
        date: '2026-05-16',
        startTime: '15:00',
        endTime: '15:30',
        serviceName: 'Dis Temizligi',
        practitionerName: 'Dr. A',
        status: 'scheduled',
      }],
      formatAppointmentLookup: appointments => `found:${appointments.length}`,
      formatServiceList: () => 'services',
      formatMainMenu: () => 'main menu',
      handleCancelIntent: async () => 'cancel',
    });

    assert.equal(message, 'found:1');
    assert.equal(resetCalls, 1);
    assert.equal(recorder.calls.length, 0);
  });

  await runFixture('resolved intent router falls back to main menu on unknown high-confidence requests', async () => {
    const recorder = createStateRecorder();
    const message = await routeResolvedWhatsAppIntent({
      extraction: {
        intent: 'unknown',
        appointmentTypeName: null,
        appointmentTypeId: null,
        dateText: null,
        exactTime: null,
        afterTime: null,
        timePreference: null,
        clarificationReason: null,
        confidence: 0.95,
        needsClarification: false,
      },
      state: null,
      customerName,
      clinicName: 'Disklinik',
      inputText: 'yardim',
      services: baseServices,
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      getAppointments: async () => [],
      formatAppointmentLookup: () => 'appointments',
      formatServiceList: () => 'services',
      formatMainMenu: (nextCustomerName, isReturningCustomer, clinicName) => `${nextCustomerName}|${String(isReturningCustomer)}|${clinicName}`,
      handleCancelIntent: async () => 'cancel',
    });

    assert.equal(message, 'Ayse Demir|true|Disklinik');
    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].step, 'main_menu');
    assert.equal(recorder.calls[0].currentIntent, null);
  });

  await runFixture('webhook payload normalizes wrapped Evolution conversation messages', () => {
    const normalized = normalizeEvolutionWebhookPayload({
      body: {
        event: 'messages.upsert',
        instance: 'clinic-main',
        data: {
          key: {
            remoteJid: '90 555 111 22 33@s.whatsapp.net',
            fromMe: false,
          },
          pushName: 'Ayse',
          message: {
            conversation: 'Merhaba',
          },
        },
      },
    });

    assert.equal(normalized.event, 'messages.upsert');
    assert.equal(normalized.instance, 'clinic-main');
    assert.equal(normalized.fromMe, false);
    assert.equal(normalized.message?.phone, '905551112233');
    assert.equal(normalized.message?.name, 'Ayse');
    assert.equal(normalized.message?.text, 'Merhaba');
  });

  await runFixture('webhook payload reads extended text and ignores fromMe messages', () => {
    const normalized = normalizeEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '33753849141@s.whatsapp.net',
          fromMe: true,
        },
        message: {
          extendedTextMessage: {
            text: 'Randevu almak istiyorum',
          },
        },
      },
    });

    assert.equal(normalized.message?.phone, '33753849141');
    assert.equal(normalized.message?.text, 'Randevu almak istiyorum');
    assert.equal(getWebhookIgnoreReason(normalized), 'from_me');
  });

  await runFixture('webhook payload returns ignore reasons for unsupported and textless events', () => {
    const unsupportedEvent = normalizeEvolutionWebhookPayload({
      event: 'messages.update',
      data: {
        key: {
          remoteJid: '33753849141@s.whatsapp.net',
          fromMe: false,
        },
        message: {
          conversation: 'Merhaba',
        },
      },
    });
    const noTextMessage = normalizeEvolutionWebhookPayload({
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '33753849141@s.whatsapp.net',
          fromMe: false,
        },
        message: {},
      },
    });

    assert.equal(getWebhookIgnoreReason(unsupportedEvent), 'unsupported_event');
    assert.equal(getWebhookIgnoreReason(noTextMessage), 'no_text_message');
  });

  await runFixture('public WhatsApp auth accepts header and bearer secrets', () => {
    assert.equal(validateWhatsappApiSecret('test-secret', {
      xWhatsappSecret: 'test-secret',
    }), null);
    assert.equal(validateWhatsappApiSecret('test-secret', {
      authorization: 'Bearer test-secret',
    }), null);
    assert.equal(validateWhatsappApiSecret(undefined, {
      xWhatsappSecret: 'test-secret',
    }), 'not_configured');
    assert.equal(validateWhatsappApiSecret('test-secret', {
      xWhatsappSecret: 'wrong-secret',
    }), 'invalid');
  });

  await runFixture('optional webhook secret is skipped when not configured and rejects invalid secrets', () => {
    assert.equal(validateOptionalWebhookSecret(undefined, {
      xWhatsappSecret: 'anything',
    }), null);
    assert.equal(validateOptionalWebhookSecret('hook-secret', {
      authorization: 'Bearer hook-secret',
    }), null);
    assert.equal(validateOptionalWebhookSecret('hook-secret', {
      xWhatsappSecret: 'wrong-secret',
    }), 'invalid');
  });

  await runFixture('public WhatsApp schemas parse valid availability and lookup requests', () => {
    const availability = whatsappAvailabilityQuerySchema.parse({
      appointmentTypeId: '11111111-1111-4111-8111-111111111111',
      date: '2026-05-16',
      practitionerId: '22222222-2222-4222-8222-222222222222',
    });
    const lookup = whatsappAppointmentLookupQuerySchema.parse({
      phone: ' 905551112233 ',
    });

    assert.equal(availability.date, '2026-05-16');
    assert.equal(lookup.phone, '905551112233');
  });

  await runFixture('public WhatsApp appointment request schema rejects inverted date ranges', () => {
    const result = whatsappAppointmentRequestSchema.safeParse({
      patientName: 'Ayse Demir',
      phone: '905551112233',
      appointmentTypeId: '',
      practitionerId: '',
      preferredStartTime: '2026-05-16T15:00:00.000Z',
      preferredEndTime: '2026-05-16T14:30:00.000Z',
      requestType: 'appointment',
    });

    assert.equal(result.success, false);
    assert.match(JSON.stringify(result.error?.format() ?? {}), /Preferred end time must be after preferred start time/);
  });

  console.log('All WhatsApp conversation fixtures passed.');
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
