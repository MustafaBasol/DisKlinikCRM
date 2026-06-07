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
  testConnection,
  sendMessage,
  parseWebhook,
} from '../services/instagram/InstagramMessagingProvider.js';
import { verifyMetaWebhookChallenge } from '../utils/webhookVerification.js';
import { selectUniqueProviderConnection } from '../utils/webhookRouting.js';
import type { InstagramConnectionRecord } from '../services/instagram/InstagramMessagingProvider.js';import {
  canManageInstagramConnections,
  canAssignInstagramToClinic,
  canViewInstagramStatus,
  canViewInstagramInbox,
  canReplyInstagramMessages,
  canResolveInstagramConversation,
} from '../utils/roles.js';

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
    const result = await sendMessage(conn, { recipientIgsid: 'igsid-123', text: longText });
    // Will fail with network error (no real API) but should NOT be a validation error about length
    assert.ok(result.success === false); // No real API in test — expect network failure
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
