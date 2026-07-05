/**
 * instagramAssistantParity.test.ts — Instagram DM assistant parity with the
 * latest WhatsApp assistant architecture (deterministic-first, step-aware
 * NLU fallback second, validation/safety always last).
 *
 * Covers:
 *  - the new 'awaiting_phone' step-aware NLU intents (Instagram-only — WhatsApp
 *    already knows the phone number, so this step didn't previously exist)
 *  - Instagram-specific guard/formatter functions: no placeholder identity is
 *    ever produced for a real booking, name/phone validation, conversation key
 *    building, consent-resume messaging
 *  - the InstagramConversationMessage persistence/dedupe/backfill *rules*
 *    (mirrored against the exact where-clauses used in
 *    instagramAiConversationProcessor.ts, in the same "fake DB" style as
 *    patientSharedPhone.test.ts / whatsappConversationPersistence.test.ts)
 *
 * The live DB-touching paths inside processInstagramIncomingMessage (real
 * Prisma calls for InstagramConversationMessage/InstagramInboxEntry/Patient)
 * are not exercised end-to-end here — same convention as
 * whatsappIdentityAndPostBooking.test.ts. Verify those manually against a
 * staging Instagram connection before deploying (see PR description).
 *
 * Run with: cd server && npx tsx src/tests/instagramAssistantParity.test.ts
 */

import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY = 'c'.repeat(64);
delete process.env.GOOGLE_AI_STUDIO_API_KEY;
delete process.env.GEMINI_API_KEY;

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
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
import type { BookingServiceOption } from '../services/whatsappBookingFlow.js';
import {
  normalizeInstagramPatientPhone,
  buildInstagramAppointmentFallbackPhone,
  hasUsableInstagramFullName,
  formatInstagramCustomerName,
  buildInstagramConversationKey,
  buildInstagramAppointmentRequestSourceMetadata,
  formatInstagramBookingCreatedReply,
  isConsentResumableStep,
  canProcessInstagramAi,
} from '../services/instagram/instagramAiConversationProcessor.js';

const SERVICES: BookingServiceOption[] = [
  { id: 'svc-1', name: 'Diş Taşı Temizliği', durationMinutes: 30 },
  { id: 'svc-2', name: 'Ağız, Diş ve Çene Cerrahisi', durationMinutes: 60 },
];

function baseArgs(overrides: Partial<ResolveStepAwareWhatsAppIntentArgs>): ResolveStepAwareWhatsAppIntentArgs {
  return {
    clinicId: 'clinic-1',
    phone: 'instagram:conn-1:1050315040903637',
    currentStep: 'awaiting_phone',
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
  // ── Part D: step-aware NLU — new awaiting_phone step ─────────────────────

  section('resolveStepAwareWhatsAppIntent — awaiting_phone (Instagram-only step)');

  await test('"neden istiyorsunuz" at awaiting_phone classifies as ask_why_phone_needed', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_phone', userText: 'neden istiyorsunuz' }),
    );
    assert.equal(decision.intent, 'ask_why_phone_needed');
  });

  await test('unrecognized free text at awaiting_phone classifies as unknown_phone_request (contextual, not a dead-end)', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_phone', userText: 'bilmiyorum ki' }),
    );
    assert.equal(decision.intent, 'unknown_phone_request');
  });

  await test('awaiting_phone decision never extracts/invents a phone number itself — actual parsing stays deterministic', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_phone', userText: '+90 532 111 22 33' }),
    );
    assert.equal('extractedPhone' in decision, false);
    assert.equal(decision.extractedServiceId, null);
  });

  await test('human_handoff at awaiting_phone still takes priority over phone-specific intents', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_phone', userText: 'temsilciyle görüşmek istiyorum' }),
    );
    assert.equal(decision.intent, 'human_handoff');
  });

  await test('restart_flow at awaiting_phone is still classified (general intents apply to every step)', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_phone', userText: 'baştan başlayalım' }),
    );
    assert.equal(decision.intent, 'restart_flow');
  });

  // ── Part D: awaiting_service escalation intents Instagram now shares ─────

  section('resolveStepAwareWhatsAppIntent — awaiting_service (repeat list / price)');

  await test('"hizmetleri tekrar gönderir misiniz" style free text classifies with a usable fallback intent', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_service', userText: 'fiyat ne kadar' }),
    );
    assert.equal(decision.intent, 'ask_service_price_or_duration');
  });

  await test('loose service description match extracts a real service id from Available services', async () => {
    const { decision } = await resolveStepAwareWhatsAppIntent(
      baseArgs({ currentStep: 'awaiting_service', userText: 'diş temizliği istiyorum' }),
    );
    assert.equal(decision.intent, 'select_service_by_name_or_description');
    assert.equal(decision.extractedServiceId, 'svc-1');
  });

  // ── Part C/F: identity guards — never a placeholder name for a real booking ─

  section('Instagram identity guards — no placeholder name/phone for real bookings');

  await test('hasUsableInstagramFullName rejects a single word', () => {
    assert.equal(hasUsableInstagramFullName('Ahmet'), false);
  });

  await test('hasUsableInstagramFullName rejects a numeric-looking value (platform id leak)', () => {
    assert.equal(hasUsableInstagramFullName('1050315040903637'), false);
  });

  await test('hasUsableInstagramFullName accepts a real first+last name', () => {
    assert.equal(hasUsableInstagramFullName('Ayşe Yılmaz'), true);
  });

  await test('formatInstagramCustomerName returns null (never a placeholder) when nothing is resolved yet', () => {
    const name = formatInstagramCustomerName(null, '1050315040903637', null);
    assert.equal(name, null);
  });

  await test('formatInstagramCustomerName falls back to @username, never to "Instagram Kullanıcısı"', () => {
    const name = formatInstagramCustomerName(null, '1050315040903637', 'ayse.yilmaz');
    assert.equal(name, '@ayse.yilmaz');
  });

  await test('formatInstagramCustomerName ignores a numeric-looking username (platform id, not a real handle)', () => {
    const name = formatInstagramCustomerName(null, '1050315040903637', '1050315040903637');
    assert.equal(name, null);
  });

  await test('formatInstagramCustomerName prefers the linked patient full name over username', () => {
    const name = formatInstagramCustomerName(
      { id: 'entry-1', patientId: 'pat-1', senderUsername: 'ayse.yilmaz', patient: { id: 'pat-1', firstName: 'Ayşe', lastName: 'Yılmaz', phone: '905321112233' } },
      '1050315040903637',
      'ayse.yilmaz',
    );
    assert.equal(name, 'Ayşe Yılmaz');
  });

  await test('normalizeInstagramPatientPhone rejects a 16-digit Instagram-scoped sender id as a phone number', () => {
    assert.equal(normalizeInstagramPatientPhone('1050315040903637'), null);
  });

  await test('normalizeInstagramPatientPhone accepts a real E.164-ish phone', () => {
    assert.equal(normalizeInstagramPatientPhone('+90 532 111 22 33'), '905321112233');
  });

  await test('buildInstagramAppointmentFallbackPhone falls back to the unknown-phone placeholder only when the sender id itself is not phone-shaped', () => {
    assert.equal(buildInstagramAppointmentFallbackPhone('1050315040903637'), '0000000000');
  });

  await test('canProcessInstagramAi refuses to run the assistant while clinic resolution is still pending', () => {
    assert.equal(canProcessInstagramAi({ clinicId: 'clinic-1', needsClinicResolution: true }), false);
    assert.equal(canProcessInstagramAi({ clinicId: 'clinic-1', needsClinicResolution: false }), true);
    assert.equal(canProcessInstagramAi({ clinicId: null, needsClinicResolution: false }), false);
  });

  // ── Conversation key / source metadata / booking reply formatting ───────

  section('Instagram conversation key & appointment source metadata');

  await test('buildInstagramConversationKey namespaces by connection + sender (never collides with WhatsApp)', () => {
    const key = buildInstagramConversationKey('conn-1', '1050315040903637');
    assert.equal(key, 'instagram:conn-1:1050315040903637');
  });

  await test('buildInstagramAppointmentRequestSourceMetadata always tags source as instagram with sender/connection/conversation ids', () => {
    const meta = buildInstagramAppointmentRequestSourceMetadata({
      instagramConnectionId: 'conn-1',
      externalSenderId: '1050315040903637',
      externalConversationId: 'conv-1',
      inboxEntryId: 'entry-1',
    });
    assert.equal(meta.source, 'instagram');
    assert.equal(meta.sourceConnectionId, 'conn-1');
    assert.equal(meta.sourceConversationId, 'conv-1');
    assert.equal(meta.sourceInboxEntryId, 'entry-1');
  });

  await test('formatInstagramBookingCreatedReply never emits a placeholder customer name — it echoes exactly what it was given', () => {
    const reply = formatInstagramBookingCreatedReply({
      customerName: 'Ayşe Yılmaz',
      selectedDate: '2026-07-10',
      localStartTime: '14:00',
      practitionerName: 'Dr. Demir',
      serviceName: 'Diş Taşı Temizliği',
    });
    assert.ok(reply.includes('Ayşe Yılmaz'));
    assert.ok(!reply.includes('Kullanıcısı'));
  });

  await test('isConsentResumableStep includes awaiting_phone (a mid-flow consent prompt must resume, not discard, the phone step)', () => {
    assert.equal(isConsentResumableStep('awaiting_phone'), true);
    assert.equal(isConsentResumableStep('main_menu'), false);
    assert.equal(isConsentResumableStep(null), false);
  });

  // ── Part B: persistence/dedupe/backfill rules ────────────────────────────
  // Mirrors the exact where-clauses used in instagramAiConversationProcessor.ts
  // and instagramClinicResolver.ts (fake-DB rule test, same convention as
  // whatsappConversationPersistence.test.ts / patientSharedPhone.test.ts).

  section('InstagramConversationMessage persistence rules (dedupe + backfill)');

  type FakeMessageRow = {
    id: string;
    organizationId: string;
    clinicId: string | null;
    patientId: string | null;
    instagramConnectionId: string;
    externalSenderId: string;
    externalMessageId: string | null;
    direction: 'incoming' | 'outgoing';
    text: string;
  };

  function makeFakeMessageStore() {
    const rows: FakeMessageRow[] = [];
    let seq = 0;
    // Mirrors @@unique([organizationId, externalMessageId]) in schema.prisma.
    function create(data: Omit<FakeMessageRow, 'id'>) {
      if (
        data.externalMessageId !== null &&
        rows.some(r => r.organizationId === data.organizationId && r.externalMessageId === data.externalMessageId)
      ) {
        const err = new Error('Unique constraint failed') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      const row: FakeMessageRow = { id: `msg-${++seq}`, ...data };
      rows.push(row);
      return row;
    }
    // Mirrors the backfill updateMany in processInstagramIncomingMessage (scoped
    // to organization + connection + sender, only rows still unlinked).
    function backfill(args: { organizationId: string; instagramConnectionId: string; externalSenderId: string; patientId: string }) {
      let count = 0;
      for (const row of rows) {
        if (
          row.organizationId === args.organizationId &&
          row.instagramConnectionId === args.instagramConnectionId &&
          row.externalSenderId === args.externalSenderId &&
          row.patientId === null
        ) {
          row.patientId = args.patientId;
          count++;
        }
      }
      return count;
    }
    return { rows, create, backfill };
  }

  const ORG = 'org-1';
  const CONN = 'conn-1';
  const SENDER = '1050315040903637';

  await test('inbound message with no resolved patient is persisted with patientId null (never lost)', () => {
    const store = makeFakeMessageStore();
    const row = store.create({
      organizationId: ORG, clinicId: 'clinic-1', patientId: null, instagramConnectionId: CONN,
      externalSenderId: SENDER, externalMessageId: 'ig-msg-1', direction: 'incoming', text: 'merhaba',
    });
    assert.equal(row.patientId, null);
    assert.equal(store.rows.length, 1);
  });

  await test('duplicate externalMessageId does not create a second row', () => {
    const store = makeFakeMessageStore();
    store.create({ organizationId: ORG, clinicId: 'clinic-1', patientId: null, instagramConnectionId: CONN, externalSenderId: SENDER, externalMessageId: 'ig-msg-2', direction: 'incoming', text: 'a' });
    assert.throws(() => store.create({ organizationId: ORG, clinicId: 'clinic-1', patientId: null, instagramConnectionId: CONN, externalSenderId: SENDER, externalMessageId: 'ig-msg-2', direction: 'incoming', text: 'a-retry' }));
    assert.equal(store.rows.length, 1);
  });

  await test('outbound assistant reply is persisted with direction outgoing', () => {
    const store = makeFakeMessageStore();
    store.create({ organizationId: ORG, clinicId: 'clinic-1', patientId: null, instagramConnectionId: CONN, externalSenderId: SENDER, externalMessageId: null, direction: 'outgoing', text: 'Merhaba, size nasıl yardımcı olabilirim?' });
    assert.equal(store.rows[0].direction, 'outgoing');
  });

  await test('backfill links unlinked inbound+outbound rows once patient is created/linked', () => {
    const store = makeFakeMessageStore();
    store.create({ organizationId: ORG, clinicId: 'clinic-1', patientId: null, instagramConnectionId: CONN, externalSenderId: SENDER, externalMessageId: 'ig-msg-3', direction: 'incoming', text: 'randevu istiyorum' });
    store.create({ organizationId: ORG, clinicId: 'clinic-1', patientId: null, instagramConnectionId: CONN, externalSenderId: SENDER, externalMessageId: null, direction: 'outgoing', text: 'Elbette...' });
    const count = store.backfill({ organizationId: ORG, instagramConnectionId: CONN, externalSenderId: SENDER, patientId: 'patient-ayse' });
    assert.equal(count, 2);
    assert.ok(store.rows.every(r => r.patientId === 'patient-ayse'));
  });

  await test('backfill never touches rows already linked to a different patient (shared-device/shared-phone safety)', () => {
    const store = makeFakeMessageStore();
    store.create({ organizationId: ORG, clinicId: 'clinic-1', patientId: 'patient-sibling', instagramConnectionId: CONN, externalSenderId: SENDER, externalMessageId: 'ig-msg-4', direction: 'incoming', text: 'm1' });
    store.create({ organizationId: ORG, clinicId: 'clinic-1', patientId: null, instagramConnectionId: CONN, externalSenderId: SENDER, externalMessageId: 'ig-msg-5', direction: 'incoming', text: 'm2' });
    const count = store.backfill({ organizationId: ORG, instagramConnectionId: CONN, externalSenderId: SENDER, patientId: 'patient-ayse' });
    assert.equal(count, 1);
    assert.equal(store.rows[0].patientId, 'patient-sibling');
    assert.equal(store.rows[1].patientId, 'patient-ayse');
  });

  await test('backfill never crosses organizations or connections/senders', () => {
    const store = makeFakeMessageStore();
    store.create({ organizationId: 'org-2', clinicId: 'clinic-9', patientId: null, instagramConnectionId: CONN, externalSenderId: SENDER, externalMessageId: 'ig-msg-6', direction: 'incoming', text: 'm1' });
    store.create({ organizationId: ORG, clinicId: 'clinic-1', patientId: null, instagramConnectionId: 'conn-2', externalSenderId: SENDER, externalMessageId: 'ig-msg-7', direction: 'incoming', text: 'm2' });
    const count = store.backfill({ organizationId: ORG, instagramConnectionId: CONN, externalSenderId: SENDER, patientId: 'patient-ayse' });
    assert.equal(count, 0);
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
