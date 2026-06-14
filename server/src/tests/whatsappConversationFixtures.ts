import assert from 'node:assert/strict';
import { buildClarificationMessage } from '../services/whatsappClarification.js';
import {
  handleAwaitingConfirmationStep,
  handleAwaitingDateStep,
  handleAwaitingServiceStep,
  handleAwaitingTimeStep,
  type BookingServiceOption,
  type BookingStateJson,
} from '../services/whatsappBookingFlow.js';
import type { RawAvailableSlot, SavedAvailableSlot } from '../services/whatsappAvailability.js';
import { routeResolvedWhatsAppIntent } from '../services/whatsappResolvedIntentRouter.js';
import { buildFallbackWhatsAppAgentDecision } from '../services/whatsappConversationAgent.js';
import { normalizeWhatsAppAgentDecision } from '../services/whatsappAgentSchema.js';
import { getWebhookIgnoreReason, normalizeEvolutionWebhookPayload } from '../services/whatsappWebhookPayload.js';
import { interpretTimeRequest } from '../services/whatsappInterpreter.js';
import { getPastMonthDayCorrectedDate, normalizeDateFromTurkishInput } from '../utils/whatsappDate.js';
import {
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

const createAgentArgs = (latestMessage: string, overrides: Partial<Parameters<typeof buildFallbackWhatsAppAgentDecision>[0]> = {}) => ({
  latestMessage,
  customerName,
  currentIntent: null,
  currentStep: null,
  selectedAppointmentTypeName: null,
  selectedDate: null,
  services: baseServices,
  recentMessages: [],
  clinicFacts: {
    clinicName: 'Disklinik',
    timezone: 'Europe/Istanbul',
    hasAddress: false,
    hasPhone: false,
    hasEmail: false,
    hasWebsite: false,
    doctorCountKnown: false,
    doctorCount: null,
    workingHoursKnown: false,
  },
  ...overrides,
});

const createSlot = (localStartTime: string, practitionerId: string, practitionerName: string): SavedAvailableSlot => ({
  practitionerId,
  practitionerName,
  startTime: `2026-05-16T${localStartTime}:00.000Z`,
  endTime: `2026-05-16T${localStartTime}:00.000Z`,
  localStartTime,
  localEndTime: localStartTime,
});

const createRawSlot = (date: string, localStartTime: string, id: string, firstName: string, lastName: string): RawAvailableSlot => {
  const start = new Date(`${date}T${localStartTime}:00.000Z`);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const [h, m] = localStartTime.split(':').map(Number);
  const endMinutes = h * 60 + m + 30;
  const localEndTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  return {
    practitioner: { id, firstName, lastName },
    startTime: start,
    endTime: end,
    localStartTime,
    localEndTime,
  };
};

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
  await runFixture('whatsapp agent schema normalizes unknown actions into safe replies', () => {
    const decision = normalizeWhatsAppAgentDecision({
      intent: 'book_appointment',
      confidence: 1.3,
      action: 'delete_patient',
      reply: 'Tamam',
      slots: {
        serviceName: 'Implant Muayenesi',
      },
      safetyFlags: ['unexpected_action'],
    });

    assert.equal(decision?.intent, 'book_appointment');
    assert.equal(decision?.action, 'unknown_safe_reply');
    assert.equal(decision?.confidence, 1);
    assert.equal(decision?.slots.serviceName, 'Implant Muayenesi');
  });

  await runFixture('whatsapp agent fallback recognizes typo-heavy human handoff requests', () => {
    const decision = buildFallbackWhatsAppAgentDecision(createAgentArgs('yetklye bagla beni lutfen'));

    assert.equal(decision?.intent, 'human_handoff');
    assert.equal(decision?.action, 'human_handoff');
    assert.ok((decision?.confidence ?? 0) >= 0.95);
  });

  await runFixture('whatsapp agent fallback routes messy tooth pain to general assessment without medical advice', () => {
    const decision = buildFallbackWhatsAppAgentDecision(createAgentArgs('dism cok agriyo hangi hizmet bilmiyom'));

    assert.equal(decision?.intent, 'symptom_or_complaint');
    assert.equal(decision?.action, 'start_general_assessment');
    assert.deepEqual(decision?.safetyFlags, ['no_diagnosis', 'no_treatment_advice']);
    assert.doesNotMatch(decision?.reply ?? '', /ilaç|tedavi|teşhis|tani|tanı/i);
  });

  await runFixture('whatsapp agent fallback classifies clinic fact questions without fabricating answers', () => {
    const decision = buildFallbackWhatsAppAgentDecision(createAgentArgs('klinikte kac hekim calisiyo acaba'));

    assert.equal(decision?.intent, 'clinic_info');
    assert.equal(decision?.action, 'answer_clinic_info');
    assert.equal(decision?.reply, null);
  });

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
    assert.doesNotMatch(result.message, /Tam olarak hangi hizmeti istediğinizi anlayamadim/i);
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

  await runFixture('clarification hides raw AI reasons for unknown intents', () => {
    const result = buildClarificationMessage({
      intent: 'unknown',
      appointmentTypeName: null,
      appointmentTypeId: null,
      dateText: null,
      exactTime: null,
      afterTime: null,
      timePreference: null,
      clarificationReason: 'kullanıcı müsaitlik durumu hakkında genel bir soru soruyor',
    }, null, customerName);

    assert.match(result.message, /yeni randevu mu almak istiyorsunuz/i);
    assert.doesNotMatch(result.message, /kullanıcı müsaitlik durumu hakkında genel bir soru soruyor/i);
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
      formatServiceList: services => services.map((service, index) => `${index + 1}. ${service.name}`).join('\n'),
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

  await runFixture('awaiting_service shows full service list when the user asks what services are available', async () => {
    const recorder = createStateRecorder();
    const message = await handleAwaitingServiceStep({
      text: 'hangi hizmetleriniz var',
      phone,
      customerName,
      services: baseServices,
      state: {},
      stateJson: {},
      extractNumericSelection,
      findServiceMatches: () => [],
      formatServiceList: services => services.map((service, index) => `${index + 1}. ${service.name}`).join('\n'),
      upsertState: recorder.upsertState,
    });

    assert.match(message, /1\. Dis Temizligi/);
    assert.match(message, /2\. Dis Beyazlatma/);
    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].step, 'awaiting_service');
  });

  await runFixture('awaiting_service re-shows narrowed service list when the user says the list was not shown', async () => {
    const recorder = createStateRecorder();
    const message = await handleAwaitingServiceStep({
      text: 'listeyi vermedin ki',
      phone,
      customerName,
      services: baseServices,
      state: {},
      stateJson: {
        matchedServices: [
          { id: 'svc-1', name: 'Dis Temizligi' },
          { id: 'svc-2', name: 'Dis Beyazlatma' },
        ],
      },
      extractNumericSelection,
      findServiceMatches: () => [],
      formatServiceList: services => services.map((service, index) => `${index + 1}. ${service.name}`).join('\n'),
      upsertState: recorder.upsertState,
    });

    assert.equal(message, '1. Dis Temizligi\n2. Dis Beyazlatma');
    assert.equal(recorder.calls.length, 1);
    assert.deepEqual(recorder.calls[0].stateJson, {
      matchedServices: [
        { id: 'svc-1', name: 'Dis Temizligi' },
        { id: 'svc-2', name: 'Dis Beyazlatma' },
      ],
    });
  });

  await runFixture('awaiting_date applies after-time filtering when the date message also includes a time threshold', async () => {
    const recorder = createStateRecorder();
    const message = await handleAwaitingDateStep({
      prisma: {} as never,
      clinicId,
      text: '18 Mayıs 15ten sonra var mı',
      customerName,
      now: new Date('2026-05-15T10:00:00.000Z'),
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
      },
      buildAvailableSlots: async () => [
        {
          practitioner: { id: 'p1', firstName: 'Dt.', lastName: 'Aysegul Akmese' },
          startTime: new Date('2026-05-18T09:00:00.000Z'),
          endTime: new Date('2026-05-18T09:30:00.000Z'),
          localStartTime: '09:00',
          localEndTime: '09:30',
        },
        {
          practitioner: { id: 'p2', firstName: 'Dt.', lastName: 'Kerem Ozguler' },
          startTime: new Date('2026-05-18T15:00:00.000Z'),
          endTime: new Date('2026-05-18T15:30:00.000Z'),
          localStartTime: '15:00',
          localEndTime: '15:30',
        },
        {
          practitioner: { id: 'p3', firstName: 'Uzm. Dt.', lastName: 'Hatice Erkin' },
          startTime: new Date('2026-05-18T15:30:00.000Z'),
          endTime: new Date('2026-05-18T16:00:00.000Z'),
          localStartTime: '15:30',
          localEndTime: '16:00',
        },
      ],
      formatAvailabilityMessage,
      logAvailabilitySave: () => undefined,
      minutesToTime,
      upsertState: recorder.upsertState,
    });

    assert.match(message, /saat 15:00 sonrası uygun saatler/i);
    assert.ok(!message.includes('09:00'));
    assert.match(message, /15:00/);
    assert.match(message, /15:30/);
  });

  await runFixture('awaiting_date applies after-time filtering for spaced threshold phrasing in the same message', async () => {
    const recorder = createStateRecorder();
    const message = await handleAwaitingDateStep({
      prisma: {} as never,
      clinicId,
      text: '19 Mayıs saat 14 ten sonra istiyorum',
      customerName,
      now: new Date('2026-05-18T10:00:00.000Z'),
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
      },
      buildAvailableSlots: async () => [
        {
          practitioner: { id: 'p1', firstName: 'Dt.', lastName: 'Aysegul Akmese' },
          startTime: new Date('2026-05-19T09:00:00.000Z'),
          endTime: new Date('2026-05-19T09:30:00.000Z'),
          localStartTime: '09:00',
          localEndTime: '09:30',
        },
        {
          practitioner: { id: 'p2', firstName: 'Dt.', lastName: 'Batikan Sirin' },
          startTime: new Date('2026-05-19T14:00:00.000Z'),
          endTime: new Date('2026-05-19T14:30:00.000Z'),
          localStartTime: '14:00',
          localEndTime: '14:30',
        },
        {
          practitioner: { id: 'p3', firstName: 'Dt.', lastName: 'Kerem Ozguler' },
          startTime: new Date('2026-05-19T14:30:00.000Z'),
          endTime: new Date('2026-05-19T15:00:00.000Z'),
          localStartTime: '14:30',
          localEndTime: '15:00',
        },
      ],
      formatAvailabilityMessage,
      logAvailabilitySave: () => undefined,
      minutesToTime,
      upsertState: recorder.upsertState,
    });

    assert.match(message, /19 Mayıs 2026 için saat 14:00 sonrası uygun saatler/i);
    assert.ok(!message.includes('09:00'));
    assert.match(message, /14:00/);
    assert.match(message, /14:30/);
  });

  await runFixture('date and time parser handles Turkish date plus dotted time', () => {
    const now = new Date('2026-05-16T21:36:00.000Z');
    assert.equal(normalizeDateFromTurkishInput('24 mayis 18.30', now), '2026-05-24');
    assert.equal(interpretTimeRequest('24 mayis 18.30').exactTime, '18:30');
  });

  await runFixture('awaiting_date understands date plus dotted time instead of failing date parsing', async () => {
    const recorder = createStateRecorder();
    const message = await handleAwaitingDateStep({
      prisma: {} as never,
      clinicId,
      text: '24 mayis 18.30',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
      },
      now: new Date('2026-05-16T21:36:00.000Z'),
      buildAvailableSlots: async () => [],
      formatAvailabilityMessage,
      logAvailabilitySave: () => undefined,
      minutesToTime,
      upsertState: recorder.upsertState,
    });

    assert.doesNotMatch(message, /Tarihi anlayamadim|Tarihi anlayamadım/i);
    assert.match(message, /24 Mayıs 2026/i);
    assert.match(message, /uygun saat görünmüyor/i);
  });

  await runFixture('awaiting_date filters exact dotted time when slots exist', async () => {
    const recorder = createStateRecorder();
    const message = await handleAwaitingDateStep({
      prisma: {} as never,
      clinicId,
      text: '24 mayis 18.30',
      customerName,
      now: new Date('2026-05-16T21:36:00.000Z'),
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
      },
      buildAvailableSlots: async () => [
        {
          practitioner: { id: 'p1', firstName: 'Dt.', lastName: 'Aysegul Akmese' },
          startTime: new Date('2026-05-24T18:00:00.000Z'),
          endTime: new Date('2026-05-24T18:30:00.000Z'),
          localStartTime: '18:00',
          localEndTime: '18:30',
        },
        {
          practitioner: { id: 'p2', firstName: 'Dt.', lastName: 'Kerem Ozguler' },
          startTime: new Date('2026-05-24T18:30:00.000Z'),
          endTime: new Date('2026-05-24T19:00:00.000Z'),
          localStartTime: '18:30',
          localEndTime: '19:00',
        },
      ],
      formatAvailabilityMessage,
      logAvailabilitySave: () => undefined,
      minutesToTime,
      upsertState: recorder.upsertState,
    });

    assert.match(message, /18:30/);
    assert.ok(!message.includes('18:00'));
  });

  await runFixture('awaiting_date treats short affirmative continuation as asking for another date', async () => {
    const recorder = createStateRecorder();
    const message = await handleAwaitingDateStep({
      prisma: {} as never,
      clinicId,
      text: 'Olur',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
      },
      buildAvailableSlots: async () => {
        throw new Error('availability should not be called without a date');
      },
      formatAvailabilityMessage,
      logAvailabilitySave: () => undefined,
      minutesToTime,
      upsertState: recorder.upsertState,
    });

    assert.match(message, /hangi günü kontrol/i);
    assert.doesNotMatch(message, /Tarihi anlayamad/i);
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

  await runFixture('awaiting_time treats question-form afternoon requests as a preference filter', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('10:00', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('10:30', 'p2', 'Dt. Kerem Ozguler'),
      createSlot('12:00', 'p3', 'Uzm. Dt. Hatice Erkin'),
      createSlot('12:30', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('13:00', 'p2', 'Dt. Kerem Ozguler'),
      createSlot('15:30', 'p3', 'Uzm. Dt. Hatice Erkin'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: 'Öğleden sonra uygun doktor var mı',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate,
      },
      stateJson: {
        availableSlots,
        lastShownSlots: availableSlots.slice(0, 3),
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

    assert.match(message, /öğleden sonraki uygun saatler/i);
    assert.ok(!message.includes('10:00'));
    assert.match(message, /12:00/);
    assert.match(message, /15:30/);
  });

  await runFixture('awaiting_time honors 15 ten sonra threshold requests even when the date is repeated', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('10:00', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('12:30', 'p2', 'Dt. Kerem Ozguler'),
      createSlot('15:00', 'p3', 'Uzm. Dt. Hatice Erkin'),
      createSlot('15:30', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('16:00', 'p2', 'Dt. Kerem Ozguler'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: '16 Mayıs saat 15 ten sonra uygun doktor var mı',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate,
      },
      stateJson: {
        availableSlots,
        lastShownSlots: availableSlots.slice(0, 3),
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

    assert.match(message, /saat 15:00 sonrası uygun saatler/i);
    assert.ok(!message.includes('10:00'));
    assert.ok(!message.includes('12:30'));
    assert.match(message, /15:00/);
    assert.match(message, /15:30/);
    assert.match(message, /16:00/);
  });

  await runFixture('awaiting_time supports explicit time ranges like 15-16 arasında', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('13:30', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('15:00', 'p2', 'Dt. Kerem Ozguler'),
      createSlot('15:30', 'p3', 'Uzm. Dt. Hatice Erkin'),
      createSlot('16:00', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('16:30', 'p2', 'Dt. Kerem Ozguler'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: 'Saat 15-16 arasında istiyorum',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate,
      },
      stateJson: {
        availableSlots,
        lastShownSlots: availableSlots.slice(0, 3),
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

    assert.match(message, /saat 15:00 ile 16:00 arasındaki uygun saatler/i);
    assert.ok(!message.includes('13:30'));
    assert.match(message, /15:00/);
    assert.match(message, /15:30/);
    assert.match(message, /16:00/);
    assert.ok(!message.includes('16:30'));
  });

  await runFixture('awaiting_time treats numbered slot selection as authoritative and skips AI extraction', async () => {
    const recorder = createStateRecorder();
    let aiCalls = 0;
    const availableSlots = [
      createSlot('09:00', 'p1', 'Dt. Sabah Hekimi'),
      createSlot('16:30', 'p2', 'Dt. Aksam Hekimi'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: '2',
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
      interpretTimeWithAi: async () => {
        aiCalls += 1;
        return {
          exactTime: '09:00',
          afterTime: null,
          timePreference: null,
        };
      },
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => ({ appointmentType: { name: 'Dis Temizligi' } }),
    });

    assert.equal(aiCalls, 0);
    assert.match(message, /16:30/);
    assert.match(message, /Dt\. Aksam Hekimi/);
    assert.doesNotMatch(message, /09:00/);
    assert.equal(recorder.calls[0].step, 'awaiting_confirmation');
    assert.equal(recorder.calls[0].selectedTime, '16:30');
    assert.equal(recorder.calls[0].selectedPractitionerId, 'p2');
    const updatedState = recorder.calls[0].stateJson as BookingStateJson;
    assert.equal(updatedState.pendingConfirmationSlot?.localStartTime, '16:30');
    assert.equal(updatedState.pendingConfirmationSlot?.practitionerId, 'p2');
  });

  await runFixture('awaiting_time uses AI fallback interpretation when local parsing finds no actionable time signal', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('13:30', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('15:00', 'p2', 'Dt. Kerem Ozguler'),
      createSlot('15:30', 'p3', 'Uzm. Dt. Hatice Erkin'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: 'ogleden sonraymis gibi ama 3ten sonrasina bakin',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate,
      },
      stateJson: {
        availableSlots,
        lastShownSlots: availableSlots.slice(0, 2),
      },
      extractNumericSelection,
      findSlotMatches: defaultFindSlotMatches,
      formatAvailabilityMessage,
      minutesToTime,
      logAvailabilitySave: () => undefined,
      interpretTimeWithAi: async () => ({
        exactTime: null,
        afterTime: '15:00',
        timePreference: null,
      }),
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => ({ appointmentType: { name: 'Dis Temizligi' } }),
    });

    assert.match(message, /saat 15:00 sonrası uygun saatler/i);
    assert.ok(!message.includes('13:30'));
    assert.match(message, /15:00/);
    assert.match(message, /15:30/);
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

  await runFixture('awaiting_time understands hour-only colloquial phrasing like 15te', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('14:30', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('15:00', 'p2', 'Dt. Kerem Ozguler'),
      createSlot('15:00', 'p3', 'Uzm. Dt. Hatice Erkin'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: 'Saat 15te var mı',
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

    assert.match(message, /15:00 için birden fazla hekim uygun görünüyor/i);
    assert.ok(!message.includes('14:30'));
    assert.match(message, /15:00/);
    assert.equal(recorder.calls.length, 1);
  });

  await runFixture('awaiting_time understands exact time phrasing with apostrophes like 15:00\'te', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('14:30', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('15:00', 'p2', 'Dt. Kerem Ozguler'),
      createSlot('15:00', 'p3', 'Uzm. Dt. Hatice Erkin'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: "Saat 15:00'te uygun randevu var mı",
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

    assert.match(message, /15:00 için birden fazla hekim uygun görünüyor/i);
    assert.ok(!message.includes('14:30'));
    assert.match(message, /15:00/);
    assert.equal(recorder.calls.length, 1);
  });

  await runFixture('awaiting_time still handles exact time when hasPractitionerFragment is true but no practitioner was actually matched', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('14:30', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('15:00', 'p2', 'Dt. Kerem Ozguler'),
      createSlot('15:00', 'p3', 'Uzm. Dt. Hatice Erkin'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: "Saat 15:00'te uygun randevu var mı",
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
      findSlotMatches: () => ({
        extractedTime: '15:00',
        hasPractitionerFragment: true,
        matches: [],
      }),
      formatAvailabilityMessage,
      minutesToTime,
      logAvailabilitySave: () => undefined,
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => ({ appointmentType: { name: 'Dis Temizligi' } }),
    });

    assert.match(message, /15:00 için birden fazla hekim uygun görünüyor/i);
    assert.ok(!message.includes('14:30'));
    assert.match(message, /15:00/);
    assert.equal(recorder.calls.length, 1);
  });

  await runFixture('awaiting_time handles colloquial availability phrasing like 15 musait mi', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('14:30', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('15:00', 'p2', 'Dt. Kerem Ozguler'),
      createSlot('15:00', 'p3', 'Uzm. Dt. Hatice Erkin'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: '15 müsait mi',
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
      findSlotMatches: () => ({
        extractedTime: '15:00',
        hasPractitionerFragment: false,
        matches: [
          { slot: availableSlots[1], index: 1 },
          { slot: availableSlots[2], index: 2 },
        ],
      }),
      formatAvailabilityMessage,
      minutesToTime,
      logAvailabilitySave: () => undefined,
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => ({ appointmentType: { name: 'Dis Temizligi' } }),
    });

    assert.match(message, /15:00 için birden fazla hekim uygun görünüyor/i);
    assert.ok(!message.includes('14:30'));
    assert.match(message, /15:00/);
    assert.equal(recorder.calls.length, 1);
  });

  await runFixture('awaiting_time asks for confirmation instead of immediately creating the appointment for a unique slot', async () => {
    const recorder = createStateRecorder();
    const availableSlots = [
      createSlot('16:30', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('17:00', 'p2', 'Dt. Kerem Ozguler'),
    ];

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: 'Aysegul hanim 16:30 da uygun mu',
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
      findSlotMatches: () => ({
        extractedTime: '16:30',
        hasPractitionerFragment: true,
        matches: [{ slot: availableSlots[0], index: 0 }],
      }),
      formatAvailabilityMessage,
      minutesToTime,
      logAvailabilitySave: () => undefined,
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => ({ appointmentType: { name: 'Dis Temizligi' } }),
    });

    assert.match(message, /uygun görünüyor/i);
    assert.match(message, /onaylıyor musunuz/i);
    assert.equal(recorder.calls[0].step, 'awaiting_confirmation');
    const updatedState = recorder.calls[0].stateJson as BookingStateJson;
    assert.equal(updatedState.pendingConfirmationSlot?.localStartTime, '16:30');
  });

  await runFixture('awaiting_confirmation only creates a staff approval request after explicit approval', async () => {
    const recorder = createStateRecorder();
    let createdRequests = 0;
    const pendingSlot = createSlot('16:30', 'p1', 'Dt. Aysegul Akmese');

    const rejectMessage = await handleAwaitingConfirmationStep({
      clinicId,
      phone,
      text: 'Sadece uygun mu diye sordum',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate,
      },
      stateJson: {
        availableSlots: [pendingSlot],
        lastShownSlots: [pendingSlot],
        pendingConfirmationSlot: pendingSlot,
      },
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => {
        createdRequests += 1;
        return { appointmentType: { name: 'Dis Temizligi' } };
      },
    });

    assert.match(rejectMessage, /yalnız uygunluğu teyit etmiş oldum/i);
    assert.equal(createdRequests, 0);

    const approveMessage = await handleAwaitingConfirmationStep({
      clinicId,
      phone,
      text: '👍',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate,
      },
      stateJson: {
        availableSlots: [pendingSlot],
        lastShownSlots: [pendingSlot],
        pendingConfirmationSlot: pendingSlot,
      },
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => {
        createdRequests += 1;
        return { appointmentType: { name: 'Dis Temizligi' } };
      },
    });

    assert.match(approveMessage, /klinik onay ekranına aldım/i);
    assert.match(approveMessage, /personel tarafından kontrol edilecek/i);
    assert.equal(createdRequests, 1);
  });

  await runFixture('awaiting_confirmation accepts numeric approval replies', async () => {
    let createdRequests = 0;
    const pendingSlot = createSlot('16:30', 'p1', 'Dt. Aysegul Akmese');

    const message = await handleAwaitingConfirmationStep({
      clinicId,
      phone,
      text: '1',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate,
      },
      stateJson: {
        availableSlots: [pendingSlot],
        lastShownSlots: [pendingSlot],
        pendingConfirmationSlot: pendingSlot,
      },
      upsertState: async () => undefined,
      resetState: async () => undefined,
      createAppointment: async () => {
        createdRequests += 1;
        return { appointmentType: { name: 'Dis Temizligi' } };
      },
    });

    assert.match(message, /klinik onay ekran/i);
    assert.equal(createdRequests, 1);
  });

  await runFixture('transcript flow keeps availability checks non-committing and allows appointment lookup afterwards', async () => {
    const availableSlots = [
      createSlot('09:00', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('15:00', 'p1', 'Dt. Aysegul Akmese'),
      createSlot('15:30', 'p2', 'Dt. Kerem Ozguler'),
      createSlot('16:30', 'p1', 'Dt. Aysegul Akmese'),
    ];
    let conversationState: {
      currentIntent?: string | null;
      step?: string | null;
      selectedAppointmentTypeId?: string | null;
      selectedAppointmentTypeName?: string | null;
      selectedPractitionerId?: string | null;
      selectedDate?: string | null;
      selectedTime?: string | null;
      stateJson?: BookingStateJson | null;
      lastMessage?: string | null;
    } = {
      currentIntent: 'book_appointment',
      step: 'awaiting_date',
      selectedAppointmentTypeId: 'svc-1',
      selectedAppointmentTypeName: 'Estetik Dis Hekimligi',
      stateJson: null,
    };
    const upsertState = async (data: Record<string, unknown>) => {
      conversationState = {
        ...conversationState,
        ...data,
      };
      return conversationState;
    };
    let resetCalls = 0;
    let createdAppointments = 0;

    const dateMessage = await handleAwaitingDateStep({
      prisma: {} as never,
      clinicId,
      text: '18 Mayıs 15ten sonra var mı',
      customerName: 'Selami Sahin',
      now: new Date('2026-05-15T10:00:00.000Z'),
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Estetik Dis Hekimligi',
      },
      buildAvailableSlots: async () => availableSlots.map(slot => ({
        practitioner: {
          id: slot.practitionerId,
          firstName: slot.practitionerName.split(' ')[0] ?? 'Dt.',
          lastName: slot.practitionerName.split(' ').slice(1).join(' ') || 'Hekim',
        },
        startTime: new Date(slot.startTime),
        endTime: new Date(slot.endTime),
        localStartTime: slot.localStartTime,
        localEndTime: slot.localEndTime,
      })),
      formatAvailabilityMessage,
      logAvailabilitySave: () => undefined,
      minutesToTime,
      upsertState,
    });

    assert.match(dateMessage, /saat 15:00 sonrası uygun saatler/i);
    assert.ok(!dateMessage.includes('09:00'));
    assert.equal(conversationState.step, 'awaiting_time');

    const confirmPrompt = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: 'Aysegul hanim 16:30 da uygun mu',
      customerName: 'Selami Sahin',
      state: {
        selectedAppointmentTypeId: conversationState.selectedAppointmentTypeId,
        selectedAppointmentTypeName: conversationState.selectedAppointmentTypeName,
        selectedDate: conversationState.selectedDate,
        selectedPractitionerId: conversationState.selectedPractitionerId,
      },
      stateJson: conversationState.stateJson ?? {},
      extractNumericSelection,
      findSlotMatches: () => ({
        extractedTime: '16:30',
        hasPractitionerFragment: true,
        matches: [{ slot: availableSlots[3], index: 3 }],
      }),
      formatAvailabilityMessage,
      minutesToTime,
      logAvailabilitySave: () => undefined,
      upsertState,
      resetState: async () => {
        resetCalls += 1;
      },
      createAppointment: async () => {
        createdAppointments += 1;
        return { appointmentType: { name: 'Estetik Dis Hekimligi' } };
      },
    });

    assert.match(confirmPrompt, /onaylıyor musunuz/i);
    assert.equal(conversationState.step, 'awaiting_confirmation');
    assert.equal(createdAppointments, 0);

    const rejectPrompt = await handleAwaitingConfirmationStep({
      clinicId,
      phone,
      text: 'Sadece uygun mu diye sordum',
      customerName: 'Selami Sahin',
      state: {
        selectedAppointmentTypeId: conversationState.selectedAppointmentTypeId,
        selectedAppointmentTypeName: conversationState.selectedAppointmentTypeName,
        selectedDate: conversationState.selectedDate,
        selectedPractitionerId: conversationState.selectedPractitionerId,
      },
      stateJson: conversationState.stateJson ?? {},
      upsertState,
      resetState: async () => {
        resetCalls += 1;
      },
      createAppointment: async () => {
        createdAppointments += 1;
        return { appointmentType: { name: 'Estetik Dis Hekimligi' } };
      },
    });

    assert.match(rejectPrompt, /uygunluğu teyit etmiş oldum/i);
    assert.equal(conversationState.step, 'awaiting_time');
    assert.equal(createdAppointments, 0);

    const lookupMessage = await routeResolvedWhatsAppIntent({
      extraction: {
        intent: 'check_appointment',
        appointmentTypeName: null,
        appointmentTypeId: null,
        dateText: null,
        exactTime: null,
        afterTime: null,
        timePreference: null,
        clarificationReason: null,
        confidence: 0.99,
        needsClarification: false,
      },
      state: {
        currentIntent: 'book_appointment',
        step: conversationState.step,
        customerName: 'Selami Sahin',
        selectedAppointmentTypeId: conversationState.selectedAppointmentTypeId,
        selectedAppointmentTypeName: conversationState.selectedAppointmentTypeName,
        selectedDate: conversationState.selectedDate,
      },
      customerName: 'Selami Sahin',
      clinicName: 'Aile Dis Kliniği',
      inputText: 'Mevcut randevuyu sorgulamak istiyorum',
      services: baseServices,
      upsertState,
      resetState: async () => {
        resetCalls += 1;
      },
      getAppointments: async () => [{
        id: 'apt-1',
        date: '2026-05-18',
        startTime: '16:30',
        endTime: '17:00',
        serviceName: 'Estetik Dis Hekimligi',
        practitionerName: 'Dt. Aysegul Akmese',
        status: 'scheduled',
      }],
      formatAppointmentLookup: appointments => [
        'Sistemde görebildiğim randevularınız şunlar:',
        ...appointments.map((appointment, index) => `${index + 1}. ${appointment.date} ${appointment.startTime} - ${appointment.serviceName} / ${appointment.practitionerName} / ${appointment.status}`),
      ].join('\n'),
      formatServiceList: () => 'services',
      formatMainMenu: () => 'main menu',
      handleCancelIntent: async () => 'cancel',
    });

    assert.match(lookupMessage, /Sistemde görebildiğim randevularınız şunlar:/i);
    assert.match(lookupMessage, /2026-05-18 16:30 - Estetik Dis Hekimligi/i);
    assert.equal(resetCalls, 1);
    assert.equal(createdAppointments, 0);
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

  await runFixture('resolved intent router treats APPOINTMENT_QUERY as appointment lookup', async () => {
    let resetCalls = 0;
    const message = await routeResolvedWhatsAppIntent({
      extraction: {
        intent: 'appointment_query',
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
      state: { currentIntent: 'book_appointment', step: 'awaiting_service' },
      customerName,
      clinicName: 'Disklinik',
      inputText: 'randevum var mi',
      services: baseServices,
      upsertState: async () => undefined,
      resetState: async () => {
        resetCalls += 1;
      },
      getAppointments: async () => [{
        id: 'apt-2',
        date: '2026-05-18',
        startTime: '10:00',
        endTime: '10:30',
        serviceName: 'Dis Temizligi',
        practitionerName: 'Dr. B',
        status: 'confirmed',
      }],
      formatAppointmentLookup: appointments => `lookup:${appointments.length}`,
      formatServiceList: () => 'services',
      formatMainMenu: () => 'main menu',
      handleCancelIntent: async () => 'cancel',
    });

    assert.equal(message, 'lookup:1');
    assert.equal(resetCalls, 1);
  });

  await runFixture('resolved intent router asks for clarification instead of repeating the main menu on unknown requests', async () => {
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

    assert.match(message, /mesajınızı tam anlayamadım/i);
    assert.doesNotMatch(message, /1\. Randevu almak/i);
    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].step, null);
    assert.equal(recorder.calls[0].currentIntent, null);
  });

  await runFixture('webhook payload normalizes wrapped Evolution conversation messages', () => {
    const normalized = normalizeEvolutionWebhookPayload({
      body: {
        event: 'messages.upsert',
        instance: 'clinic-main',
        data: {
          key: {
            id: 'msg-1',
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
    assert.equal(normalized.message?.messageId, 'msg-1');
    assert.equal(normalized.message?.instance, 'clinic-main');
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

  await runFixture('webhook secret is required and accepts header or bearer secrets', () => {
    assert.equal(validateWhatsappApiSecret(undefined, {
      xWhatsappSecret: 'anything',
    }), 'not_configured');
    assert.equal(validateWhatsappApiSecret('hook-secret', {
      authorization: 'Bearer hook-secret',
    }), null);
    assert.equal(validateWhatsappApiSecret('hook-secret', {
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
      phone: ' +90 555 111 22 33 ',
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

  // ── Türkçe sözel saat ifadeleri ─────────────────────────────────────────────

  await runFixture('interpreter parses "öğleden sonra iki buçuk ve sonrası" as afterTimeMinutes 14:30', () => {
    const result = interpretTimeRequest('öğleden sonra iki buçuk ve sonrası uygun benim için');
    assert.equal(result.afterTimeMinutes, 14 * 60 + 30, 'afterTimeMinutes 870 olmalı (14:30)');
    assert.equal(result.exactTime, null, 'exactTime null olmalı');
    assert.equal(result.preference, 'afternoon');
  });

  await runFixture('interpreter parses "öğleden sonra iki buçuk" as exactTime 14:30', () => {
    const result = interpretTimeRequest('öğleden sonra iki buçuk uygun');
    assert.equal(result.exactTime, '14:30');
    assert.equal(result.afterTimeMinutes, null);
  });

  await runFixture('interpreter parses "öğleden sonra üç" as exactTime 15:00', () => {
    const result = interpretTimeRequest('öğleden sonra üç gibi gelebilirim');
    assert.equal(result.exactTime, '15:00');
  });

  await runFixture('interpreter parses "sabah sekiz" as exactTime 08:00', () => {
    const result = interpretTimeRequest('sabah sekiz gibi gelebilirim');
    assert.equal(result.exactTime, '08:00');
    assert.equal(result.preference, 'morning');
  });

  await runFixture('interpreter parses "üç buçuk sonrası" as afterTimeMinutes 15:30 without PM context', () => {
    const result = interpretTimeRequest('üç buçuk sonrası uygun benim için');
    assert.equal(result.afterTimeMinutes, 3 * 60 + 30);
  });

  await runFixture('interpreter parses "öğleden sonra dört buçuktan sonra" as afterTimeMinutes 16:30', () => {
    const result = interpretTimeRequest('öğleden sonra dört buçuktan sonra olur');
    assert.equal(result.afterTimeMinutes, 16 * 60 + 30);
  });

  await runFixture('interpreter parses "on dört buçuk" as exactTime 14:30 without needing PM context', () => {
    const result = interpretTimeRequest('on dört buçukta gelebilirim');
    assert.equal(result.exactTime, '14:30');
  });

  // --- Tarih ayrıştırma testleri (whatsappDate.ts) ---

  await runFixture('normalizeDateFromTurkishInput — "3 gün sonra"', () => {
    const today = new Date('2025-06-03T10:00:00.000Z'); // Salı
    const result = normalizeDateFromTurkishInput('3 gün sonra gelebilirim', today, 'Europe/Istanbul');
    assert.equal(result, '2025-06-06');
  });

  await runFixture('normalizeDateFromTurkishInput — "2 hafta sonra"', () => {
    const today = new Date('2025-06-03T10:00:00.000Z');
    const result = normalizeDateFromTurkishInput('2 hafta sonra', today, 'Europe/Istanbul');
    assert.equal(result, '2025-06-17');
  });

  await runFixture('normalizeDateFromTurkishInput — "2 gün sonraki cuma"', () => {
    // Bugün Salı (2025-06-03), pivotDate = Perşembe (2025-06-05), en yakın Cuma = 2025-06-06
    const today = new Date('2025-06-03T10:00:00.000Z');
    const result = normalizeDateFromTurkishInput('2 gün sonraki cuma', today, 'Europe/Istanbul');
    assert.equal(result, '2025-06-06');
  });

  await runFixture('normalizeDateFromTurkishInput — "önümüzdeki cuma" (geçmemişse bu hafta)', () => {
    // Bugün Salı (gün 2), Cuma = gün 5, delta = 3 → 2025-06-06
    const today = new Date('2025-06-03T10:00:00.000Z');
    const result = normalizeDateFromTurkishInput('önümüzdeki cuma', today, 'Europe/Istanbul');
    assert.equal(result, '2025-06-06');
  });

  await runFixture('normalizeDateFromTurkishInput — "önümüzdeki cuma" bugün Cuma ise gelecek Cuma', () => {
    // Bugün Cuma (2025-06-06), "önümüzdeki cuma" → forward modifier → delta=0 → delta+=7 → 2025-06-13
    const today = new Date('2025-06-06T10:00:00.000Z');
    const result = normalizeDateFromTurkishInput('önümüzdeki cuma', today, 'Europe/Istanbul');
    assert.equal(result, '2025-06-13');
  });

  await runFixture('normalizeDateFromTurkishInput — "haftaya perşembe"', () => {
    // Bugün Salı (2025-06-03), Perşembe = gün 4, delta = 2, +7 = 9 → 2025-06-12
    const today = new Date('2025-06-03T10:00:00.000Z');
    const result = normalizeDateFromTurkishInput('haftaya perşembe', today, 'Europe/Istanbul');
    assert.equal(result, '2025-06-12');
  });

  // ─── WhatsApp: date/time preserved through service selection ─────────────────

  await runFixture('awaiting_service preserves selectedDate when transitioning to awaiting_date', async () => {
    const recorder = createStateRecorder();
    const message = await handleAwaitingServiceStep({
      text: '1',
      phone,
      customerName,
      services: baseServices,
      state: {
        selectedDate: '2026-06-11',
        selectedTime: '14:00',
      },
      stateJson: {},
      extractNumericSelection,
      findServiceMatches: () => [],
      formatServiceList: services => services.map((s, i) => `${i + 1}. ${s.name}`).join('\n'),
      upsertState: recorder.upsertState,
    });

    assert.match(message, /Dis Temizligi/i);
    assert.equal(recorder.calls.length, 1);
    assert.equal(recorder.calls[0].step, 'awaiting_date');
    assert.equal(recorder.calls[0].selectedDate, '2026-06-11');
    assert.equal(recorder.calls[0].selectedTime, '14:00');
  });

  await runFixture('awaiting_time re-filters for 14:00 when user says "saat 14 demiştim"', async () => {
    const allSlots: SavedAvailableSlot[] = [
      createSlot('09:00', 'p1', 'Dt. Ahmet'),
      createSlot('10:30', 'p1', 'Dt. Ahmet'),
      createSlot('14:00', 'p2', 'Dt. Ayşe'),
      createSlot('14:30', 'p2', 'Dt. Ayşe'),
    ];
    const recorder = createStateRecorder();

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: 'saat 14 demiştim',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate: '2026-06-11',
      },
      stateJson: { availableSlots: allSlots, lastShownSlots: allSlots.slice(0, 2) },
      extractNumericSelection,
      findSlotMatches: (text, slots) => {
        const extracted = interpretTimeRequest(text).exactTime;
        const matches = extracted ? slots.map((s, i) => ({ slot: s, index: i })).filter(({ slot }) => slot.localStartTime === extracted) : [];
        return { extractedTime: extracted, hasPractitionerFragment: false, matches };
      },
      formatAvailabilityMessage,
      minutesToTime,
      logAvailabilitySave: () => undefined,
      interpretTimeWithAi: async text => {
        const r = interpretTimeRequest(text);
        return { exactTime: r.exactTime, afterTime: r.afterTimeMinutes !== null ? minutesToTime(r.afterTimeMinutes) : null, timePreference: r.preference };
      },
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => { throw new Error('should not be called'); },
    });

    assert.ok(!message.includes('09:00'), `Reply should not include 09:00 slot: ${message}`);
    assert.ok(message.includes('14:00'), `Reply should include 14:00 slot: ${message}`);
  });

  await runFixture('awaiting_time "öğleden sonra" returns afternoon slots only', async () => {
    const allSlots: SavedAvailableSlot[] = [
      createSlot('09:00', 'p1', 'Dt. Ahmet'),
      createSlot('14:00', 'p2', 'Dt. Ayşe'),
      createSlot('15:30', 'p2', 'Dt. Ayşe'),
    ];
    const recorder = createStateRecorder();

    const message = await handleAwaitingTimeStep({
      prisma: {} as never,
      clinicId,
      phone,
      text: 'öğleden sonra',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate: '2026-06-11',
      },
      stateJson: { availableSlots: allSlots, lastShownSlots: allSlots },
      extractNumericSelection,
      findSlotMatches: (text, slots) => {
        const extracted = interpretTimeRequest(text).exactTime;
        return { extractedTime: extracted, hasPractitionerFragment: false, matches: [] };
      },
      formatAvailabilityMessage,
      minutesToTime,
      logAvailabilitySave: () => undefined,
      interpretTimeWithAi: async text => {
        const r = interpretTimeRequest(text);
        return { exactTime: r.exactTime, afterTime: r.afterTimeMinutes !== null ? minutesToTime(r.afterTimeMinutes) : null, timePreference: r.preference };
      },
      upsertState: recorder.upsertState,
      resetState: async () => undefined,
      createAppointment: async () => { throw new Error('should not be called'); },
    });

    assert.ok(!message.includes('09:00'), `Reply should not include 09:00 slot: ${message}`);
    assert.ok(message.includes('14:00') || message.includes('15:30'), `Reply should include afternoon slots: ${message}`);
  });

  // ─── Bug B: getPastMonthDayCorrectedDate ──────────────────────────────────

  await runFixture('getPastMonthDayCorrectedDate returns null for today and future month+day', () => {
    const now = new Date('2026-06-14T10:00:00.000Z'); // 14 Haziran 2026
    // Today → null (not in the past)
    assert.equal(getPastMonthDayCorrectedDate('14 haziran', now), null);
    // Future → null
    assert.equal(getPastMonthDayCorrectedDate('15 haziran', now), null);
    assert.equal(getPastMonthDayCorrectedDate('yarın', now), null);
    assert.equal(getPastMonthDayCorrectedDate('pazartesi', now), null);
  });

  await runFixture('getPastMonthDayCorrectedDate returns current-year ISO for "13 haziran" on 2026-06-14', () => {
    const now = new Date('2026-06-14T10:00:00.000Z');
    const result = getPastMonthDayCorrectedDate('13 haziran', now);
    assert.equal(result, '2026-06-13');
  });

  await runFixture('getPastMonthDayCorrectedDate returns current-year ISO for "11.06" on 2026-06-14', () => {
    const now = new Date('2026-06-14T10:00:00.000Z');
    const result = getPastMonthDayCorrectedDate('11.06', now);
    assert.equal(result, '2026-06-11');
  });

  // ─── Bug B: handleAwaitingDateStep clarification ───────────────────────────

  await runFixture('handleAwaitingDateStep asks for year clarification on explicit past month+day', async () => {
    const recorder = createStateRecorder();
    const now = new Date('2026-06-14T10:00:00.000Z');
    const msg = await handleAwaitingDateStep({
      prisma: {} as never,
      clinicId,
      text: '13 haziran 14.00',
      customerName,
      state: { selectedAppointmentTypeId: 'svc-1', selectedAppointmentTypeName: 'Dis Temizligi' },
      stateJson: {},
      buildAvailableSlots: async () => null,
      formatAvailabilityMessage,
      logAvailabilitySave: () => undefined,
      minutesToTime,
      now,
      upsertState: recorder.upsertState,
    });

    assert.ok(msg.includes('geçmiş'), `Expected past-date warning in: "${msg}"`);
    assert.ok(msg.includes('2026'), `Expected 2026 year in: "${msg}"`);
    assert.ok(msg.includes('2027'), `Expected 2027 year option in: "${msg}"`);
    assert.ok(!msg.includes('Tarihi anlayamadım'), `Should NOT be a "couldn't parse" reply: "${msg}"`);

    // State should store pendingPastDateClarification
    assert.equal(recorder.calls.length, 1);
    const stateJsonSaved = recorder.calls[0].stateJson as BookingStateJson | undefined;
    assert.equal(stateJsonSaved?.pendingPastDateClarification, '2026-06-13');
    assert.equal(recorder.calls[0].step, 'awaiting_date');
  });

  await runFixture('handleAwaitingDateStep uses pendingPastDateClarification when user confirms with evet', async () => {
    const recorder = createStateRecorder();
    const now = new Date('2026-06-14T10:00:00.000Z');
    const rawSlots: RawAvailableSlot[] = [
      createRawSlot('2026-06-13', '10:00', 'p1', 'Dt.', 'Ahmet'),
      createRawSlot('2026-06-13', '14:00', 'p2', 'Dt.', 'Ayşe'),
    ];
    const msg = await handleAwaitingDateStep({
      prisma: {} as never,
      clinicId,
      text: 'evet',
      customerName,
      state: { selectedAppointmentTypeId: 'svc-1', selectedAppointmentTypeName: 'Dis Temizligi' },
      stateJson: { pendingPastDateClarification: '2026-06-13' },
      buildAvailableSlots: async () => rawSlots,
      formatAvailabilityMessage,
      logAvailabilitySave: () => undefined,
      minutesToTime,
      now,
      upsertState: recorder.upsertState,
    });

    // Should show availability for 2026-06-13, not ask for date again
    assert.ok(msg.includes('2026-06-13') || msg.includes('10:00') || msg.includes('14:00'), `Expected slot list: "${msg}"`);
    assert.ok(!msg.includes('geçmiş'), `Should NOT repeat past-date warning: "${msg}"`);

    const finalState = recorder.calls[recorder.calls.length - 1];
    assert.equal(finalState?.step, 'awaiting_time');
    assert.equal(finalState?.selectedDate, '2026-06-13');
  });

  // ─── Bug A: handleAwaitingServiceStep short message when date preserved ────

  await runFixture('handleAwaitingServiceStep returns short message (no date question) when state.selectedDate is set', async () => {
    const recorder = createStateRecorder();
    const msg = await handleAwaitingServiceStep({
      text: '1',
      phone,
      customerName,
      services: baseServices,
      state: { selectedDate: '2026-06-15', selectedTime: '14:00' },
      stateJson: {},
      extractNumericSelection,
      findServiceMatches: () => [],
      formatServiceList: svcs => svcs.map((s, i) => `${i + 1}. ${s.name}`).join('\n'),
      upsertState: recorder.upsertState,
    });

    assert.ok(msg.includes('Dis Temizligi'), `Should mention service: "${msg}"`);
    assert.ok(!msg.includes('Hangi gün'), `Should NOT ask for date when date is already preserved: "${msg}"`);
    assert.equal(recorder.calls[0].step, 'awaiting_date');
    assert.equal(recorder.calls[0].selectedDate, '2026-06-15');
  });

  await runFixture('handleAwaitingServiceStep asks for date normally when state.selectedDate is null', async () => {
    const recorder = createStateRecorder();
    const msg = await handleAwaitingServiceStep({
      text: '1',
      phone,
      customerName,
      services: baseServices,
      state: { selectedDate: null },
      stateJson: {},
      extractNumericSelection,
      findServiceMatches: () => [],
      formatServiceList: svcs => svcs.map((s, i) => `${i + 1}. ${s.name}`).join('\n'),
      upsertState: recorder.upsertState,
    });

    assert.ok(msg.includes('Hangi gün'), `Should ask for date when no date preserved: "${msg}"`);
    assert.equal(recorder.calls[0].step, 'awaiting_date');
    assert.equal(recorder.calls[0].selectedDate, null);
  });

  // ─── Bug A: customerName preserved from initial AI slot extraction ─────────

  await runFixture('handleAwaitingServiceStep preserves customerName provided at call site', async () => {
    const recorder = createStateRecorder();
    await handleAwaitingServiceStep({
      text: '1',
      phone,
      customerName: 'Faruk Duman',
      services: baseServices,
      state: { selectedDate: '2026-06-15', selectedTime: '14:00' },
      stateJson: {},
      extractNumericSelection,
      findServiceMatches: () => [],
      formatServiceList: svcs => svcs.map((s, i) => `${i + 1}. ${s.name}`).join('\n'),
      upsertState: recorder.upsertState,
    });

    assert.equal(recorder.calls[0].customerName, 'Faruk Duman');
  });

  // ─── Bug C: handleAwaitingConfirmationStep structured error logging ─────────

  await runFixture('handleAwaitingConfirmationStep returns friendly error message on appointment creation failure', async () => {
    const pendingSlot = createSlot('14:00', 'p2', 'Dt. Ayşe');
    const recorder = createStateRecorder();
    const msg = await handleAwaitingConfirmationStep({
      clinicId,
      phone,
      text: 'evet',
      customerName,
      state: {
        selectedAppointmentTypeId: 'svc-1',
        selectedAppointmentTypeName: 'Dis Temizligi',
        selectedDate: '2026-06-15',
      },
      stateJson: { pendingConfirmationSlot: pendingSlot, availableSlots: [pendingSlot], lastShownSlots: [pendingSlot] },
      resetState: async () => undefined,
      upsertState: recorder.upsertState,
      createAppointment: async () => { throw new Error('DB_CONSTRAINT_VIOLATION'); },
    });

    assert.ok(msg.includes('teknik bir sorun'), `Expected friendly error: "${msg}"`);
    assert.ok(!msg.includes('DB_CONSTRAINT_VIOLATION'), `Error details must not leak to user: "${msg}"`);
  });

  console.log('All WhatsApp conversation fixtures passed.');
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
