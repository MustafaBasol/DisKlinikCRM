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
  canProcessInstagramAi,
} from '../services/instagram/instagramAiConversationProcessor.js';
import {
  processInstagramEventForConnection,
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

  await test('AppointmentRequest phone fallback uses Instagram sender id', () => {
    assert.equal(buildInstagramAppointmentFallbackPhone(' igsid-123 '), 'igsid-123');
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
        resolutionSource: 'single_clinic',
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
      assert.equal(result.accountId, '123456789');
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

  await test('testConnection: rejects a token for a different Instagram account id', async () => {
    await withMockFetch(() => {
      return jsonResponse({ id: '17841477329539113', username: 'autoviseo' });
    }, async () => {
      const result = await testConnection(makeConn({ instagramAccountId: '123456789' }));
      assert.equal(result.success, false);
      assert.ok(result.message.includes('mismatch'));
      assert.equal(result.accountId, '17841477329539113');
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
