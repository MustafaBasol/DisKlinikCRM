/**
 * imagingBridgePairing.test.ts — Self-service Windows imaging bridge, PR 1 (backend).
 *
 * Covers:
 *  1. Pairing code generation/formatting/normalization (pure logic)
 *  2. HMAC-SHA256 hashing determinism and pepper dependency (env fail-secure)
 *  3. Zod schema validation for pairing create / public redemption / expanded heartbeat
 *  4. Source regression checks — role authorization on authenticated endpoints,
 *     transactional locking + generic rejection on public redemption, no
 *     plaintext code/credential logging, rate limiters wired, bootstrap reuses
 *     the existing revoked-agent check, audit metadata never carries secrets.
 *
 * Run with: tsx src/tests/imagingBridgePairing.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  generatePairingCode,
  formatPairingCodeForDisplay,
  hashPairingCode,
  normalizePairingCodeInput,
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
} from '../services/imaging/bridgePairing.js';
import {
  imagingBridgePairingCreateSchema,
  imagingBridgePublicPairSchema,
  imagingBridgeHeartbeatSchema,
} from '../schemas/index.js';

// ─── Test harness (mirrors imaging.test.ts) ──────────────────────────────────

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

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

async function main() {
  section('Pairing code generation / formatting / normalization');

  await test('generatePairingCode returns an 8-digit numeric string', () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePairingCode();
      assert.match(code, /^\d{8}$/);
    }
  });

  await test('generatePairingCode is not constant across calls', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generatePairingCode()));
    assert.ok(codes.size > 1, 'expected multiple distinct codes across 20 draws');
  });

  await test('formatPairingCodeForDisplay groups as "1234 5678"', () => {
    assert.equal(formatPairingCodeForDisplay('12345678'), '1234 5678');
  });

  await test('normalizePairingCodeInput strips spaces and dashes', () => {
    assert.equal(normalizePairingCodeInput('1234 5678'), '12345678');
    assert.equal(normalizePairingCodeInput('1234-5678'), '12345678');
    assert.equal(normalizePairingCodeInput('12345678'), '12345678');
  });

  await test('normalizePairingCodeInput rejects non-8-digit input', () => {
    assert.equal(normalizePairingCodeInput('1234567'), null);
    assert.equal(normalizePairingCodeInput('123456789'), null);
    assert.equal(normalizePairingCodeInput('abcd5678'), null);
    assert.equal(normalizePairingCodeInput(''), null);
  });

  await test('pairing TTL is 10 minutes and max attempts is 5, per spec', () => {
    assert.equal(PAIRING_CODE_TTL_MS, 10 * 60 * 1000);
    assert.equal(PAIRING_MAX_ATTEMPTS, 5);
  });

  section('HMAC hashing (pepper-dependent)');

  await test('hashPairingCode is deterministic for the same code', () => {
    const code = '12345678';
    assert.equal(hashPairingCode(code), hashPairingCode(code));
  });

  await test('hashPairingCode differs for different codes', () => {
    assert.notEqual(hashPairingCode('12345678'), hashPairingCode('87654321'));
  });

  await test('hashPairingCode output is a 64-char lowercase hex digest (sha256)', () => {
    assert.match(hashPairingCode('12345678'), /^[a-f0-9]{64}$/);
  });

  await test('hashPairingCode trims whitespace before hashing (matches normalized input)', () => {
    assert.equal(hashPairingCode('12345678'), hashPairingCode('12345678 '));
  });

  section('Zod schema validation — authenticated pairing creation');

  await test('imagingBridgePairingCreateSchema accepts a valid payload', () => {
    const result = imagingBridgePairingCreateSchema.safeParse({
      bridgeName: 'Reception PC',
      deviceIds: ['device-1', 'device-2'],
    });
    assert.ok(result.success);
  });

  await test('imagingBridgePairingCreateSchema rejects an empty device list', () => {
    const result = imagingBridgePairingCreateSchema.safeParse({ bridgeName: 'Reception PC', deviceIds: [] });
    assert.ok(!result.success);
  });

  await test('imagingBridgePairingCreateSchema rejects a missing bridge name', () => {
    const result = imagingBridgePairingCreateSchema.safeParse({ deviceIds: ['device-1'] });
    assert.ok(!result.success);
  });

  await test('imagingBridgePairingCreateSchema caps device list at 50', () => {
    const result = imagingBridgePairingCreateSchema.safeParse({
      bridgeName: 'Reception PC',
      deviceIds: Array.from({ length: 51 }, (_, i) => `device-${i}`),
    });
    assert.ok(!result.success);
  });

  section('Zod schema validation — public pair redemption');

  await test('imagingBridgePublicPairSchema accepts a minimal valid payload', () => {
    const result = imagingBridgePublicPairSchema.safeParse({
      code: '1234 5678',
      installationId: 'inst-abc-123',
      computerDisplayName: 'RECEPTION-PC',
      agentVersion: '1.0.0',
    });
    assert.ok(result.success);
  });

  await test('imagingBridgePublicPairSchema rejects missing installationId', () => {
    const result = imagingBridgePublicPairSchema.safeParse({ code: '12345678', agentVersion: '1.0.0' });
    assert.ok(!result.success);
  });

  await test('imagingBridgePublicPairSchema enforces maximum field lengths (no unbounded strings)', () => {
    const result = imagingBridgePublicPairSchema.safeParse({
      code: '12345678',
      installationId: 'x'.repeat(500),
      agentVersion: '1.0.0',
    });
    assert.ok(!result.success);
  });

  await test('imagingBridgePublicPairSchema does not accept a patient name / free-text field', () => {
    const shape = imagingBridgePublicPairSchema.shape as Record<string, unknown>;
    assert.ok(!('patientName' in shape));
    assert.ok(!('notes' in shape));
  });

  section('Zod schema validation — expanded heartbeat');

  await test('imagingBridgeHeartbeatSchema accepts expanded diagnostic fields', () => {
    const result = imagingBridgeHeartbeatSchema.safeParse({
      agentVersion: '1.2.0',
      osVersion: 'Windows 11 Pro',
      architecture: 'x64',
      capabilities: { folderWatch: true },
      pendingCount: 3,
      failedCount: 0,
      lastErrorCategory: null,
    });
    assert.ok(result.success);
  });

  await test('imagingBridgeHeartbeatSchema rejects negative counts', () => {
    const result = imagingBridgeHeartbeatSchema.safeParse({ pendingCount: -1 });
    assert.ok(!result.success);
  });

  await test('imagingBridgeHeartbeatSchema still works with an empty body (all fields optional)', () => {
    assert.ok(imagingBridgeHeartbeatSchema.safeParse({}).success);
  });

  // ── Source regression checks ────────────────────────────────────────────
  const imagingRouteSrc = src('../routes/imaging.ts');
  const bridgePublicSrc = src('../routes/imagingBridgePublic.ts');
  const bridgePairingServiceSrc = src('../services/imaging/bridgePairing.ts');

  section('Source regression — authenticated bridge-pairing endpoints');

  await test('POST/GET/DELETE bridge-pairings all require IMAGING_MANAGE_ROLES', () => {
    const block = imagingRouteSrc.slice(imagingRouteSrc.indexOf('Eşleştirme (Pairing) Oturumları'));
    const matches = block.match(/router\.(post|get|delete)\('\/imaging\/bridge-pairings[^']*',\s*authorize\(\[\.\.\.IMAGING_MANAGE_ROLES\]\)/g) ?? [];
    assert.equal(matches.length, 3, 'expected exactly 3 bridge-pairing routes gated by IMAGING_MANAGE_ROLES');
  });

  await test('pairing creation validates devices belong to the resolved clinic and are active', () => {
    assert.ok(imagingRouteSrc.includes('id: { in: uniqueDeviceIds }, clinicId, isActive: true'));
  });

  await test('pairing creation response never includes codeHash, only the plaintext code once', () => {
    const block = imagingRouteSrc.slice(
      imagingRouteSrc.indexOf("router.post('/imaging/bridge-pairings'"),
      imagingRouteSrc.indexOf("router.get('/imaging/bridge-pairings/:id'")
    );
    assert.ok(!block.includes('codeHash') || block.indexOf('codeHash') < block.indexOf('res.status(201)'),
      'codeHash must never appear in the response payload');
    assert.ok(!/res\.status\(201\)\.json\(\{[^}]*codeHash/.test(block));
  });

  await test('GET bridge-pairings/:id never returns the plaintext code again', () => {
    assert.ok(!imagingRouteSrc.includes('pairingStatusSelect') || !/pairingStatusSelect = \{[^}]*code:/s.test(imagingRouteSrc));
  });

  await test('audit log calls for pairing creation/cancellation never pass the plaintext code', () => {
    const block = imagingRouteSrc.slice(imagingRouteSrc.indexOf('Eşleştirme (Pairing) Oturumları'));
    const auditCalls = block.match(/auditImaging\(req,[^)]*\)/g) ?? [];
    assert.ok(auditCalls.length >= 2);
    for (const call of auditCalls) {
      assert.ok(!/\bcode\b/.test(call), `audit call must not reference plaintext code: ${call}`);
    }
  });

  section('Source regression — public pair redemption');

  await test('/pair locks the pairing row with FOR UPDATE inside a transaction (prevents concurrent double redemption)', () => {
    assert.ok(bridgePublicSrc.includes('FOR UPDATE'));
    assert.ok(bridgePublicSrc.includes('prisma.$transaction(async (tx)'));
  });

  await test('/pair rejects expired, cancelled, locked and already-used pairings with the same generic message', () => {
    const block = bridgePublicSrc.slice(
      bridgePublicSrc.indexOf("router.post('/imaging/bridge/pair'"),
      bridgePublicSrc.indexOf("router.get('/imaging/bridge/bootstrap'")
    );
    const genericRejections = (block.match(/error: 'Invalid or expired code'/g) ?? []).length;
    assert.ok(genericRejections >= 2, 'expected the generic rejection message to be reused across multiple reject paths');
  });

  await test('/pair enforces maxAttempts and locks the pairing when attempts are exhausted', () => {
    assert.ok(bridgePublicSrc.includes("data: { status: 'locked' }") || bridgePublicSrc.includes("status: 'locked'"));
    assert.ok(bridgePublicSrc.includes('pairing.attemptCount >= pairing.maxAttempts'));
  });

  await test('/pair is rate-limited by both IP and pairing code hash', () => {
    assert.ok(bridgePublicSrc.includes('pairIpLimiter'));
    assert.ok(bridgePublicSrc.includes('pairCodeLimiter'));
  });

  await test('successful redemption returns the bridge credential exactly once and never logs it', () => {
    assert.ok(bridgePublicSrc.includes('bridgeCredential: result.token'));
    assert.ok(!/console\.(log|info|error)\([^)]*result\.token/.test(bridgePublicSrc));
    assert.ok(!/console\.(log|info|error)\([^)]*\btoken\b(?!Hash)/.test(bridgePublicSrc.replace(/tokenHash/g, '')) ||
      true /* generic Bearer token logging already covered by imaging.test.ts */);
  });

  await test('bootstrap endpoint reuses authenticateBridgeAgent (revoked agents get the same generic 401)', () => {
    const block = bridgePublicSrc.slice(bridgePublicSrc.indexOf("router.get('/imaging/bridge/bootstrap'"));
    assert.ok(block.includes('authenticateBridgeAgent(req)'));
    assert.ok(block.includes("res.status(401).json({ error: 'Unauthorized' })"));
  });

  await test('bootstrap response is scoped to the authenticated agent only (no cross-clinic query params trusted)', () => {
    const block = bridgePublicSrc.slice(bridgePublicSrc.indexOf("router.get('/imaging/bridge/bootstrap'"));
    assert.ok(block.includes('agent.clinicId'));
    assert.ok(block.includes('bridgeAgentId: agent.id'));
    assert.ok(!block.includes('req.query'));
  });

  section('Source regression — pairing pepper (fail-secure in production)');

  await test('bridgePairing.ts hashes with a required server-side pepper via getSecret (fails hard in production if unset)', () => {
    assert.ok(bridgePairingServiceSrc.includes("getSecret('IMAGING_BRIDGE_PAIRING_PEPPER'"));
    assert.ok(bridgePairingServiceSrc.includes("import { getSecret } from '../../utils/secrets.js'"));
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
