/**
 * rawSqlTenantAudit.test.ts — F3-2 raw-SQL drift guard.
 *
 * The Prisma guard rewrites structured query arguments. It can intercept
 * `$queryRaw`, but it cannot READ the SQL, so from tenant execution it refuses
 * rather than guessing (proved in tenantGuardUnit.test.ts §I). That refusal is
 * only half an answer: NoraMedi has ~36 raw-SQL call sites today, and every one
 * of them needs a recorded reason why it is safe, or the guard's refusal just
 * becomes the thing everyone works around.
 *
 * This suite is the other half. It re-scans `server/src` on every CI run and
 * holds `tenancy/rawSqlAuditRegistry.ts` to it in both directions, so that:
 *
 *   - adding raw SQL to an UNLISTED file fails CI;
 *   - adding raw SQL to an already-reviewed file fails CI (the count moves);
 *   - removing the last raw SQL from a listed file fails CI (stale entry);
 *   - a `UNSAFE_BLOCKER` classification can never sit in the registry quietly.
 *
 * The keying is per FILE plus a call-site COUNT, deliberately not per line:
 * line numbers move on every unrelated edit, and a registry that churns is a
 * registry people stop reading.
 *
 * DATABASE-FREE: text scanning plus a direct import of the registry.
 *
 * Run with: tsx src/tests/rawSqlTenantAudit.test.ts
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RAW_SQL_AUDIT_REGISTRY,
  RAW_SQL_REGISTRY_KEYS,
  rawSqlAuditBlockers,
  rawSqlAuditCountsByClassification,
  rawSqlAuditTotalCallSites,
} from '../tenancy/rawSqlAuditRegistry.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');
const REPO_ROOT = resolve(SERVER_ROOT, '..');
const SRC_ROOT = join(SERVER_ROOT, 'src');

/**
 * Files that NAME the raw operations as data rather than calling them: the
 * guard's own operation taxonomy and the audited-escape module. Excluded
 * explicitly (never by directory) so that adding a real raw-SQL call anywhere
 * else under tenancy/ still trips the scan.
 */
const SELF_REFERENTIAL_FILES: readonly string[] = Object.freeze([
  'server/src/tenancy/prismaTenantGuard.ts',
  'server/src/tenancy/rawSqlAuditRegistry.ts',
]);

/**
 * Longest-alternative-first so `$queryRawUnsafe` is not consumed as
 * `$queryRaw` followed by stray text.
 */
const RAW_CALL_PATTERN = /\$(?:queryRawUnsafe|queryRaw|executeRawUnsafe|executeRaw)\b/g;

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*');
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // The test tree is excluded on purpose: a test may legitimately run raw
      // SQL to set up or verify a fixture, and holding fixtures to a production
      // tenant-safety registry would be noise, not signal.
      if (entry.name === 'tests') continue;
      listSourceFiles(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function repoRelative(absolutePath: string): string {
  return absolutePath.slice(REPO_ROOT.length + 1).split(sep).join('/');
}

/** file -> number of raw-SQL call sites, comments excluded. */
function scanRawSqlCallSites(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of listSourceFiles(SRC_ROOT)) {
    const relative = repoRelative(file);
    if (SELF_REFERENTIAL_FILES.includes(relative)) continue;
    const source = readFileSync(file, 'utf8').replace(/\r/g, '');
    let count = 0;
    for (const line of source.split('\n')) {
      if (isCommentLine(line)) continue;
      count += (line.match(RAW_CALL_PATTERN) ?? []).length;
    }
    if (count > 0) found.set(relative, count);
  }
  return found;
}

async function main() {
  const scanned = scanRawSqlCallSites();
  const registered = new Map(
    RAW_SQL_AUDIT_REGISTRY.map((entry) => [entry.file, entry.sites.reduce((n, s) => n + s.count, 0)]),
  );

  // ── Parser sanity — guard the guard ────────────────────────────────────────
  section('Parser sanity');

  await test('the scanner finds raw SQL at all (a silently-broken scanner would report "all clear")', () => {
    assert.ok(scanned.size >= 15, `expected many raw-SQL files, found ${scanned.size}`);
    assert.ok(rawSqlAuditTotalCallSites() >= 30, 'the registry itself should record a substantial inventory');
  });

  await test('the scanner ignores comment lines (this file mentions $queryRaw in prose)', () => {
    assert.ok(!scanned.has('server/src/utils/readiness.ts'), "readiness.ts's only mention is a doc comment");
  });

  await test('the self-referential exclusions still exist and still name the raw operations', () => {
    for (const relative of SELF_REFERENTIAL_FILES) {
      const source = readFileSync(join(REPO_ROOT, relative), 'utf8');
      assert.match(source, /\$queryRaw/, `${relative} no longer names the raw operations — drop it from the exclusion list`);
    }
  });

  // ── A. Nothing unclassified ────────────────────────────────────────────────
  section('A. Every raw-SQL call site is classified');

  await test('no file contains raw SQL without a registry entry', () => {
    const missing = [...scanned.keys()].filter((file) => !registered.has(file)).sort();
    assert.deepEqual(
      missing,
      [],
      'these files contain raw SQL with no tenant classification. Add them to ' +
        'tenancy/rawSqlAuditRegistry.ts with a justification — the Prisma guard cannot ' +
        `protect raw SQL, so an unreviewed raw path is an unreviewed tenant boundary:\n  ${missing.join('\n  ')}`,
    );
  });

  await test('no registry entry is stale', () => {
    const stale = [...registered.keys()].filter((file) => !scanned.has(file)).sort();
    assert.deepEqual(
      stale,
      [],
      `these registry entries no longer have any raw SQL:\n  ${stale.join('\n  ')}`,
    );
  });

  await test('every registered call-site count matches the source exactly', () => {
    const drift: string[] = [];
    for (const [file, count] of registered) {
      const actual = scanned.get(file);
      if (actual !== undefined && actual !== count) {
        drift.push(`${file}: registry says ${count}, source has ${actual}`);
      }
    }
    assert.deepEqual(
      drift,
      [],
      `raw-SQL call-site counts drifted. A count that grew means a NEW raw statement was added to an\n` +
        `already-reviewed file, which is exactly the case that must not pass silently:\n  ${drift.join('\n  ')}`,
    );
  });

  await test('registry entries are unique and sorted by file', () => {
    const files = RAW_SQL_AUDIT_REGISTRY.map((e) => e.file);
    assert.equal(new Set(files).size, files.length, 'duplicate file entries');
    assert.deepEqual(files, [...files].sort(), 'keep the registry sorted so it diffs cleanly against the scan');
  });

  // ── B. Classification quality ──────────────────────────────────────────────
  section('B. Classifications carry real reasons');

  await test('every call-site group has a non-trivial justification', () => {
    const weak: string[] = [];
    for (const entry of RAW_SQL_AUDIT_REGISTRY) {
      for (const site of entry.sites) {
        if (site.count <= 0) weak.push(`${entry.file}: a group with count ${site.count}`);
        if (site.justification.trim().length < 40) weak.push(`${entry.file}: justification too thin to review`);
      }
    }
    assert.deepEqual(weak, []);
  });

  await test('there are NO unsafe blockers recorded', () => {
    const blockers = rawSqlAuditBlockers().map((e) => e.file);
    assert.deepEqual(
      blockers,
      [],
      'a raw-SQL path classified UNSAFE_BLOCKER is a live cross-tenant risk and must be fixed, ' +
        `not carried:\n  ${blockers.join('\n  ')}`,
    );
  });

  await test('the audited-escape registry keys are unique', () => {
    assert.equal(new Set(RAW_SQL_REGISTRY_KEYS).size, RAW_SQL_REGISTRY_KEYS.length);
  });

  await test('every file classified TENANT_SAFE_EXPLICIT_PREDICATE really does interpolate a tenant predicate', () => {
    // Not a proof of correctness — it is a smoke test that the classification
    // was not applied to a statement with no tenant term in it at all.
    const suspicious: string[] = [];
    for (const entry of RAW_SQL_AUDIT_REGISTRY) {
      if (!entry.sites.some((s) => s.classification === 'TENANT_SAFE_EXPLICIT_PREDICATE')) continue;
      const source = readFileSync(join(REPO_ROOT, entry.file), 'utf8');
      const mentionsTenantTerm =
        /clinicId/i.test(source) || /organizationId/i.test(source) || /clinicScopeSql|clinicFilter|scopeSql/.test(source);
      if (!mentionsTenantTerm) suspicious.push(entry.file);
    }
    assert.deepEqual(suspicious, [], 'classified tenant-safe but the file names no tenant column or scope helper');
  });

  await test('every file classified NO_ROW_ACCESS really is a probe or an advisory lock', () => {
    const suspicious: string[] = [];
    for (const entry of RAW_SQL_AUDIT_REGISTRY) {
      if (!entry.sites.some((s) => s.classification === 'NO_ROW_ACCESS')) continue;
      const source = readFileSync(join(REPO_ROOT, entry.file), 'utf8');
      if (!/advisory_xact_lock|SELECT 1/.test(source)) suspicious.push(entry.file);
    }
    assert.deepEqual(suspicious, [], 'classified NO_ROW_ACCESS but names neither an advisory lock nor a SELECT 1 probe');
  });

  // ── Loud reporting ─────────────────────────────────────────────────────────
  section('Raw-SQL tenant audit summary (reported on every run)');
  const counts = rawSqlAuditCountsByClassification();
  for (const [name, count] of Object.entries(counts)) console.log(`  ${name.padEnd(32)} ${count}`);
  console.log(`  ${'TOTAL CALL SITES'.padEnd(32)} ${rawSqlAuditTotalCallSites()}`);
  console.log(`  ${'FILES'.padEnd(32)} ${RAW_SQL_AUDIT_REGISTRY.length}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
