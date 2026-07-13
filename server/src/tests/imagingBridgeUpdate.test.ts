/**
 * imagingBridgeUpdate.test.ts — Windows bridge secure auto-update, PR 6/7 + PR 7/7 (backend).
 *
 * Covers:
 *  1. getBridgeUpdateConfig() fail-closed mode/metadata validation, shared
 *     with bridgeOnboardingConfig.ts via releaseMetadataValidation.ts.
 *  2. Deterministic staged rollout (channel + percentage cohort assignment).
 *  3. Rollback package descriptor parsing (fail-closed on partial/malformed).
 *  4. Source regression checks — the update endpoint authenticates the
 *     paired bridge, never accepts a client-supplied release, and never
 *     queries clinic/patient data for the descriptor itself.
 *
 * Run with: tsx src/tests/imagingBridgeUpdate.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { computeRolloutBucket, getBridgeUpdateConfig } from '../services/imaging/bridgeUpdateConfig.js';
import { isValidCertThumbprint, isValidReleaseId, isValidRolloutPercent, parseUpdateChannel, parseUpdateMode } from '../services/imaging/releaseMetadataValidation.js';

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

const ENV_KEYS = [
  'IMAGING_BRIDGE_UPDATE_MODE',
  'IMAGING_BRIDGE_UPDATE_VERSION',
  'IMAGING_BRIDGE_UPDATE_DOWNLOAD_URL',
  'IMAGING_BRIDGE_UPDATE_SHA256',
  'IMAGING_BRIDGE_UPDATE_SIGNED',
  'IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT',
  'IMAGING_BRIDGE_UPDATE_MIN_SOURCE_VERSION',
  'IMAGING_BRIDGE_UPDATE_NOTES',
  'IMAGING_BRIDGE_UPDATE_RELEASE_ID',
  'IMAGING_BRIDGE_UPDATE_ROLLOUT_PERCENT',
  'IMAGING_BRIDGE_UPDATE_CHANNEL',
  'IMAGING_BRIDGE_UPDATE_FORCED',
  'IMAGING_BRIDGE_ROLLBACK_VERSION',
  'IMAGING_BRIDGE_ROLLBACK_DOWNLOAD_URL',
  'IMAGING_BRIDGE_ROLLBACK_SHA256',
  'IMAGING_BRIDGE_ROLLBACK_PUBLISHER_THUMBPRINT',
  'NODE_ENV',
] as const;

function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => void) {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const VALID_SHA256 = 'b'.repeat(64);
const VALID_THUMBPRINT = 'c'.repeat(40);
const VALID_URL = 'https://cdn.example.com/NoraMediBridgeSetup.exe';
const VALID_RELEASE_ID = 'rel-0.4.8-2026-07-13';

const VALID_SIGNED_PROD = {
  IMAGING_BRIDGE_UPDATE_MODE: 'notify',
  IMAGING_BRIDGE_UPDATE_VERSION: '0.4.7',
  IMAGING_BRIDGE_UPDATE_DOWNLOAD_URL: VALID_URL,
  IMAGING_BRIDGE_UPDATE_SHA256: VALID_SHA256,
  IMAGING_BRIDGE_UPDATE_SIGNED: 'true',
  IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT: VALID_THUMBPRINT,
  IMAGING_BRIDGE_UPDATE_RELEASE_ID: VALID_RELEASE_ID,
  NODE_ENV: 'production',
} as const;

async function main() {
  section('parseUpdateMode — fail closed');

  await test('unset -> disabled', () => {
    assert.equal(parseUpdateMode(undefined), 'disabled');
  });

  await test('unrecognized value -> disabled', () => {
    assert.equal(parseUpdateMode('yes'), 'disabled');
    assert.equal(parseUpdateMode('AUTOMATIC-ish'), 'disabled');
  });

  await test('recognizes disabled/notify/automatic case-insensitively', () => {
    assert.equal(parseUpdateMode('notify'), 'notify');
    assert.equal(parseUpdateMode('AUTOMATIC'), 'automatic');
    assert.equal(parseUpdateMode('Disabled'), 'disabled');
  });

  section('isValidCertThumbprint');

  await test('accepts 40 hex chars, rejects other lengths/content', () => {
    assert.equal(isValidCertThumbprint('a'.repeat(40)), true);
    assert.equal(isValidCertThumbprint('a'.repeat(39)), false);
    assert.equal(isValidCertThumbprint('z'.repeat(40)), false);
  });

  section('parseUpdateChannel / isValidReleaseId / isValidRolloutPercent');

  await test('parseUpdateChannel accepts stable/pilot, rejects and does not default anything else', () => {
    assert.equal(parseUpdateChannel('stable'), 'stable');
    assert.equal(parseUpdateChannel('PILOT'), 'pilot');
    assert.equal(parseUpdateChannel('beta'), null);
    assert.equal(parseUpdateChannel(undefined), null);
  });

  await test('isValidReleaseId rejects empty/oversized/unsafe charset', () => {
    assert.equal(isValidReleaseId('rel-1.2.3'), true);
    assert.equal(isValidReleaseId(''), false);
    assert.equal(isValidReleaseId('a'.repeat(129)), false);
    assert.equal(isValidReleaseId('rel with spaces'), false);
    assert.equal(isValidReleaseId('rel;rm -rf'), false);
  });

  await test('isValidRolloutPercent accepts 0-100 integers only', () => {
    assert.equal(isValidRolloutPercent('0'), true);
    assert.equal(isValidRolloutPercent('100'), true);
    assert.equal(isValidRolloutPercent('50'), true);
    assert.equal(isValidRolloutPercent('101'), false);
    assert.equal(isValidRolloutPercent('-1'), false);
    assert.equal(isValidRolloutPercent('50.5'), false);
    assert.equal(isValidRolloutPercent('abc'), false);
  });

  section('getBridgeUpdateConfig — fail-closed defaults');

  await test('disabled when IMAGING_BRIDGE_UPDATE_MODE is unset', () => {
    withEnv({ IMAGING_BRIDGE_UPDATE_MODE: undefined }, () => {
      assert.deepEqual(getBridgeUpdateConfig(), { mode: 'disabled', release: null });
    });
  });

  await test('notify mode with no release metadata yields release: null', () => {
    withEnv({ IMAGING_BRIDGE_UPDATE_MODE: 'notify' }, () => {
      const config = getBridgeUpdateConfig();
      assert.equal(config.mode, 'notify');
      assert.equal(config.release, null);
    });
  });

  section('getBridgeUpdateConfig — metadata validation');

  await test('valid signed production release is returned (raw descriptor, no eligibility filter)', () => {
    withEnv(VALID_SIGNED_PROD, () => {
      const config = getBridgeUpdateConfig();
      assert.equal(config.mode, 'notify');
      assert.deepEqual(config.release, {
        releaseId: VALID_RELEASE_ID,
        version: '0.4.7',
        downloadUrl: VALID_URL,
        sha256: VALID_SHA256,
        signed: true,
        publisherThumbprint: VALID_THUMBPRINT,
        minimumSourceVersion: null,
        notes: null,
        channel: 'stable',
        rolloutPercent: 100,
        forced: false,
        rollback: null,
      });
    });
  });

  await test('rejects malformed version', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_VERSION: 'latest' }, () => {
      assert.equal(getBridgeUpdateConfig().release, null);
    });
  });

  await test('rejects malformed sha256', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_SHA256: 'not-a-hash' }, () => {
      assert.equal(getBridgeUpdateConfig().release, null);
    });
  });

  await test('rejects missing/malformed release ID', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_RELEASE_ID: undefined }, () => {
      assert.equal(getBridgeUpdateConfig().release, null);
    });
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_RELEASE_ID: 'has spaces' }, () => {
      assert.equal(getBridgeUpdateConfig().release, null);
    });
  });

  await test('rejects malformed channel', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_CHANNEL: 'beta' }, () => {
      assert.equal(getBridgeUpdateConfig().release, null);
    });
  });

  await test('rejects out-of-range rollout percent', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_ROLLOUT_PERCENT: '150' }, () => {
      assert.equal(getBridgeUpdateConfig().release, null);
    });
  });

  await test('rejects non-HTTPS URL in production', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_DOWNLOAD_URL: 'http://cdn.example.com/setup.exe' }, () => {
      assert.equal(getBridgeUpdateConfig().release, null);
    });
  });

  await test('allows localhost http outside production only', () => {
    withEnv({
      ...VALID_SIGNED_PROD,
      IMAGING_BRIDGE_UPDATE_DOWNLOAD_URL: 'http://localhost:5000/setup.exe',
      IMAGING_BRIDGE_UPDATE_SIGNED: 'false',
      IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT: undefined,
      NODE_ENV: 'development',
    }, () => {
      assert.notEqual(getBridgeUpdateConfig().release, null);
    });
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_DOWNLOAD_URL: 'http://localhost:5000/setup.exe' }, () => {
      // still production here — localhost http is not accepted in production regardless of host.
      assert.equal(getBridgeUpdateConfig().release, null);
    });
  });

  await test('unsigned release is never offered in production (fail closed)', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_SIGNED: 'false', IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT: undefined }, () => {
      assert.equal(getBridgeUpdateConfig().release, null);
    });
  });

  await test('unsigned release is allowed outside production (local test signing)', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_SIGNED: 'false', IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT: undefined, NODE_ENV: 'test' }, () => {
      const config = getBridgeUpdateConfig();
      assert.notEqual(config.release, null);
      assert.equal(config.release?.signed, false);
      assert.equal(config.release?.publisherThumbprint, null);
    });
  });

  await test('signed:true with a malformed thumbprint is rejected', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT: 'not-a-thumbprint' }, () => {
      assert.equal(getBridgeUpdateConfig().release, null);
    });
  });

  await test('signed:true with no thumbprint at all is rejected', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT: undefined }, () => {
      assert.equal(getBridgeUpdateConfig().release, null);
    });
  });

  await test('rejects a malformed minimum source version when provided', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_MIN_SOURCE_VERSION: 'not-a-version' }, () => {
      assert.equal(getBridgeUpdateConfig().release, null);
    });
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_MIN_SOURCE_VERSION: '0.4.0' }, () => {
      assert.equal(getBridgeUpdateConfig().release?.minimumSourceVersion, '0.4.0');
    });
  });

  await test('automatic mode is independent of metadata validity', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_MODE: 'automatic' }, () => {
      assert.equal(getBridgeUpdateConfig().mode, 'automatic');
    });
  });

  section('computeRolloutBucket — deterministic cohort assignment');

  await test('same (bridge, release) pair always yields the same bucket', () => {
    const b1 = computeRolloutBucket('bridge-abc', 'rel-1');
    const b2 = computeRolloutBucket('bridge-abc', 'rel-1');
    assert.equal(b1, b2);
    assert.ok(b1 >= 0 && b1 < 100);
  });

  await test('different release IDs reshuffle the cohort (not guaranteed identical)', () => {
    // Not a strict mathematical guarantee for any single pair, but across many
    // bridges the buckets for two different release IDs must differ for at
    // least some of them, proving the release ID is actually mixed into the hash.
    let anyDifferent = false;
    for (let i = 0; i < 25; i++) {
      const id = `bridge-${i}`;
      if (computeRolloutBucket(id, 'rel-A') !== computeRolloutBucket(id, 'rel-B')) {
        anyDifferent = true;
        break;
      }
    }
    assert.ok(anyDifferent);
  });

  await test('bucket distribution is roughly uniform across many bridge IDs (sanity, not a statistical proof)', () => {
    let under50 = 0;
    const total = 2000;
    for (let i = 0; i < total; i++) {
      if (computeRolloutBucket(`bridge-${i}`, 'rel-uniform') < 50) under50++;
    }
    const ratio = under50 / total;
    assert.ok(ratio > 0.4 && ratio < 0.6, `ratio was ${ratio}`);
  });

  section('getBridgeUpdateConfig — rollout eligibility');

  await test('rolloutPercent=100 offers to every bridge', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_ROLLOUT_PERCENT: '100' }, () => {
      for (let i = 0; i < 10; i++) {
        const config = getBridgeUpdateConfig({ bridgeAgentId: `bridge-${i}`, updateChannel: 'stable' });
        assert.notEqual(config.release, null);
      }
    });
  });

  await test('rolloutPercent=0 offers to no bridge (kill switch without disabling mode)', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_ROLLOUT_PERCENT: '0' }, () => {
      for (let i = 0; i < 10; i++) {
        const config = getBridgeUpdateConfig({ bridgeAgentId: `bridge-${i}`, updateChannel: 'stable' });
        assert.equal(config.release, null);
      }
      // mode itself is untouched — this is a rollout pause, not a disable.
      assert.equal(getBridgeUpdateConfig().mode, 'notify');
    });
  });

  await test('rolloutPercent=1 offers to roughly 1% of a large bridge population', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_ROLLOUT_PERCENT: '1' }, () => {
      let eligible = 0;
      const total = 3000;
      for (let i = 0; i < total; i++) {
        if (getBridgeUpdateConfig({ bridgeAgentId: `bridge-${i}`, updateChannel: 'stable' }).release !== null) eligible++;
      }
      const ratio = eligible / total;
      assert.ok(ratio > 0.001 && ratio < 0.03, `ratio was ${ratio}`);
    });
  });

  await test('rolloutPercent=50 offers to roughly half, and the same bridge is stable across repeated calls', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_ROLLOUT_PERCENT: '50' }, () => {
      let eligible = 0;
      const total = 2000;
      for (let i = 0; i < total; i++) {
        if (getBridgeUpdateConfig({ bridgeAgentId: `bridge-${i}`, updateChannel: 'stable' }).release !== null) eligible++;
      }
      const ratio = eligible / total;
      assert.ok(ratio > 0.4 && ratio < 0.6, `ratio was ${ratio}`);

      const first = getBridgeUpdateConfig({ bridgeAgentId: 'bridge-repeat', updateChannel: 'stable' }).release !== null;
      for (let i = 0; i < 5; i++) {
        const again = getBridgeUpdateConfig({ bridgeAgentId: 'bridge-repeat', updateChannel: 'stable' }).release !== null;
        assert.equal(again, first);
      }
    });
  });

  await test('pilot-channel release is never offered to a stable bridge and vice versa', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_CHANNEL: 'pilot' }, () => {
      assert.equal(getBridgeUpdateConfig({ bridgeAgentId: 'bridge-1', updateChannel: 'stable' }).release, null);
      assert.notEqual(getBridgeUpdateConfig({ bridgeAgentId: 'bridge-1', updateChannel: 'pilot' }).release, null);
    });
    withEnv(VALID_SIGNED_PROD, () => {
      // default channel is stable
      assert.notEqual(getBridgeUpdateConfig({ bridgeAgentId: 'bridge-1', updateChannel: 'stable' }).release, null);
      assert.equal(getBridgeUpdateConfig({ bridgeAgentId: 'bridge-1', updateChannel: 'pilot' }).release, null);
    });
  });

  await test('forced release bypasses rollout percentage but not channel', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_ROLLOUT_PERCENT: '0', IMAGING_BRIDGE_UPDATE_FORCED: 'true' }, () => {
      assert.notEqual(getBridgeUpdateConfig({ bridgeAgentId: 'bridge-1', updateChannel: 'stable' }).release, null);
      assert.equal(getBridgeUpdateConfig({ bridgeAgentId: 'bridge-1', updateChannel: 'pilot' }).release, null);
    });
  });

  await test('two different clinics/bridges never see each other\'s eligibility leak into a shared cache (pure function of inputs only)', () => {
    withEnv({ ...VALID_SIGNED_PROD, IMAGING_BRIDGE_UPDATE_ROLLOUT_PERCENT: '50' }, () => {
      const a1 = getBridgeUpdateConfig({ bridgeAgentId: 'clinic-a-bridge', updateChannel: 'stable' }).release !== null;
      const b1 = getBridgeUpdateConfig({ bridgeAgentId: 'clinic-b-bridge', updateChannel: 'stable' }).release !== null;
      // Calling for one bridge must not perturb the other's independently-recomputed result.
      const a2 = getBridgeUpdateConfig({ bridgeAgentId: 'clinic-a-bridge', updateChannel: 'stable' }).release !== null;
      const b2 = getBridgeUpdateConfig({ bridgeAgentId: 'clinic-b-bridge', updateChannel: 'stable' }).release !== null;
      assert.equal(a1, a2);
      assert.equal(b1, b2);
    });
  });

  section('getBridgeUpdateConfig — rollback package');

  const VALID_ROLLBACK = {
    IMAGING_BRIDGE_ROLLBACK_VERSION: '0.4.6',
    IMAGING_BRIDGE_ROLLBACK_DOWNLOAD_URL: 'https://cdn.example.com/NoraMediBridgeSetup-0.4.6.exe',
    IMAGING_BRIDGE_ROLLBACK_SHA256: 'd'.repeat(64),
    IMAGING_BRIDGE_ROLLBACK_PUBLISHER_THUMBPRINT: 'e'.repeat(40),
  } as const;

  await test('no rollback env vars set -> rollback: null', () => {
    withEnv(VALID_SIGNED_PROD, () => {
      assert.equal(getBridgeUpdateConfig().release?.rollback, null);
    });
  });

  await test('fully valid rollback package is returned', () => {
    withEnv({ ...VALID_SIGNED_PROD, ...VALID_ROLLBACK }, () => {
      assert.deepEqual(getBridgeUpdateConfig().release?.rollback, {
        version: '0.4.6',
        downloadUrl: VALID_ROLLBACK.IMAGING_BRIDGE_ROLLBACK_DOWNLOAD_URL,
        sha256: VALID_ROLLBACK.IMAGING_BRIDGE_ROLLBACK_SHA256,
        publisherThumbprint: VALID_ROLLBACK.IMAGING_BRIDGE_ROLLBACK_PUBLISHER_THUMBPRINT,
      });
    });
  });

  await test('partially-declared rollback (missing thumbprint) fails closed to null, not a partial object', () => {
    withEnv({ ...VALID_SIGNED_PROD, ...VALID_ROLLBACK, IMAGING_BRIDGE_ROLLBACK_PUBLISHER_THUMBPRINT: undefined }, () => {
      assert.equal(getBridgeUpdateConfig().release?.rollback, null);
    });
  });

  await test('malformed rollback sha256 fails closed to null', () => {
    withEnv({ ...VALID_SIGNED_PROD, ...VALID_ROLLBACK, IMAGING_BRIDGE_ROLLBACK_SHA256: 'not-a-hash' }, () => {
      assert.equal(getBridgeUpdateConfig().release?.rollback, null);
    });
  });

  await test('malformed rollback version fails closed to null', () => {
    withEnv({ ...VALID_SIGNED_PROD, ...VALID_ROLLBACK, IMAGING_BRIDGE_ROLLBACK_VERSION: 'not-a-version' }, () => {
      assert.equal(getBridgeUpdateConfig().release?.rollback, null);
    });
  });

  // ── Source regression checks ────────────────────────────────────────────
  const routeSrc = src('../routes/imagingBridgePublic.ts');
  const updateConfigSrc = src('../services/imaging/bridgeUpdateConfig.ts');
  const onboardingConfigSrc = src('../services/imaging/bridgeOnboardingConfig.ts');

  section('Source regression — update endpoint');

  await test('GET /imaging/bridge/update requires a valid authenticated bridge agent', () => {
    const block = routeSrc.slice(routeSrc.indexOf("router.get('/imaging/bridge/update'"));
    assert.match(block, /authenticateBridgeAgent\(req\)/);
    assert.match(block, /status\(401\)/);
  });

  await test('update endpoint passes the authenticated agent identity/channel into eligibility, not client input', () => {
    const block = routeSrc.slice(
      routeSrc.indexOf("router.get('/imaging/bridge/update'"),
      routeSrc.indexOf('export default router;'),
    );
    assert.match(block, /getBridgeUpdateConfig\(\{\s*bridgeAgentId:\s*agent\.id,\s*updateChannel:\s*agent\.updateChannel\s*\}\)/);
  });

  await test('update endpoint never queries the database for the descriptor itself (only auth does)', () => {
    const block = routeSrc.slice(
      routeSrc.indexOf("router.get('/imaging/bridge/update'"),
      routeSrc.indexOf('export default router;'),
    );
    // authenticateBridgeAgent (defined earlier in the file) does its own
    // prisma lookup; the handler body itself must not add a second one.
    const handlerBody = block.slice(block.indexOf('try {'));
    assert.ok(!handlerBody.includes('prisma.'));
  });

  await test('update endpoint never reads a client-supplied release field from the request', () => {
    const block = routeSrc.slice(
      routeSrc.indexOf("router.get('/imaging/bridge/update'"),
      routeSrc.indexOf('export default router;'),
    );
    assert.ok(!block.includes('req.body'));
    assert.ok(!block.includes('req.query'));
  });

  section('Source regression — one canonical validator (no divergent parsers)');

  await test('bridgeUpdateConfig imports shared validators, does not redefine them', () => {
    assert.ok(updateConfigSrc.includes("from './releaseMetadataValidation.js'"));
    assert.ok(!/function isValidSha256/.test(updateConfigSrc));
    assert.ok(!/function isAcceptableDownloadUrl/.test(updateConfigSrc));
  });

  await test('bridgeOnboardingConfig imports the same shared validators', () => {
    assert.ok(onboardingConfigSrc.includes("from './releaseMetadataValidation.js'"));
    assert.ok(!/function isValidSha256/.test(onboardingConfigSrc));
    assert.ok(!/function isAcceptableDownloadUrl/.test(onboardingConfigSrc));
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
