/**
 * whatsappStepAwareNlu.test.ts — Regression tests for the step-aware semantic
 * fallback architecture change: Gemini/NLU must be reachable from every active
 * booking step (not only the final top-level fallback), while deterministic
 * parsing still runs first and still wins for high-confidence structured input.
 *
 * Run with: cd server && npx tsx src/tests/whatsappStepAwareNlu.test.ts
 */

import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = 'c'.repeat(64);
// No Google AI Studio key configured in tests -> resolveStepAwareWhatsAppIntent
// always exercises the network-free rule-based classifier (source: rule_fallback).
delete process.env.GOOGLE_AI_STUDIO_API_KEY;
delete process.env.GEMINI_API_KEY;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

import {
  resolveStepAwareWhatsAppIntent,
  type ResolveStepAwareWhatsAppIntentArgs,
} from '../services/whatsappStepAwareNlu.js';
import {
  handleAwaitingDateStep,
  handleAwaitingTimeStep,
  isDeterministicConfirmationReply,
  type BookingServiceOption,
} from '../services/whatsappBookingFlow.js';
import type { SavedAvailableSlot } from '../services/whatsappAvailability.js';

const SERVICES: BookingServiceOption[] = [
  { id: 'svc-1', name: 'Diş Taşı Temizliği', durationMinutes: 30 },
  { id: 'svc-2', name: 'Kanal Tedavisi', durationMinutes: 60 },
  { id: 'svc-5', name: 'Ortodonti Muayenesi', durationMinutes: 45 },
];

function baseArgs(overrides: Partial<ResolveStepAwareWhatsAppIntentArgs>): ResolveStepAwareWhatsAppIntentArgs {
  return {
    clinicId: 'clinic-1',
    phone: 'whatsapp:conn-1:33753849141',
    currentStep: 'awaiting_service',
    currentIntent: 'book_appointment',
    lastMessage: null,
    userText: '',
    availableServices: SERVICES,
    selectedService: null,
    selectedDate: null,
    selectedTime: null,
    ...overrides,
  };
}

async function main() {
  section('resolveStepAwareWhatsAppIntent — awaiting_service');

  await test('arbitrary unresolvable text calls the NLU fallback (nluUsed) and classifies as cannot_choose_service', async () => {
    const { decision, source } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ userText: 'bilmiyorum bakalim ne olur' }),
    );
    assert.notEqual(source, 'unavailable');
    assert.equal(decision.intent, 'cannot_choose_service');
  });

  await test('"diş temizliği istiyorum" resolves to the closest matching service via loose description matching', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ userText: 'diş temizliği istiyorum' }),
    );
    assert.equal(decision.intent, 'select_service_by_name_or_description');
    assert.equal(decision.extractedServiceId, 'svc-1');
    assert.ok(decision.confidence >= 0.5);
  });

  await test('"fiyatlar ne kadar" classifies as ask_service_price_or_duration', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ userText: 'fiyatlar ne kadar' }),
    );
    assert.equal(decision.intent, 'ask_service_price_or_duration');
  });

  await test('extractedServiceId is never invented for an id outside availableServices', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ userText: 'tamamen alakasiz bir mesaj' }),
    );
    if (decision.extractedServiceId) {
      assert.ok(SERVICES.some(s => s.id === decision.extractedServiceId));
    }
  });

  section('resolveStepAwareWhatsAppIntent — awaiting_confirmation');

  await test('"saat 15 olsun" classifies as change_time with extracted 15:00, not confirm_booking', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_confirmation', userText: 'saat 15 olsun' }),
    );
    assert.equal(decision.intent, 'change_time');
    assert.equal(decision.extractedTime, '15:00');
  });

  await test('"tamam onaylıyorum" is a deterministic confirmation reply and must not reach the NLU layer', () => {
    assert.equal(isDeterministicConfirmationReply('tamam onaylıyorum'), true);
  });

  section('resolveStepAwareWhatsAppIntent — cross-step general intents');

  await test('"temsilciyle görüşmek istiyorum" is human_handoff regardless of step', async () => {
    for (const step of ['awaiting_service', 'awaiting_date', 'awaiting_time', 'awaiting_confirmation'] as const) {
      const { decision } = await resolveStepAwareWhatsAppIntent(
        baseArgs({ currentStep: step, userText: 'temsilciyle görüşmek istiyorum' }),
      );
      assert.equal(decision.intent, 'human_handoff', `expected human_handoff at step ${step}`);
    }
  });

  await test('"baştan başlayalım" is restart_flow regardless of step', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_time', userText: 'baştan başlayalım' }),
    );
    assert.equal(decision.intent, 'restart_flow');
  });

  section('resolveStepAwareWhatsAppIntent — unknown input still yields a contextual, actionable decision');

  await test('unknown awaiting_date input classifies as unknown_date_request (not a raw dead-end)', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_date', userText: 'asdkjaskjd' }),
    );
    assert.equal(decision.intent, 'unknown_date_request');
  });

  section('resolveStepAwareWhatsAppIntent — safety: never resolves patient identity');

  await test('decision shape has no patient-identifying field (shared-phone safety stays in deterministic code)', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ userText: 'herhangi bir mesaj' }),
    );
    const keys = Object.keys(decision);
    assert.ok(!keys.some(k => k.toLowerCase().includes('patient')));
  });

  section('Existing deterministic date/time handling already covers common natural phrasing (no NLU needed)');

  const makePractitionerSlots = (times: string[]): SavedAvailableSlot[] =>
    times.map((t, i) => ({
      practitionerId: `pr-${i}`,
      practitionerName: 'Dr. Test',
      startTime: `2026-07-04T${t}:00.000Z`,
      endTime: `2026-07-04T${t}:30.000Z`,
      localStartTime: t,
      localEndTime: t,
    }));

  await test('awaiting_date + "yarın öğleden sonra olur mu" filters to afternoon slots deterministically', async () => {
    const fixtureSlots = makePractitionerSlots(['09:00', '10:00', '14:00', '15:00']);
    const reply = await handleAwaitingDateStep({
      prisma: {} as any,
      clinicId: 'clinic-1',
      text: 'yarın öğleden sonra olur mu',
      customerName: 'Test Hasta',
      state: { selectedAppointmentTypeId: 'svc-2', selectedAppointmentTypeName: 'Kanal Tedavisi', selectedDate: null },
      stateJson: {},
      buildAvailableSlots: async () => fixtureSlots.map(s => ({
        practitioner: { id: s.practitionerId, firstName: 'Dr.', lastName: 'Test' },
        startTime: new Date(s.startTime),
        endTime: new Date(s.endTime),
        localStartTime: s.localStartTime,
        localEndTime: s.localEndTime,
      })),
      formatAvailabilityMessage: (date, slots) => `AVAILABILITY:${date}:${slots.map(s => s.localStartTime).join(',')}`,
      logAvailabilitySave: () => {},
      minutesToTime: m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
      upsertState: async () => {},
    });
    assert.ok(reply.includes('14:00') || reply.includes('öğleden sonra'), `expected afternoon slots in: ${reply}`);
    assert.ok(!reply.includes('09:00'), `morning slot should be filtered out: ${reply}`);
  });

  await test('awaiting_time + "sabah daha uygun" filters to morning slots deterministically', async () => {
    const fixtureSlots = makePractitionerSlots(['09:00', '10:00', '14:00', '15:00']);
    const reply = await handleAwaitingTimeStep({
      prisma: {} as any,
      clinicId: 'clinic-1',
      phone: 'whatsapp:conn-1:33753849141',
      text: 'sabah daha uygun',
      customerName: 'Test Hasta',
      state: {
        selectedAppointmentTypeId: 'svc-2',
        selectedAppointmentTypeName: 'Kanal Tedavisi',
        selectedPractitionerId: null,
        selectedDate: '2026-07-04',
      },
      stateJson: { availableSlots: fixtureSlots, lastShownSlots: fixtureSlots },
      extractNumericSelection: () => null,
      findSlotMatches: () => ({ extractedTime: null, hasPractitionerFragment: false, matches: [] }),
      formatAvailabilityMessage: (date, slots) => `AVAILABILITY:${date}:${slots.map(s => s.localStartTime).join(',')}`,
      minutesToTime: m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
      logAvailabilitySave: () => {},
      upsertState: async () => {},
      resetState: async () => {},
      createAppointment: async () => ({ appointmentType: null }),
    });
    assert.ok(reply.includes('09:00') || reply.includes('sabah'), `expected morning slots in: ${reply}`);
    assert.ok(!reply.includes('15:00'), `afternoon slot should be filtered out: ${reply}`);
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
