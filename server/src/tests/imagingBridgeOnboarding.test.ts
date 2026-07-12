/**
 * imagingBridgeOnboarding.test.ts — Windows bridge web onboarding, PR 5/7 (backend).
 *
 * Covers:
 *  1. getBridgeOnboardingConfig() fail-closed defaults and installer metadata validation.
 *  2. Source regression checks — the config endpoint is gated by IMAGING_MANAGE_ROLES,
 *     never leaks secrets/patient data, and never claims an unsigned installer is signed.
 *
 * Run with: tsx src/tests/imagingBridgeOnboarding.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getBridgeOnboardingConfig } from '../services/imaging/bridgeOnboardingConfig.js';

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
  'IMAGING_BRIDGE_ONBOARDING_ENABLED',
  'IMAGING_BRIDGE_INSTALLER_DOWNLOAD_URL',
  'IMAGING_BRIDGE_INSTALLER_VERSION',
  'IMAGING_BRIDGE_INSTALLER_SHA256',
  'IMAGING_BRIDGE_INSTALLER_SIGNED',
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

const VALID_SHA256 = 'a'.repeat(64);

async function main() {
  section('getBridgeOnboardingConfig — fail-closed defaults');

  await test('disabled when IMAGING_BRIDGE_ONBOARDING_ENABLED is unset', () => {
    withEnv({ IMAGING_BRIDGE_ONBOARDING_ENABLED: undefined }, () => {
      const config = getBridgeOnboardingConfig();
      assert.deepEqual(config, { enabled: false, installerAvailable: false, installer: null });
    });
  });

  await test('disabled for any value other than the literal string "true"', () => {
    withEnv({ IMAGING_BRIDGE_ONBOARDING_ENABLED: 'TRUE' }, () => {
      assert.equal(getBridgeOnboardingConfig().enabled, false);
    });
    withEnv({ IMAGING_BRIDGE_ONBOARDING_ENABLED: '1' }, () => {
      assert.equal(getBridgeOnboardingConfig().enabled, false);
    });
  });

  await test('enabled but installer unavailable when installer env vars are missing', () => {
    withEnv({ IMAGING_BRIDGE_ONBOARDING_ENABLED: 'true' }, () => {
      const config = getBridgeOnboardingConfig();
      assert.equal(config.enabled, true);
      assert.equal(config.installerAvailable, false);
      assert.equal(config.installer, null);
    });
  });

  section('getBridgeOnboardingConfig — installer metadata validation');

  await test('installer available with a valid https URL, version and sha256', () => {
    withEnv({
      IMAGING_BRIDGE_ONBOARDING_ENABLED: 'true',
      IMAGING_BRIDGE_INSTALLER_DOWNLOAD_URL: 'https://cdn.example.com/NoraMediBridgeSetup.exe',
      IMAGING_BRIDGE_INSTALLER_VERSION: '0.4.2',
      IMAGING_BRIDGE_INSTALLER_SHA256: VALID_SHA256,
      IMAGING_BRIDGE_INSTALLER_SIGNED: 'true',
      NODE_ENV: 'production',
    }, () => {
      const config = getBridgeOnboardingConfig();
      assert.equal(config.installerAvailable, true);
      assert.deepEqual(config.installer, {
        downloadUrl: 'https://cdn.example.com/NoraMediBridgeSetup.exe',
        version: '0.4.2',
        sha256: VALID_SHA256,
        signed: true,
        minimumWindowsBuild: 10240,
      });
    });
  });

  await test('installer unavailable when signed is omitted — defaults false, never claims signed', () => {
    withEnv({
      IMAGING_BRIDGE_ONBOARDING_ENABLED: 'true',
      IMAGING_BRIDGE_INSTALLER_DOWNLOAD_URL: 'https://cdn.example.com/NoraMediBridgeSetup.exe',
      IMAGING_BRIDGE_INSTALLER_VERSION: '0.4.2',
      IMAGING_BRIDGE_INSTALLER_SHA256: VALID_SHA256,
      IMAGING_BRIDGE_INSTALLER_SIGNED: undefined,
    }, () => {
      const config = getBridgeOnboardingConfig();
      assert.equal(config.installerAvailable, true);
      assert.equal(config.installer?.signed, false);
    });
  });

  await test('rejects a plain http:// URL in production', () => {
    withEnv({
      IMAGING_BRIDGE_ONBOARDING_ENABLED: 'true',
      IMAGING_BRIDGE_INSTALLER_DOWNLOAD_URL: 'http://cdn.example.com/NoraMediBridgeSetup.exe',
      IMAGING_BRIDGE_INSTALLER_VERSION: '0.4.2',
      IMAGING_BRIDGE_INSTALLER_SHA256: VALID_SHA256,
      NODE_ENV: 'production',
    }, () => {
      assert.equal(getBridgeOnboardingConfig().installerAvailable, false);
    });
  });

  await test('accepts a localhost http:// URL outside production only', () => {
    withEnv({
      IMAGING_BRIDGE_ONBOARDING_ENABLED: 'true',
      IMAGING_BRIDGE_INSTALLER_DOWNLOAD_URL: 'http://localhost:5000/NoraMediBridgeSetup.exe',
      IMAGING_BRIDGE_INSTALLER_VERSION: '0.4.2',
      IMAGING_BRIDGE_INSTALLER_SHA256: VALID_SHA256,
      NODE_ENV: 'development',
    }, () => {
      assert.equal(getBridgeOnboardingConfig().installerAvailable, true);
    });
    withEnv({
      IMAGING_BRIDGE_ONBOARDING_ENABLED: 'true',
      IMAGING_BRIDGE_INSTALLER_DOWNLOAD_URL: 'http://localhost:5000/NoraMediBridgeSetup.exe',
      IMAGING_BRIDGE_INSTALLER_VERSION: '0.4.2',
      IMAGING_BRIDGE_INSTALLER_SHA256: VALID_SHA256,
      NODE_ENV: 'production',
    }, () => {
      assert.equal(getBridgeOnboardingConfig().installerAvailable, false);
    });
  });

  await test('rejects a malformed URL', () => {
    withEnv({
      IMAGING_BRIDGE_ONBOARDING_ENABLED: 'true',
      IMAGING_BRIDGE_INSTALLER_DOWNLOAD_URL: 'not-a-url',
      IMAGING_BRIDGE_INSTALLER_VERSION: '0.4.2',
      IMAGING_BRIDGE_INSTALLER_SHA256: VALID_SHA256,
    }, () => {
      assert.equal(getBridgeOnboardingConfig().installerAvailable, false);
    });
  });

  await test('rejects a non-semver-shaped version string', () => {
    withEnv({
      IMAGING_BRIDGE_ONBOARDING_ENABLED: 'true',
      IMAGING_BRIDGE_INSTALLER_DOWNLOAD_URL: 'https://cdn.example.com/NoraMediBridgeSetup.exe',
      IMAGING_BRIDGE_INSTALLER_VERSION: 'latest',
      IMAGING_BRIDGE_INSTALLER_SHA256: VALID_SHA256,
    }, () => {
      assert.equal(getBridgeOnboardingConfig().installerAvailable, false);
    });
  });

  await test('rejects a sha256 that is not 64 hex characters', () => {
    withEnv({
      IMAGING_BRIDGE_ONBOARDING_ENABLED: 'true',
      IMAGING_BRIDGE_INSTALLER_DOWNLOAD_URL: 'https://cdn.example.com/NoraMediBridgeSetup.exe',
      IMAGING_BRIDGE_INSTALLER_VERSION: '0.4.2',
      IMAGING_BRIDGE_INSTALLER_SHA256: 'not-a-hash',
    }, () => {
      assert.equal(getBridgeOnboardingConfig().installerAvailable, false);
    });
  });

  // ── Source regression checks ────────────────────────────────────────────
  const imagingRouteSrc = src('../routes/imaging.ts');
  const configServiceSrc = src('../services/imaging/bridgeOnboardingConfig.ts');

  section('Source regression — onboarding config endpoint');

  await test('GET bridge-onboarding/config requires IMAGING_MANAGE_ROLES', () => {
    const block = imagingRouteSrc.slice(imagingRouteSrc.indexOf('Self-servis kurulum (Web Onboarding)'));
    assert.match(block, /router\.get\('\/imaging\/bridge-onboarding\/config',\s*authorize\(\[\.\.\.IMAGING_MANAGE_ROLES\]\)/);
  });

  await test('config endpoint does not query the database or accept clinic-scoped query params', () => {
    const block = imagingRouteSrc.slice(imagingRouteSrc.indexOf('Self-servis kurulum (Web Onboarding)'));
    assert.ok(!block.includes('prisma.'));
    assert.ok(!block.includes('req.query'));
  });

  section('Source regression — fail-closed / no false "signed" claim');

  await test('onboarding defaults to disabled unless IMAGING_BRIDGE_ONBOARDING_ENABLED === "true"', () => {
    assert.ok(configServiceSrc.includes("process.env.IMAGING_BRIDGE_ONBOARDING_ENABLED === 'true'"));
  });

  await test('signed flag is only ever read from env, never hardcoded true', () => {
    assert.ok(configServiceSrc.includes("process.env.IMAGING_BRIDGE_INSTALLER_SIGNED === 'true'"));
    assert.ok(!/signed:\s*true(?!,\s*NODE_ENV)/.test(configServiceSrc.replace(/\/\/.*$/gm, '')));
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
