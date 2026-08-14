/**
 * deployReleaseShaPropagation.test.ts — F3-C2-ERR-003-R1
 *
 * Regression coverage for the production finding after the F3-C2-ERR-001
 * deploy: the application deployed and stayed healthy, but both PM2 processes
 * came up with RELEASE_SHA unset (RELEASE_SHA_CONFIGURED=NO,
 * RELEASE_SHA_MATCH=NO), so server/src/utils/errorTracking.ts's `release` tag
 * would still be empty once a DSN is configured.
 *
 * Root cause: scripts/noramedi-deploy.sh exported RELEASE_SHA into the deploy
 * shell, but PM2's CLI environment is conservative — on restart/reload it
 * reuses the environment recorded when the process was first started. What
 * PM2 guarantees instead is that values declared under an ecosystem file's
 * `env:` attribute are re-applied on every restart/reload
 * (https://pm2.io/docs/runtime/best-practices/environment-variables/), so
 * ecosystem.config.cjs must declare RELEASE_SHA itself.
 *
 * These tests exercise the real ecosystem.config.cjs the way PM2 does — by
 * `require`-ing it in a child Node process with a controlled environment —
 * plus a static scan of the deploy script. They prove the contract, not the
 * wording: dynamic consumption, no hard-coded SHA, both processes, unchanged
 * process roles / job-ownership split, no SENTRY_DSN, git-HEAD derivation in
 * the deploy script, and the deliberate operator-supplied override.
 *
 * No DB/network/PM2 required.
 *
 * Run with: tsx src/tests/deployReleaseShaPropagation.test.ts
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ECOSYSTEM_PATH = fileURLToPath(new URL('../../../ecosystem.config.cjs', import.meta.url));
const DEPLOY_SCRIPT_PATH = fileURLToPath(new URL('../../../scripts/noramedi-deploy.sh', import.meta.url));

const ECOSYSTEM_SOURCE = readFileSync(ECOSYSTEM_PATH, 'utf8');
const DEPLOY_SOURCE = readFileSync(DEPLOY_SCRIPT_PATH, 'utf8');

const API_APP = 'noramedi-api';
const WORKER_APP = 'noramedi-worker';

// Two distinct, obviously synthetic release ids. Using two different values
// (rather than one) is what proves the config *reads* the environment instead
// of returning a constant that happens to match a single expectation.
const FAKE_SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
const FAKE_SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2';

type EcosystemApp = {
  name: string;
  env?: Record<string, string | undefined>;
};

/**
 * Loads ecosystem.config.cjs exactly as the PM2 CLI does — a fresh Node
 * process that `require`s the CommonJS module — with `envOverrides` applied to
 * that process's environment (an `undefined` value deletes the variable).
 */
function loadEcosystem(envOverrides: Record<string, string | undefined> = {}): EcosystemApp[] {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  const stdout = execFileSync(
    process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(require(process.argv[1])));', ECOSYSTEM_PATH],
    { encoding: 'utf8', env, cwd: REPO_ROOT },
  );

  const parsed = JSON.parse(stdout) as { apps?: EcosystemApp[] };
  assert.ok(Array.isArray(parsed.apps), 'ecosystem config must export an apps array');
  return parsed.apps!;
}

function appNamed(apps: EcosystemApp[], name: string): EcosystemApp {
  const app = apps.find(candidate => candidate.name === name);
  assert.ok(app, `ecosystem config must declare a PM2 app named '${name}'`);
  return app!;
}

function envOf(apps: EcosystemApp[], name: string): Record<string, string | undefined> {
  const app = appNamed(apps, name);
  assert.ok(app.env, `PM2 app '${name}' must declare an env block`);
  return app.env!;
}

async function main() {
  section('1. The ecosystem/deploy contract consumes the deployment RELEASE_SHA dynamically');

  await test('a supplied RELEASE_SHA reaches both PM2 apps verbatim', () => {
    const apps = loadEcosystem({ RELEASE_SHA: FAKE_SHA_A });
    assert.equal(envOf(apps, API_APP).RELEASE_SHA, FAKE_SHA_A);
    assert.equal(envOf(apps, WORKER_APP).RELEASE_SHA, FAKE_SHA_A);
  });

  await test('a different supplied RELEASE_SHA yields a different declared value (not a constant)', () => {
    const apps = loadEcosystem({ RELEASE_SHA: FAKE_SHA_B });
    assert.equal(envOf(apps, API_APP).RELEASE_SHA, FAKE_SHA_B);
    assert.equal(envOf(apps, WORKER_APP).RELEASE_SHA, FAKE_SHA_B);
  });

  await test('the declared value is always a usable non-empty string, never the string "undefined"', () => {
    for (const overrides of [{ RELEASE_SHA: FAKE_SHA_A }, { RELEASE_SHA: undefined }, { RELEASE_SHA: '   ' }]) {
      const apps = loadEcosystem(overrides);
      for (const appName of [API_APP, WORKER_APP]) {
        const value = envOf(apps, appName).RELEASE_SHA;
        assert.equal(typeof value, 'string', `${appName}: RELEASE_SHA must be declared as a string`);
        assert.notEqual(value, '', `${appName}: RELEASE_SHA must never be empty`);
        assert.notEqual(value, 'undefined', `${appName}: RELEASE_SHA must never be the literal "undefined"`);
      }
    }
  });

  section('2. The release SHA is never hard-coded in the repository');

  await test('ecosystem.config.cjs contains no literal 40-character commit id', () => {
    const match = ECOSYSTEM_SOURCE.match(/\b[0-9a-f]{40}\b/i);
    assert.equal(match, null, `unexpected literal commit id in ecosystem.config.cjs: ${match?.[0] ?? ''}`);
  });

  await test('ecosystem.config.cjs contains no quoted hex-like release literal', () => {
    const match = ECOSYSTEM_SOURCE.match(/['"][0-9a-f]{7,}['"]/i);
    assert.equal(match, null, `unexpected quoted hex literal in ecosystem.config.cjs: ${match?.[0] ?? ''}`);
  });

  await test('ecosystem.config.cjs resolves RELEASE_SHA from the environment it is evaluated in', () => {
    assert.match(
      ECOSYSTEM_SOURCE,
      /process\.env\.RELEASE_SHA/,
      'ecosystem.config.cjs must read process.env.RELEASE_SHA rather than embed a value',
    );
  });

  await test('scripts/noramedi-deploy.sh contains no literal 40-character commit id', () => {
    const match = DEPLOY_SOURCE.match(/\b[0-9a-f]{40}\b/i);
    assert.equal(match, null, `unexpected literal commit id in noramedi-deploy.sh: ${match?.[0] ?? ''}`);
  });

  section('3. Both PM2 processes receive the release SHA');

  await test('the API app declares RELEASE_SHA in its own env block', () => {
    const apps = loadEcosystem({ RELEASE_SHA: FAKE_SHA_A });
    assert.ok(
      Object.prototype.hasOwnProperty.call(envOf(apps, API_APP), 'RELEASE_SHA'),
      `${API_APP} must declare RELEASE_SHA (PM2 only re-applies env-block values on reload)`,
    );
  });

  await test('the worker app declares RELEASE_SHA in its own env block', () => {
    const apps = loadEcosystem({ RELEASE_SHA: FAKE_SHA_A });
    assert.ok(
      Object.prototype.hasOwnProperty.call(envOf(apps, WORKER_APP), 'RELEASE_SHA'),
      `${WORKER_APP} must declare RELEASE_SHA (PM2 only re-applies env-block values on reload)`,
    );
  });

  await test('both apps are still reloaded from the ecosystem file by the deploy script', () => {
    for (const appName of [API_APP, WORKER_APP]) {
      assert.match(
        DEPLOY_SOURCE,
        new RegExp(`pm2 startOrReload "\\$ECOSYSTEM_FILE" --only "\\$PM2_${appName === API_APP ? 'API' : 'WORKER'}_NAME" --update-env`),
        `deploy script must keep reloading ${appName} from ecosystem.config.cjs`,
      );
    }
  });

  section('4. Process roles are unchanged (F3-IMPL-002 contract)');

  await test('NORAMEDI_PROCESS_ROLE remains api/worker respectively', () => {
    const apps = loadEcosystem({ RELEASE_SHA: FAKE_SHA_A });
    assert.equal(envOf(apps, API_APP).NORAMEDI_PROCESS_ROLE, 'api');
    assert.equal(envOf(apps, WORKER_APP).NORAMEDI_PROCESS_ROLE, 'worker');
  });

  await test('both apps are still declared, with unchanged entrypoints', () => {
    const apps = loadEcosystem({ RELEASE_SHA: FAKE_SHA_A });
    assert.equal(apps.length, 2, 'exactly the API and worker apps are declared');
    assert.equal((appNamed(apps, API_APP) as Record<string, unknown>).args, 'run start');
    assert.equal((appNamed(apps, WORKER_APP) as Record<string, unknown>).args, 'run start:worker');
  });

  section('5. RUN_BACKGROUND_JOBS=false remains API-only (F3-IMPL-001/002 job ownership)');

  await test('the API app still opts out of background jobs', () => {
    const apps = loadEcosystem({ RELEASE_SHA: FAKE_SHA_A });
    assert.equal(envOf(apps, API_APP).RUN_BACKGROUND_JOBS, 'false');
  });

  await test('the worker app still declares no RUN_BACKGROUND_JOBS (owns jobs unconditionally)', () => {
    const apps = loadEcosystem({ RELEASE_SHA: FAKE_SHA_A });
    assert.equal(
      Object.prototype.hasOwnProperty.call(envOf(apps, WORKER_APP), 'RUN_BACKGROUND_JOBS'),
      false,
      'RUN_BACKGROUND_JOBS must not leak into the worker app',
    );
  });

  section('6. SENTRY_DSN is not introduced into the PM2 process contract');

  await test('ecosystem.config.cjs never mentions SENTRY_DSN as a declared variable', () => {
    const apps = loadEcosystem({ RELEASE_SHA: FAKE_SHA_A });
    for (const appName of [API_APP, WORKER_APP]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(envOf(apps, appName), 'SENTRY_DSN'),
        false,
        `${appName} must not declare SENTRY_DSN — the DSN stays in server/.env`,
      );
    }
  });

  await test('the declared env keys are exactly the intended non-secret set', () => {
    const apps = loadEcosystem({ RELEASE_SHA: FAKE_SHA_A });
    assert.deepEqual(
      Object.keys(envOf(apps, API_APP)).sort(),
      ['NORAMEDI_PROCESS_ROLE', 'RELEASE_SHA', 'RUN_BACKGROUND_JOBS'],
    );
    assert.deepEqual(
      Object.keys(envOf(apps, WORKER_APP)).sort(),
      ['NORAMEDI_PROCESS_ROLE', 'RELEASE_SHA'],
    );
  });

  await test('the deploy script still never handles or prints SENTRY_DSN', () => {
    const dsnMentions = DEPLOY_SOURCE.split('\n').filter(line => line.includes('SENTRY_DSN'));
    for (const line of dsnMentions) {
      assert.match(line.trim(), /^#/, `SENTRY_DSN may only appear in comments, found: ${line.trim()}`);
    }
  });

  section('7. The deploy script still derives the SHA from the deployed git HEAD');

  await test('RELEASE_SHA is derived from `git -C "$APP_DIR" rev-parse HEAD`', () => {
    assert.match(DEPLOY_SOURCE, /git -C "\$APP_DIR" rev-parse HEAD/);
  });

  await test('RELEASE_SHA is exported before the PM2 reload calls', () => {
    const exportIndex = DEPLOY_SOURCE.indexOf('\nexport RELEASE_SHA');
    const firstReloadIndex = DEPLOY_SOURCE.indexOf('pm2 startOrReload "$ECOSYSTEM_FILE"');
    assert.notEqual(exportIndex, -1, 'deploy script must export RELEASE_SHA');
    assert.notEqual(firstReloadIndex, -1, 'deploy script must reload via the ecosystem file');
    assert.ok(
      exportIndex < firstReloadIndex,
      'RELEASE_SHA must be exported before the PM2 reload calls evaluate ecosystem.config.cjs',
    );
  });

  await test('a non-git deploy directory degrades to "unknown" instead of aborting the deploy', () => {
    assert.match(DEPLOY_SOURCE, /\|\| echo unknown/);
  });

  section('8. Operator-supplied RELEASE_SHA override remains intentionally supported');

  await test('the deploy script keeps ${RELEASE_SHA:-...} precedence (operator value wins)', () => {
    assert.match(DEPLOY_SOURCE, /RELEASE_SHA="\$\{RELEASE_SHA:-/);
  });

  await test('an operator-supplied value wins over this checkout\'s git HEAD in the ecosystem config', () => {
    const supplied = loadEcosystem({ RELEASE_SHA: FAKE_SHA_A });
    assert.equal(envOf(supplied, API_APP).RELEASE_SHA, FAKE_SHA_A);
    assert.equal(envOf(supplied, WORKER_APP).RELEASE_SHA, FAKE_SHA_A);

    const derived = loadEcosystem({ RELEASE_SHA: undefined });
    assert.notEqual(
      envOf(derived, API_APP).RELEASE_SHA,
      FAKE_SHA_A,
      'the fallback must not echo a previously supplied value',
    );
  });

  await test('with no supplied value the config falls back to this checkout\'s git HEAD (or "unknown")', () => {
    const apps = loadEcosystem({ RELEASE_SHA: undefined });
    let expectedHead: string | null = null;
    try {
      expectedHead = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      expectedHead = null;
    }

    for (const appName of [API_APP, WORKER_APP]) {
      const value = envOf(apps, appName).RELEASE_SHA;
      if (expectedHead) {
        assert.equal(value, expectedHead, `${appName}: fallback must be the deployed checkout's git HEAD`);
      } else {
        assert.equal(value, 'unknown', `${appName}: without git the fallback must be the literal "unknown"`);
      }
    }
  });

  await test('a blank/whitespace-only supplied value is treated as unset, not propagated', () => {
    const apps = loadEcosystem({ RELEASE_SHA: '   ' });
    for (const appName of [API_APP, WORKER_APP]) {
      const value = envOf(apps, appName).RELEASE_SHA;
      assert.notEqual(value?.trim(), '', `${appName}: a blank RELEASE_SHA must fall back, not propagate`);
    }
  });

  section('9. The deploy script verifies propagation on the live processes (non-fatal)');

  await test('deploy verification checks RELEASE_SHA state for both PM2 apps', () => {
    assert.match(DEPLOY_SOURCE, /release_sha_state_of\(\)/, 'deploy script must define the verification helper');
    assert.match(
      DEPLOY_SOURCE,
      /for app_name in "\$PM2_API_NAME" "\$PM2_WORKER_NAME"/,
      'verification must cover both apps',
    );
    assert.match(DEPLOY_SOURCE, /RELEASE_SHA_CONFIGURED=YES RELEASE_SHA_MATCH=YES/);
    assert.match(DEPLOY_SOURCE, /RELEASE_SHA_CONFIGURED=NO RELEASE_SHA_MATCH=NO/);
  });

  await test('release-tag verification never aborts an otherwise healthy deploy', () => {
    const verificationBlock = DEPLOY_SOURCE.slice(DEPLOY_SOURCE.indexOf('# 8b.'));
    assert.ok(verificationBlock.length > 0, 'step 8b must exist');
    assert.equal(
      /\bexit 1\b/.test(verificationBlock),
      false,
      'a degraded release tag must warn, never fail the deploy (the application itself is healthy)',
    );
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
