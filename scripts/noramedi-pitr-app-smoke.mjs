#!/usr/bin/env node
// noramedi-pitr-app-smoke.mjs — F4-FCR-002A
// Deploy alongside: /usr/local/sbin/noramedi-pgbackrest-restore-drill.sh
//
// Application-level smoke test for a RESTORED, DISPOSABLE PostgreSQL cluster.
// Invoked only by noramedi-pgbackrest-restore-drill.sh, as the unprivileged
// drill OS user, over the drill's mode-0700 unix socket.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────
// The drill's SQL checks prove that a cluster starts and that a handful of
// tables are countable. They do not prove that the code production actually
// runs can use the restored database. Those are different claims: a restore
// whose schema has drifted from the deployed Prisma client passes every
// count(*) and fails on the first real query the API makes.
//
// So this loads the DEPLOYED release's own generated Prisma client — the one
// in the production server directory's node_modules, not a copy, not a fresh
// generate — and issues typed queries through it. A column the client expects
// and the restore does not have surfaces here (Prisma P2022) and nowhere else.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
//   - It never starts the application. No express app, no HTTP listener, no
//     job runner, no worker. Only the Prisma client module is imported.
//   - It never writes. Every query is a read.
//   - It never prints row content. `findFirst()` deliberately selects ALL
//     scalar columns, because that is what makes it a schema-drift detector,
//     and the returned row is discarded without being inspected, logged, or
//     serialised. Only counts and booleans leave this process.
//   - It never touches production: the connection URL is a unix socket path
//     inside the drill root, and the script refuses to run without one.
//
// Contract with the caller: exactly one line beginning `APP_SMOKE_RESULT ` is
// written to stdout. Everything else on stdout/stderr is diagnostic.
//
// Environment (all set by the drill script):
//   NORAMEDI_SMOKE_APP_DIR     deployed server directory (has package.json,
//                              prisma/migrations, node_modules)
//   NORAMEDI_SMOKE_SOCKET_DIR  the drill cluster's unix socket directory
//   NORAMEDI_SMOKE_PORT        the drill cluster's port
//   NORAMEDI_SMOKE_DB          database name to connect to
//   NORAMEDI_SMOKE_USER        role to connect as (peer-mapped)
//   NORAMEDI_SMOKE_TIMEOUT_MS  optional, default 120000

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const E = process.env;
const TIMEOUT_MS = Number.parseInt(E.NORAMEDI_SMOKE_TIMEOUT_MS ?? '120000', 10) || 120000;

/**
 * Errors from a read-only query cannot carry row values the way a write
 * conflict can ("Key (email)=(...)"), but this is the one place a restored
 * database's contents could reach a log, so the reason string is capped and
 * reduced to printable ASCII before it is emitted.
 */
function sanitize(message) {
  return String(message ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

// Written with fs.writeSync so the contract line cannot be lost to an
// unflushed stdout pipe when the process exits — the caller greps for exactly
// this line and treats its absence as a failure of the whole stage.
let emitted = false;
function emit(status, detail) {
  if (emitted) return;
  emitted = true;
  fs.writeSync(1, `APP_SMOKE_RESULT ${status}${detail ? ' ' + detail : ''}\n`);
}

/** Marker for "this stage has already decided it failed"; carries no data. */
class SmokeFailure extends Error {}

function bail(reason) {
  emit('failed', `reason="${sanitize(reason)}"`);
  throw new SmokeFailure('smoke failed');
}

/** For the pre-flight checks that run before the async body. */
function bailSync(reason) {
  emit('failed', `reason="${sanitize(reason)}"`);
  process.exitCode = 1;
  process.exit(1);
}

const appDir = E.NORAMEDI_SMOKE_APP_DIR;
const sockDir = E.NORAMEDI_SMOKE_SOCKET_DIR;
const port = E.NORAMEDI_SMOKE_PORT;
const dbName = E.NORAMEDI_SMOKE_DB;
const dbUser = E.NORAMEDI_SMOKE_USER;

if (!appDir || !sockDir || !port || !dbName || !dbUser) {
  bailSync('missing required environment (APP_DIR/SOCKET_DIR/PORT/DB/USER)');
}
// A hostname or IP here would mean connecting to something other than the
// drill's own socket — including, if it were ever 5432 on localhost,
// production. Only an absolute filesystem path is accepted.
if (!path.isAbsolute(sockDir)) {
  bailSync('socket directory must be an absolute path; refusing to connect over TCP');
}
if (!fs.existsSync(path.join(sockDir, `.s.PGSQL.${port}`))) {
  bailSync(`no unix socket .s.PGSQL.${port} in ${sockDir}`);
}

// Resolve the DEPLOYED release's Prisma client, not this script's own
// dependencies. createRequire anchored at the app's package.json walks the
// app's node_modules, so `@prisma/client` is whatever production has
// installed and generated — which is the entire point of the check.
let PrismaClient;
try {
  const appRequire = createRequire(pathToFileURL(path.join(appDir, 'package.json')));
  ({ PrismaClient } = appRequire('@prisma/client'));
} catch (err) {
  bailSync(`could not load the deployed @prisma/client from ${appDir}: ${err && err.message}`);
}
if (typeof PrismaClient !== 'function') {
  bailSync(`the deployed @prisma/client did not export a PrismaClient constructor`);
}

// Unix-socket connection string. `host` is percent-encoded because the path
// is a query-string value; libpq/Prisma reads it as the socket directory and
// the port selects the .s.PGSQL.<port> file inside it. No password: the drill
// cluster authenticates by peer (kernel-verified UID) over a mode-0700 socket
// directory, so there is no credential for this process to hold or leak.
const url =
  `postgresql://${encodeURIComponent(dbUser)}@localhost:${encodeURIComponent(port)}` +
  `/${encodeURIComponent(dbName)}?host=${encodeURIComponent(sockDir)}&connection_limit=1`;

let prisma;
try {
  prisma = new PrismaClient({ datasourceUrl: url, log: [] });
} catch (_) {
  try {
    // Older generated clients predate `datasourceUrl`.
    prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
  } catch (err) {
    bailSync(`could not construct the deployed PrismaClient: ${err && err.message}`);
  }
}

// A hung connect must not stall the drill, which is holding a PHI-bearing
// cluster in RAM while this runs. The line is written synchronously first, so
// the hard exit cannot lose it.
const timer = setTimeout(() => {
  emit('failed', 'reason="application smoke timed out"');
  process.exit(1);
}, TIMEOUT_MS);

/**
 * Typed reads through the deployed client. `findFirst()` with no `select` is
 * intentional: it materialises every scalar column the generated client knows
 * about, so a restore missing any of them throws instead of quietly passing.
 * The row is discarded — never read, never printed.
 */
async function probeModel(delegate, name) {
  const count = await delegate.count();
  await delegate.findFirst(); // schema-drift probe; result deliberately unused
  return { name, count };
}

async function main() {
  // A connectivity failure and a schema failure must not be reported the same
  // way: the operator's next action differs completely.
  try {
    await prisma.$connect();
  } catch (err) {
    bail(`the deployed Prisma client could not connect to the restored database: ${err && err.message}`);
  }

  const probes = [
    ['clinic', prisma.clinic],
    ['patient', prisma.patient],
    ['appointment', prisma.appointment],
  ];
  const missing = probes.filter(([, d]) => !d || typeof d.count !== 'function').map(([n]) => n);
  if (missing.length) {
    bail(`the deployed Prisma client has no delegate for: ${missing.join(',')} — the client and the schema disagree`);
  }

  const results = [];
  for (const [name, delegate] of probes) {
    try {
      results.push(await probeModel(delegate, name));
    } catch (err) {
      const code = (err && err.code) ? `${err.code} ` : '';
      bail(`${code}typed query against '${name}' failed on the restored schema: ${err && err.message}`);
    }
  }

  // One raw query, run through the same client, so the result also proves the
  // connection reached the DRILL cluster and not something else.
  let onDrillCluster = false;
  try {
    const rows = await prisma.$queryRawUnsafe("SELECT current_setting('port') AS v");
    onDrillCluster = String(rows?.[0]?.v ?? '') === String(port);
  } catch (err) {
    bail(`raw query against the restored database failed: ${err && err.message}`);
  }
  if (!onDrillCluster) {
    bail('the deployed Prisma client connected to a cluster that is NOT the drill cluster');
  }

  const detail = results.map(r => `${r.name}s=${r.count}`).join(' ');
  emit('passed', `${detail} connectedTo=drill`);
}

// process.exitCode rather than process.exit: the result line is already on fd
// 1 synchronously, and letting Node unwind normally lets $disconnect release
// the connection instead of leaving a backend for the drill's teardown.
main()
  .catch(err => {
    if (!(err instanceof SmokeFailure)) {
      emit('failed', `reason="${sanitize(`unexpected failure: ${err && err.message}`)}"`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(timer);
    try { await prisma?.$disconnect(); } catch (_) { /* teardown must not mask the result */ }
  });
