/**
 * F3-CI-OPT-001 — deterministic tests for the changed-path classifier.
 *
 * No test framework: same self-contained test()/assert()/assertEqual()
 * harness as scripts/test-runtime/__tests__/orchestratorUnit.test.ts and
 * scripts/architecture-guardrail/__tests__/index.test.ts.
 *
 * Run: npx tsx scripts/ci-classify/__tests__/classify.test.ts
 */
import { classify, classifyFile, type Category, type DeepGateFlags } from '../classify.js';
import { parseArgs, toGithubOutputLines, toStepSummaryMarkdown } from '../cli.js';

let passed = 0;
let failed = 0;

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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const NO_GATE = {
  runBackendGeneral: false,
  runPostgres: false,
  runStorage: false,
  runFrontendFullSuite: false,
  runLegacyBackend: false,
};

const FULL_GATE = {
  runBackendGeneral: true,
  runPostgres: true,
  runStorage: true,
  runFrontendFullSuite: true,
  runLegacyBackend: true,
};

function assertFlags(actual: DeepGateFlags, expected: DeepGateFlags, msg: string) {
  for (const key of Object.keys(expected) as Array<keyof DeepGateFlags>) {
    assertEqual(actual[key], expected[key], `${msg} (flag "${key}")`);
  }
}

// ─── STEP 13 required scenarios ──────────────────────────────────────────

test('1. docs-only -> DOCS, docsOnly=true, no deep gate', () => {
  const r = classify(['docs/program/evidence/example.md']);
  assertEqual(r.docsOnly, true, 'single markdown file under docs/ is docs-only');
  assertFlags(r.flags, NO_GATE, 'docs-only must not select any deep-gate job');
});

test('2. frontend-only -> FRONTEND, frontend full-suite only', () => {
  const r = classify(['src/pages/Patients.tsx']);
  assertEqual(r.docsOnly, false, 'not docs-only');
  assertEqual(r.categoriesPresent.length, 1, 'exactly one category present');
  assertEqual(r.categoriesPresent[0], 'FRONTEND', 'classified as FRONTEND');
  assertFlags(r.flags, { ...NO_GATE, runFrontendFullSuite: true }, 'frontend-only selects only the frontend full-suite fail-safe');
});

test('3. ordinary backend route -> BACKEND_GENERAL, Layer 2 only', () => {
  const r = classify(['server/src/routes/payments.ts']);
  assertEqual(r.categoriesPresent[0], 'BACKEND_GENERAL', 'ordinary route classified as BACKEND_GENERAL');
  assertFlags(r.flags, { ...NO_GATE, runBackendGeneral: true }, 'ordinary backend route selects only Layer 2');
});

test('4. platform auth (middleware) -> AUTH_SECURITY, Layer 2+3+5b', () => {
  const r = classify(['server/src/middleware/platformAuth.ts']);
  assertEqual(r.categoriesPresent[0], 'AUTH_SECURITY', 'middleware classified as AUTH_SECURITY');
  assertFlags(
    r.flags,
    { ...NO_GATE, runBackendGeneral: true, runPostgres: true, runLegacyBackend: true },
    'auth/security selects Layer 2, 3, and 5b (auth tests span both disposable-db and legacy-db-required)',
  );
  assertEqual(r.flags.runStorage, false, 'auth/security does not require the storage/MinIO layer');
});

test('5. Prisma schema -> DATABASE_SCHEMA, full DB-related deep gate', () => {
  const r = classify(['server/prisma/schema.prisma']);
  assertEqual(r.categoriesPresent[0], 'DATABASE_SCHEMA', 'schema.prisma classified as DATABASE_SCHEMA');
  assertFlags(
    r.flags,
    { ...NO_GATE, runBackendGeneral: true, runPostgres: true, runStorage: true, runLegacyBackend: true },
    'schema changes select every DB-backed layer (2, 3, 4, 5b) - never narrowed for regulated-data migrations',
  );
});

test('6. migration file -> DATABASE_SCHEMA, full DB-related deep gate', () => {
  const r = classify(['server/prisma/migrations/20260101000000_change/migration.sql']);
  assertEqual(r.categoriesPresent[0], 'DATABASE_SCHEMA', 'migration SQL classified as DATABASE_SCHEMA');
  assertFlags(
    r.flags,
    { ...NO_GATE, runBackendGeneral: true, runPostgres: true, runStorage: true, runLegacyBackend: true },
    'migrations select every DB-backed layer',
  );
});

test('7. storage service -> STORAGE_IMAGING, Layer 2+3+4', () => {
  const r = classify(['server/src/services/fileStorage.ts']);
  assertEqual(r.categoriesPresent[0], 'STORAGE_IMAGING', 'fileStorage.ts classified as STORAGE_IMAGING');
  assertFlags(
    r.flags,
    { ...NO_GATE, runBackendGeneral: true, runPostgres: true, runStorage: true },
    'storage changes select Layer 2, 3 (imaging/backup DB tests live there), and 4 (MinIO)',
  );
  assertEqual(r.flags.runLegacyBackend, false, 'storage changes do not require the auth-heavy legacy-DB layer');
});

test('8. imaging route -> STORAGE_IMAGING', () => {
  const r = classify(['server/src/routes/imaging.ts']);
  assertEqual(r.categoriesPresent[0], 'STORAGE_IMAGING', 'imaging route classified as STORAGE_IMAGING');
  assertEqual(r.flags.runStorage, true, 'imaging route selects the storage/MinIO layer');
});

test('9. architecture-boundary (guardrail config) -> ARCHITECTURE_BOUNDARY, no extra deep gate', () => {
  const r = classify(['scripts/architecture-guardrail/config/domain-map.json']);
  assertEqual(r.categoriesPresent[0], 'ARCHITECTURE_BOUNDARY', 'guardrail config classified as ARCHITECTURE_BOUNDARY');
  assertFlags(r.flags, NO_GATE, 'guardrail config alone selects no Layer 2-5 job (Layer 1 guardrail scan already always runs)');
});

test('10. CI workflow/tooling -> CI_TOOLING, full deep gate (fail-safe)', () => {
  const r = classify(['.github/workflows/ci-main-and-nightly.yml']);
  assertEqual(r.categoriesPresent[0], 'CI_TOOLING', 'workflow file classified as CI_TOOLING');
  assertFlags(r.flags, FULL_GATE, 'CI tooling changes conservatively select the full deep gate');
});

test('11. mixed frontend + backend -> both categories, union of their flags', () => {
  const r = classify(['src/pages/Patients.tsx', 'server/src/routes/payments.ts']);
  assert(r.categoriesPresent.includes('FRONTEND'), 'includes FRONTEND');
  assert(r.categoriesPresent.includes('BACKEND_GENERAL'), 'includes BACKEND_GENERAL');
  assertFlags(
    r.flags,
    { ...NO_GATE, runFrontendFullSuite: true, runBackendGeneral: true },
    'mixed frontend+backend unions exactly the two selected flags, nothing more',
  );
  assertEqual(r.docsOnly, false, 'mixed changeset is never docs-only');
});

test('12. mixed auth + migration -> union is a superset of either alone', () => {
  const r = classify(['server/src/middleware/platformAuth.ts', 'server/prisma/migrations/20260101000000_change/migration.sql']);
  assert(r.categoriesPresent.includes('AUTH_SECURITY'), 'includes AUTH_SECURITY');
  assert(r.categoriesPresent.includes('DATABASE_SCHEMA'), 'includes DATABASE_SCHEMA');
  assertFlags(
    r.flags,
    { runBackendGeneral: true, runPostgres: true, runStorage: true, runLegacyBackend: true, runFrontendFullSuite: false },
    'auth+migration union pulls in storage (from migration) on top of what auth alone would select - union is monotonic, never narrower than either category alone',
  );
});

test('13. unknown/unrecognized source path -> UNKNOWN, conservative full deep gate', () => {
  const r = classify(['some/brand/new/top-level/thing.ts']);
  assertEqual(r.categoriesPresent[0], 'UNKNOWN', 'unrecognized path classified as UNKNOWN');
  assertFlags(r.flags, FULL_GATE, 'unknown paths never fail open - full deep gate');
  assertEqual(r.docsOnly, false, 'UNKNOWN can never be docs-only');
});

// ─── Additional coverage beyond the 13 mandated scenarios ────────────────

test('empty changed-file list is never docs-only and selects the full deep gate', () => {
  const r = classify([]);
  assertEqual(r.docsOnly, false, 'empty diff is not treated as docs-only');
  assertFlags(r.flags, FULL_GATE, 'empty/undetectable diff fails safe to the full deep gate');
});

test('docs mixed with a single unrelated file is not docs-only', () => {
  const r = classify(['docs/program/evidence/example.md', 'src/pages/Patients.tsx']);
  assertEqual(r.docsOnly, false, 'one non-docs file disqualifies docs-only even among many docs files');
});

test('recovery/backup/PITR paths keep the full deep gate (R-030-DB protection)', () => {
  // These paths carry the entire off-host recovery surface: the pgBackRest
  // wrapper, preflight, status writer, restore drill and the Gate 0 harness.
  // They are gated today ONLY because no CATEGORY_RULE matches them, so they
  // fall through to UNKNOWN -> FULL_DEEP_GATE. That is correct behaviour
  // arrived at by accident, and nothing asserted it.
  //
  // Without this test, the first plausible-looking cost-reduction rule --
  // `ops/**` or `scripts/**` mapped to DOCS or ARCHITECTURE_BOUNDARY, both of
  // which carry NO_FLAGS -- would silently delete the recovery deep gate, and
  // no test would turn red. Layer 2 holds every recovery/PITR unit test, so
  // runBackendGeneral is the flag that actually matters here.
  const recoveryPaths = [
    'ops/pgbackrest/pgbackrest.conf.example',
    'ops/pgbackrest/postgresql-pitr.conf.example',
    'ops/systemd/noramedi-pgbackrest-status.timer',
    'scripts/noramedi-pgbackrest-backup.sh',
    'scripts/noramedi-pgbackrest-preflight.sh',
    'scripts/noramedi-pgbackrest-status.sh',
    'scripts/noramedi-pgbackrest-restore-drill.sh',
    'scripts/noramedi-gate0-repo2-unreachability.sh',
    'scripts/noramedi-pitr-app-smoke.mjs',
    'scripts/backup-restore-rehearsal.sh',
  ];
  for (const p of recoveryPaths) {
    const r = classify([p]);
    assertEqual(r.docsOnly, false, `${p} must never be treated as docs-only`);
    assertEqual(
      r.flags.runBackendGeneral,
      true,
      `${p} must still select Layer 2, which runs every recovery/PITR test`,
    );
  }

  // And as a set, so a future rule cannot pass the per-file check while
  // narrowing the combined selection.
  const all = classify(recoveryPaths);
  assertEqual(all.docsOnly, false, 'a recovery-only changeset is not docs-only');
  assertEqual(
    all.flags.runBackendGeneral,
    true,
    'a recovery-only changeset still selects the backend suite',
  );
});

test('every category is reachable (CATEGORY_RULES completeness spot-check)', () => {
  const samples: Array<[string, Category]> = [
    ['docs/README.md', 'DOCS'],
    ['README.md', 'DOCS'],
    ['src/App.tsx', 'FRONTEND'],
    ['vite.config.ts', 'FRONTEND'],
    ['server/src/services/dashboard.ts', 'BACKEND_GENERAL'],
    ['server/src/routes/auth.ts', 'AUTH_SECURITY'],
    ['server/src/utils/sessionCookies.ts', 'AUTH_SECURITY'],
    ['server/src/tests/totp.test.ts', 'AUTH_SECURITY'],
    ['server/prisma/schema.prisma', 'DATABASE_SCHEMA'],
    ['server/prisma/seed.ts', 'DATABASE_SCHEMA'],
    ['server/src/services/imaging/ops.ts', 'STORAGE_IMAGING'],
    ['windows-bridge/src/Program.cs', 'STORAGE_IMAGING'],
    ['scripts/architecture-guardrail/config/scan-roots.json', 'ARCHITECTURE_BOUNDARY'],
    ['scripts/architecture-guardrail/cli.ts', 'CI_TOOLING'],
    ['scripts/test-runtime/orchestrator.ts', 'CI_TOOLING'],
    ['.github/workflows/ci-pr.yml', 'CI_TOOLING'],
    ['package.json', 'CI_TOOLING'],
    ['server/package.json', 'CI_TOOLING'],
    ['ecosystem.config.cjs', 'UNKNOWN'],
    ['nginx.conf', 'UNKNOWN'],
    ['bridge-agent/src/index.ts', 'UNKNOWN'],
  ];
  for (const [path, expected] of samples) {
    assertEqual(classifyFile(path), expected, `classifyFile(${JSON.stringify(path)})`);
  }
});

test('backslash paths (Windows-style) normalize the same as forward-slash paths', () => {
  assertEqual(classifyFile('server\\src\\middleware\\auth.ts'), classifyFile('server/src/middleware/auth.ts'), 'backslash vs forward-slash agree');
});

test('flag union is monotonic: no category can remove a flag another category set', () => {
  const authOnly = classify(['server/src/middleware/platformAuth.ts']).flags;
  const authPlusFrontend = classify(['server/src/middleware/platformAuth.ts', 'src/pages/Patients.tsx']).flags;
  for (const key of Object.keys(authOnly) as Array<keyof typeof authOnly>) {
    if (authOnly[key]) {
      assert(authPlusFrontend[key], `adding an unrelated FRONTEND file must not clear flag "${key}" set by AUTH_SECURITY`);
    }
  }
});

test('CLI: parseArgs requires --files-from or --files', () => {
  let threw = false;
  try {
    parseArgs([]);
  } catch {
    threw = true;
  }
  assert(threw, 'parseArgs with no file source must throw');
});

test('CLI: parseArgs accepts --files-from and optional output paths', () => {
  const opts = parseArgs(['--files-from=/tmp/changed.txt', '--github-output=/tmp/out', '--step-summary=/tmp/summary']);
  assertEqual(opts.filesFromPath, '/tmp/changed.txt', 'files-from parsed');
  assertEqual(opts.githubOutputPath, '/tmp/out', 'github-output parsed');
  assertEqual(opts.stepSummaryPath, '/tmp/summary', 'step-summary parsed');
});

test('CLI: toGithubOutputLines emits stable, GitHub Actions-compatible key=value pairs', () => {
  const r = classify(['server/src/middleware/platformAuth.ts']);
  const lines = toGithubOutputLines(r);
  assert(lines.includes('docs_only=false'), 'docs_only line present and correct');
  assert(lines.includes('run_backend_general=true'), 'run_backend_general line present and correct');
  assert(lines.includes('run_storage=false'), 'run_storage line present and correct');
  assert(
    lines.every((l) => /^[a-z_]+=[a-zA-Z_,]*$/.test(l)),
    'every output line is a bare key=value pair with no characters GITHUB_OUTPUT would choke on',
  );
});

test('CLI: toStepSummaryMarkdown renders a table without throwing on any classification', () => {
  const r = classify(['docs/x.md', 'src/a.tsx', 'server/src/b.ts']);
  const md = toStepSummaryMarkdown(r);
  assert(md.includes('changed-path classification'), 'summary has a title');
  assert(md.includes('DOCS'), 'summary lists the DOCS category present');
});

// ─── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${'-'.repeat(60)}`);
console.log(`classify: ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
