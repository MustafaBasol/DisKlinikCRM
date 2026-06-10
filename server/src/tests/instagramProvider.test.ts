/**
 * instagramProvider.test.ts — Unit tests for Instagram DM provider, resolver, permissions, and webhook parsing
 *
 * Run with:  tsx src/tests/instagramProvider.test.ts
 * No external test framework required — uses node:assert/strict + manual counters.
 */

import assert from 'node:assert/strict';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── Encryption setup ─────────────────────────────────────────────────────────
process.env.ENCRYPTION_KEY = 'b'.repeat(64);

import { encryptSecret, decryptSecret } from '../utils/encryption.js';
import {
  INSTAGRAM_LOGIN_GRAPH_API_BASE,
  testConnection,
  sendMessage,
  parseWebhook,
} from '../services/instagram/InstagramMessagingProvider.js';
import { verifyMetaWebhookChallenge } from '../utils/webhookVerification.js';
import { selectUniqueProviderConnection } from '../utils/webhookRouting.js';
import type { InstagramConnectionRecord } from '../services/instagram/InstagramMessagingProvider.js';
import {
  canManageInstagramConnections,
  canAssignInstagramToClinic,
  canViewInstagramStatus,
  canViewInstagramInbox,
  canReplyInstagramMessages,
  canResolveInstagramConversation,
} from '../utils/roles.js';
import {
  buildInstagramAppointmentFallbackPhone,
  buildInstagramConversationKey,
  buildInstagramAppointmentRequestSourceMetadata,
  canProcessInstagramAi,
  formatInstagramCustomerName,
  formatInstagramBookingCreatedReply,
  formatMainMenu,
  hasUsableInstagramFullName,
  normalizeInstagramPatientPhone,
} from '../services/instagram/instagramAiConversationProcessor.js';
import { handleAwaitingConfirmationStep } from '../services/whatsappBookingFlow.js';
import { resolveInstagramClinicFromKnownContext } from '../services/instagram/instagramClinicResolver.js';
import { buildInstagramClinicAssignments } from '../routes/organizationInstagram.js';
import {
  resolveAppointmentRequestSourceFilter,
  shouldIncludeLegacyWhatsappAppointmentRows,
} from '../routes/appointmentRequests.js';
import {
  processInstagramEventForConnection,
  resolveInstagramWebhookConnectionFromCandidates,
  type InstagramWebhookConnection,
  type InstagramWebhookProcessingDeps,
} from '../routes/instagramWebhook.js';

// ─── Fake connection record ────────────────────────────────────────────────────

function makeConn(overrides: Partial<InstagramConnectionRecord> = {}): InstagramConnectionRecord {
  return {
    id: 'test-conn-id',
    organizationId: 'org-1',
    instagramAccountId: '123456789',
    instagramUsername: 'testclinic',
    accessTokenEncrypted: encryptSecret('fake-page-access-token'),
    webhookSecret: null,
    isActive: true,
    ...overrides,
  };
}

type FetchMock = (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>;

async function withMockFetch(mock: FetchMock, fn: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    return Promise.resolve(mock(input, init));
  }) as typeof fetch;

  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type InstagramProcessingCounters = {
  inboundCalls: number;
  inboxMessageCount: number;
  aiCalls: number;
  processedCalls: number;
  failedCalls: number;
};

function makeSuccessfulInstagramProcessingDeps(
  counters: InstagramProcessingCounters,
): InstagramWebhookProcessingDeps {
  return {
    resolveClinicForInstagramMessage: async () => ({
      clinicId: 'clinic-1',
      needsClinicResolution: false,
      resolutionSource: 'connection_single',
    }),
    createInboundEventOrDetectDuplicate: async () => {
      counters.inboundCalls++;
      return { status: 'created', eventId: `event-${counters.inboundCalls}` };
    },
    upsertInstagramInboxEntry: async () => {
      counters.inboxMessageCount++;
    },
    processInstagramIncomingMessage: async () => {
      counters.aiCalls++;
      return { status: 'processed', replySent: true, replyText: 'ok' };
    },
    markInboundEventProcessed: async () => {
      counters.processedCalls++;
      return null;
    },
    markInboundEventFailed: async () => {
      counters.failedCalls++;
      return null;
    },
  };
}

// ─── Run tests ────────────────────────────────────────────────────────────────

async function main() {
  // ── Encryption round-trip ──────────────────────────────────────────────────
  section('Encryption');

  await test('encrypt then decrypt returns original value', () => {
    const plaintext = 'ig-access-token-secret-value';
    const encrypted = encryptSecret(plaintext);
    const decrypted = decryptSecret(encrypted);
    assert.equal(decrypted, plaintext);
  });

  await test('different encryptions produce different ciphertexts (IV randomness)', () => {
    const plaintext = 'same-token';
    const enc1 = encryptSecret(plaintext);
    const enc2 = encryptSecret(plaintext);
    assert.notEqual(enc1, enc2); // Different IVs
  });

  // ── InstagramMessagingProvider: parseWebhook ────────────────────────────────
  section('InstagramMessagingProvider.parseWebhook');

  await test('parseWebhook: valid text message returns ParsedInstagramEvent', () => {
    const raw = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: 'ig-page-id',
          time: 1716000000000,
          messaging: [
            {
              sender: { id: 'sender-igsid-123' },
              recipient: { id: '123456789' },
              timestamp: 1716000000000,
              message: {
                mid: 'msg-1',
                text: 'Randevu almak istiyorum',
              },
            },
          ],
        },
      ],
    });

    const events = parseWebhook(JSON.parse(raw));
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'message');
    assert.equal(events[0].senderId, 'sender-igsid-123');
    assert.equal(events[0].text, 'Randevu almak istiyorum');
    assert.equal(events[0].pageId ?? JSON.parse(raw).entry[0].id, 'ig-page-id');
  });

  await test('parseWebhook: echo message returns echo event', () => {
    const raw = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: 'ig-page-id',
          time: 1716000000000,
          messaging: [
            {
              sender: { id: '123456789' },
              recipient: { id: 'sender-igsid-123' },
              timestamp: 1716000000000,
              message: {
                mid: 'msg-2',
                text: 'Bu bir eko mesajdır',
                is_echo: true,
              },
            },
          ],
        },
      ],
    });

    const events = parseWebhook(JSON.parse(raw));
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'echo');
  });

  await test('parseWebhook: non-instagram object returns empty array', () => {
    const raw = JSON.stringify({ object: 'page', entry: [] });
    const events = parseWebhook(JSON.parse(raw));
    assert.equal(events.length, 0);
  });

  await test('parseWebhook: malformed/null input returns empty array', () => {
    const events = parseWebhook(null);
    assert.equal(events.length, 0);
  });

  await test('parseWebhook: missing messaging array returns empty array', () => {
    const raw = JSON.stringify({
      object: 'instagram',
      entry: [{ id: 'page-id', time: 1716000000000, messaging: [] }],
    });
    const events = parseWebhook(JSON.parse(raw));
    assert.equal(events.length, 0);
  });

  section('Instagram webhook verification and routing guards');

  await test('global GET verification: correct token returns 200-equivalent challenge', () => {
    const result = verifyMetaWebhookChallenge({
      mode: 'subscribe',
      token: 'dentheria',
      challenge: 'test12345',
      expectedToken: 'dentheria',
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.challenge, 'test12345');
  });

  await test('global GET verification: wrong token returns 403-equivalent failure', () => {
    const result = verifyMetaWebhookChallenge({
      mode: 'subscribe',
      token: 'wrong-token',
      challenge: 'test12345',
      expectedToken: 'dentheria',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'token_mismatch');
  });

  await test('global GET verification: token comparison trims whitespace', () => {
    const result = verifyMetaWebhookChallenge({
      mode: 'subscribe',
      token: '  dentheria  ',
      challenge: 'test12345',
      expectedToken: ' dentheria ',
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.challenge, 'test12345');
  });

  await test('POST routing guard: unknown Instagram provider ID does not select a clinic connection', () => {
    const payload = {
      object: 'instagram',
      entry: [{
        id: 'unknown-page-id',
        messaging: [{
          sender: { id: 'sender-1' },
          recipient: { id: 'unknown-recipient-id' },
          message: { mid: 'msg-1', text: 'Hello' },
        }],
      }],
    };
    const events = parseWebhook(payload);
    assert.equal(events[0].recipientId, 'unknown-recipient-id');
    assert.equal(events[0].pageId, 'unknown-page-id');
    assert.equal(selectUniqueProviderConnection([]), null);
  });

  await test('webhook resolver: real recipient id matches configured Instagram account when Login API id differs', async () => {
    const webhookRecipientId = '17841477329539113';
    const instagramLoginUserId = '35431205066470793';
    const facebookPageId = '761577810379281';
    const payload = {
      object: 'instagram',
      entry: [{
        id: webhookRecipientId,
        messaging: [{
          sender: { id: 'sender-igsid-real' },
          recipient: { id: webhookRecipientId },
          message: { mid: 'ig-mid-real', text: 'Bonjour' },
        }],
      }],
    };
    const event = parseWebhook(payload)[0];
    const connection: InstagramWebhookConnection = {
      id: 'ig-conn-real',
      organizationId: 'org-1',
      instagramAccountId: webhookRecipientId,
      instagramLoginUserId,
      facebookPageId,
      webhookSecret: null,
    };

    const resolved = resolveInstagramWebhookConnectionFromCandidates({
      recipientId: event.recipientId,
      pageId: event.pageId,
    }, [connection]);
    assert.equal(resolved.connection?.id, connection.id);
    assert.equal(resolved.matchReason, 'recipient_instagram_account_id');

    const counters: InstagramProcessingCounters = {
      inboundCalls: 0,
      inboxMessageCount: 0,
      aiCalls: 0,
      processedCalls: 0,
      failedCalls: 0,
    };
    await processInstagramEventForConnection(
      resolved.connection!,
      event,
      makeSuccessfulInstagramProcessingDeps(counters),
    );

    assert.equal(counters.inboundCalls, 1);
    assert.equal(counters.inboxMessageCount, 1);
    assert.equal(counters.aiCalls, 1);
    assert.equal(counters.processedCalls, 1);
    assert.equal(counters.failedCalls, 0);
  });

  await test('webhook resolver: legacy same Instagram account and Login API id still matches primary account id', () => {
    const sharedId = '123456789';
    const resolved = resolveInstagramWebhookConnectionFromCandidates({
      recipientId: sharedId,
      pageId: sharedId,
    }, [{
      id: 'ig-conn-legacy',
      organizationId: 'org-1',
      instagramAccountId: sharedId,
      instagramLoginUserId: sharedId,
      facebookPageId: null,
      webhookSecret: null,
    }]);

    assert.equal(resolved.connection?.id, 'ig-conn-legacy');
    assert.equal(resolved.matchReason, 'recipient_instagram_account_id');
  });

  await test('webhook resolver: primary instagramAccountId match wins over fallback Login API id match', () => {
    const incomingId = '17841477329539113';
    const resolved = resolveInstagramWebhookConnectionFromCandidates({
      recipientId: incomingId,
      pageId: incomingId,
    }, [
      {
        id: 'ig-conn-primary',
        organizationId: 'org-1',
        instagramAccountId: incomingId,
        instagramLoginUserId: '35431205066470793',
        facebookPageId: null,
        webhookSecret: null,
      },
      {
        id: 'ig-conn-fallback',
        organizationId: 'org-2',
        instagramAccountId: null,
        instagramLoginUserId: incomingId,
        facebookPageId: null,
        webhookSecret: null,
      },
    ]);

    assert.equal(resolved.connection?.id, 'ig-conn-primary');
    assert.equal(resolved.matchReason, 'recipient_instagram_account_id');
  });

  await test('Instagram connection clinic assignment: selected clinic is linked as default', () => {
    const assignments = buildInstagramClinicAssignments({
      organizationId: 'org-1',
      instagramConnectionId: 'ig-conn-1',
      clinicIds: ['clinic-a', 'clinic-b'],
      selectedClinicId: 'clinic-b',
    });

    assert.equal(assignments.length, 2);
    assert.equal(assignments.find(item => item.clinicId === 'clinic-b')?.isDefault, true);
    assert.equal(assignments.find(item => item.clinicId === 'clinic-a')?.isDefault, false);
  });

  await test('Instagram connection clinic assignment: single clinic auto-link is default', () => {
    const assignments = buildInstagramClinicAssignments({
      organizationId: 'org-1',
      instagramConnectionId: 'ig-conn-1',
      clinicIds: ['clinic-only'],
      selectedClinicId: null,
    });

    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].clinicId, 'clinic-only');
    assert.equal(assignments[0].isDefault, true);
  });

  await test('Instagram clinic resolution: existing inbox entry wins first', () => {
    const result = resolveInstagramClinicFromKnownContext({
      existingInboxClinicId: 'clinic-existing',
      clinicLinks: [{ clinicId: 'clinic-a', isDefault: true }],
      organizationClinicIds: ['clinic-a'],
    });

    assert.equal(result.clinicId, 'clinic-existing');
    assert.equal(result.needsClinicResolution, false);
    assert.equal(result.resolutionSource, 'inbox_entry');
  });

  await test('Instagram clinic resolution: resolves from single connection clinic link', () => {
    const result = resolveInstagramClinicFromKnownContext({
      clinicLinks: [{ clinicId: 'clinic-a', isDefault: true }],
      organizationClinicIds: [],
    });

    assert.equal(result.clinicId, 'clinic-a');
    assert.equal(result.needsClinicResolution, false);
    assert.equal(result.resolutionSource, 'connection_single');
  });

  await test('Instagram clinic resolution: resolves from one default among multiple links', () => {
    const result = resolveInstagramClinicFromKnownContext({
      clinicLinks: [
        { clinicId: 'clinic-a', isDefault: false },
        { clinicId: 'clinic-b', isDefault: true },
      ],
      organizationClinicIds: [],
    });

    assert.equal(result.clinicId, 'clinic-b');
    assert.equal(result.needsClinicResolution, false);
    assert.equal(result.resolutionSource, 'connection_default');
  });

  await test('Instagram clinic resolution: falls back to organization single clinic', () => {
    const result = resolveInstagramClinicFromKnownContext({
      clinicLinks: [],
      organizationClinicIds: ['clinic-only'],
    });

    assert.equal(result.clinicId, 'clinic-only');
    assert.equal(result.needsClinicResolution, false);
    assert.equal(result.resolutionSource, 'organization_single');
  });

  await test('Instagram clinic resolution: multiple clinics without default remains unresolved', () => {
    const result = resolveInstagramClinicFromKnownContext({
      clinicLinks: [
        { clinicId: 'clinic-a', isDefault: false },
        { clinicId: 'clinic-b', isDefault: false },
      ],
      organizationClinicIds: [],
    });

    assert.equal(result.clinicId, null);
    assert.equal(result.needsClinicResolution, true);
    assert.equal(result.resolutionSource, 'unresolved');
  });

  await test('Instagram default reply: numeric sender id does not become a greeting name', () => {
    const customerName = formatInstagramCustomerName(null, '1050315040903637', null);
    const reply = formatMainMenu('Aile Dis', customerName);

    assert.equal(customerName, null);
    assert.ok(reply.startsWith('Merhaba,'));
    assert.equal(reply.includes('1050315040903637'), false);
  });

  await test('Instagram default reply: patient name is used safely', () => {
    const customerName = formatInstagramCustomerName({
      id: 'entry-1',
      patientId: 'patient-1',
      senderUsername: null,
      patient: { id: 'patient-1', firstName: 'Ayse', lastName: 'Yilmaz', phone: null },
    }, '1050315040903637', null);
    const reply = formatMainMenu('Aile Dis', customerName);

    assert.equal(customerName, 'Ayse Yilmaz');
    assert.ok(reply.startsWith('Merhaba Ayse,'));
  });

  await test('Instagram default reply: username can be used but numeric username is ignored', () => {
    const usernameName = formatInstagramCustomerName(null, '1050315040903637', 'autoviseo');
    const numericName = formatInstagramCustomerName(null, '1050315040903637', '1050315040903637');

    assert.equal(usernameName, '@autoviseo');
    assert.equal(numericName, null);
    assert.equal(formatMainMenu('Aile Dis', numericName).includes('1050315040903637'), false);
  });

  await test('Instagram default reply: Turkish characters are preserved', () => {
    const reply = formatMainMenu('Aile Dis', null);
    assert.equal(reply, [
      'Merhaba, size nasıl yardımcı olabilirim?',
      '',
      '1. Randevu almak',
      '2. Randevumu sorgulamak',
      '3. Randevumu iptal etmek',
      '4. Hizmetler hakkında bilgi almak',
    ].join('\n'));
  });

  await test('Instagram booking state: confirmation without name preserves pending slot context', async () => {
    const pendingSlot = {
      practitionerId: 'doctor-1',
      practitionerName: 'Dt. Salim Fatih Girgin',
      startTime: '2026-06-11T11:00:00.000Z',
      endTime: '2026-06-11T11:30:00.000Z',
      localStartTime: '14:00',
      localEndTime: '14:30',
    };
    const savedStates: Record<string, unknown>[] = [];

    const reply = await handleAwaitingConfirmationStep({
      clinicId: 'clinic-1',
      phone: 'instagram:conn-1:sender-1',
      text: 'evet',
      customerName: null,
      state: {
        selectedAppointmentTypeId: 'service-1',
        selectedAppointmentTypeName: 'Ağız, Diş ve Çene Cerrahisi',
        selectedPractitionerId: pendingSlot.practitionerId,
        selectedDate: '2026-06-11',
      },
      stateJson: {
        availableSlots: [pendingSlot],
        lastShownSlots: [pendingSlot],
        pendingConfirmationSlot: pendingSlot,
      },
      upsertState: async data => {
        savedStates.push(data as Record<string, unknown>);
      },
      resetState: async () => null,
      createAppointment: async () => {
        throw new Error('createAppointment should not be called before name is collected');
      },
    });

    assert.equal(reply.includes('adınızı ve soyadınızı') || reply.includes('adÄ±nÄ±zÄ± ve soyadÄ±nÄ±zÄ±'), true);
    const savedState = savedStates[0];
    assert.equal(savedState.currentIntent, 'book_appointment');
    assert.equal(savedState.step, 'awaiting_name');
    assert.equal(savedState.selectedAppointmentTypeId, 'service-1');
    assert.equal(savedState.selectedDate, '2026-06-11');
    assert.deepEqual((savedState.stateJson as any)?.pendingConfirmationSlot, pendingSlot);
  });

  await test('Instagram booking state: Anatoly Echo completion reply does not show service menu again', () => {
    assert.equal(hasUsableInstagramFullName('Anatoly Echo'), true);
    const reply = formatInstagramBookingCreatedReply({
      customerName: 'Anatoly Echo',
      selectedDate: '2026-06-11',
      localStartTime: '14:00',
      practitionerName: 'Dt. Salim Fatih Girgin',
      serviceName: 'Ağız, Diş ve Çene Cerrahisi',
    });

    assert.ok(reply.includes('Teşekkürler Anatoly Echo.'));
    assert.ok(reply.includes('14:00'));
    assert.ok(reply.includes('Ağız, Diş ve Çene Cerrahisi'));
    assert.equal(reply.includes('hangi hizmet'), false);
  });

  await test('Instagram appointment request metadata: source is instagram with conversation context', () => {
    const metadata = buildInstagramAppointmentRequestSourceMetadata({
      instagramConnectionId: 'ig-conn-1',
      externalSenderId: 'sender-igsid-1',
      externalConversationId: 'conversation-1',
      inboxEntryId: 'inbox-1',
    });

    assert.equal(metadata.source, 'instagram');
    assert.equal(metadata.externalSenderId, 'sender-igsid-1');
    assert.equal(metadata.sourceConnectionId, 'ig-conn-1');
    assert.equal(metadata.sourceInboxEntryId, 'inbox-1');
    assert.equal(metadata.sourceConversationId, 'conversation-1');
  });

  await test('Unified appointment request API filters: default includes WhatsApp legacy and channel filter resolves Instagram', () => {
    assert.equal(resolveAppointmentRequestSourceFilter({}), null);
    assert.equal(resolveAppointmentRequestSourceFilter({ channel: 'instagram' }), 'instagram');
    assert.equal(resolveAppointmentRequestSourceFilter({ source: 'whatsapp' }), 'whatsapp');
    assert.equal(shouldIncludeLegacyWhatsappAppointmentRows({}), true);
    assert.equal(shouldIncludeLegacyWhatsappAppointmentRows({ channel: 'instagram' }), false);
    assert.equal(shouldIncludeLegacyWhatsappAppointmentRows({ source: 'whatsapp', status: 'pending' }), false);
    assert.equal(shouldIncludeLegacyWhatsappAppointmentRows({ source: 'whatsapp', status: 'converted' }), true);
  });

  section('Instagram AI conversation adapter guards');

  await test('AI adapter runs only when clinic is resolved', () => {
    assert.equal(canProcessInstagramAi({ clinicId: 'clinic-1', needsClinicResolution: false }), true);
    assert.equal(canProcessInstagramAi({ clinicId: null, needsClinicResolution: true }), false);
    assert.equal(canProcessInstagramAi({ clinicId: 'clinic-1', needsClinicResolution: true }), false);
  });

  await test('conversation key is scoped by connection and sender', () => {
    const first = buildInstagramConversationKey('conn-a', 'sender-1');
    const second = buildInstagramConversationKey('conn-b', 'sender-1');
    assert.equal(first, 'instagram:conn-a:sender-1');
    assert.notEqual(first, second);
  });

  await test('Instagram phone normalizer accepts only phone-like values', () => {
    assert.equal(normalizeInstagramPatientPhone('+33 6 12 34 56 78'), '33612345678');
    assert.equal(normalizeInstagramPatientPhone('1050315040903637'), null);
    assert.equal(normalizeInstagramPatientPhone('igsid-123'), null);
  });

  await test('AppointmentRequest fallback phone remains synthetic placeholder when input is not phone-like', () => {
    assert.equal(buildInstagramAppointmentFallbackPhone(' igsid-123 '), '0000000000');
  });

  section('Instagram webhook AI idempotency integration');

  await test('duplicate Instagram mid skips AI, reply, AppointmentRequest, and inbox increment', async () => {
    const payload = {
      object: 'instagram',
      entry: [{
        id: 'ig-page-id',
        messaging: [{
          sender: { id: 'sender-igsid-123' },
          recipient: { id: '123456789' },
          message: { mid: 'ig-mid-duplicate', text: 'Randevu almak istiyorum' },
        }],
      }],
    };
    const event = parseWebhook(payload)[0];
    assert.equal(event.eventType, 'message');

    const connection: InstagramWebhookConnection = {
      id: 'ig-conn-1',
      organizationId: 'org-1',
      instagramAccountId: '123456789',
      facebookPageId: 'ig-page-id',
      webhookSecret: null,
    };

    let inboundCalls = 0;
    let inboxMessageCount = 0;
    let aiCalls = 0;
    let replyCalls = 0;
    let appointmentRequestCreates = 0;
    let processedCalls = 0;
    let failedCalls = 0;

    const deps: InstagramWebhookProcessingDeps = {
      resolveClinicForInstagramMessage: async () => ({
        clinicId: 'clinic-1',
        needsClinicResolution: false,
        resolutionSource: 'connection_single',
      }),
      createInboundEventOrDetectDuplicate: async () => {
        inboundCalls++;
        return inboundCalls === 1
          ? { status: 'created', eventId: 'event-1' }
          : { status: 'duplicate' };
      },
      upsertInstagramInboxEntry: async () => {
        inboxMessageCount++;
      },
      processInstagramIncomingMessage: async () => {
        aiCalls++;
        replyCalls++;
        appointmentRequestCreates++;
        return { status: 'processed', replySent: true, replyText: 'ok' };
      },
      markInboundEventProcessed: async () => {
        processedCalls++;
        return null;
      },
      markInboundEventFailed: async () => {
        failedCalls++;
        return null;
      },
    };

    await processInstagramEventForConnection(connection, event, deps);
    await processInstagramEventForConnection(connection, event, deps);

    assert.equal(inboundCalls, 2);
    assert.equal(inboxMessageCount, 1);
    assert.equal(aiCalls, 1);
    assert.equal(replyCalls, 1);
    assert.equal(appointmentRequestCreates, 1);
    assert.equal(processedCalls, 1);
    assert.equal(failedCalls, 0);
  });

  await test('unresolved Instagram clinic skips AI reply and AppointmentRequest', async () => {
    const payload = {
      object: 'instagram',
      entry: [{
        id: 'ig-page-id',
        messaging: [{
          sender: { id: 'sender-igsid-999' },
          recipient: { id: '123456789' },
          message: { mid: 'ig-mid-unresolved', text: 'Merhaba' },
        }],
      }],
    };
    const event = parseWebhook(payload)[0];
    assert.equal(event.eventType, 'message');

    const connection: InstagramWebhookConnection = {
      id: 'ig-conn-2',
      organizationId: 'org-1',
      instagramAccountId: '123456789',
      facebookPageId: 'ig-page-id',
      webhookSecret: null,
    };

    let inboxMessageCount = 0;
    let aiCalls = 0;
    let replyCalls = 0;
    let appointmentRequestCreates = 0;
    let processedCalls = 0;

    const deps: InstagramWebhookProcessingDeps = {
      resolveClinicForInstagramMessage: async () => ({
        clinicId: null,
        needsClinicResolution: true,
        resolutionSource: 'unresolved',
      }),
      createInboundEventOrDetectDuplicate: async () => ({ status: 'created', eventId: 'event-unresolved' }),
      upsertInstagramInboxEntry: async () => {
        inboxMessageCount++;
      },
      processInstagramIncomingMessage: async () => {
        aiCalls++;
        replyCalls++;
        appointmentRequestCreates++;
        return { status: 'processed', replySent: true, replyText: 'should-not-send' };
      },
      markInboundEventProcessed: async () => {
        processedCalls++;
        return null;
      },
      markInboundEventFailed: async () => null,
    };

    await processInstagramEventForConnection(connection, event, deps);

    assert.equal(inboxMessageCount, 1);
    assert.equal(aiCalls, 0);
    assert.equal(replyCalls, 0);
    assert.equal(appointmentRequestCreates, 0);
    assert.equal(processedCalls, 1);
  });

  // ── InstagramMessagingProvider: testConnection ─────────────────────────────
  section('InstagramMessagingProvider.testConnection');

  await test('testConnection: missing accessToken returns failure result', async () => {
    const conn = makeConn({ accessTokenEncrypted: null as unknown as string });
    const result = await testConnection(conn);
    assert.equal(result.success, false);
    assert.ok(result.message.toLowerCase().includes('token') || result.message.toLowerCase().includes('erişim'));
  });

  await test('testConnection: inactive connection returns failure result', async () => {
    const conn = makeConn({ isActive: false });
    const result = await testConnection(conn);
    assert.equal(result.success, false);
  });

  await test('testConnection: validates Instagram Login token through graph.instagram.com /me', async () => {
    let requestedUrl = '';

    await withMockFetch((input) => {
      requestedUrl = input.toString();
      return jsonResponse({ id: '123456789', username: 'testclinic' });
    }, async () => {
      const result = await testConnection(makeConn());
      assert.equal(result.success, true);
      assert.equal(result.instagramLoginUserId, '123456789');
      assert.equal(result.username, 'testclinic');
    });

    const url = new URL(requestedUrl);
    assert.equal(`${url.origin}${url.pathname}`, `${INSTAGRAM_LOGIN_GRAPH_API_BASE}/me`);
    assert.equal(url.searchParams.get('fields'), 'id,username');
    assert.equal(url.searchParams.get('access_token'), 'fake-page-access-token');
    assert.equal(requestedUrl.includes('graph.facebook.com'), false);
  });

  await test('testConnection: trims token before calling Instagram Login validation', async () => {
    let requestedUrl = '';
    const conn = makeConn({ accessTokenEncrypted: encryptSecret('  spaced-token  ') });

    await withMockFetch((input) => {
      requestedUrl = input.toString();
      return jsonResponse({ id: '123456789', username: 'testclinic' });
    }, async () => {
      const result = await testConnection(conn);
      assert.equal(result.success, true);
    });

    const url = new URL(requestedUrl);
    assert.equal(url.searchParams.get('access_token'), 'spaced-token');
  });

  await test('testConnection: accepts distinct webhook recipient id and Instagram Login API id', async () => {
    await withMockFetch(() => {
      return jsonResponse({ id: '35431205066470793', username: 'autoviseo' });
    }, async () => {
      const result = await testConnection(makeConn({ instagramAccountId: '17841477329539113' }));
      assert.equal(result.success, true);
      assert.equal(result.instagramLoginUserId, '35431205066470793');
      assert.equal(result.username, 'autoviseo');
    });
  });

  await test('testConnection: returns Meta error message from Instagram Login endpoint', async () => {
    await withMockFetch(() => {
      return jsonResponse({
        error: {
          message: 'Invalid OAuth access token - Cannot parse access token',
          type: 'OAuthException',
          code: 190,
        },
      }, 400);
    }, async () => {
      const result = await testConnection(makeConn());
      assert.equal(result.success, false);
      assert.equal(result.message, 'Meta API error: Invalid OAuth access token - Cannot parse access token');
    });
  });

  // ── sendMessage: validation ────────────────────────────────────────────────
  section('InstagramMessagingProvider.sendMessage');

  await test('sendMessage: empty message text returns validation error', async () => {
    const conn = makeConn();
    const result = await sendMessage(conn, { recipientIgsid: 'igsid-123', text: '' });
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  await test('sendMessage: message > 1000 chars is truncated (not error)', async () => {
    // Implementation silently truncates to 1000 chars
    const conn = makeConn();
    const longText = 'a'.repeat(1001);
    let requestedUrl = '';
    let requestBody: Record<string, unknown> | null = null;

    await withMockFetch((input, init) => {
      requestedUrl = input.toString();
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ message_id: 'ig-mid-1' });
    }, async () => {
      const result = await sendMessage(conn, { recipientIgsid: 'igsid-123', text: longText });
      assert.equal(result.success, true);
      assert.equal(result.externalMessageId, 'ig-mid-1');
    });
    assert.ok(requestBody);
    const message = (requestBody as Record<string, unknown>).message as Record<string, unknown>;
    const text = message.text;
    assert.equal(typeof text, 'string');
    assert.equal((text as string).length, 1000);
    const url = new URL(requestedUrl);
    assert.equal(`${url.origin}${url.pathname}`, `${INSTAGRAM_LOGIN_GRAPH_API_BASE}/123456789/messages`);
  });

  await test('sendMessage: page token records keep Facebook Graph send endpoint', async () => {
    let requestedUrl = '';
    let requestBody: Record<string, unknown> | null = null;
    const conn = makeConn({
      accessTokenEncrypted: null,
      pageAccessTokenEncrypted: encryptSecret('page-access-token'),
    });

    await withMockFetch((input, init) => {
      requestedUrl = input.toString();
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ message_id: 'fb-mid-1' });
    }, async () => {
      const result = await sendMessage(conn, { recipientIgsid: 'igsid-123', text: 'Merhaba' });
      assert.equal(result.success, true);
      assert.equal(result.externalMessageId, 'fb-mid-1');
    });

    const url = new URL(requestedUrl);
    assert.equal(`${url.origin}${url.pathname}`, 'https://graph.facebook.com/v20.0/123456789/messages');
    assert.ok(requestBody);
    assert.equal((requestBody as Record<string, unknown>).access_token, 'page-access-token');
  });

  await test('sendMessage: missing instagram account ID returns failure', async () => {
    const conn = makeConn({ instagramAccountId: null });
    const result = await sendMessage(conn, { recipientIgsid: 'igsid-123', text: 'Merhaba' });
    assert.equal(result.success, false);
  });

  // ── Permission helpers ─────────────────────────────────────────────────────
  section('Instagram Permission Helpers (roles.ts)');

  type FakeUser = { role: string };

  await test('OWNER can manage Instagram connections', () => {
    assert.equal(canManageInstagramConnections({ role: 'OWNER' } as FakeUser), true);
  });

  await test('ORG_ADMIN can manage Instagram connections', () => {
    assert.equal(canManageInstagramConnections({ role: 'ORG_ADMIN' } as FakeUser), true);
  });

  await test('RECEPTIONIST cannot manage Instagram connections', () => {
    assert.equal(canManageInstagramConnections({ role: 'RECEPTIONIST' } as FakeUser), false);
  });

  await test('BILLING cannot manage Instagram connections', () => {
    assert.equal(canManageInstagramConnections({ role: 'BILLING' } as FakeUser), false);
  });

  await test('CLINIC_MANAGER can assign Instagram to clinic', () => {
    assert.equal(canAssignInstagramToClinic({ role: 'CLINIC_MANAGER' } as FakeUser), true);
  });

  await test('RECEPTIONIST cannot assign Instagram to clinic', () => {
    assert.equal(canAssignInstagramToClinic({ role: 'RECEPTIONIST' } as FakeUser), false);
  });

  await test('OWNER can view Instagram status', () => {
    assert.equal(canViewInstagramStatus({ role: 'OWNER' } as FakeUser), true);
  });

  await test('CLINIC_MANAGER can view Instagram status', () => {
    assert.equal(canViewInstagramStatus({ role: 'CLINIC_MANAGER' } as FakeUser), true);
  });

  await test('BILLING cannot view Instagram status', () => {
    assert.equal(canViewInstagramStatus({ role: 'BILLING' } as FakeUser), false);
  });

  await test('RECEPTIONIST can view Instagram inbox', () => {
    assert.equal(canViewInstagramInbox({ role: 'RECEPTIONIST' } as FakeUser), true);
  });

  await test('BILLING cannot view Instagram inbox', () => {
    assert.equal(canViewInstagramInbox({ role: 'BILLING' } as FakeUser), false);
  });

  await test('RECEPTIONIST can reply Instagram messages', () => {
    assert.equal(canReplyInstagramMessages({ role: 'RECEPTIONIST' } as FakeUser), true);
  });

  await test('BILLING cannot reply Instagram messages', () => {
    assert.equal(canReplyInstagramMessages({ role: 'BILLING' } as FakeUser), false);
  });

  await test('CLINIC_MANAGER can resolve Instagram conversation', () => {
    assert.equal(canResolveInstagramConversation({ role: 'CLINIC_MANAGER' } as FakeUser), true);
  });

  await test('RECEPTIONIST cannot resolve Instagram conversation', () => {
    assert.equal(canResolveInstagramConversation({ role: 'RECEPTIONIST' } as FakeUser), false);
  });

  await test('OWNER can resolve Instagram conversation', () => {
    assert.equal(canResolveInstagramConversation({ role: 'OWNER' } as FakeUser), true);
  });

  // ── Webhook signature validation ───────────────────────────────────────────
  section('Webhook signature (HMAC SHA-256)');

  await test('Signature validation: valid signature matches', async () => {
    const crypto = await import('node:crypto');
    const secret = 'test-webhook-secret';
    const body = '{"object":"instagram","entry":[]}';
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

    const rawBody = Buffer.from(body);
    const expectedSig = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    assert.equal(sig, expectedSig);
  });

  await test('Signature validation: wrong secret does not match', async () => {
    const crypto = await import('node:crypto');
    const body = '{"object":"instagram"}';
    const correctSig = 'sha256=' + crypto.createHmac('sha256', 'correct-secret').update(body).digest('hex');
    const wrongSig = 'sha256=' + crypto.createHmac('sha256', 'wrong-secret').update(body).digest('hex');
    assert.notEqual(correctSig, wrongSig);
  });

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
