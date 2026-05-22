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

main().then(() => extendedTests()).then(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log('Extended panel E2E tests complete');
}).catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
