#!/usr/bin/env bash
# noramedi-pitr-app-smoke.test.sh — F4-FCR-002A-R4
#
# Run with: bash scripts/noramedi-pitr-app-smoke.test.sh
#
# ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
# F4-FCR-002A's second controlled PITR drill restored production, verified the
# PITR stop point, matched 74/74 migrations, passed tenant isolation, and met
# both RPO and RTO — and then failed closed at the application smoke with:
#
#   Unknown property datasources provided to PrismaClient constructor
#
# The deployed runtime is Prisma 7 (server/src/db.ts constructs
# `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`), and
# Prisma 7 removed both `datasourceUrl` and `datasources`. The smoke helper was
# still using them.
#
# scripts/noramedi-pgbackrest.test.sh already covered the helper — but every
# one of its cases bails BEFORE construction (missing env, TCP host, absent
# socket). Nothing in the repository had ever constructed the client, so the
# defect was invisible to the whole suite and only a real restore could find it.
#
# This suite closes that hole. It stands up a FAKE deployed app directory whose
# node_modules/@prisma/{client,adapter-pg} behave like the real ones — including
# rejecting the legacy constructor properties exactly as Prisma 7 does — plus a
# fake unix socket file, and then drives the helper's real construct/connect/
# probe path end to end. No PostgreSQL, no network, no credential.
#
# `set -uo pipefail` WITHOUT -e, matching the sibling shell suites: a failing
# assertion records a failure and continues rather than aborting the run.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE="$SCRIPT_DIR/noramedi-pitr-app-smoke.mjs"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASSED=0
FAILED=0
pass() { PASSED=$((PASSED + 1)); echo "  ok - $1"; }
fail() { FAILED=$((FAILED + 1)); echo "  FAIL - $1"; }
section() { echo; echo "$1"; }

# A value planted in the fake row that findFirst() returns. The helper selects
# every scalar column on purpose (that is what makes it a drift detector) and
# must discard the row. If this string ever reaches stdout or stderr, patient
# data would reach the drill log on a real run.
ROW_CANARY="patient-row-CANARY-d0-n0t-pr1nt-th1s"

if [[ ! -f "$SMOKE" ]]; then
  echo "  FAIL - $SMOKE is missing"
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "  SKIPPED - node is not installed; this suite drives the helper directly and cannot run."
  echo "            Reported rather than silently passing."
  exit 1
fi

PORT=55433
DB=noramedi_crm
DBUSER=postgres

# ── the fake deployed release ────────────────────────────────────────────
# build_app <dir> <client-major> <with-adapter:true|false>
#
# The stub PrismaClient enforces the Prisma 7 contract rather than merely
# recording it: on v7 it THROWS the real "Unknown property ..." message for
# `datasources`/`datasourceUrl` and refuses to construct without an `adapter`.
# That is what makes this a regression test — the superseded helper fails these
# cases for the same reason it failed in production.
#
# Behaviour is steered by env vars read INSIDE the stub, so the helper under
# test needs no test-only hooks of its own:
#   FAKE_PRISMA_TRACE   file the stub appends its observations to
#   FAKE_PRISMA_PORT    value returned by current_setting('port')
#   FAKE_PRISMA_FAIL    "connect" | "probe" | "" (default: succeed)
build_app() {
  local dir="$1" major="$2" with_adapter="$3"
  mkdir -p "$dir/node_modules/@prisma/client" "$dir/prisma/migrations"
  printf '{"name":"server","type":"module"}\n' > "$dir/package.json"
  printf '{"name":"@prisma/client","version":"%s.9.1","main":"index.js"}\n' "$major" \
    > "$dir/node_modules/@prisma/client/package.json"

  cat > "$dir/node_modules/@prisma/client/index.js" <<EOF
'use strict';
const fs = require('node:fs');
const MAJOR = $major;
const trace = (line) => {
  if (process.env.FAKE_PRISMA_TRACE) fs.appendFileSync(process.env.FAKE_PRISMA_TRACE, line + '\n');
};
// The row every findFirst() returns. Selecting all scalars is the point of the
// probe; the helper must throw this away.
const ROW = { id: 1, name: '$ROW_CANARY', email: '$ROW_CANARY@example.invalid' };

function delegate(model) {
  return {
    count: async () => {
      trace('count:' + model);
      if (process.env.FAKE_PRISMA_FAIL === 'probe' && model === 'patient') {
        const e = new Error("The column \`Patient.consentVersion\` does not exist in the current database.");
        e.code = 'P2022';
        throw e;
      }
      return model === 'clinic' ? 3 : model === 'patient' ? 41 : 128;
    },
    findFirst: async () => { trace('findFirst:' + model); return ROW; },
  };
}

class PrismaClient {
  constructor(options) {
    const opts = options || {};
    trace('construct:keys=' + Object.keys(opts).sort().join(','));
    if (MAJOR >= 7) {
      // Verbatim Prisma 7 behaviour, verified against @prisma/client 7.8.0.
      for (const legacy of ['datasources', 'datasourceUrl']) {
        if (legacy in opts) {
          trace('legacy-rejected:' + legacy);
          throw new Error('Unknown property ' + legacy + ' provided to PrismaClient constructor.');
        }
      }
      if (!opts.adapter) {
        trace('no-adapter');
        throw new Error('PrismaClient requires a driver adapter.');
      }
      trace('adapter-connectionString=' + String(opts.adapter.connectionString));
      trace('adapter-max=' + String(opts.adapter.max));
    } else {
      if (opts.adapter) throw new Error('this client does not support driver adapters');
      if (!opts.datasourceUrl && !opts.datasources) throw new Error('no datasource provided');
      trace('legacy-datasourceUrl=' + String(opts.datasourceUrl));
    }
    this.clinic = delegate('clinic');
    this.patient = delegate('patient');
    this.appointment = delegate('appointment');
  }
  async \$connect() {
    trace('connect');
    if (process.env.FAKE_PRISMA_FAIL === 'connect') {
      throw new Error('connect ECONNREFUSED /run/nope/.s.PGSQL.$PORT');
    }
  }
  async \$disconnect() { trace('disconnect'); }
  async \$queryRawUnsafe(sql) {
    trace('raw:' + sql);
    return [{ v: String(process.env.FAKE_PRISMA_PORT || '') }];
  }
}
module.exports = { PrismaClient };
EOF

  if [[ "$with_adapter" == true ]]; then
    mkdir -p "$dir/node_modules/@prisma/adapter-pg"
    printf '{"name":"@prisma/adapter-pg","version":"%s.9.1","main":"index.js"}\n' "$major" \
      > "$dir/node_modules/@prisma/adapter-pg/package.json"
    cat > "$dir/node_modules/@prisma/adapter-pg/index.js" <<'EOF'
'use strict';
const fs = require('node:fs');
class PrismaPg {
  constructor(config) {
    const cfg = config || {};
    if (process.env.FAKE_PRISMA_TRACE) {
      fs.appendFileSync(process.env.FAKE_PRISMA_TRACE, 'PrismaPg:' + String(cfg.connectionString) + '\n');
    }
    this.connectionString = cfg.connectionString;
    this.max = cfg.max;
    this.connectionTimeoutMillis = cfg.connectionTimeoutMillis;
  }
}
module.exports = { PrismaPg };
EOF
  fi
}

# A plain file named .s.PGSQL.<port> satisfies the helper's existsSync check;
# nothing in this suite ever opens it, because nothing ever really connects.
make_socket() {
  local d="$1"
  mkdir -p "$d"
  : > "$d/.s.PGSQL.$PORT"
}

OUT=""
CODE=0
TRACE=""
# run_smoke <app-dir> <socket-dir> [extra env assignments...]
run_smoke() {
  local app="$1" sock="$2"; shift 2
  TRACE="$WORK/trace.$RANDOM"
  : > "$TRACE"
  set +e
  # `env -i` deliberately: PATH plus exactly the documented inputs and nothing
  # else. It is also how "no PGPASSWORD is required" is proven rather than
  # asserted — there is no PGPASSWORD in this environment to fall back on, and
  # no DATABASE_URL either.
  OUT="$(env -i PATH="$PATH" HOME="$WORK" \
    FAKE_PRISMA_TRACE="$TRACE" \
    NORAMEDI_SMOKE_APP_DIR="$app" \
    NORAMEDI_SMOKE_SOCKET_DIR="$sock" \
    NORAMEDI_SMOKE_PORT="$PORT" \
    NORAMEDI_SMOKE_DB="$DB" \
    NORAMEDI_SMOKE_USER="$DBUSER" \
    "$@" node "$SMOKE" 2>&1)"
  CODE=$?
  set -e
}

APP7="$WORK/app-prisma7"
APP7_NOADAPTER="$WORK/app-prisma7-no-adapter"
APP6="$WORK/app-prisma6"
SOCK="$WORK/sock"
build_app "$APP7" 7 true
build_app "$APP7_NOADAPTER" 7 false
build_app "$APP6" 6 false
make_socket "$SOCK"

# ════════════════════════════════════════════════════════════════════════
section "A. The deployed Prisma 7 driver-adapter path is the one that runs"

run_smoke "$APP7" "$SOCK" FAKE_PRISMA_PORT="$PORT"
[[ "$OUT" == *"APP_SMOKE_RESULT passed"* ]] \
  && pass "a Prisma 7 deployed client is constructed successfully and the smoke passes" \
  || fail "the Prisma 7 path did not pass (code=$CODE): $OUT"
[[ "$CODE" -eq 0 ]] && pass "the passing run exits 0" || fail "expected exit 0, got $CODE"
grep -q '^construct:keys=adapter,log$' "$TRACE" \
  && pass "PrismaClient received exactly { adapter, log } — the same family as server/src/db.ts" \
  || fail "constructor options were not { adapter, log }: $(grep '^construct:keys=' "$TRACE")"
grep -q '^PrismaPg:' "$TRACE" \
  && pass "the adapter is a PrismaPg built from the DEPLOYED @prisma/adapter-pg" \
  || fail "PrismaPg was never constructed"
grep -q '^adapter-max=1$' "$TRACE" \
  && pass "the adapter pool is capped at 1 connection" \
  || fail "pool size is not 1: $(grep '^adapter-max=' "$TRACE")"

# ── the regression itself ───────────────────────────────────────────────
# The superseded helper reached this stub with `datasourceUrl` and then with
# `datasources`, and the stub throws the production error for both. If anyone
# reintroduces either as the v7 path, these two assertions fail.
section "B. The legacy datasourceUrl/datasources contract is NOT used on Prisma 7"

! grep -q '^legacy-rejected:' "$TRACE" \
  && pass "no legacy constructor property was offered to the Prisma 7 client (the F4-FCR-002A-R4 defect)" \
  || fail "a legacy property was still offered: $(grep '^legacy-rejected:' "$TRACE")"
! grep -q '^legacy-datasourceUrl=' "$TRACE" \
  && pass "the v7 run never falls through to the datasourceUrl branch" \
  || fail "the datasourceUrl branch ran against a v7 client"
[[ "$OUT" != *"Unknown property"* ]] \
  && pass "the production failure message no longer appears anywhere in the output" \
  || fail "the drill's exact failure reproduced: $OUT"

# Version-awareness, not a catch-all: a pre-7 deployed client (a rollback) must
# still get a real smoke, via the contract THAT client actually has.
run_smoke "$APP6" "$SOCK" FAKE_PRISMA_PORT="$PORT"
[[ "$OUT" == *"APP_SMOKE_RESULT passed"* ]] \
  && pass "a Prisma 6 deployed client still smokes, through datasourceUrl" \
  || fail "the pre-7 fallback is broken (code=$CODE): $OUT"
grep -q '^legacy-datasourceUrl=postgresql://' "$TRACE" \
  && pass "the pre-7 path is selected by the deployed VERSION, not by catching a construction error" \
  || fail "the v6 client was not given datasourceUrl: $(cat "$TRACE")"
grep -q '^construct:keys=datasourceUrl,log$' "$TRACE" \
  && pass "the pre-7 client is never offered an adapter it cannot use" \
  || fail "unexpected v6 constructor options: $(grep '^construct:keys=' "$TRACE")"

# The version is the only thing selecting the path, so failing to read it must
# not silently pick one. It must refuse.
APP_NOVER="$WORK/app-no-version"
build_app "$APP_NOVER" 7 true
printf '{"name":"@prisma/client","main":"index.js"}\n' > "$APP_NOVER/node_modules/@prisma/client/package.json"
run_smoke "$APP_NOVER" "$SOCK" FAKE_PRISMA_PORT="$PORT"
[[ "$OUT" == *"APP_SMOKE_RESULT failed"* && "$OUT" == *"refusing to guess"* ]] \
  && pass "an unreadable deployed client version fails closed rather than guessing a contract" \
  || fail "an unknown version did not fail closed: $OUT"
[[ ! -s "$TRACE" ]] \
  && pass "no client is constructed when the contract is unknown" \
  || fail "a client was constructed on an unknown version: $(cat "$TRACE")"

# A package whose `exports` map does not publish ./package.json must still be
# readable — otherwise a future Prisma release would turn this stage into a
# false failure on a restore that is actually fine.
APP_SEALED="$WORK/app-sealed-exports"
build_app "$APP_SEALED" 7 true
printf '{"name":"@prisma/client","version":"7.9.1","main":"index.js","exports":{".":"./index.js"}}\n' \
  > "$APP_SEALED/node_modules/@prisma/client/package.json"
run_smoke "$APP_SEALED" "$SOCK" FAKE_PRISMA_PORT="$PORT"
[[ "$OUT" == *"APP_SMOKE_RESULT passed"* ]] \
  && pass "the version is still resolved when the package seals off ./package.json in exports" \
  || fail "a sealed exports map broke version detection: $OUT"
grep -q '^construct:keys=adapter,log$' "$TRACE" \
  && pass "the sealed-exports client still takes the driver-adapter path" \
  || fail "the fallback selected the wrong contract: $(grep '^construct:keys=' "$TRACE")"

# ════════════════════════════════════════════════════════════════════════
section "C. The connection targets the supplied drill socket, never production"

run_smoke "$APP7" "$SOCK" FAKE_PRISMA_PORT="$PORT"
CONNSTR="$(sed -n 's/^PrismaPg://p' "$TRACE" | head -n1)"
# Encoded with encodeURIComponent, not a sed substitution, so the expectation
# is produced the same way the helper produces it. (A hand-rolled `s:/:%2F:g`
# silently omits the drive-letter colon when this suite runs on Git Bash.)
SOCK_ENC="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$SOCK")"
[[ "$CONNSTR" == *"host=$SOCK_ENC"* ]] \
  && pass "the connection string carries the drill socket directory as a percent-encoded host" \
  || fail "socket directory missing from the connection string: $CONNSTR"
[[ "$CONNSTR" == *":$PORT/"* ]] \
  && pass "the connection string selects the drill port ($PORT), which picks .s.PGSQL.$PORT" \
  || fail "drill port missing from the connection string: $CONNSTR"
[[ "$CONNSTR" != *"5432"* ]] \
  && pass "the connection string never names the production port" \
  || fail "the production port appears in the connection string: $CONNSTR"
grep -q "^raw:SELECT current_setting('port')" "$TRACE" \
  && pass "the raw current_setting('port') assertion still runs through the same client" \
  || fail "the drill-cluster proof query was not issued"

# The port assertion must be able to FAIL. A client that reached production
# would answer 5432, and this stage is the only thing that would notice.
run_smoke "$APP7" "$SOCK" FAKE_PRISMA_PORT=5432
[[ "$OUT" == *"APP_SMOKE_RESULT failed"* && "$OUT" == *"NOT the drill cluster"* ]] \
  && pass "a client answering the production port fails the smoke closed" \
  || fail "a wrong-cluster connection was accepted (code=$CODE): $OUT"
[[ "$CODE" -ne 0 ]] && pass "a wrong-cluster run exits non-zero" || fail "expected non-zero exit"

# ════════════════════════════════════════════════════════════════════════
section "D. A missing drill socket fails closed"

run_smoke "$APP7" "$WORK/no-such-socket-dir" FAKE_PRISMA_PORT="$PORT"
[[ "$OUT" == *"APP_SMOKE_RESULT failed"* && "$OUT" == *"no unix socket"* ]] \
  && pass "an absent .s.PGSQL.<port> is a failure, not a skip" \
  || fail "a missing socket was not refused: $OUT"
[[ ! -s "$TRACE" ]] \
  && pass "the socket check runs BEFORE any client is constructed" \
  || fail "the client was constructed despite a missing socket: $(cat "$TRACE")"

run_smoke "$APP7" "127.0.0.1" FAKE_PRISMA_PORT="$PORT"
[[ "$OUT" == *"refusing to connect over TCP"* ]] \
  && pass "a non-absolute socket directory is still refused (no TCP path exists)" \
  || fail "a TCP host was not refused: $OUT"

# ════════════════════════════════════════════════════════════════════════
section "E. A missing deployed @prisma/adapter-pg fails closed"

run_smoke "$APP7_NOADAPTER" "$SOCK" FAKE_PRISMA_PORT="$PORT"
[[ "$OUT" == *"APP_SMOKE_RESULT failed"* ]] \
  && pass "a v7 deployed client with no @prisma/adapter-pg fails the smoke" \
  || fail "a missing adapter did not fail the stage: $OUT"
[[ "$OUT" == *"adapter-pg"* ]] \
  && pass "the failure names the missing package, so the operator knows what to install" \
  || fail "the reason does not identify the adapter: $OUT"
[[ "$CODE" -ne 0 ]] && pass "a missing-adapter run exits non-zero" || fail "expected non-zero exit"
! grep -q '^connect$' "$TRACE" \
  && pass "no connection is attempted once construction is known to be impossible" \
  || fail "the helper connected anyway"

# The drill must catch this before it spends a restore on it.
DRILL="$SCRIPT_DIR/noramedi-pgbackrest-restore-drill.sh"
grep -q 'node_modules/@prisma/adapter-pg' "$DRILL" \
  && pass "the restore drill pre-flights @prisma/adapter-pg before restoring anything" \
  || fail "the drill does not check for the deployed adapter"

# ════════════════════════════════════════════════════════════════════════
section "F. A typed delegate probe failure fails the smoke"

run_smoke "$APP7" "$SOCK" FAKE_PRISMA_PORT="$PORT" FAKE_PRISMA_FAIL=probe
[[ "$OUT" == *"APP_SMOKE_RESULT failed"* ]] \
  && pass "a typed query failure on the restored schema is reported failed" \
  || fail "a P2022 drift error did not fail the smoke: $OUT"
[[ "$OUT" == *"P2022"* ]] \
  && pass "the Prisma error code is preserved — schema drift is distinguishable from a connection fault" \
  || fail "the error code was dropped: $OUT"
[[ "$OUT" == *"'patient'"* ]] \
  && pass "the failing model is named" \
  || fail "the failing model is not identified: $OUT"

run_smoke "$APP7" "$SOCK" FAKE_PRISMA_PORT="$PORT" FAKE_PRISMA_FAIL=connect
[[ "$OUT" == *"APP_SMOKE_RESULT failed"* && "$OUT" == *"could not connect"* ]] \
  && pass "a connect failure is reported distinctly from a schema failure" \
  || fail "the connect failure was misreported: $OUT"

# ════════════════════════════════════════════════════════════════════════
section "G. Exactly one APP_SMOKE_RESULT line, on every path"

for scenario in "pass:FAKE_PRISMA_PORT=$PORT" "wrong-port:FAKE_PRISMA_PORT=5432" \
                "probe:FAKE_PRISMA_PORT=$PORT FAKE_PRISMA_FAIL=probe" \
                "connect:FAKE_PRISMA_PORT=$PORT FAKE_PRISMA_FAIL=connect"; do
  label="${scenario%%:*}"
  # shellcheck disable=SC2086
  run_smoke "$APP7" "$SOCK" ${scenario#*:}
  n="$(grep -c '^APP_SMOKE_RESULT ' <<<"$OUT")"
  [[ "$n" -eq 1 ]] \
    && pass "exactly one contract line on the '$label' path" \
    || fail "'$label' emitted $n contract lines: $OUT"
done

run_smoke "$APP7" "$SOCK" FAKE_PRISMA_PORT="$PORT"
[[ "$(grep -c '^APP_SMOKE_RESULT passed' <<<"$OUT")" -eq 1 ]] \
  && pass "the successful path emits exactly one 'passed' line" \
  || fail "wrong number of passed lines: $OUT"
[[ "$OUT" == *"clinics=3 patients=41 appointments=128 connectedTo=drill"* ]] \
  && pass "the passed line reports counts and the drill-cluster proof" \
  || fail "unexpected passed detail: $OUT"

# ════════════════════════════════════════════════════════════════════════
section "H. No row content ever leaves the process"

run_smoke "$APP7" "$SOCK" FAKE_PRISMA_PORT="$PORT"
[[ "$OUT" != *"$ROW_CANARY"* ]] \
  && pass "the row returned by findFirst() never reaches stdout or stderr on the passing path" \
  || fail "ROW CANARY LEAKED: $OUT"
grep -q '^findFirst:patient$' "$TRACE" \
  && pass "the schema-drift probe genuinely ran (the canary was returned and discarded)" \
  || fail "findFirst() was not called — the drift probe is not exercised"
for m in clinic patient appointment; do
  grep -q "^count:$m$" "$TRACE" && grep -q "^findFirst:$m$" "$TRACE" \
    && pass "typed count()+findFirst() probes both run for '$m'" \
    || fail "the '$m' probes did not both run"
done

# The failure paths are where a row value would most plausibly escape, inside
# an error message. Run them all and check the canary against every one.
LEAKED=false
for extra in "FAKE_PRISMA_PORT=5432" "FAKE_PRISMA_PORT=$PORT FAKE_PRISMA_FAIL=probe" \
             "FAKE_PRISMA_PORT=$PORT FAKE_PRISMA_FAIL=connect"; do
  # shellcheck disable=SC2086
  run_smoke "$APP7" "$SOCK" $extra
  [[ "$OUT" == *"$ROW_CANARY"* ]] && LEAKED=true
done
[[ "$LEAKED" == false ]] \
  && pass "no failure path prints row content either" \
  || fail "ROW CANARY LEAKED on a failure path"

# ════════════════════════════════════════════════════════════════════════
section "I. No credential is required or referenced"

# Every run above already went through `env -i` — no PGPASSWORD, no
# DATABASE_URL, no PGSERVICEFILE — and the passing case passed anyway.
run_smoke "$APP7" "$SOCK" FAKE_PRISMA_PORT="$PORT"
[[ "$OUT" == *"APP_SMOKE_RESULT passed"* ]] \
  && pass "the smoke passes in an environment with no PGPASSWORD and no DATABASE_URL at all" \
  || fail "the smoke needs something beyond its documented inputs: $OUT"
[[ "$CONNSTR" != *":"*"@"*":"* || "$CONNSTR" == "postgresql://$DBUSER@"* ]] \
  && pass "the connection string carries a role and no password (peer auth needs none)" \
  || fail "the connection string appears to contain a password: $CONNSTR"
grep -q 'PGPASSWORD' "$SMOKE" && fail "the helper references PGPASSWORD" \
  || pass "the helper never references PGPASSWORD"
# Matches a READ of the variable, not the prose explaining why it is never read
# — `env.DATABASE_URL` / `env['DATABASE_URL']` are the only ways to reach it.
grep -qE "env\.DATABASE_URL|env\[['\"]DATABASE_URL" "$SMOKE" \
  && fail "the helper reads DATABASE_URL — it must never resolve production's" \
  || pass "the helper never reads DATABASE_URL (importing server/src/db.ts would have)"
grep -qE "require\(['\"]\.\./server|from ['\"].*server/src/db" "$SMOKE" \
  && fail "the helper imports the application's own db module, which resolves the production URL" \
  || pass "the helper does not import server/src/db.ts"

# ════════════════════════════════════════════════════════════════════════
section "Summary"
echo "─────────────────────────────────────────"
echo "Results: $PASSED passed, $FAILED failed"
[[ "$FAILED" -eq 0 ]] || exit 1
