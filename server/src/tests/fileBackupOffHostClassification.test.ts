/**
 * fileBackupOffHostClassification.test.ts — F4-CI-L4-STORAGE-GATE-001 (Lane C/D).
 *
 * Locks down the PRODUCTION definition of "off-host" so the Layer 4 storage
 * fix cannot have weakened it, now or later.
 *
 * Background: F4-FCR-001 tightened `isFileBackupDestinationOffHost()` so a
 * loopback S3 endpoint (a MinIO container on the very same VPS) is no longer
 * reported as an independent copy — that value drives an operator-facing
 * "off-host ✓" badge, the recovery status file, and the host monitor's
 * failure-domain alarm, so over-claiming it is exactly the false assurance
 * R-030 exists to prevent. The Layer 4 storage suite, however, still asserted
 * `off-host === true` against a loopback MinIO. F4-CI-L4-STORAGE-GATE-001
 * resolves that contradiction by changing the disposable TEST topology (the
 * container's own non-loopback network address) and the test's assertion —
 * never the production predicate.
 *
 * This file is the standing proof of that "never": it needs no Docker, no
 * database and no network, so it runs in Layer 2 on every PR, independently
 * of whether Layer 4 ran at all.
 *
 * Run: cd server && npx tsx src/tests/fileBackupOffHostClassification.test.ts
 */
import {
  getFileBackupDestinationKind,
  isFileBackupDestinationOffHost,
} from '../services/fileBackupDestination.js';

let passed = 0;
let failed = 0;

function section(name: string) {
  console.log(`\n${name}`);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const ENV_KEYS = [
  'NODE_ENV',
  'FILE_BACKUP_S3_BUCKET',
  'FILE_BACKUP_S3_ENDPOINT',
  'FILE_BACKUP_LOCAL_DIR',
] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => void) {
  for (const key of ENV_KEYS) {
    const value = key in overrides ? overrides[key] : undefined;
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ── Loopback is never off-host ───────────────────────────────────────────────
section('Production policy: a loopback S3 endpoint is never off-host');

const LOOPBACK_ENDPOINTS = [
  'http://127.0.0.1:9000',
  'http://127.0.0.1',
  'https://127.0.0.1:9000',
  'http://127.1.2.3:9000',
  'http://127.255.255.254:9000',
  'http://localhost:9000',
  'http://LOCALHOST:9000',
  'http://[::1]:9000',
  'http://0.0.0.0:9000',
];

for (const endpoint of LOOPBACK_ENDPOINTS) {
  test(`${endpoint} is NOT off-host`, () => {
    withEnv({ FILE_BACKUP_S3_BUCKET: 'backups', FILE_BACKUP_S3_ENDPOINT: endpoint }, () => {
      assertEqual(getFileBackupDestinationKind(), 's3', 'destination kind is still s3');
      assertEqual(isFileBackupDestinationOffHost(), false, 'loopback endpoint must not be reported as off-host');
    });
  });
}

test('a loopback endpoint is NOT off-host in production either (the tightening is not dev-only)', () => {
  withEnv({ NODE_ENV: 'production', FILE_BACKUP_S3_BUCKET: 'backups', FILE_BACKUP_S3_ENDPOINT: 'http://127.0.0.1:9000' }, () => {
    assertEqual(isFileBackupDestinationOffHost(), false, 'production loopback endpoint must not be reported as off-host');
  });
});

// ── Non-loopback addresses ───────────────────────────────────────────────────
section('Production policy: a non-loopback endpoint is off-host');

test('a Docker container-network address (the disposable Layer 4 topology) IS off-host, via the unmodified production predicate', () => {
  withEnv({ FILE_BACKUP_S3_BUCKET: 'backups', FILE_BACKUP_S3_ENDPOINT: 'http://172.18.0.3:9000' }, () => {
    assertEqual(isFileBackupDestinationOffHost(), true, 'a container-network address is not this host');
  });
});

test('a remote provider hostname is off-host', () => {
  withEnv({ FILE_BACKUP_S3_BUCKET: 'backups', FILE_BACKUP_S3_ENDPOINT: 'https://s3.eu-central-1.amazonaws.com' }, () => {
    assertEqual(isFileBackupDestinationOffHost(), true, 'a remote endpoint is off-host');
  });
});

test('no endpoint at all (real AWS S3 default endpoints) is off-host', () => {
  withEnv({ FILE_BACKUP_S3_BUCKET: 'backups' }, () => {
    assertEqual(isFileBackupDestinationOffHost(), true, 'unset endpoint means real AWS S3');
  });
});

// ── Fail-closed cases ────────────────────────────────────────────────────────
section('Production policy: fail closed on anything unprovable');

test('an unparseable endpoint is NOT off-host (under-claiming durability is the safe direction)', () => {
  withEnv({ FILE_BACKUP_S3_BUCKET: 'backups', FILE_BACKUP_S3_ENDPOINT: 'not a url' }, () => {
    assertEqual(isFileBackupDestinationOffHost(), false, 'unparseable endpoint must fail closed');
  });
});

test('a local-directory destination is NOT off-host, whatever the directory is', () => {
  withEnv({ FILE_BACKUP_LOCAL_DIR: '/mnt/backup-disk' }, () => {
    assertEqual(getFileBackupDestinationKind(), 'local', 'destination kind is local');
    assertEqual(isFileBackupDestinationOffHost(), false, 'a local directory is never off-host');
  });
});

test('no destination configured at all is NOT off-host', () => {
  withEnv({}, () => {
    assertEqual(getFileBackupDestinationKind(), 'none', 'destination kind is none');
    assertEqual(isFileBackupDestinationOffHost(), false, 'nothing configured is never off-host');
  });
});

test('an S3 bucket whose endpoint is loopback stays non-off-host even when the bucket name looks remote', () => {
  withEnv({ FILE_BACKUP_S3_BUCKET: 'offsite-turkey-backups', FILE_BACKUP_S3_ENDPOINT: 'http://localhost:9000' }, () => {
    assertEqual(isFileBackupDestinationOffHost(), false, 'the bucket name is not evidence of anything');
  });
});

console.log(`\n${'-'.repeat(60)}`);
console.log(`fileBackupOffHostClassification: ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
