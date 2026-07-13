/**
 * imagingBridgeUpdate.test.ts — Windows bridge secure auto-update, PR 6/7 (backend).
 *
 * Covers:
 *  1. getBridgeUpdateConfig() fail-closed mode/metadata validation, shared
 *     with bridgeOnboardingConfig.ts via releaseMetadataValidation.ts.
 *  2. Source regression checks — the update endpoint authenticates the
 *     paired bridge, never accepts a client-supplied release, and never
 *     queries clinic/patient data for the descriptor itself.
 *
 * Run with: tsx src/tests/imagingBridgeUpdate.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getBridgeUpdateConfig } from '../services/imaging/bridgeUpdateConfig.js';
import { isValidCertThumbprint, parseUpdateMode } from '../services/imaging/releaseMetadataValidation.js';

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

const VALID_SIGNED_PROD = {
  IMAGING_BRIDGE_UPDATE_MODE: 'notify',
  IMAGING_BRIDGE_UPDATE_VERSION: '0.4.7',
  IMAGING_BRIDGE_UPDATE_DOWNLOAD_URL: VALID_URL,
  IMAGING_BRIDGE_UPDATE_SHA256: VALID_SHA256,
  IMAGING_BRIDGE_UPDATE_SIGNED: 'true',
  IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT: VALID_THUMBPRINT,
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

  await test('valid signed production release is returned', () => {
    withEnv(VALID_SIGNED_PROD, () => {
      const config = getBridgeUpdateConfig();
      assert.equal(config.mode, 'notify');
      assert.deepEqual(config.release, {
        version: '0.4.7',
        downloadUrl: VALID_URL,
        sha256: VALID_SHA256,
        signed: true,
        publisherThumbprint: VALID_THUMBPRINT,
        minimumSourceVersion: null,
        notes: null,
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
