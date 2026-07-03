/**
 * whatsappAwaitingServiceStep.test.ts — Regression tests for the awaiting_service
 * conversation-understanding bug (production symptom: bot stuck repeating
 * "Lütfen listedeki hizmet numarasını seçin." for any non-numeric message,
 * including requests to resend the list, and for a stale "Merhaba").
 *
 * handleAwaitingServiceStep (server/src/services/whatsappBookingFlow.ts) is the
 * shared, dependency-injected step handler used by both the Meta WhatsApp Cloud
 * processor and the Evolution webhook route — testing it directly here exercises
 * real production logic without needing a live DB.
 *
 * The stale-greeting and human-handoff-escape behaviors live one level up, in
 * metaWhatsAppAiProcessor.ts's step-dispatch predicates (isStuckBookingStep,
 * isHumanHandoffRequest) and the broadened isMainMenuCommand/isGreeting gate —
 * those pure predicates are exercised directly below as well.
 *
 * Run with: cd server && npx tsx src/tests/whatsappAwaitingServiceStep.test.ts
 */

import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = 'c'.repeat(64);

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
  handleAwaitingServiceStep,
  type BookingServiceOption,
} from '../services/whatsappBookingFlow.js';
import {
  isStuckBookingStep,
  isHumanHandoffRequest,
} from '../services/whatsapp/metaWhatsAppAiProcessor.js';

const SERVICES: BookingServiceOption[] = [
  { id: 'svc-1', name: 'Diş Beyazlatma', durationMinutes: 30 },
  { id: 'svc-2', name: 'Kanal Tedavisi', durationMinutes: 60 },
  { id: 'svc-5', name: 'Ortodonti Muayenesi', durationMinutes: 45 },
];

// Mirrors the substring-based fuzzy matcher the real callers pass in.
const findServiceMatches = (text: string, services: BookingServiceOption[]) => {
  const normalized = text.trim().toLocaleLowerCase('tr-TR');
  if (!normalized || /^\d+$/.test(normalized)) return [];
  return services.filter(s => s.name.toLocaleLowerCase('tr-TR').includes(normalized));
};

const extractNumericSelection = (text: string): number | null => {
  const m = text.trim().match(/^(\d{1,2})(?:[.)])?$/);
  return m ? Number(m[1]) : null;
};

const formatServiceList = (services: BookingServiceOption[]) =>
  ['Elbette, hangi hizmet için randevu planlamak istersiniz?', ...services.map((s, i) => `${i + 1}. ${s.name}`)].join('\n');

function makeDeps(text: string, overrides: Partial<Parameters<typeof handleAwaitingServiceStep>[0]> = {}) {
  const upsertCalls: unknown[] = [];
  return {
    deps: {
      text,
      phone: 'whatsapp:conn-1:905551234567',
      customerName: 'Test Hasta',
      services: SERVICES,
      state: {},
      stateJson: {},
      extractNumericSelection,
      findServiceMatches,
      formatServiceList,
      upsertState: async (data: unknown) => { upsertCalls.push(data); },
      ...overrides,
    },
    upsertCalls,
  };
}

async function main() {
  section('handleAwaitingServiceStep — list-resend requests');

  await test('"Listeyi tekrar iletir misiniz" resends the actual service list', async () => {
    const { deps } = makeDeps('Listeyi tekrar iletir misiniz');
    const reply = await handleAwaitingServiceStep(deps);
    assert.ok(reply.includes('1. Diş Beyazlatma'), 'reply should include service #1');
    assert.ok(reply.includes('2. Kanal Tedavisi'), 'reply should include service #2');
    assert.ok(reply.includes('3. Ortodonti Muayenesi'), 'reply should include service #3');
    assert.ok(!reply.includes('Lütfen listedeki hizmet numarasını seçin'), 'must not be the dumb numeric-only fallback');
  });

  await test('"hangi hizmetler var" resends the actual service list', async () => {
    const { deps } = makeDeps('hangi hizmetler var');
    const reply = await handleAwaitingServiceStep(deps);
    assert.ok(reply.includes('1. Diş Beyazlatma'));
    assert.ok(reply.includes('3. Ortodonti Muayenesi'));
  });

  await test('"hizmet listesini gönder" resends the actual service list', async () => {
    const { deps } = makeDeps('hizmet listesini gönder');
    const reply = await handleAwaitingServiceStep(deps);
    assert.ok(reply.includes('1. Diş Beyazlatma'));
  });

  section('handleAwaitingServiceStep — unresolvable free text');

  await test('invalid nonnumeric text returns the service list, not just generic numeric instruction', async () => {
    const { deps } = makeDeps('bilmiyorum ne seçeceğimi');
    const reply = await handleAwaitingServiceStep(deps);
    assert.ok(reply.includes('1. Diş Beyazlatma'), 'fallback must include the real list');
    assert.ok(reply.includes('2. Kanal Tedavisi'));
    assert.ok(reply.includes('3. Ortodonti Muayenesi'));
    assert.ok(reply.startsWith('Size uygun hizmeti seçebilmem için'), 'fallback should lead with a helpful instruction');
  });

  section('handleAwaitingServiceStep — valid selection still works');

  await test('valid numeric selection still selects the service and advances to awaiting_date', async () => {
    const { deps, upsertCalls } = makeDeps('2');
    const reply = await handleAwaitingServiceStep(deps);
    assert.ok(reply.toLowerCase().includes('kanal tedavisi') || reply.toLowerCase().includes('tarih'), 'reply should progress the booking, not repeat the list');
    const lastUpsert = upsertCalls[upsertCalls.length - 1] as { step?: string; selectedAppointmentTypeId?: string };
    assert.equal(lastUpsert.step, 'awaiting_date');
    assert.equal(lastUpsert.selectedAppointmentTypeId, 'svc-2');
  });

  await test('exact service name match still selects the service', async () => {
    const { deps, upsertCalls } = makeDeps('Diş Beyazlatma');
    await handleAwaitingServiceStep(deps);
    const lastUpsert = upsertCalls[upsertCalls.length - 1] as { selectedAppointmentTypeId?: string };
    assert.equal(lastUpsert.selectedAppointmentTypeId, 'svc-1');
  });

  section('Meta processor — stuck-flow escape predicates');

  await test('isStuckBookingStep is true for awaiting_service', () => {
    assert.equal(isStuckBookingStep('awaiting_service'), true);
  });

  await test('isStuckBookingStep is false for main_menu / null (nothing to escape from)', () => {
    assert.equal(isStuckBookingStep('main_menu'), false);
    assert.equal(isStuckBookingStep(null), false);
  });

  await test('isHumanHandoffRequest recognizes "temsilci" and related phrasings', () => {
    assert.equal(isHumanHandoffRequest('temsilci ile görüşmek istiyorum'), true);
    assert.equal(isHumanHandoffRequest('bir yetkili bana ulaşsın'), true);
    assert.equal(isHumanHandoffRequest('Diş Beyazlatma'), false);
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
