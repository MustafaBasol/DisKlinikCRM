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

  const metaConn = { ...emptyConn, provider: 'meta_cloud_api' };
  const metaProvider = new MetaCloudWhatsAppProvider();

  await test('sendMessage → { success: false, not implemented }', async () => {
    const result = await metaProvider.sendMessage(metaConn, { phone: '905551234567', text: 'test' });
    assert.equal(result.success, false);
    assert.ok(result.error?.toLowerCase().includes('not'));
  });

  await test('testConnection → { success: false }', async () => {
    const result = await metaProvider.testConnection(metaConn);
    assert.equal(result.success, false);
  });

  await test('parseWebhook: Meta format → eventType "unknown"', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-1', changes: [] }],
    };
    const result = metaProvider.parseWebhook(payload, metaConn);
    assert.equal(result.eventType, 'unknown');
  });

  await test('parseWebhook: non-Meta payload → eventType "unknown"', () => {
    const result = metaProvider.parseWebhook({ random: true }, metaConn);
    assert.equal(result.eventType, 'unknown');
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

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
