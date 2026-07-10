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

  await test('imagingBridgePublicPairSchema accepts a payload shaped exactly like the real Windows Bridge Service (capabilities/machineIdHash omitted)', () => {
    // Mirrors BridgeOrchestrator.ProvisionWithPairingCodeAsync's real
    // PairRequest after BridgeApiClient serializes it with
    // PairRequestJsonOptions (null optional fields omitted, not sent as
    // JSON null) — regression guard for the pairing-failure bug where
    // "capabilities":null caused every real pairing attempt to be rejected
    // with 400 before the code was ever looked up.
    const result = imagingBridgePublicPairSchema.safeParse({
      code: '12345678',
      installationId: 'a1b2c3d4-e5f6-4789-90ab-cdef01234567',
      agentVersion: '0.4.4',
      computerDisplayName: 'RECEPTION-PC',
      osVersion: 'Microsoft Windows NT 10.0.19045.0',
      architecture: 'X64',
    });
    assert.ok(result.success, result.success ? undefined : JSON.stringify(result.error.format()));
  });

  await test('imagingBridgePublicPairSchema rejects an explicit capabilities:null (must be omitted, not nulled)', () => {
    // capabilities is `.optional()` but deliberately NOT `.nullable()` (see
    // schemas/index.ts) — this is the exact payload shape that broke real
    // pairing before the Service-side JSON serialization fix. This test
    // guards against the schema being loosened back to accepting null,
    // which would only mask a future regression of the same client bug.
    const result = imagingBridgePublicPairSchema.safeParse({
      code: '12345678',
      installationId: 'inst-abc-123',
      agentVersion: '1.0.0',
      capabilities: null,
    });
    assert.ok(!result.success);
  });

  await test('imagingBridgePublicPairSchema accepts capabilities when present as an object', () => {
    const result = imagingBridgePublicPairSchema.safeParse({
      code: '12345678',
      installationId: 'inst-abc-123',
      agentVersion: '1.0.0',
      capabilities: { folderWatch: true },
    });
    assert.ok(result.success);
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

  await test('imagingBridgeHeartbeatSchema accepts a valid ISO 8601 datetime for lastSuccessfulUploadAt', () => {
    const result = imagingBridgeHeartbeatSchema.safeParse({ lastSuccessfulUploadAt: '2026-07-08T12:34:56.000Z' });
    assert.ok(result.success);
  });

  await test('imagingBridgeHeartbeatSchema accepts null for lastSuccessfulUploadAt (explicit clear)', () => {
    const result = imagingBridgeHeartbeatSchema.safeParse({ lastSuccessfulUploadAt: null });
    assert.ok(result.success);
    assert.equal(result.success && result.data.lastSuccessfulUploadAt, null);
  });

  await test('imagingBridgeHeartbeatSchema treats an omitted lastSuccessfulUploadAt as undefined', () => {
    const result = imagingBridgeHeartbeatSchema.safeParse({});
    assert.ok(result.success);
    assert.equal(result.success && result.data.lastSuccessfulUploadAt, undefined);
  });

  await test('imagingBridgeHeartbeatSchema rejects an arbitrary non-date string for lastSuccessfulUploadAt', () => {
    const result = imagingBridgeHeartbeatSchema.safeParse({ lastSuccessfulUploadAt: 'not-a-date' });
    assert.ok(!result.success);
  });

  await test('imagingBridgeHeartbeatSchema rejects a date-only string without time (must be full ISO datetime)', () => {
    const result = imagingBridgeHeartbeatSchema.safeParse({ lastSuccessfulUploadAt: '2026-07-08' });
    assert.ok(!result.success);
  });

  await test('imagingBridgeHeartbeatSchema rejects an excessively long lastSuccessfulUploadAt value', () => {
    const result = imagingBridgeHeartbeatSchema.safeParse({ lastSuccessfulUploadAt: `2026-07-08T12:00:00.000Z${'x'.repeat(100)}` });
    assert.ok(!result.success);
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

  await test('pairing creation consumes the rate limiter before clinic-scope resolution and device lookup (no unlimited DB work on invalid input)', () => {
    const block = imagingRouteSrc.slice(
      imagingRouteSrc.indexOf("router.post('/imaging/bridge-pairings'"),
      imagingRouteSrc.indexOf("router.get('/imaging/bridge-pairings/:id'")
    );
    const recordIdx = block.indexOf('pairingCreateLimiter.record(rateKey)');
    const clinicScopeIdx = block.indexOf('resolveEffectiveClinicId(');
    const deviceLookupIdx = block.indexOf('prisma.imagingDevice.findMany(');
    assert.ok(recordIdx >= 0, 'expected pairingCreateLimiter.record to be called');
    assert.ok(clinicScopeIdx >= 0 && deviceLookupIdx >= 0);
    assert.ok(recordIdx < clinicScopeIdx,
      'the rate limiter must be consumed before resolving clinic scope, so unauthorized clinic attempts cannot bypass it');
    assert.ok(recordIdx < deviceLookupIdx,
      'the rate limiter must be consumed before the device lookup, so invalid deviceIds still consume the limit');
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

    const pairBlock = bridgePublicSrc.slice(
      bridgePublicSrc.indexOf("router.post('/imaging/bridge/pair'"),
      bridgePublicSrc.indexOf("router.get('/imaging/bridge/bootstrap'")
    );

    // No console.* call in the /pair handler may reference the raw bridge
    // token or the raw/normalized pairing code (codeHash/tokenHash are fine).
    const consoleCalls = pairBlock.match(/console\.(log|info|warn|error)\([\s\S]*?\);/g) ?? [];
    for (const call of consoleCalls) {
      assert.ok(!/\btoken\b(?!Hash)/.test(call.replace(/tokenHash/g, '')),
        `console call must not reference the plaintext bridge token: ${call}`);
      assert.ok(!/\bnormalizedCode\b|\bv\.code\b|\breq\.body\b/.test(call),
        `console call must not reference the plaintext pairing code: ${call}`);
    }

    // Audit logging must carry only IDs/counts — never the token or the code.
    const auditCalls = pairBlock.match(/writeAuditLog\(\{[\s\S]*?\}\);/g) ?? [];
    assert.ok(auditCalls.length >= 1, 'expected at least one audit log call in the /pair handler');
    for (const call of auditCalls) {
      assert.ok(!/\btoken\b(?!Hash)/.test(call.replace(/tokenHash/g, '')),
        `audit call must not include the plaintext bridge token: ${call}`);
      assert.ok(!/\bnormalizedCode\b|\bcodeHash\b|\bv\.code\b/.test(call),
        `audit call must not include the pairing code or its hash: ${call}`);
    }
  });

  await test('/pair response bindings include acquisitionType (required by the Windows Bridge BootstrapBinding contract)', () => {
    // Regression guard: the pair route's binding `select` previously omitted
    // acquisitionType while bootstrap's did not, so a freshly-paired Service
    // deserialized a BootstrapBinding missing a field the C# contract
    // expects on every binding returned by either endpoint.
    const pairBlock = bridgePublicSrc.slice(
      bridgePublicSrc.indexOf("router.post('/imaging/bridge/pair'"),
      bridgePublicSrc.indexOf("router.get('/imaging/bridge/bootstrap'")
    );
    const selectMatch = pairBlock.match(/tx\.imagingBridgeBinding\.create\(\{[\s\S]*?select:\s*\{([^}]*)\}/);
    assert.ok(selectMatch, 'expected to find the imagingBridgeBinding.create select clause in the /pair handler');
    assert.ok(selectMatch![1].includes('acquisitionType: true'),
      'the /pair response binding select must include acquisitionType, matching bootstrap\'s select');
  });

  await test('/pair and /bootstrap binding selects expose the same field set', () => {
    const pairBlock = bridgePublicSrc.slice(
      bridgePublicSrc.indexOf("router.post('/imaging/bridge/pair'"),
      bridgePublicSrc.indexOf("router.get('/imaging/bridge/bootstrap'")
    );
    const bootstrapBlock = bridgePublicSrc.slice(bridgePublicSrc.indexOf("router.get('/imaging/bridge/bootstrap'"));

    const pairSelect = pairBlock.match(/tx\.imagingBridgeBinding\.create\(\{[\s\S]*?select:\s*\{([^}]*)\}/)?.[1];
    const bootstrapSelect = bootstrapBlock.match(/imagingBridgeBinding\.findMany\(\{[\s\S]*?select:\s*\{([^}]*)\}/)?.[1];
    assert.ok(pairSelect && bootstrapSelect);

    const fieldsOf = (clause: string) =>
      new Set((clause.match(/(\w+):\s*true/g) ?? []).map(m => m.replace(/:\s*true/, '')));
    assert.deepEqual(fieldsOf(pairSelect!), fieldsOf(bootstrapSelect!));
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

  section('Source regression — heartbeat lastSuccessfulUploadAt tri-state persistence');

  const heartbeatBlock = bridgePublicSrc.slice(
    bridgePublicSrc.indexOf("router.post('/imaging/bridge/heartbeat'"),
    bridgePublicSrc.indexOf("router.post('/imaging/bridge/studies'")
  );

  await test('heartbeat distinguishes omitted (no update) from explicit null (clear) for lastSuccessfulUploadAt', () => {
    assert.ok(heartbeatBlock.includes('hb.lastSuccessfulUploadAt === undefined'),
      'expected an explicit undefined check so omission does not update the field');
    assert.ok(heartbeatBlock.includes('hb.lastSuccessfulUploadAt === null ? null'),
      'expected explicit null to be persisted as null (clear), not skipped');
  });

  await test('heartbeat never passes the raw unvalidated string straight to `new Date(...)`', () => {
    assert.ok(!/new Date\(hb\.lastSuccessfulUploadAt\)/.test(heartbeatBlock) ||
      /hb\.lastSuccessfulUploadAt === null \? null : new Date\(hb\.lastSuccessfulUploadAt\)/.test(heartbeatBlock),
      'new Date(...) must only run after the null/undefined branches are handled, on an already-schema-validated ISO string');
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
