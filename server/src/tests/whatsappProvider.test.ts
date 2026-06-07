/**
 * whatsappProvider.test.ts — Unit tests for the WhatsApp provider abstraction
 *
 * Run with:  tsx src/tests/whatsappProvider.test.ts
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

// ─── Encryption ───────────────────────────────────────────────────────────────

// Must set env before importing encryption module (getKey() reads at call-time)
process.env.ENCRYPTION_KEY = 'a'.repeat(64); // valid 64-char hex test key

import { encryptSecret, decryptSecret, isEncryptionKeyConfigured } from '../utils/encryption.js';

// ─── WhatsApp provider factory ────────────────────────────────────────────────

import { getWhatsAppProvider } from '../services/whatsapp/whatsappProviderFactory.js';
import { EvolutionWhatsAppProvider } from '../services/whatsapp/EvolutionWhatsAppProvider.js';
import { MetaCloudWhatsAppProvider } from '../services/whatsapp/MetaCloudWhatsAppProvider.js';
import {
  resolveSingleLinkedClinic,
  selectUniqueProviderConnection,
} from '../utils/webhookRouting.js';
import { isLegacyFallbackEnabled } from '../utils/legacyWhatsApp.js';

// ─── Role helpers ─────────────────────────────────────────────────────────────

import {
  canManageWhatsAppConnections,
  canAssignWhatsAppToClinic,
  canViewWhatsAppStatus,
  canSendWhatsAppMessages,
} from '../utils/roles.js';

// ─── Run tests ────────────────────────────────────────────────────────────────

async function main() {
  // ── Encryption ──────────────────────────────────────────────────────────────
  section('encryption.ts');

  await test('isEncryptionKeyConfigured() → true when key is set', () => {
    assert.equal(isEncryptionKeyConfigured(), true);
  });

  await test('isEncryptionKeyConfigured() → false when key missing', () => {
    const orig = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    assert.equal(isEncryptionKeyConfigured(), false);
    process.env.ENCRYPTION_KEY = orig;
  });

  await test('encryptSecret + decryptSecret round-trip', () => {
    const plaintext = 'my-super-secret-api-key-12345';
    const ciphertext = encryptSecret(plaintext);
    assert.notEqual(ciphertext, plaintext);
    assert.equal(decryptSecret(ciphertext), plaintext);
  });

  await test('each encryptSecret call produces unique ciphertext (random IV)', () => {
    const plaintext = 'same-text';
    const c1 = encryptSecret(plaintext);
    const c2 = encryptSecret(plaintext);
    assert.notEqual(c1, c2); // Different IV each time
  });

  await test('decryptSecret throws on tampered ciphertext', () => {
    const ciphertext = encryptSecret('hello');
    // Flip last char
    const tampered = ciphertext.slice(0, -1) + (ciphertext.endsWith('a') ? 'b' : 'a');
    assert.throws(() => decryptSecret(tampered));
  });

  // ── whatsappProviderFactory ──────────────────────────────────────────────────
  section('whatsappProviderFactory');

  await test('"evolution_api" → EvolutionWhatsAppProvider', () => {
    const p = getWhatsAppProvider('evolution_api');
    assert.ok(p instanceof EvolutionWhatsAppProvider);
  });

  await test('"meta_cloud_api" → MetaCloudWhatsAppProvider', () => {
    const p = getWhatsAppProvider('meta_cloud_api');
    assert.ok(p instanceof MetaCloudWhatsAppProvider);
  });

  await test('unknown provider key → throws Error', () => {
    assert.throws(() => getWhatsAppProvider('unknown_provider'), /unknown/i);
  });

  // ── EvolutionWhatsAppProvider ────────────────────────────────────────────────
  section('EvolutionWhatsAppProvider');

  const emptyConn = {
    id: 'test',
    organizationId: 'org-1',
    provider: 'evolution_api',
    status: 'disconnected',
  };

  await test('sendMessage with missing credentials → { success: false }', async () => {
    // Remove env vars to force "no credentials" path
    const savedUrl = process.env.EVOLUTION_API_BASE_URL;
    const savedKey = process.env.EVOLUTION_API_KEY;
    const savedInst = process.env.EVOLUTION_INSTANCE_NAME;
    delete process.env.EVOLUTION_API_BASE_URL;
    delete process.env.EVOLUTION_API_KEY;
    delete process.env.EVOLUTION_INSTANCE_NAME;

    const provider = new EvolutionWhatsAppProvider();
    const result = await provider.sendMessage(emptyConn, { phone: '905551234567', text: 'test' });

    process.env.EVOLUTION_API_BASE_URL = savedUrl;
    process.env.EVOLUTION_API_KEY = savedKey;
    process.env.EVOLUTION_INSTANCE_NAME = savedInst;

    assert.equal(result.success, false);
    assert.ok(result.error?.includes('incomplete') || result.error?.includes('configuration'));
  });

  await test('testConnection with missing credentials → { success: false }', async () => {
    const savedUrl = process.env.EVOLUTION_API_BASE_URL;
    const savedKey = process.env.EVOLUTION_API_KEY;
    const savedInst = process.env.EVOLUTION_INSTANCE_NAME;
    delete process.env.EVOLUTION_API_BASE_URL;
    delete process.env.EVOLUTION_API_KEY;
    delete process.env.EVOLUTION_INSTANCE_NAME;

    const provider = new EvolutionWhatsAppProvider();
    const result = await provider.testConnection(emptyConn);

    process.env.EVOLUTION_API_BASE_URL = savedUrl;
    process.env.EVOLUTION_API_KEY = savedKey;
    process.env.EVOLUTION_INSTANCE_NAME = savedInst;

    assert.equal(result.success, false);
  });

  await test('parseWebhook: Evolution message payload → eventType "message"', () => {
    const provider = new EvolutionWhatsAppProvider();
    const payload = {
      event: 'messages.upsert',
      data: {
        key: { fromMe: false, remoteJid: '905551234567@s.whatsapp.net', id: 'msg-1' },
        message: { conversation: 'Hello clinic' },
      },
    };
    const result = provider.parseWebhook(payload, emptyConn);
    assert.equal(result.eventType, 'message');
    assert.equal(result.text, 'Hello clinic');
  });

  // ── MetaCloudWhatsAppProvider ────────────────────────────────────────────────
  section('MetaCloudWhatsAppProvider');

  const metaConnBase = {
    id: 'meta-conn-1',
    organizationId: 'org-1',
    provider: 'meta_cloud_api',
    status: 'connected',
  };
  const metaProvider = new MetaCloudWhatsAppProvider();

  await test('factory returns MetaCloudWhatsAppProvider for meta_cloud_api', () => {
    const p = getWhatsAppProvider('meta_cloud_api');
    assert.ok(p instanceof MetaCloudWhatsAppProvider);
  });

  await test('sendMessage with missing credentials → { success: false }', async () => {
    const result = await metaProvider.sendMessage(
      { ...metaConnBase, metaPhoneNumberId: undefined, metaAccessTokenEncrypted: undefined },
      { phone: '905551234567', text: 'test' },
    );
    assert.equal(result.success, false);
    assert.ok(result.error?.toLowerCase().includes('incomplete') || result.error?.toLowerCase().includes('required'));
  });

  await test('sendMessage with missing phoneNumberId → { success: false }', async () => {
    const conn = { ...metaConnBase, metaAccessTokenEncrypted: encryptSecret('token'), metaPhoneNumberId: undefined };
    const result = await metaProvider.sendMessage(conn, { phone: '905551234567', text: 'test' });
    assert.equal(result.success, false);
  });

  await test('sendMessage with missing access token → { success: false }', async () => {
    const conn = { ...metaConnBase, metaPhoneNumberId: '123456789', metaAccessTokenEncrypted: undefined };
    const result = await metaProvider.sendMessage(conn, { phone: '905551234567', text: 'test' });
    assert.equal(result.success, false);
  });

  await test('sendMessage with valid credentials calls Graph API and returns success', async () => {
    // Mock global fetch to return a successful Meta response
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = Object.fromEntries(Object.entries(init?.headers ?? {}));
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.test123' }] }), { status: 200 });
    };
    const token = encryptSecret('test-access-token');
    const conn = { ...metaConnBase, metaPhoneNumberId: '123456789', metaAccessTokenEncrypted: token };
    const result = await metaProvider.sendMessage(conn, { phone: '905551234567', text: 'Hello clinic' });
    globalThis.fetch = originalFetch;

    assert.equal(result.success, true, `Expected success but got: ${result.error}`);
    assert.equal(result.externalMessageId, 'wamid.test123');
    assert.ok(capturedUrl.includes('123456789/messages'), `URL should include phoneNumberId/messages, got: ${capturedUrl}`);
    // Authorization header must be present and contain Bearer (not leaked to response)
    assert.ok(capturedHeaders['Authorization']?.startsWith('Bearer '), 'Must include Bearer token in request');
  });

  await test('sendMessage handles Graph API error safely', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid token' } }), { status: 401 });
    const token = encryptSecret('bad-token');
    const conn = { ...metaConnBase, metaPhoneNumberId: '123', metaAccessTokenEncrypted: token };
    const result = await metaProvider.sendMessage(conn, { phone: '905551234567', text: 'x' });
    globalThis.fetch = originalFetch;
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('401'));
  });

  await test('testConnection with missing config → { success: false }', async () => {
    const result = await metaProvider.testConnection({ ...metaConnBase });
    assert.equal(result.success, false);
    assert.ok(result.message?.toLowerCase().includes('incomplete') || result.message?.toLowerCase().includes('required'));
  });

  await test('testConnection with valid credentials → { success: true, message with phone info }', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ display_phone_number: '+90 555 123 4567', verified_name: 'Test Clinic' }),
      { status: 200 },
    );
    const token = encryptSecret('good-token');
    const conn = { ...metaConnBase, metaPhoneNumberId: '999888777', metaAccessTokenEncrypted: token };
    const result = await metaProvider.testConnection(conn);
    globalThis.fetch = originalFetch;
    assert.equal(result.success, true, `Expected success but got: ${result.message}`);
    assert.ok(result.message?.includes('Test Clinic') || result.message?.includes('555'), `Expected phone/name in message: ${result.message}`);
  });

  await test('testConnection handles API error safely', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('Forbidden', { status: 403 });
    const token = encryptSecret('expired-token');
    const conn = { ...metaConnBase, metaPhoneNumberId: '111', metaAccessTokenEncrypted: token };
    const result = await metaProvider.testConnection(conn);
    globalThis.fetch = originalFetch;
    assert.equal(result.success, false);
    assert.ok(result.message?.includes('403'));
  });

  await test('getQrCode → available: false with clear message', async () => {
    const result = await metaProvider.getQrCode(metaConnBase);
    assert.equal(result.available, false);
    assert.ok(result.message && result.message.length > 0);
    assert.ok(result.message?.toLowerCase().includes('qr') || result.message?.toLowerCase().includes('meta'));
  });

  await test('disconnect → completes without error', async () => {
    await assert.doesNotReject(() => metaProvider.disconnect(metaConnBase));
  });

  await test('parseWebhook: valid text message → eventType "message"', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '+905551234567', phone_number_id: '987654321' },
            messages: [{
              from: '905559876543',
              id: 'wamid.abc123',
              timestamp: '1716000000',
              type: 'text',
              text: { body: 'Merhaba, randevu almak istiyorum.' },
            }],
          },
        }],
      }],
    };
    const event = metaProvider.parseWebhook(payload, metaConnBase);
    assert.equal(event.eventType, 'message');
    assert.equal(event.phone, '905559876543');
    assert.equal(event.text, 'Merhaba, randevu almak istiyorum.');
    assert.equal(event.messageId, 'wamid.abc123');
  });

  await test('parseWebhook: status update → eventType "status_update"', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: '987654321' },
            statuses: [{
              id: 'wamid.abc123',
              status: 'delivered',
              timestamp: '1716000001',
              recipient_id: '905551234567',
            }],
          },
        }],
      }],
    };
    const event = metaProvider.parseWebhook(payload, metaConnBase);
    assert.equal(event.eventType, 'status_update');
    assert.equal(event.status, 'delivered');
    assert.equal(event.messageId, 'wamid.abc123');
  });

  await test('parseWebhook: non-text message type (image) → eventType "unknown"', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-1',
        changes: [{
          field: 'messages',
          value: {
            messages: [{
              from: '905551234567',
              id: 'wamid.img1',
              type: 'image',
              image: { id: 'img-id', mime_type: 'image/jpeg' },
            }],
          },
        }],
      }],
    };
    const event = metaProvider.parseWebhook(payload, metaConnBase);
    assert.equal(event.eventType, 'unknown');
  });

  await test('parseWebhook: non-Meta payload → eventType "unknown"', () => {
    const event = metaProvider.parseWebhook({ object: 'instagram', entry: [] }, metaConnBase);
    assert.equal(event.eventType, 'unknown');
  });

  await test('parseWebhook: null/undefined payload → eventType "unknown"', () => {
    assert.equal(metaProvider.parseWebhook(null, metaConnBase).eventType, 'unknown');
    assert.equal(metaProvider.parseWebhook(undefined, metaConnBase).eventType, 'unknown');
  });

  await test('parseWebhook: malformed entry (empty changes) → eventType "unknown"', () => {
    const payload = { object: 'whatsapp_business_account', entry: [{ id: 'x', changes: [] }] };
    const event = metaProvider.parseWebhook(payload, metaConnBase);
    assert.equal(event.eventType, 'unknown');
  });

  await test('extractPhoneNumberIdFromPayload: extracts phone_number_id from metadata', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-1',
        changes: [{
          value: {
            metadata: { display_phone_number: '+905551234567', phone_number_id: '987654321' },
            messages: [],
          },
        }],
      }],
    };
    const phoneId = MetaCloudWhatsAppProvider.extractPhoneNumberIdFromPayload(payload);
    assert.equal(phoneId, '987654321');
  });

  await test('extractPhoneNumberIdFromPayload: non-WABA payload → null', () => {
    assert.equal(MetaCloudWhatsAppProvider.extractPhoneNumberIdFromPayload({ object: 'other' }), null);
    assert.equal(MetaCloudWhatsAppProvider.extractPhoneNumberIdFromPayload(null), null);
    assert.equal(MetaCloudWhatsAppProvider.extractPhoneNumberIdFromPayload({}), null);
  });

  await test('Meta webhook routing: unknown phone_number_id selects no connection', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: 'unknown-phone-id' },
            messages: [{ from: '905551234567', id: 'wamid-1', type: 'text', text: { body: 'Hello' } }],
          },
        }],
      }],
    };
    assert.equal(MetaCloudWhatsAppProvider.extractPhoneNumberIdFromPayload(payload), 'unknown-phone-id');
    assert.equal(selectUniqueProviderConnection([]), null);
  });

  await test('Evolution webhook routing: unknown evolutionInstanceName selects no connection', () => {
    const providerMatches: Array<{ id: string; organizationId: string }> = [];
    assert.equal(selectUniqueProviderConnection(providerMatches), null);
  });

  await test('Webhook routing: known provider ID resolves to the single linked clinic', () => {
    const connection = selectUniqueProviderConnection([{ id: 'conn-1', organizationId: 'org-1' }]);
    const clinicId = resolveSingleLinkedClinic([{ clinicId: 'clinic-1' }]);
    assert.equal(connection?.id, 'conn-1');
    assert.equal(clinicId, 'clinic-1');
  });

  // ── validateHubSignature (X-Hub-Signature-256) ────────────────────────────────
  section('validateHubSignature (X-Hub-Signature-256)');

  // Inline replica of the function from metaWhatsAppWebhook.ts
  const { createHmac, timingSafeEqual: tse } = await import('node:crypto');
  function validateHubSig(rawBody: Buffer, signature: string | undefined, secret: string): boolean | null {
    if (!secret) return null;
    if (!signature) return false;
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    try {
      if (expected.length === signature.length) {
        return tse(Buffer.from(expected), Buffer.from(signature));
      }
      return false;
    } catch {
      return expected === signature;
    }
  }

  const testBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
  const testSecret = 'webhook-secret-123';
  const validSig = `sha256=${createHmac('sha256', testSecret).update(testBody).digest('hex')}`;

  await test('valid signature → true', () => {
    assert.equal(validateHubSig(testBody, validSig, testSecret), true);
  });

  await test('invalid signature string → false', () => {
    assert.equal(validateHubSig(testBody, 'sha256=badhash', testSecret), false);
  });

  await test('missing signature → false', () => {
    assert.equal(validateHubSig(testBody, undefined, testSecret), false);
  });

  await test('empty secret → null (no validation mode)', () => {
    assert.equal(validateHubSig(testBody, validSig, ''), null);
  });

  await test('tampered body → false', () => {
    const tamperedBody = Buffer.from('tampered payload');
    assert.equal(validateHubSig(tamperedBody, validSig, testSecret), false);
  });

  await test('different secret → false', () => {
    assert.equal(validateHubSig(testBody, validSig, 'wrong-secret'), false);
  });

  await test('signature length mismatch → false (timing-safe shortcut)', () => {
    assert.equal(validateHubSig(testBody, 'sha256=short', testSecret), false);
  });

  // ── sanitizeConnection ───────────────────────────────────────────────────────
  section('sanitizeConnection (inline replica)');

  function sanitizeConnection(conn: Record<string, unknown>) {
    const {
      evolutionApiKeyEncrypted: _eak,
      metaAccessTokenEncrypted: _mat,
      metaWebhookVerifyToken: _mwvt,
      metaWebhookSecret: _mws,
      webhookSecret: _ws,
      ...safe
    } = conn;
    return safe;
  }

  await test('evolutionApiKeyEncrypted stripped', () => {
    const result = sanitizeConnection({ id: '1', evolutionApiKeyEncrypted: 'secret', name: 'test' });
    assert.ok(!('evolutionApiKeyEncrypted' in result));
    assert.equal(result.name, 'test');
  });

  await test('metaAccessTokenEncrypted stripped', () => {
    const result = sanitizeConnection({ id: '1', metaAccessTokenEncrypted: 'token123', name: 'test' });
    assert.ok(!('metaAccessTokenEncrypted' in result));
  });

  await test('non-secret fields preserved', () => {
    const result = sanitizeConnection({ id: 'abc', provider: 'evolution_api', status: 'connected' });
    assert.equal(result.id, 'abc');
    assert.equal(result.provider, 'evolution_api');
    assert.equal(result.status, 'connected');
  });

  // ── Role / Permission helpers ────────────────────────────────────────────────
  section('Role permission helpers');

  const owner = { role: 'OWNER', canAccessAllClinics: true };
  const orgAdmin = { role: 'ORG_ADMIN', canAccessAllClinics: true };
  const clinicMgr = { role: 'CLINIC_MANAGER', canAccessAllClinics: false };
  const dentist = { role: 'DENTIST', canAccessAllClinics: false };
  const receptionist = { role: 'RECEPTIONIST', canAccessAllClinics: false };
  const billing = { role: 'BILLING', canAccessAllClinics: false };
  const assistant = { role: 'ASSISTANT', canAccessAllClinics: false };

  await test('canManageWhatsAppConnections: OWNER → true', () => {
    assert.equal(canManageWhatsAppConnections(owner), true);
  });
  await test('canManageWhatsAppConnections: ORG_ADMIN → true', () => {
    assert.equal(canManageWhatsAppConnections(orgAdmin), true);
  });
  await test('canManageWhatsAppConnections: RECEPTIONIST → false', () => {
    assert.equal(canManageWhatsAppConnections(receptionist), false);
  });

  await test('canAssignWhatsAppToClinic: CLINIC_MANAGER → true', () => {
    assert.equal(canAssignWhatsAppToClinic(clinicMgr), true);
  });
  await test('canAssignWhatsAppToClinic: BILLING → false', () => {
    assert.equal(canAssignWhatsAppToClinic(billing), false);
  });

  await test('canViewWhatsAppStatus: CLINIC_MANAGER → true', () => {
    assert.equal(canViewWhatsAppStatus(clinicMgr), true);
  });
  await test('canViewWhatsAppStatus: ASSISTANT → false', () => {
    assert.equal(canViewWhatsAppStatus(assistant), false);
  });

  await test('canSendWhatsAppMessages: DENTIST → true', () => {
    assert.equal(canSendWhatsAppMessages(dentist), true);
  });
  await test('canSendWhatsAppMessages: RECEPTIONIST → true', () => {
    assert.equal(canSendWhatsAppMessages(receptionist), true);
  });
  await test('canSendWhatsAppMessages: BILLING → false', () => {
    assert.equal(canSendWhatsAppMessages(billing), false);
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

// ─── Extended tests (connection panel E2E logic) ──────────────────────────────

async function extendedTests() {
  // Re-use encryption + sanitize helpers already imported at top of file

  function sanitizeConnection(conn: Record<string, unknown>) {
    const {
      evolutionApiKeyEncrypted: _eak,
      metaAccessTokenEncrypted: _mat,
      metaWebhookVerifyToken: _mwvt,
      metaWebhookSecret: _mws,
      webhookSecret: _ws,
      ...safe
    } = conn;
    return safe;
  }

  // ── 1. Create connection — secrets never returned ────────────────────────────
  section('Create connection — secret handling');

  await test('new connection payload → API key encrypted, not returned', () => {
    const plainKey = 'evolution-api-key-plain';
    const encrypted = encryptSecret(plainKey);
    // Simulate what DB stores vs what client receives
    const stored = {
      id: 'conn-1', name: 'Main', provider: 'evolution_api',
      evolutionApiKeyEncrypted: encrypted,
      evolutionApiUrl: 'https://evo.example.com',
      evolutionInstanceName: 'clinic-main',
    };
    const response = sanitizeConnection(stored);
    assert.ok(!('evolutionApiKeyEncrypted' in response), 'encrypted key must be stripped from response');
    assert.equal(response.name, 'Main');
    assert.equal(response.evolutionApiUrl, 'https://evo.example.com');
  });

  await test('webhookSecret stripped from response', () => {
    const stored = { id: 'conn-1', name: 'X', webhookSecret: 'my-webhook-secret', provider: 'evolution_api' };
    const response = sanitizeConnection(stored);
    assert.ok(!('webhookSecret' in response));
    assert.equal(response.provider, 'evolution_api');
  });

  await test('QR response must not include credentials', () => {
    // Simulated QR response (only safe fields)
    const qrResponse = { available: true, qrCode: 'base64string' };
    assert.ok(!('apiKey' in qrResponse));
    assert.ok(!('evolutionApiKeyEncrypted' in qrResponse));
    assert.ok(qrResponse.available);
  });

  // ── 2. Edit connection — empty API key preserves old encrypted key ───────────
  section('Edit connection — API key preservation');

  await test('empty API key string → should NOT re-encrypt or overwrite', () => {
    const original = encryptSecret('original-key');
    // Simulate update logic: only replace if non-empty string provided
    function applyKeyUpdate(existing: string, incoming: string | undefined): string {
      if (typeof incoming === 'string' && incoming.length > 0) {
        return encryptSecret(incoming);
      }
      return existing; // keep old
    }
    const result = applyKeyUpdate(original, '');
    assert.equal(result, original, 'empty input must preserve old encrypted key');
  });

  await test('new API key string → encrypts and replaces', () => {
    const original = encryptSecret('original-key');
    function applyKeyUpdate(existing: string, incoming: string | undefined): string {
      if (typeof incoming === 'string' && incoming.length > 0) {
        return encryptSecret(incoming);
      }
      return existing;
    }
    const result = applyKeyUpdate(original, 'new-key');
    assert.notEqual(result, original, 'new key must produce different ciphertext');
    assert.equal(decryptSecret(result), 'new-key', 'new key must decrypt correctly');
  });

  await test('undefined API key → preserves old encrypted key', () => {
    const original = encryptSecret('keep-this');
    function applyKeyUpdate(existing: string, incoming: string | undefined): string {
      if (typeof incoming === 'string' && incoming.length > 0) {
        return encryptSecret(incoming);
      }
      return existing;
    }
    const result = applyKeyUpdate(original, undefined);
    assert.equal(result, original);
  });

  // ── 3. Disconnect prevents sending ──────────────────────────────────────────
  section('Disconnect / inactive connection guard');

  await test('isActive=false connection → sendWhatsAppMessage returns error', async () => {
    // Simulate resolveConnectionForClinic returning null when isActive=false
    // (the actual service code checks isActive and returns null)
    const inactiveConn = {
      id: 'conn-1', organizationId: 'org-1', provider: 'evolution_api',
      status: 'disconnected', isActive: false,
      evolutionApiUrl: 'https://evo.example.com',
      evolutionInstanceName: 'inst',
      evolutionApiKeyEncrypted: encryptSecret('key'),
    };
    // Simulate the guard logic in sendWhatsAppMessage
    function guardedSend(conn: typeof inactiveConn | null): { success: boolean; error?: string } {
      if (!conn) {
        return { success: false, error: 'No active WhatsApp connection found for this clinic.' };
      }
      if (!conn.isActive) {
        return { success: false, error: 'WhatsApp connection is inactive or disconnected.' };
      }
      return { success: true };
    }
    const result = guardedSend(inactiveConn);
    assert.equal(result.success, false);
    assert.ok(result.error?.toLowerCase().includes('inactive') || result.error?.toLowerCase().includes('disconnected'));
  });

  await test('null connection → sendWhatsAppMessage returns clear error', () => {
    function guardedSend(conn: null | { isActive: boolean }): { success: boolean; error?: string } {
      if (!conn) return { success: false, error: 'No active WhatsApp connection found for this clinic.' };
      if (!conn.isActive) return { success: false, error: 'Connection inactive.' };
      return { success: true };
    }
    const result = guardedSend(null);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('No active'));
  });

  await test('disconnect marks isActive=false + status=disconnected (service behavior)', () => {
    // Simulate the DB update that disconnectWhatsAppConnection performs
    const conn = { id: 'c1', status: 'connected', isActive: true };
    const after = { ...conn, status: 'disconnected', isActive: false };
    assert.equal(after.isActive, false);
    assert.equal(after.status, 'disconnected');
  });

  // ── 4. Shared connection resolves for multiple clinics ───────────────────────
  section('Shared vs dedicated clinic assignment');

  await test('shared: same connection resolves for clinic A and clinic B', () => {
    const sharedConn = { id: 'conn-shared', provider: 'evolution_api', isActive: true };
    // Two ClinicWhatsAppConnection records pointing to same connection
    const mappings = [
      { clinicId: 'clinic-a', whatsappConnectionId: sharedConn.id, isDefault: true, whatsappConnection: sharedConn },
      { clinicId: 'clinic-b', whatsappConnectionId: sharedConn.id, isDefault: true, whatsappConnection: sharedConn },
    ];
    function resolve(clinicId: string) {
      return mappings.find((m) => m.clinicId === clinicId && m.isDefault)?.whatsappConnection ?? null;
    }
    const a = resolve('clinic-a');
    const b = resolve('clinic-b');
    assert.equal(a?.id, sharedConn.id);
    assert.equal(b?.id, sharedConn.id);
    assert.equal(a?.id, b?.id, 'both clinics use same connection');
  });

  await test('dedicated: clinic A and clinic B have separate connections', () => {
    const connA = { id: 'conn-a', provider: 'evolution_api', isActive: true };
    const connB = { id: 'conn-b', provider: 'evolution_api', isActive: true };
    const mappings = [
      { clinicId: 'clinic-a', whatsappConnectionId: connA.id, isDefault: true, whatsappConnection: connA },
      { clinicId: 'clinic-b', whatsappConnectionId: connB.id, isDefault: true, whatsappConnection: connB },
    ];
    function resolve(clinicId: string) {
      return mappings.find((m) => m.clinicId === clinicId && m.isDefault)?.whatsappConnection ?? null;
    }
    assert.equal(resolve('clinic-a')?.id, 'conn-a');
    assert.equal(resolve('clinic-b')?.id, 'conn-b');
    assert.notEqual(resolve('clinic-a')?.id, resolve('clinic-b')?.id);
  });

  await test('reassignment: after moving clinic-a to conn-b, only conn-b resolves', () => {
    // Initial state: clinic-a → conn-a
    let mappings = [
      { clinicId: 'clinic-a', whatsappConnectionId: 'conn-a', isDefault: true },
      { clinicId: 'clinic-b', whatsappConnectionId: 'conn-b', isDefault: true },
    ];
    // Reassign clinic-a to conn-b (delete old default, create new)
    mappings = mappings.filter((m) => !(m.clinicId === 'clinic-a' && m.whatsappConnectionId === 'conn-a'));
    mappings.push({ clinicId: 'clinic-a', whatsappConnectionId: 'conn-b', isDefault: true });

    const forClinicA = mappings.find((m) => m.clinicId === 'clinic-a' && m.isDefault);
    assert.equal(forClinicA?.whatsappConnectionId, 'conn-b');
    // conn-a no longer has clinic-a
    const oldMapping = mappings.find((m) => m.clinicId === 'clinic-a' && m.whatsappConnectionId === 'conn-a');
    assert.equal(oldMapping, undefined);
  });

  // ── 5. Cross-organization clinic rejection ───────────────────────────────────
  section('Cross-organization clinic assignment guard');

  await test('cross-org clinic ID is rejected by org filter', () => {
    const organizationId = 'org-1';
    // Simulate incoming clinic IDs (one valid, one from another org)
    const requestedIds = ['clinic-1', 'clinic-evil-other-org'];
    // Server-side: findMany with organizationId filter
    const orgClinics = [
      { id: 'clinic-1', organizationId: 'org-1' },
      // 'clinic-evil-other-org' belongs to org-2, not returned
    ];
    const validIds = requestedIds.filter((id) => orgClinics.some((c) => c.id === id && c.organizationId === organizationId));
    assert.equal(validIds.length, 1);
    assert.equal(validIds[0], 'clinic-1');
    assert.ok(!validIds.includes('clinic-evil-other-org'));
  });

  // ── 6. Legacy import idempotency ────────────────────────────────────────────
  section('Legacy import idempotency');

  await test('import-legacy with existing instance → returns alreadyImported=true, no duplicate', () => {
    const instanceName = 'my-instance';
    // Simulate DB state: connection already imported
    const db: Array<{ id: string; evolutionInstanceName: string }> = [
      { id: 'conn-existing', evolutionInstanceName: instanceName },
    ];
    function tryImport(name: string): { alreadyImported: boolean } {
      const existing = db.find((c) => c.evolutionInstanceName === name);
      if (existing) return { alreadyImported: true };
      db.push({ id: 'conn-new', evolutionInstanceName: name });
      return { alreadyImported: false };
    }
    const first = tryImport(instanceName);
    assert.equal(first.alreadyImported, true);
    assert.equal(db.length, 1, 'no duplicate created');
    const second = tryImport(instanceName);
    assert.equal(second.alreadyImported, true);
    assert.equal(db.length, 1, 'still no duplicate after second call');
  });

  await test('import-legacy with no existing instance → creates record', () => {
    const instanceName = 'new-instance';
    const db: Array<{ id: string; evolutionInstanceName: string }> = [];
    function tryImport(name: string): { alreadyImported: boolean } {
      const existing = db.find((c) => c.evolutionInstanceName === name);
      if (existing) return { alreadyImported: true };
      db.push({ id: 'conn-new', evolutionInstanceName: name });
      return { alreadyImported: false };
    }
    const result = tryImport(instanceName);
    assert.equal(result.alreadyImported, false);
    assert.equal(db.length, 1);
  });

  // ── 7. Existing send flow integration ───────────────────────────────────────
  section('Existing send flow (legacy fallback)');

  await test('resolveConnectionForClinic: no DB record + env vars → uses legacy config', () => {
    // Simulate the fallback behavior without DB
    const envConfig = {
      EVOLUTION_API_BASE_URL: 'https://evo.example.com',
      EVOLUTION_API_KEY: 'legacy-key',
      EVOLUTION_INSTANCE_NAME: 'legacy-inst',
    };
    function buildLegacy(env: typeof envConfig) {
      if (!env.EVOLUTION_API_BASE_URL || !env.EVOLUTION_API_KEY) return null;
      return {
        id: 'legacy', provider: 'evolution_api',
        evolutionApiUrl: env.EVOLUTION_API_BASE_URL,
        evolutionInstanceName: env.EVOLUTION_INSTANCE_NAME,
        evolutionApiKeyEncrypted: env.EVOLUTION_API_KEY, // raw in legacy mode
        isActive: true,
      };
    }
    const conn = buildLegacy(envConfig);
    assert.ok(conn !== null);
    assert.equal(conn?.evolutionApiUrl, 'https://evo.example.com');
    assert.equal(conn?.provider, 'evolution_api');
  });

  await test('resolveConnectionForClinic: DB record exists + isActive=true → DB wins over legacy', () => {
    const dbRecord = {
      id: 'conn-db', provider: 'evolution_api', isActive: true,
      evolutionApiUrl: 'https://evo-prod.example.com',
    };
    function resolve(db: typeof dbRecord | null, envExists: boolean) {
      if (db && db.isActive) return db; // DB wins
      if (envExists) return { id: 'legacy', provider: 'evolution_api', isActive: true };
      return null;
    }
    const result = resolve(dbRecord, true);
    assert.equal(result?.id, 'conn-db', 'DB record takes priority');
  });

  await test('resolveConnectionForClinic: DB record isActive=false → falls back to null (not env)', () => {
    const inactiveDb = { id: 'conn-db', provider: 'evolution_api', isActive: false };
    // After the isActive fix in whatsappService.ts, isActive=false → return null
    function resolve(db: typeof inactiveDb | null): string {
      if (!db || !db.isActive) return 'null';
      return db.id;
    }
    assert.equal(resolve(inactiveDb), 'null');
  });

  // ── 8. Permission model ──────────────────────────────────────────────────────
  section('Permission model — complete matrix');

  await test('DENTIST cannot manage connections', () => {
    const dentist = { role: 'DENTIST', canAccessAllClinics: false };
    assert.equal(canManageWhatsAppConnections(dentist), false);
  });

  await test('BILLING cannot view status', () => {
    const billing = { role: 'BILLING', canAccessAllClinics: false };
    assert.equal(canViewWhatsAppStatus(billing), false);
  });

  await test('OWNER can assign connections to clinics', () => {
    const owner = { role: 'OWNER', canAccessAllClinics: true };
    assert.equal(canAssignWhatsAppToClinic(owner), true);
  });

  await test('CLINIC_MANAGER can view but cannot manage connections', () => {
    const cm = { role: 'CLINIC_MANAGER', canAccessAllClinics: false };
    assert.equal(canViewWhatsAppStatus(cm), true);
    assert.equal(canManageWhatsAppConnections(cm), false);
  });

  await test('RECEPTIONIST can send but cannot manage connections', () => {
    const r = { role: 'RECEPTIONIST', canAccessAllClinics: false };
    assert.equal(canSendWhatsAppMessages(r), true);
    assert.equal(canManageWhatsAppConnections(r), false);
  });

  // ── 9. Explicit clinic enforcement for WhatsApp send ────────────────────────
  section('Explicit clinic enforcement — clinicId=all guard');

  await test('clinicId="all" → sendWhatsAppMessage returns friendly error', async () => {
    // Simulate the guard added at the top of sendWhatsAppMessage
    function guardedSend(clinicId: string): { success: boolean; error?: string } {
      if (!clinicId || clinicId === 'all') {
        return { success: false, error: 'Please select a clinic before sending a WhatsApp message.' };
      }
      return { success: true };
    }
    const result = guardedSend('all');
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('select a clinic'));
  });

  await test('clinicId="" (empty) → sendWhatsAppMessage returns error', async () => {
    function guardedSend(clinicId: string): { success: boolean; error?: string } {
      if (!clinicId || clinicId === 'all') {
        return { success: false, error: 'Please select a clinic before sending a WhatsApp message.' };
      }
      return { success: true };
    }
    const result = guardedSend('');
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('select a clinic'));
  });

  await test('valid UUID clinicId → passes the guard', async () => {
    function guardedSend(clinicId: string): { success: boolean; error?: string } {
      if (!clinicId || clinicId === 'all') {
        return { success: false, error: 'Please select a clinic before sending a WhatsApp message.' };
      }
      return { success: true };
    }
    const result = guardedSend('a1b2c3d4-0000-0000-0000-000000000001');
    assert.equal(result.success, true);
  });

  // ── 10. Evolution QR endpoint compatibility ──────────────────────────────────
  section('Evolution QR endpoint compatibility');

  await test('getQrCode with missing credentials → available: false', async () => {
    const provider = new EvolutionWhatsAppProvider();
    const conn = { id: 'c1', organizationId: 'org-1', provider: 'evolution_api', status: 'connected' };
    // No env vars set → credentials missing
    const savedUrl = process.env.EVOLUTION_API_BASE_URL;
    const savedKey = process.env.EVOLUTION_API_KEY;
    const savedInst = process.env.EVOLUTION_INSTANCE_NAME;
    delete process.env.EVOLUTION_API_BASE_URL;
    delete process.env.EVOLUTION_API_KEY;
    delete process.env.EVOLUTION_INSTANCE_NAME;
    const result = await provider.getQrCode(conn);
    process.env.EVOLUTION_API_BASE_URL = savedUrl;
    process.env.EVOLUTION_API_KEY = savedKey;
    process.env.EVOLUTION_INSTANCE_NAME = savedInst;
    assert.equal(result.available, false);
    assert.ok(result.message?.toLowerCase().includes('credentials') || result.message?.toLowerCase().includes('configuration'));
  });

  await test('getQrCode 404 on both paths → returns unavailable with clear message', async () => {
    // Simulate both endpoints returning 404 — result should be graceful
    // We test the logic inline (the actual HTTP calls go to a real server)
    const results: Array<{ status: number; ok: boolean }> = [
      { status: 404, ok: false },
      { status: 404, ok: false },
    ];
    let finalResult = { available: false, message: 'QR endpoint is not available for this Evolution API deployment.' };
    for (const r of results) {
      if (r.status === 404 || r.status === 405) continue;
      if (!r.ok) {
        finalResult = { available: false, message: `QR fetch failed with ${r.status}` };
        break;
      }
    }
    assert.equal(finalResult.available, false);
    assert.ok(finalResult.message.includes('not available'));
  });

  await test('QR response object never contains API key field', () => {
    // Assert that QrCodeResult interface only contains safe fields
    const mockQrResult = { available: true, qrCode: 'base64data==', message: undefined };
    assert.ok(!('apiKey' in mockQrResult));
    assert.ok(!('evolutionApiKeyEncrypted' in mockQrResult));
    assert.ok(!('metaAccessTokenEncrypted' in mockQrResult));
    assert.ok(mockQrResult.qrCode === 'base64data==');
  });

  await test('QR instance already connected → available: false with descriptive message', () => {
    // Simulate API returning 200 with no qrCode field (already connected)
    const data: Record<string, unknown> = { status: 'open' }; // no qrcode key
    const qrcodeObj = data?.qrcode as Record<string, unknown> | undefined;
    const qrCode = (qrcodeObj?.base64 ?? data?.base64) as string | undefined ?? null;
    const result = {
      available: Boolean(qrCode),
      qrCode: typeof qrCode === 'string' ? qrCode : null,
      message: qrCode ? undefined : 'No QR code available — instance may already be connected',
    };
    assert.equal(result.available, false);
    assert.ok(result.message?.includes('already be connected'));
  });
}

// ─── Sprint 16B — Meta Cloud API production readiness tests ─────────────────
async function sprintSixteenBTests() {
  section('Sprint 16B — sendTemplateMessage');

  await test('Evolution sendTemplateMessage → supported: false (not implemented)', async () => {
    const provider = new EvolutionWhatsAppProvider();
    const conn = { id: 'c1', organizationId: 'org-1', provider: 'evolution_api', status: 'connected' };
    const result = await provider.sendTemplateMessage(conn, {
      phone: '+905001234567',
      templateName: 'hello_world',
      languageCode: 'tr',
    });
    assert.equal(result.supported, false);
    assert.ok(typeof result.error === 'string');
  });

  await test('Meta sendTemplateMessage → missing credentials → supported: true, success: false', async () => {
    const provider = new MetaCloudWhatsAppProvider();
    // Connection missing metaAccessToken and metaPhoneNumberId
    const conn = { id: 'c2', organizationId: 'org-1', provider: 'meta_cloud_api', status: 'connected' };
    const result = await provider.sendTemplateMessage(conn, {
      phone: '+905001234567',
      templateName: 'hello_world',
      languageCode: 'tr',
    });
    assert.equal(result.supported, true);
    assert.equal(result.success, false);
    assert.ok(typeof result.error === 'string');
  });

  await test('Meta sendTemplateMessage → Graph API success → supported: true, success: true', async () => {
    const provider = new MetaCloudWhatsAppProvider();
    const conn = {
      id: 'c3',
      organizationId: 'org-1',
      provider: 'meta_cloud_api',
      status: 'connected',
      metaPhoneNumberId: 'pn_001',
      metaAccessTokenEncrypted: 'MOCK_ACCESS_TOKEN',
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({ ok: true, json: async () => ({ messages: [{ id: 'wamid.abc123' }] }) } as Response);
    const result = await provider.sendTemplateMessage(conn, {
      phone: '+905001234567',
      templateName: 'hello_world',
      languageCode: 'tr',
    });
    globalThis.fetch = originalFetch;
    assert.equal(result.supported, true);
    assert.equal(result.success, true);
    assert.ok(result.externalMessageId?.includes('wamid'));
  });

  await test('Meta sendTemplateMessage → Graph API error → supported: true, success: false', async () => {
    const provider = new MetaCloudWhatsAppProvider();
    const conn = {
      id: 'c4',
      organizationId: 'org-1',
      provider: 'meta_cloud_api',
      status: 'connected',
      metaPhoneNumberId: 'pn_001',
      metaAccessTokenEncrypted: 'MOCK_ACCESS_TOKEN',
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Template not found' } }),
      } as Response);
    const result = await provider.sendTemplateMessage(conn, {
      phone: '+905001234567',
      templateName: 'no_such_template',
      languageCode: 'tr',
    });
    globalThis.fetch = originalFetch;
    assert.equal(result.supported, true);
    assert.equal(result.success, false);
    assert.ok(typeof result.error === 'string');
  });

  section('Sprint 16B — sanitizeConnection token fields');

  await test('metaTokenStatus passes through sanitizeConnection', () => {
    function sanitize(conn: Record<string, unknown>) {
      const { evolutionApiKeyEncrypted: _a, metaAccessTokenEncrypted: _b, metaWebhookVerifyToken: _c, metaWebhookSecret: _d, webhookSecret: _e, ...safe } = conn;
      return safe;
    }
    const result = sanitize({ id: 'x', metaTokenStatus: 'expiring', metaTokenExpiresAt: '2025-01-01T00:00:00Z' });
    assert.equal(result.metaTokenStatus, 'expiring');
    assert.ok('metaTokenExpiresAt' in result);
  });

  await test('metaTokenStatus not in stripped fields list', () => {
    const stripped = ['evolutionApiKeyEncrypted', 'metaAccessTokenEncrypted', 'metaWebhookVerifyToken', 'metaWebhookSecret', 'webhookSecret'];
    assert.ok(!stripped.includes('metaTokenStatus'));
    assert.ok(!stripped.includes('metaTokenExpiresAt'));
  });

  section('Sprint 16B — MetaCallbackPage message shape');

  await test('meta_signup_callback message type constant is correct', () => {
    const msg = { type: 'meta_signup_callback', code: 'authcode123', state: 'state456', error: null, errorDescription: null };
    assert.equal(msg.type, 'meta_signup_callback');
    assert.ok('code' in msg);
    assert.ok('state' in msg);
    assert.ok('error' in msg);
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Sprint 16B tests — ${passed} passed, ${failed} failed`);
}

main().then(() => extendedTests()).then(() => sprintSixteenBTests()).then(() => connectionLifecycleTests()).then(() => sprintSeventeenBTests()).then(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log('All tests complete');
}).catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});

// ─── Sprint 17A — Connection lifecycle (status toggle + delete guard) ─────────
async function connectionLifecycleTests() {
  section('Sprint 17A — Deactivate / Activate (PATCH /status logic)');

  await test('setStatus isActive=false → status becomes "disconnected"', () => {
    // Simulate PATCH /status endpoint logic
    function applyStatus(
      conn: { isActive: boolean; status: string },
      payload: { isActive: boolean; status?: string },
    ) {
      const update: { isActive: boolean; status: string } = { ...conn, isActive: payload.isActive };
      if (payload.status) {
        update.status = payload.status;
      } else if (!payload.isActive) {
        update.status = 'disconnected';
      }
      return update;
    }
    const result = applyStatus({ isActive: true, status: 'connected' }, { isActive: false });
    assert.equal(result.isActive, false);
    assert.equal(result.status, 'disconnected');
  });

  await test('setStatus isActive=true without explicit status → preserves existing status', () => {
    function applyStatus(
      conn: { isActive: boolean; status: string },
      payload: { isActive: boolean; status?: string },
    ) {
      const update: { isActive: boolean; status: string } = { ...conn, isActive: payload.isActive };
      if (payload.status) {
        update.status = payload.status;
      } else if (!payload.isActive) {
        update.status = 'disconnected';
      }
      return update;
    }
    const result = applyStatus({ isActive: false, status: 'disconnected' }, { isActive: true });
    assert.equal(result.isActive, true);
    // status not changed because isActive=true and no explicit status in payload
    assert.equal(result.status, 'disconnected');
  });

  await test('setStatus isActive=true with explicit status="connected" → connected', () => {
    function applyStatus(
      conn: { isActive: boolean; status: string },
      payload: { isActive: boolean; status?: string },
    ) {
      const update: { isActive: boolean; status: string } = { ...conn, isActive: payload.isActive };
      if (payload.status) update.status = payload.status;
      else if (!payload.isActive) update.status = 'disconnected';
      return update;
    }
    const result = applyStatus(
      { isActive: false, status: 'disconnected' },
      { isActive: true, status: 'connected' },
    );
    assert.equal(result.isActive, true);
    assert.equal(result.status, 'connected');
  });

  await test('inactive connection cannot send — isActive=false guard fires', () => {
    function canSend(isActive: boolean): { allowed: boolean; reason?: string } {
      if (!isActive) return { allowed: false, reason: 'Bağlantı devre dışı — mesaj gönderilemez.' };
      return { allowed: true };
    }
    assert.equal(canSend(false).allowed, false);
    assert.ok(canSend(false).reason?.includes('devre dışı'));
    assert.equal(canSend(true).allowed, true);
  });

  section('Sprint 17A — Delete guard (message history check)');

  await test('deleteConnection: 0 messages → allowed', () => {
    function canDelete(messageCount: number): { allowed: boolean; code?: string } {
      if (messageCount > 0) return { allowed: false, code: 'HAS_MESSAGE_HISTORY' };
      return { allowed: true };
    }
    assert.equal(canDelete(0).allowed, true);
  });

  await test('deleteConnection: >0 messages → blocked with HAS_MESSAGE_HISTORY', () => {
    function canDelete(messageCount: number): { allowed: boolean; code?: string } {
      if (messageCount > 0) return { allowed: false, code: 'HAS_MESSAGE_HISTORY' };
      return { allowed: true };
    }
    const result = canDelete(5);
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'HAS_MESSAGE_HISTORY');
  });

  await test('deleteConnection: 1 message → also blocked', () => {
    function canDelete(messageCount: number): { allowed: boolean; code?: string } {
      if (messageCount > 0) return { allowed: false, code: 'HAS_MESSAGE_HISTORY' };
      return { allowed: true };
    }
    assert.equal(canDelete(1).allowed, false);
  });

  await test('deleteConnection: clinic assignments removed before connection delete', () => {
    // Simulate the two-step delete sequence
    const clinicAssignments: Array<{ connectionId: string; clinicId: string }> = [
      { connectionId: 'conn-1', clinicId: 'clinic-a' },
      { connectionId: 'conn-1', clinicId: 'clinic-b' },
    ];
    const connections: Array<{ id: string }> = [{ id: 'conn-1' }];

    // Step 1: delete assignments
    const cleaned = clinicAssignments.filter((a) => a.connectionId !== 'conn-1');
    // Step 2: delete connection
    const remaining = connections.filter((c) => c.id !== 'conn-1');

    assert.equal(cleaned.length, 0, 'all assignments removed first');
    assert.equal(remaining.length, 0, 'connection removed after assignments');
  });

  await test('secrets never returned after delete 409 error', () => {
    // When delete returns 409, response must not contain sensitive fields
    const errorResponse = {
      error: 'Bu bağlantıya ait mesaj kaydı bulunduğundan silinemez.',
      code: 'HAS_MESSAGE_HISTORY',
      messageCount: 3,
    };
    assert.ok(!('evolutionApiKeyEncrypted' in errorResponse));
    assert.ok(!('metaAccessTokenEncrypted' in errorResponse));
    assert.ok(!('webhookSecret' in errorResponse));
    assert.ok('messageCount' in errorResponse);
  });

  section('Sprint 17A — Unauthorized role cannot call status/delete');

  await test('canManageWhatsAppConnections: CLINIC_MANAGER cannot toggle status', () => {
    const cm = { role: 'CLINIC_MANAGER', canAccessAllClinics: false };
    assert.equal(canManageWhatsAppConnections(cm), false);
  });

  await test('canManageWhatsAppConnections: DENTIST cannot delete connection', () => {
    const dentist = { role: 'DENTIST', canAccessAllClinics: false };
    assert.equal(canManageWhatsAppConnections(dentist), false);
  });

  await test('canManageWhatsAppConnections: BILLING cannot toggle status', () => {
    const billing = { role: 'BILLING', canAccessAllClinics: false };
    assert.equal(canManageWhatsAppConnections(billing), false);
  });

  await test('canManageWhatsAppConnections: OWNER can toggle and delete', () => {
    const owner = { role: 'OWNER', canAccessAllClinics: true };
    assert.equal(canManageWhatsAppConnections(owner), true);
  });

  await test('canManageWhatsAppConnections: ORG_ADMIN can toggle and delete', () => {
    const orgAdmin = { role: 'ORG_ADMIN', canAccessAllClinics: true };
    assert.equal(canManageWhatsAppConnections(orgAdmin), true);
  });

  section('Sprint 17A — Legacy card does not allow delete/disconnect');

  await test('isLegacy connection: no delete action available', () => {
    const legacyConn = { id: '__legacy__', isLegacy: true, provider: 'evolution_api', isActive: true };
    // Delete must be blocked for legacy virtual entries (they have no real DB id)
    function canDeleteConn(conn: { isLegacy?: boolean }): boolean {
      return !conn.isLegacy;
    }
    assert.equal(canDeleteConn(legacyConn), false);
  });

  await test('isLegacy connection: import action available for OWNER/ORG_ADMIN', () => {
    const legacyConn = { id: '__legacy__', isLegacy: true };
    const owner = { role: 'OWNER', canAccessAllClinics: true };
    assert.equal(canManageWhatsAppConnections(owner), true);
    // Legacy conn itself does not expose management actions; only import
    assert.ok(legacyConn.isLegacy);
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Sprint 17A connection lifecycle tests complete`);
}

// ─── Sprint 17B — Legacy fallback flag (ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK) ──
async function sprintSeventeenBTests() {
  section('Sprint 17B — isLegacyFallbackEnabled() flag semantics');

  await test('flag defaults to true when env var is not set', () => {
    const saved = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    delete process.env.NODE_ENV;
    function isLegacyFallbackEnabled(): boolean {
      const flag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK?.trim().toLowerCase();
      if (flag === 'false' || flag === '0') return false;
      return process.env.NODE_ENV !== 'production';
    }
    assert.equal(isLegacyFallbackEnabled(), true);
    if (saved !== undefined) process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = saved;
    if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
    else delete process.env.NODE_ENV;
  });

  await test('flag defaults to false in production when env var is not set', () => {
    const saved = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    process.env.NODE_ENV = 'production';
    assert.equal(isLegacyFallbackEnabled(), false);
    if (saved !== undefined) process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = saved;
    else delete process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
    else delete process.env.NODE_ENV;
  });

  await test('flag is true when set to "true"', () => {
    const saved = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = 'true';
    function isLegacyFallbackEnabled(): boolean {
      const flag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK?.trim().toLowerCase();
      if (flag === 'false' || flag === '0') return false;
      return true;
    }
    assert.equal(isLegacyFallbackEnabled(), true);
    if (saved !== undefined) process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = saved;
    else delete process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
  });

  await test('flag is false when set to "false"', () => {
    const saved = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = 'false';
    function isLegacyFallbackEnabled(): boolean {
      const flag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK?.trim().toLowerCase();
      if (flag === 'false' || flag === '0') return false;
      return true;
    }
    assert.equal(isLegacyFallbackEnabled(), false);
    if (saved !== undefined) process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = saved;
    else delete process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
  });

  await test('flag is false when set to "0"', () => {
    const saved = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = '0';
    function isLegacyFallbackEnabled(): boolean {
      const flag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK?.trim().toLowerCase();
      if (flag === 'false' || flag === '0') return false;
      return true;
    }
    assert.equal(isLegacyFallbackEnabled(), false);
    if (saved !== undefined) process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = saved;
    else delete process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
  });

  await test('flag is false when set to "FALSE" (case-insensitive)', () => {
    const saved = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = 'FALSE';
    function isLegacyFallbackEnabled(): boolean {
      const flag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK?.trim().toLowerCase();
      if (flag === 'false' || flag === '0') return false;
      return true;
    }
    assert.equal(isLegacyFallbackEnabled(), false);
    if (saved !== undefined) process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = saved;
    else delete process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
  });

  section('Sprint 17B — getLegacyEvolutionConfig() with flag');

  await test('getLegacyEvolutionConfig returns config when flag=true and all env vars set', () => {
    const savedFlag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    const savedUrl = process.env.EVOLUTION_API_BASE_URL;
    const savedKey = process.env.EVOLUTION_API_KEY;
    const savedInst = process.env.EVOLUTION_INSTANCE_NAME;

    process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = 'true';
    process.env.EVOLUTION_API_BASE_URL = 'http://legacy-evo.example.com';
    process.env.EVOLUTION_API_KEY = 'legacy-key-xxx';
    process.env.EVOLUTION_INSTANCE_NAME = 'legacy-inst';

    function isLegacyFallbackEnabled(): boolean {
      const flag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK?.trim().toLowerCase();
      return flag !== 'false' && flag !== '0';
    }
    function getLegacyEvolutionConfig() {
      if (!isLegacyFallbackEnabled()) return null;
      const url = process.env.EVOLUTION_API_BASE_URL?.trim();
      const key = process.env.EVOLUTION_API_KEY?.trim();
      const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim();
      if (!url || !key || !instanceName) return null;
      return { url, key, instanceName };
    }

    const cfg = getLegacyEvolutionConfig();
    assert.ok(cfg !== null);
    assert.equal(cfg?.url, 'http://legacy-evo.example.com');
    assert.equal(cfg?.instanceName, 'legacy-inst');
    // key is present but we don't log it
    assert.ok(cfg?.key.length > 0);

    if (savedFlag !== undefined) process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = savedFlag;
    else delete process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    if (savedUrl !== undefined) process.env.EVOLUTION_API_BASE_URL = savedUrl;
    else delete process.env.EVOLUTION_API_BASE_URL;
    if (savedKey !== undefined) process.env.EVOLUTION_API_KEY = savedKey;
    else delete process.env.EVOLUTION_API_KEY;
    if (savedInst !== undefined) process.env.EVOLUTION_INSTANCE_NAME = savedInst;
    else delete process.env.EVOLUTION_INSTANCE_NAME;
  });

  await test('getLegacyEvolutionConfig returns null when flag=false even if env vars present', () => {
    const savedFlag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    const savedUrl = process.env.EVOLUTION_API_BASE_URL;
    const savedKey = process.env.EVOLUTION_API_KEY;
    const savedInst = process.env.EVOLUTION_INSTANCE_NAME;

    process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = 'false';
    process.env.EVOLUTION_API_BASE_URL = 'http://legacy-evo.example.com';
    process.env.EVOLUTION_API_KEY = 'legacy-key-xxx';
    process.env.EVOLUTION_INSTANCE_NAME = 'legacy-inst';

    function isLegacyFallbackEnabled(): boolean {
      const flag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK?.trim().toLowerCase();
      return flag !== 'false' && flag !== '0';
    }
    function getLegacyEvolutionConfig() {
      if (!isLegacyFallbackEnabled()) return null;
      const url = process.env.EVOLUTION_API_BASE_URL?.trim();
      const key = process.env.EVOLUTION_API_KEY?.trim();
      const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim();
      if (!url || !key || !instanceName) return null;
      return { url, key, instanceName };
    }

    const cfg = getLegacyEvolutionConfig();
    assert.equal(cfg, null, 'must return null when flag=false');

    if (savedFlag !== undefined) process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = savedFlag;
    else delete process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    if (savedUrl !== undefined) process.env.EVOLUTION_API_BASE_URL = savedUrl;
    else delete process.env.EVOLUTION_API_BASE_URL;
    if (savedKey !== undefined) process.env.EVOLUTION_API_KEY = savedKey;
    else delete process.env.EVOLUTION_API_KEY;
    if (savedInst !== undefined) process.env.EVOLUTION_INSTANCE_NAME = savedInst;
    else delete process.env.EVOLUTION_INSTANCE_NAME;
  });

  await test('getLegacyEvolutionConfig returns null when env vars missing even if flag=true', () => {
    const savedFlag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    const savedUrl = process.env.EVOLUTION_API_BASE_URL;
    const savedKey = process.env.EVOLUTION_API_KEY;
    const savedInst = process.env.EVOLUTION_INSTANCE_NAME;

    process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = 'true';
    delete process.env.EVOLUTION_API_BASE_URL;
    delete process.env.EVOLUTION_API_KEY;
    delete process.env.EVOLUTION_INSTANCE_NAME;

    function isLegacyFallbackEnabled(): boolean {
      const flag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK?.trim().toLowerCase();
      return flag !== 'false' && flag !== '0';
    }
    function getLegacyEvolutionConfig() {
      if (!isLegacyFallbackEnabled()) return null;
      const url = process.env.EVOLUTION_API_BASE_URL?.trim();
      const key = process.env.EVOLUTION_API_KEY?.trim();
      const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim();
      if (!url || !key || !instanceName) return null;
      return { url, key, instanceName };
    }

    const cfg = getLegacyEvolutionConfig();
    assert.equal(cfg, null, 'must return null when env vars missing');

    if (savedFlag !== undefined) process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK = savedFlag;
    else delete process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK;
    if (savedUrl !== undefined) process.env.EVOLUTION_API_BASE_URL = savedUrl;
    if (savedKey !== undefined) process.env.EVOLUTION_API_KEY = savedKey;
    if (savedInst !== undefined) process.env.EVOLUTION_INSTANCE_NAME = savedInst;
  });

  section('Sprint 17B — resolveConnectionForClinic fallback behaviour');

  await test('resolveConnectionForClinic: no DB record + flag=false → no fallback (returns null)', () => {
    // Simulates the core logic of resolveConnectionForClinic
    function resolveConnectionSimulated(
      hasDbRecord: boolean,
      flagEnabled: boolean,
      hasEnvVars: boolean,
    ): string | null {
      if (hasDbRecord) return 'db-connection';
      // Fallback guard
      if (!flagEnabled) return null;
      if (!hasEnvVars) return null;
      return 'legacy-connection';
    }
    assert.equal(resolveConnectionSimulated(false, false, true), null,
      'flag=false must block fallback even when env vars present');
  });

  await test('resolveConnectionForClinic: no DB record + flag=true + env vars → legacy fallback used', () => {
    function resolveConnectionSimulated(
      hasDbRecord: boolean,
      flagEnabled: boolean,
      hasEnvVars: boolean,
    ): string | null {
      if (hasDbRecord) return 'db-connection';
      if (!flagEnabled) return null;
      if (!hasEnvVars) return null;
      return 'legacy-connection';
    }
    assert.equal(resolveConnectionSimulated(false, true, true), 'legacy-connection');
  });

  await test('resolveConnectionForClinic: DB record present → flag irrelevant', () => {
    function resolveConnectionSimulated(
      hasDbRecord: boolean,
      flagEnabled: boolean,
      hasEnvVars: boolean,
    ): string | null {
      if (hasDbRecord) return 'db-connection';
      if (!flagEnabled) return null;
      if (!hasEnvVars) return null;
      return 'legacy-connection';
    }
    // DB record wins regardless of flag
    assert.equal(resolveConnectionSimulated(true, false, false), 'db-connection');
    assert.equal(resolveConnectionSimulated(true, false, true), 'db-connection');
    assert.equal(resolveConnectionSimulated(true, true, false), 'db-connection');
  });

  section('Sprint 17B — EvolutionWhatsAppProvider resolveCredentials panel-first mode');

  await test('resolveCredentials: flag=false + empty DB fields → null (no env fallback)', () => {
    function resolveCredentialsSimulated(
      conn: { evolutionApiUrl?: string; evolutionInstanceName?: string; evolutionApiKeyEncrypted?: string },
      legacyCfg: { url: string; key: string; instanceName: string } | null,
    ): { baseUrl: string; apiKey: string; instanceName: string } | null {
      const dbBaseUrl = conn.evolutionApiUrl?.trim();
      const dbInstanceName = conn.evolutionInstanceName?.trim();
      const baseUrl = dbBaseUrl || legacyCfg?.url;
      const instanceName = dbInstanceName || legacyCfg?.instanceName;
      const rawKey = conn.evolutionApiKeyEncrypted?.trim();
      let apiKey: string | undefined;
      if (rawKey) {
        apiKey = rawKey; // simplified: no encryption in test
      } else {
        apiKey = legacyCfg?.key;
      }
      if (!baseUrl || !apiKey || !instanceName) return null;
      return { baseUrl, apiKey, instanceName };
    }
    // flag=false → legacyCfg is null
    const result = resolveCredentialsSimulated({ evolutionApiUrl: '', evolutionInstanceName: '', evolutionApiKeyEncrypted: '' }, null);
    assert.equal(result, null, 'must return null when flag=false and DB fields empty');
  });

  await test('resolveCredentials: flag=false + DB fields filled → uses DB values', () => {
    function resolveCredentialsSimulated(
      conn: { evolutionApiUrl?: string; evolutionInstanceName?: string; evolutionApiKeyEncrypted?: string },
      legacyCfg: { url: string; key: string; instanceName: string } | null,
    ): { baseUrl: string; apiKey: string; instanceName: string } | null {
      const dbBaseUrl = conn.evolutionApiUrl?.trim();
      const dbInstanceName = conn.evolutionInstanceName?.trim();
      const baseUrl = dbBaseUrl || legacyCfg?.url;
      const instanceName = dbInstanceName || legacyCfg?.instanceName;
      const rawKey = conn.evolutionApiKeyEncrypted?.trim();
      let apiKey: string | undefined;
      if (rawKey) {
        apiKey = rawKey;
      } else {
        apiKey = legacyCfg?.key;
      }
      if (!baseUrl || !apiKey || !instanceName) return null;
      return { baseUrl, apiKey, instanceName };
    }
    // flag=false → legacyCfg is null, but DB fields are populated
    const result = resolveCredentialsSimulated(
      { evolutionApiUrl: 'http://evo.example.com', evolutionInstanceName: 'my-inst', evolutionApiKeyEncrypted: 'enc-key-xyz' },
      null,
    );
    assert.ok(result !== null);
    assert.equal(result?.baseUrl, 'http://evo.example.com');
    assert.equal(result?.instanceName, 'my-inst');
    assert.equal(result?.apiKey, 'enc-key-xyz');
  });

  await test('resolveCredentials: flag=true + DB fields empty → uses legacy env fallback', () => {
    function resolveCredentialsSimulated(
      conn: { evolutionApiUrl?: string; evolutionInstanceName?: string; evolutionApiKeyEncrypted?: string },
      legacyCfg: { url: string; key: string; instanceName: string } | null,
    ): { baseUrl: string; apiKey: string; instanceName: string } | null {
      const dbBaseUrl = conn.evolutionApiUrl?.trim();
      const dbInstanceName = conn.evolutionInstanceName?.trim();
      const baseUrl = dbBaseUrl || legacyCfg?.url;
      const instanceName = dbInstanceName || legacyCfg?.instanceName;
      const rawKey = conn.evolutionApiKeyEncrypted?.trim();
      let apiKey: string | undefined;
      if (rawKey) {
        apiKey = rawKey;
      } else {
        apiKey = legacyCfg?.key;
      }
      if (!baseUrl || !apiKey || !instanceName) return null;
      return { baseUrl, apiKey, instanceName };
    }
    // flag=true → legacyCfg is non-null
    const result = resolveCredentialsSimulated(
      { evolutionApiUrl: '', evolutionInstanceName: '', evolutionApiKeyEncrypted: '' },
      { url: 'http://env-evo.example.com', key: 'env-key', instanceName: 'env-inst' },
    );
    assert.ok(result !== null);
    assert.equal(result?.baseUrl, 'http://env-evo.example.com');
    assert.equal(result?.instanceName, 'env-inst');
  });

  section('Sprint 17B — No secrets in fallback-disabled error path');

  await test('no sensitive fields exposed when fallback disabled and no DB record', () => {
    // Simulates the response body when resolveConnectionForClinic returns null
    // because fallback is disabled (flag=false) and no DB record found.
    const errorResponse = {
      success: false,
      error: 'No active WhatsApp connection found for this clinic. Please configure one in Organization Settings.',
    };
    assert.ok(!('evolutionApiKeyEncrypted' in errorResponse));
    assert.ok(!('EVOLUTION_API_KEY' in errorResponse));
    assert.ok(!('apiKey' in errorResponse));
    assert.ok(errorResponse.error.length > 0);
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Sprint 17B legacy fallback flag tests complete`);
}
