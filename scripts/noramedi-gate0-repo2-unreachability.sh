#!/usr/bin/env bash
# NoraMedi — Gate 0: repo2 unreachability / WAL backpressure failure semantics.
#
# WHAT THIS ANSWERS
# =================
# Runbook §16.5 ("Gate 0 — scratch host first. Not optional.") names one
# question and does not answer it:
#
#     An unreachable repo2 can stall `archive-push`, grow `pg_wal`, and shut
#     PostgreSQL down. That is a production outage, not a documentation
#     nicety, and it is the single most likely way this activation takes
#     production down.
#
# The same question is restated at ops/pgbackrest/pgbackrest.conf.example and
# in the F4 phase document, and is answered in none of the three. Until this
# script existed, "Gate 0" was four comment lines inside a section headed
# NOT EXECUTED.
#
# The load-bearing unknown is NOT durability. It is a property of the
# pgBackRest binary's multi-repository logic:
#
#     When one of N configured repositories is unreachable, does archive-push
#     FAIL THE COMMAND, or does it return success having written only the
#     repositories it could reach?
#
# If it returns success, PostgreSQL marks the segment archived and eventually
# recycles it. The off-host chain then has a permanent hole while every
# dashboard stays green — the silent-failure class this program's entire
# evidence design exists to prevent. That outcome BLOCKS repo2 activation on
# the affected build, and it is why this must be established before production
# points at anything remote.
#
# WHY THIS NEEDS NO SECOND VPS
# ============================
# Gate 0 asks a failure-mode question, not a durability question. From the
# pushing process's point of view "repo2 is unreachable" is indistinguishable
# between a dead VPS and a severed container network; the transport changes
# only how long the error takes. R-030-DB genuinely requires an independent
# failure domain. Gate 0 does not, and conflating the two is what would make
# this experiment look impossible to run.
#
# WHAT IT DELIBERATELY DOES NOT PROVE
# ===================================
#   * Nothing about off-host DURABILITY. A severed docker network is a
#     faithful model of unreachability and no model at all of an independent
#     failure domain. This script cannot advance R-030, R-030-DB or
#     R-030-FILES, and cannot satisfy FIRST_CUSTOMER_RECOVERY_GATE.
#   * Nothing about PRODUCTION's WAL rate. Load here is synthetic and
#     deliberately accelerated. Only the retention MECHANISM and the
#     slope-under-stall transfer; the absolute bytes/second do not.
#   * Nothing about production's installed pgBackRest build unless the
#     operator confirms version parity (CHECKPOINT 1). Results are classified
#     OBSERVED_LOCAL_ONLY and carry the exact build string that produced them.
#
# SAFETY
# ======
# Synthetic data only. The measurement network is `--internal`, so the
# experiment provably cannot reach production or any real endpoint. Every
# container carries the com.noramedi.test-runtime label set the existing
# sweeper already reclaims. Passphrases are per-run random and never printed.
#
# USAGE
#   scripts/noramedi-gate0-repo2-unreachability.sh --mode smoke
#   scripts/noramedi-gate0-repo2-unreachability.sh --mode full --summary-file out.json
#
#   --mode smoke   Short windows. Establishes the archive-push failure mode,
#                  WAL retention and backlog drain. Does NOT run to disk
#                  exhaustion, so it cannot answer monitoring sufficiency.
#   --mode full    Adds the exhaustion arm and the monitoring-threshold replay.
#   --keep         Do not tear down (debugging only; you must clean up).
#   --allow-missing-repo2-backup
#                  Continue when the repo2 BASE BACKUP cannot be taken on the
#                  pinned build (2.50 refuses it on the PostgreSQL host). The
#                  archive-push question is still answered — it depends on the
#                  stanza, which the hard gate already proved — but the outcome
#                  is capped at PASS_ARCHIVE_SEMANTICS_ONLY and repo2
#                  restorability is explicitly NOT tested. Off by default.
#   --summary-file PATH   Write the JSON summary here instead of stdout.
#   --samples-file PATH   Also copy the raw per-tick NDJSON samples here. The
#                  scratch directory is destroyed on cleanup, so without this
#                  the only surviving evidence is the classified summary.
#
# ── VERSION PARITY (F4-FCR-003-R1) ────────────────────────────────────────
#   --pgbackrest-version VER   Install exactly this pgBackRest, e.g. 2.50.
#   --postgres-image IMAGE     Base image, e.g. postgres:16.14-bookworm.
#
# Both default to "whatever is current", which is what the first Gate 0 run
# used and is NOT a parity claim. The failure semantics this experiment
# measures are a property of the pgBackRest BINARY's multi-repository logic, so
# a result carries only to the build that produced it. Production runs its own
# build, and until this harness can be pointed at that exact version the local
# result cannot be reasoned about as if it were production's.
#
# Pinning resolves through the PostgreSQL APT ARCHIVE
# (apt-archive.postgresql.org), which retains superseded PGDG builds; the live
# PGDG repository keeps only the newest two. If the requested version is not
# resolvable the build FAILS with PGBACKREST_PIN_UNAVAILABLE and this script
# exits 3. It never silently falls back to the current build — a Gate 0 result
# labelled 2.50 that actually ran on 2.59 would be worse than no result. The
# summary records the version REQUESTED alongside the version OBSERVED, so the
# two can never be conflated by a later reader.
#
# ENVIRONMENT
#   NORAMEDI_GATE0_SAMPLE_INTERVAL        default 5   seconds between samples
#   NORAMEDI_GATE0_WAL_SWITCH_INTERVAL    default 15  seconds between forced
#     WAL switches. archive-push runs once per COMPLETED segment, so without a
#     forced boundary a short outage window can contain no archive attempt at
#     all and classify INDETERMINATE on a perfectly healthy experiment. See
#     switcher_start().
#   NORAMEDI_GATE0_PGBACKREST_VERSION     same as --pgbackrest-version
#   NORAMEDI_GATE0_POSTGRES_IMAGE         same as --postgres-image
#
# EXIT CODES
#   0  the experiment ran and its evidence is complete (this includes
#      PASS_ARCHIVE_SEMANTICS_ONLY — see --allow-missing-repo2-backup)
#   2  usage error
#   3  precondition failed (docker unusable, build too old, repo2 unhealthy,
#      or the requested pgBackRest version could not be installed)
#   4  ABORTED on a safety condition
#   5  ran but evidence is incomplete => GATE0 = INCONCLUSIVE, never PASS

set -euo pipefail

# Git Bash / MSYS rewrites arguments that look like absolute POSIX paths into
# Windows paths before exec, so `--mount destination=/srv` reaches dockerd as
# 'C:/Program Files/Git/srv' and the daemon rejects it. Every absolute path in
# this script is a path INSIDE a Linux container, never on the host, so the
# conversion is always wrong here. No effect on Linux or macOS.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

USAGE_EXIT=2
PRECONDITION_EXIT=3
ABORT_EXIT=4
INCONCLUSIVE_EXIT=5

MODE="smoke"
KEEP=false
ALLOW_MISSING_REPO2_BACKUP=false
SUMMARY_FILE=""
SAMPLES_FILE=""
SAMPLE_INTERVAL="${NORAMEDI_GATE0_SAMPLE_INTERVAL:-5}"
PGBR_PIN="${NORAMEDI_GATE0_PGBACKREST_VERSION:-}"
PG_IMAGE="${NORAMEDI_GATE0_POSTGRES_IMAGE:-postgres:16-bookworm}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)                MODE="${2:-}"; shift 2 ;;
    --summary-file)        SUMMARY_FILE="${2:-}"; shift 2 ;;
    --samples-file)        SAMPLES_FILE="${2:-}"; shift 2 ;;
    --pgbackrest-version)  PGBR_PIN="${2:-}"; shift 2 ;;
    --postgres-image)      PG_IMAGE="${2:-}"; shift 2 ;;
    --keep)                KEEP=true; shift ;;
    --allow-missing-repo2-backup) ALLOW_MISSING_REPO2_BACKUP=true; shift ;;
    -h|--help)      sed -n '2,120p' "$0"; exit 0 ;;
    *) echo "Unknown argument '$1'" >&2; exit "$USAGE_EXIT" ;;
  esac
done

case "$MODE" in
  smoke|full) ;;
  *) echo "Invalid --mode '$MODE' (expected smoke|full)" >&2; exit "$USAGE_EXIT" ;;
esac

# Both values are interpolated into a Dockerfile and a `docker build --build-arg`,
# so both are constrained to an identifier-shaped charset rather than trusted.
if [[ -n "$PGBR_PIN" ]] && [[ ! "$PGBR_PIN" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
  echo "Invalid --pgbackrest-version '$PGBR_PIN' (expected MAJOR.MINOR[.PATCH], e.g. 2.50)" >&2
  exit "$USAGE_EXIT"
fi
if [[ ! "$PG_IMAGE" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*:[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "Invalid --postgres-image '$PG_IMAGE' (expected name:tag)" >&2
  exit "$USAGE_EXIT"
fi

case "$MODE" in
  smoke) BASELINE_S=60;  OUTAGE_S=180; RECOVERY_S=180 ;;
  full)  BASELINE_S=600; OUTAGE_S=3600; RECOVERY_S=1800 ;;
esac

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()  { echo "[gate0] $(ts) $*"; }
fail() { echo "[gate0] $(ts) FAIL — $*" >&2; }

# ── SAFETY PRECONDITIONS ──────────────────────────────────────────────────
# Each of these is an ABORT, not a warning. A Gate 0 run that touched a
# non-local engine would be an incident, not a bad test.
command -v docker >/dev/null 2>&1 || { fail "docker not found"; exit "$PRECONDITION_EXIT"; }

DOCKER_CTX="$(docker context show 2>/dev/null || echo unknown)"
case "$DOCKER_CTX" in
  default|desktop-linux|colima|rancher-desktop) ;;
  *) fail "docker context is '$DOCKER_CTX' — refusing to run against a context this script cannot prove is local. A remote engine could place synthetic clusters on real infrastructure."; exit "$ABORT_EXIT" ;;
esac

DOCKER_SERVER="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
[[ -n "$DOCKER_SERVER" ]] || { fail "docker engine unreachable"; exit "$PRECONDITION_EXIT"; }
DOCKER_OSARCH="$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}' 2>/dev/null || echo unknown)"
[[ "$DOCKER_OSARCH" == linux/* ]] || { fail "docker server is '$DOCKER_OSARCH'; this experiment needs a linux engine"; exit "$PRECONDITION_EXIT"; }

RUN="$(date -u +%Y%m%dT%H%M%SZ)-$$"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/nmgate0-XXXXXX")"
NET="nmgate0-net-$RUN"
PGC="nmgate0-pg-$RUN"
R2C="nmgate0-repo2-$RUN"
IMG="nmgate0:$RUN"
SAMPLES="$SCRATCH/samples.ndjson"
: > "$SAMPLES"

LBL=(--label com.noramedi.test-runtime=true
     --label "com.noramedi.test-run-id=$RUN"
     --label com.noramedi.test-profile=gate0
     --label "com.noramedi.test-created-at=$(ts)"
     --label com.noramedi.test-task=F4-FCR-003-GATE0)

# Never echoed. `openssl` is not guaranteed present; /dev/urandom is.
PASS1="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
PASS2="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
[[ "$PASS1" != "$PASS2" ]] || { fail "generated identical passphrases"; exit "$PRECONDITION_EXIT"; }

CLEANED=false
cleanup() {
  local rc=$?
  $CLEANED && return
  CLEANED=true
  if $KEEP; then
    log "--keep given; leaving $PGC / $R2C / $NET in place. Clean up with: docker rm -f $PGC $R2C; docker network rm $NET; docker image rm $IMG"
    return
  fi
  log "cleanup"
  docker rm -f "$PGC" "$R2C" >/dev/null 2>&1 || true
  docker network rm "$NET"   >/dev/null 2>&1 || true
  docker image rm "$IMG"     >/dev/null 2>&1 || true
  # An unverified cleanup is not a cleanup — the same policy the restore
  # drill applies to its disposable cluster.
  local left
  left="$(docker ps -aq --filter "label=com.noramedi.test-run-id=$RUN" 2>/dev/null || true)"
  if [[ -n "$left" ]]; then
    fail "CLEANUP INCOMPLETE — containers still present for run $RUN. Remove them before reporting any result."
    rc=$ABORT_EXIT
  fi
  PASS1=""; PASS2=""
  rm -rf "$SCRATCH" 2>/dev/null || true
  return $rc
}
trap cleanup EXIT INT TERM HUP

# ── BUILD ─────────────────────────────────────────────────────────────────
log "building image (egress allowed in this phase only)"
log "base image: $PG_IMAGE | pgbackrest: ${PGBR_PIN:-<current>}"
# Quoted heredoc on purpose: every `$` below belongs to the Dockerfile's own
# ARG expansion or to the shell running INSIDE the build, never to this script.
# The two variable inputs arrive as --build-arg, so nothing is interpolated
# into the file itself.
cat > "$SCRATCH/Dockerfile" <<'DOCKEREOF'
ARG PG_IMAGE=postgres:16-bookworm
FROM ${PG_IMAGE}
ARG PGBR_PIN=
# The pin resolves through apt-archive.postgresql.org because the live PGDG
# repository retains only the two newest pgBackRest builds, and version parity
# with production is the entire point of the pin. `apt-cache madison` lists
# newest first, so the first prefix match is the newest build of the requested
# series. An unresolvable pin is a HARD failure: falling back to the current
# build would produce a result labelled with a version that never ran.
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    if [ -n "$PGBR_PIN" ]; then \
      . /etc/os-release; \
      echo "deb [ signed-by=/usr/local/share/keyrings/postgres.gpg.asc ] https://apt-archive.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg-archive main" \
        > /etc/apt/sources.list.d/pgdg-archive.list; \
      apt-get update; \
      PKG="$(apt-cache madison pgbackrest \
             | awk -v v="$PGBR_PIN" 'index($3, v "-") == 1 || index($3, v ".") == 1 { print $3; exit }')"; \
      if [ -z "$PKG" ]; then \
        echo "PGBACKREST_PIN_UNAVAILABLE: no pgbackrest build matching '$PGBR_PIN' in the PGDG archive for ${VERSION_CODENAME}" >&2; \
        exit 90; \
      fi; \
      echo "PGBACKREST_PIN_RESOLVED: $PKG"; \
      apt-get install -y --no-install-recommends "pgbackrest=$PKG"; \
      apt-mark hold pgbackrest; \
    else \
      apt-get install -y --no-install-recommends pgbackrest; \
    fi; \
    apt-get install -y --no-install-recommends openssh-server openssh-client procps; \
    rm -rf /var/lib/apt/lists/*
DOCKEREOF
# The build context is a HOST path, so it is the one docker argument that must
# still be translated for Windows — the opposite of every container-internal
# path above, which is why the conversion is disabled globally and re-applied
# only here.
BUILD_CTX="$SCRATCH"
if command -v cygpath >/dev/null 2>&1; then BUILD_CTX="$(cygpath -w "$SCRATCH")"; fi
if ! docker build -t "$IMG" \
      --build-arg "PG_IMAGE=$PG_IMAGE" --build-arg "PGBR_PIN=$PGBR_PIN" \
      "$BUILD_CTX" > "$SCRATCH/build.log" 2>&1; then
  tail -20 "$SCRATCH/build.log" >&2 || true
  if grep -q 'PGBACKREST_PIN_UNAVAILABLE' "$SCRATCH/build.log" 2>/dev/null; then
    fail "pgBackRest '${PGBR_PIN}' is not resolvable in the PGDG archive for this base image. GATE0 = BLOCKED_ON_BUILD; report PGBACKREST_${PGBR_PIN//./_}_PARITY = NOT_PROVEN rather than substituting another build."
  else
    fail "image build failed (see the tail above)"
  fi
  exit "$PRECONDITION_EXIT"
fi

PGBR_VERSION="$(docker run --rm "$IMG" pgbackrest version 2>/dev/null | head -n1 || true)"
PG_VERSION="$(docker run --rm "$IMG" postgres --version 2>/dev/null | head -n1 || true)"
log "pgbackrest: ${PGBR_VERSION:-unknown}"
log "postgres:   ${PG_VERSION:-unknown}"

# The pin is verified against the RUNNING binary, not against the package name
# apt reported. A build that silently satisfied `pgbackrest=2.50-…` with some
# other binary — or a base image that already carried a newer one earlier on
# PATH — would otherwise produce a result labelled 2.50 that never ran on 2.50.
PGBR_PIN_HONOURED="not_requested"
if [[ -n "$PGBR_PIN" ]]; then
  if [[ "$PGBR_VERSION" == "pgBackRest $PGBR_PIN" ]] || [[ "$PGBR_VERSION" == "pgBackRest $PGBR_PIN."* ]]; then
    PGBR_PIN_HONOURED="yes"
    log "version pin honoured: requested $PGBR_PIN, running '$PGBR_VERSION'"
  else
    fail "version pin NOT honoured: requested '$PGBR_PIN' but the image runs '${PGBR_VERSION:-unknown}'. Refusing to run — a Gate 0 result carries only the build that produced it."
    exit "$PRECONDITION_EXIT"
  fi
fi

# Multi-repository support landed in 2.33. Below that the whole question is
# moot and the correct outcome is BLOCKED_ON_BUILD, not a PASS.
PGBR_NUM="$(sed -E 's/^pgBackRest ([0-9]+)\.([0-9]+).*/\1\2/' <<<"${PGBR_VERSION:-pgBackRest 0.0}")"
if [[ ! "$PGBR_NUM" =~ ^[0-9]+$ ]] || [[ "$PGBR_NUM" -lt 233 ]]; then
  fail "pgBackRest '${PGBR_VERSION:-unknown}' does not support multiple repositories (needs >= 2.33). GATE0 = BLOCKED_ON_BUILD."
  exit "$PRECONDITION_EXIT"
fi
docker run --rm "$IMG" bash -c 'pgbackrest help backup | grep -q -- --repo' \
  || { fail "this build's 'backup' command has no --repo option. GATE0 = BLOCKED_ON_BUILD."; exit "$PRECONDITION_EXIT"; }

# ── TOPOLOGY ──────────────────────────────────────────────────────────────
# --internal: no egress. The experiment cannot reach production even by
# mistake, which is what makes it safe to run from a developer machine.
log "creating internal network"
docker network create --internal "${LBL[@]}" "$NET" >/dev/null

log "starting repo2 host"
docker run -d --name "$R2C" --network "$NET" "${LBL[@]}" --restart=no "$IMG" sleep infinity >/dev/null
docker exec "$R2C" bash -eu -c '
  adduser --system --group --home /var/lib/pgbackrest --shell /bin/bash pgbackrest >/dev/null
  install -d -o pgbackrest -g pgbackrest -m 0750 /var/lib/pgbackrest /var/lib/pgbackrest/.ssh /var/log/pgbackrest
  install -d -o root -g root -m 0755 /etc/pgbackrest
  mkdir -p /run/sshd && ssh-keygen -A >/dev/null 2>&1 && /usr/sbin/sshd'

# PGDATA and repo1 deliberately share ONE size-capped tmpfs. Production keeps
# pg_wal and repo1 on the same filesystem, and that shared-exhaustion property
# is the fidelity that matters here.
log "starting postgres (PGDATA + repo1 on one 2GiB tmpfs, mirroring production's shared filesystem)"
docker run -d --name "$PGC" --network "$NET" "${LBL[@]}" --restart=no \
  --mount type=tmpfs,destination=/srv,tmpfs-size=2147483648 \
  -e POSTGRES_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '\n')" \
  -e PGDATA=/srv/pgdata \
  "$IMG" \
  postgres -c wal_level=replica -c archive_mode=on -c archive_timeout=300 \
           -c archive_command='pgbackrest --stanza=noramedi archive-push %p' \
           -c max_wal_size=1GB >/dev/null

for _i in $(seq 1 60); do
  docker exec "$PGC" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$PGC" pg_isready -U postgres >/dev/null 2>&1 \
  || { fail "postgres did not become ready"; exit "$PRECONDITION_EXIT"; }
docker exec "$PGC" bash -eu -c 'install -d -o postgres -g postgres -m 0750 /srv/pgbackrest /var/log/pgbackrest /etc/pgbackrest'

# One-way trust: production -> backup host only, mirroring §16.5's firewall
# requirement that the backup host must not be able to reach production.
log "establishing one-way ssh trust (pg -> repo2)"
docker exec -u postgres "$PGC" ssh-keygen -q -t ed25519 -N '' -f /var/lib/postgresql/.ssh/id_ed25519
PUB="$(docker exec -u postgres "$PGC" cat /var/lib/postgresql/.ssh/id_ed25519.pub)"
docker exec "$R2C" bash -eu -c "printf '%s\n' '$PUB' > /var/lib/pgbackrest/.ssh/authorized_keys
  chown pgbackrest:pgbackrest /var/lib/pgbackrest/.ssh/authorized_keys
  chmod 0600 /var/lib/pgbackrest/.ssh/authorized_keys"
docker exec -u postgres "$PGC" bash -c "ssh-keyscan -H $R2C >> /var/lib/postgresql/.ssh/known_hosts 2>/dev/null"
docker exec -u postgres "$PGC" ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "pgbackrest@$R2C" true \
  || { fail "ssh pg -> repo2 failed"; exit "$PRECONDITION_EXIT"; }

# Config mirrors ops/pgbackrest/pgbackrest.conf.example, including the
# distinct-passphrase rule the preflight enforces and the retention keys it
# now requires. archive-async is deliberately NOT set: the template refuses it
# precisely because it converts push failures into silent ones, which is the
# outcome this experiment exists to detect.
log "installing pgbackrest.conf on both hosts"
docker exec -i "$PGC" install -o postgres -g postgres -m 0600 /dev/stdin /etc/pgbackrest/pgbackrest.conf <<EOF
[global]
repo1-path=/srv/pgbackrest
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$PASS1
repo1-retention-full=7
repo1-retention-archive=7
repo2-host=$R2C
repo2-host-user=pgbackrest
repo2-path=/var/lib/pgbackrest
repo2-cipher-type=aes-256-cbc
repo2-cipher-pass=$PASS2
repo2-retention-full=7
repo2-retention-archive=7
process-max=2
log-level-console=info
log-level-file=detail
[noramedi]
pg1-path=/srv/pgdata
pg1-port=5432
pg1-user=postgres
EOF
# The repo HOST must declare the repository under the SAME index the primary
# uses for it — repo2 here, not repo1. In repo-host mode the remote process
# inherits the primary's option set, so a repo host that calls its own
# repository `repo1-path=/var/lib/pgbackrest` collides with the repo2-path the
# primary passes down:
#   ERROR: [032]: local repo1 and repo2 paths are both '/var/lib/pgbackrest'
#                 but must be different
# That error names paths, not indexes, so it reads as a path mistake and sends
# the operator to change a directory that is in fact correct. Runbook §16.5
# never states which index the secondary must use.
docker exec -i "$R2C" install -o pgbackrest -g pgbackrest -m 0600 /dev/stdin /etc/pgbackrest/pgbackrest.conf <<EOF
[global]
repo2-path=/var/lib/pgbackrest
repo2-cipher-type=aes-256-cbc
repo2-cipher-pass=$PASS2
repo2-retention-full=7
repo2-retention-archive=7
log-level-console=info
[noramedi]
pg1-path=/srv/pgdata
pg1-host=$PGC
pg1-host-user=postgres
EOF

# ── HARD GATE: both repositories healthy BEFORE any failure injection ─────
# A run that injects a failure into an already-broken topology measures
# nothing. If repo2 cannot be created or checked here, that is itself a
# legitimate Gate 0 outcome and must be recorded as BLOCKED_ON_REPO_HOST_CONFIG.
# NOTE — `stanza-create` and `check` take NO --repo option. Both are inherently
# all-repository operations, and pgBackRest 2.59.0 rejects the flag outright:
#   ERROR: [031]: option 'repo' not valid for command 'check'
# Runbook §16.5 step 9 published `--repo=2` on both commands; this experiment
# is how that was found, before activation day rather than during it. --repo IS
# valid for backup, restore, info, expire and verify, which is why the backup
# wrapper and restore drill are unaffected.
log "stanza-create and check on BOTH repositories (hard gate; no --repo, see note)"
REPO_HOST_OK=true
docker exec -u postgres "$PGC" pgbackrest --stanza=noramedi stanza-create >/dev/null 2>&1 || REPO_HOST_OK=false
docker exec -u postgres "$PGC" pgbackrest --stanza=noramedi check >/dev/null 2>&1 || REPO_HOST_OK=false
if [[ "$REPO_HOST_OK" != true ]]; then
  fail "repo1/repo2 stanza-create or check failed before any injection. GATE0 = BLOCKED_ON_REPO_HOST_CONFIG — do NOT record a PASS."
  docker exec -u postgres "$PGC" pgbackrest --stanza=noramedi check 2>&1 | tail -20 >&2 || true
  exit "$PRECONDITION_EXIT"
fi
# The tail of the failing command is printed, not swallowed. A bring-up that
# reports only "repo2 base backup failed" costs an entire re-run to diagnose,
# and on a pinned older build the reason may BE the finding: pgBackRest's
# per-command option set is version-dependent, which is the whole reason this
# harness can pin a version at all.
#
# ── WHERE THE repo2 BASE BACKUP MAY BE INITIATED IS VERSION-DEPENDENT ─────
# F4-FCR-003-R1, found by pinning 2.50. On pgBackRest 2.50, `backup --repo=2`
# invoked on the POSTGRESQL host with `repo2-host` configured is refused:
#
#     ERROR: [072]: backup command must be run on the repository host
#
# On 2.59.0 the identical topology and command succeed from the PostgreSQL
# host. The consequence is not cosmetic: initiating the backup on the
# REPOSITORY host requires SSH trust in the repo-host -> production direction,
# which is precisely the direction runbook §16.5 forbids ("the backup host must
# not be able to reach production"). So the harness does not paper over it — it
# retries from the repository host, but only after establishing that reverse
# trust explicitly, logging it, and recording it in the summary so the
# requirement is visible to whoever reads the evidence.
REVERSE_SSH_REQUIRED=false
REPO2_BACKUP_INITIATED_FROM="pg-host"
REPO2_BASE_BACKUP_PRESENT=true
REPO2_BACKUP_BLOCKER=""

establish_reverse_ssh_trust() {
  log "establishing REVERSE ssh trust (repo2 -> pg) — required by this build to run the repo2 backup"
  # The authorized_keys file lives OUTSIDE the postgres home on purpose. The
  # official postgres image ships /var/lib/postgresql as mode 1777, and sshd's
  # StrictModes (correctly) refuses a key file reachable through a
  # world-writable home. Turning StrictModes off would be the wrong fix even in
  # a disposable container: it is the control that stops any local user from
  # granting themselves this login. A root-owned key path keeps StrictModes on.
  docker exec "$PGC" bash -eu -c '
    mkdir -p /run/sshd /etc/ssh/sshd_config.d
    ssh-keygen -A >/dev/null 2>&1
    install -d -o root -g root -m 0755 /etc/ssh/authorized_keys.d
    echo "AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u" > /etc/ssh/sshd_config.d/noramedi-gate0.conf
    /usr/sbin/sshd'
  docker exec -u pgbackrest "$R2C" ssh-keygen -q -t ed25519 -N '' -f /var/lib/pgbackrest/.ssh/id_ed25519
  local pub
  pub="$(docker exec -u pgbackrest "$R2C" cat /var/lib/pgbackrest/.ssh/id_ed25519.pub)"
  docker exec "$PGC" bash -eu -c "printf '%s\n' '$pub' > /etc/ssh/authorized_keys.d/postgres
    chown root:root /etc/ssh/authorized_keys.d/postgres
    chmod 0644 /etc/ssh/authorized_keys.d/postgres"
  docker exec -u pgbackrest "$R2C" bash -c "ssh-keyscan -H $PGC >> /var/lib/pgbackrest/.ssh/known_hosts 2>/dev/null"
  docker exec -u pgbackrest "$R2C" ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "postgres@$PGC" true \
    || { fail "reverse ssh repo2 -> pg failed"; exit "$PRECONDITION_EXIT"; }
}

base_backup() {
  # Two statements on purpose: `local a=$1 b=${a}` expands EVERY argument
  # before any of them is assigned, so `${a}` is still unset under `set -u`.
  local repo="$1"
  local logf="$SCRATCH/backup-repo${repo}.log"
  if docker exec -u postgres "$PGC" \
       pgbackrest --stanza=noramedi --repo="$repo" --type=full backup > "$logf" 2>&1; then
    return 0
  fi
  if [[ "$repo" == "2" ]] && grep -q 'must be run on the repository host' "$logf"; then
    log "this build refuses a repo2 backup initiated on the PostgreSQL host (ERROR 072) — retrying from the repository host"
    REPO2_BACKUP_BLOCKER="ERROR_072_MUST_RUN_ON_REPOSITORY_HOST"
    REVERSE_SSH_REQUIRED=true
    REPO2_BACKUP_INITIATED_FROM="repo-host"
    establish_reverse_ssh_trust
    logf="$SCRATCH/backup-repo2-from-repo-host.log"
    if docker exec -u pgbackrest "$R2C" \
         pgbackrest --stanza=noramedi --repo=2 --type=full backup > "$logf" 2>&1; then
      REPO2_BACKUP_BLOCKER=""
      return 0
    fi
    REPO2_BACKUP_BLOCKER="ERROR_072_THEN_REPO_HOST_BACKUP_ALSO_FAILED"
  fi
  fail "repo${repo} base backup failed on ${PGBR_VERSION:-unknown}"
  tail -15 "$logf" >&2 || true
  echo "--- postgres container log (tail) ---" >&2
  docker logs "$PGC" 2>&1 | tail -25 >&2 || true
  echo "--- pgbackrest log on the postgres host (tail) ---" >&2
  docker exec "$PGC" bash -c 'tail -25 /var/log/pgbackrest/*.log 2>/dev/null' >&2 || true

  # ── Degraded baseline, opt-in and permanently recorded ─────────────────
  # The Gate 0 question is a property of `archive-push`, and archive-push needs
  # the STANZA to exist on both repositories, not a base backup: the hard gate
  # immediately above already proved that end to end with `check`, which is the
  # only command that validates archive_command -> repository for every
  # configured repository. A base backup is what makes a repository
  # RESTORABLE, which this experiment explicitly does not test.
  #
  # So when the repo2 base backup is unobtainable on the pinned build — as it
  # is on 2.50, where it is refused on the PostgreSQL host outright — the
  # choice is between no version-pinned evidence at all and evidence with a
  # named, narrower baseline. This flag takes the second, and pays for it: the
  # outcome can no longer be PASS, the summary carries the blocker verbatim,
  # and an extra non-claim is emitted. It is off by default, so the hard gate
  # is unchanged for anyone who does not ask for this.
  if [[ "$repo" == "2" ]] && $ALLOW_MISSING_REPO2_BACKUP; then
    REPO2_BASE_BACKUP_PRESENT=false
    log "--allow-missing-repo2-backup: continuing WITHOUT a repo2 base backup. The outage arm still answers the archive-push question; the outcome is capped at PASS_ARCHIVE_SEMANTICS_ONLY and repo2 restorability is NOT tested."
    return 0
  fi
  exit "$PRECONDITION_EXIT"
}
base_backup 1
base_backup 2
if $REPO2_BASE_BACKUP_PRESENT; then
  log "both repositories healthy; baseline established"
else
  log "baseline established with repo1 backed up and repo2 archive-only (no base backup on this build)"
fi

# Synthetic schema ONLY. No Prisma, no real schema, no PHI.
docker exec -u postgres "$PGC" psql -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE gate0_synthetic(id bigserial PRIMARY KEY, written_at timestamptz NOT NULL DEFAULT now(), payload bytea NOT NULL);"

# ── SAMPLER ───────────────────────────────────────────────────────────────
# Field names deliberately mirror server/src/services/pitrStatusFile.ts so
# samples are directly comparable to what production will publish.
SAMPLE_Q="SELECT json_build_object(
  'archivedCount',archived_count,'failedCount',failed_count,
  'lastArchivedWal',last_archived_wal,'lastFailedWal',last_failed_wal,
  'readyCount',(SELECT count(*) FROM pg_ls_dir('pg_wal/archive_status') f WHERE f LIKE '%.ready'),
  'walBytes',(SELECT coalesce(sum(size),0) FROM pg_ls_waldir()),
  'committedRows',(SELECT count(*) FROM gate0_synthetic)
) FROM pg_stat_archiver;"

sample_once() {
  local phase="$1" a
  a="$(docker exec -u postgres "$PGC" psql -Atqc "$SAMPLE_Q" 2>/dev/null || true)"
  [[ -n "$a" ]] || a='{}'
  printf '{"t":"%s","phase":"%s","archiver":%s}\n' "$(ts)" "$phase" "$a" >> "$SAMPLES"
}

sample_for() {
  local phase="$1" seconds="$2" end
  end=$(( $(date -u +%s) + seconds ))
  while [[ "$(date -u +%s)" -lt "$end" ]]; do
    sample_once "$phase"
    sleep "$SAMPLE_INTERVAL"
  done
}

# gen_random_bytes lives in pgcrypto, which the stock postgres image does not
# install — the first version of this writer failed on every iteration and
# produced no WAL at all, which is indistinguishable from "archiving stalled"
# in the samples. repeat(md5(...)) is core-only and needs no extension.
writer_start() {
  docker exec -d -u postgres "$PGC" bash -c \
    'while :; do psql -q -c "INSERT INTO gate0_synthetic(payload) SELECT repeat(md5(random()::text),256)::bytea FROM generate_series(1,500);" >>/tmp/writes.log 2>&1 || echo "WRITE_FAIL $(date -u +%FT%TZ)" >>/tmp/writes.log; sleep 2; done' || true
}
writer_stop() { docker exec "$PGC" pkill -f 'INSERT INTO gate0_synthetic' >/dev/null 2>&1 || true; }

# ── FORCED SEGMENT BOUNDARIES (F4-FCR-003-R1) ─────────────────────────────
# archive-push runs once per COMPLETED segment, so an outage window that
# contains no segment boundary observes nothing at all. That is not a
# hypothetical: the first 2.50 run produced 102,500 committed rows and ZERO
# archive attempts across the whole outage, because `repeat(md5(...),256)` is
# almost perfectly compressible, so 800 MB of inserts became a few MB of WAL —
# and `archive_timeout=300` is longer than smoke mode's 180-second outage. The
# run classified INDETERMINATE on a perfectly healthy experiment, for a reason
# that has nothing to do with pgBackRest.
#
# Forcing a switch on a fixed interval removes that dependency: it is the same
# mechanism `archive_timeout` already uses in production, run faster. It
# accelerates WHEN segments are produced; it does not change what archive-push
# does with one, which is the only thing this experiment measures.
WAL_SWITCH_INTERVAL="${NORAMEDI_GATE0_WAL_SWITCH_INTERVAL:-15}"
switcher_start() {
  docker exec -d -u postgres "$PGC" bash -c \
    "while :; do psql -q -c 'SELECT pg_switch_wal();' >>/tmp/switches.log 2>&1 || true; sleep ${WAL_SWITCH_INTERVAL}; done" || true
}
switcher_stop() { docker exec "$PGC" pkill -f 'pg_switch_wal' >/dev/null 2>&1 || true; }

# Read one numeric field from the first/last sample of a phase.
#
# These MUST NOT propagate grep's exit-1 for "field absent". Under `set -e` an
# assignment from a failing command substitution terminates the script, and it
# would do so AFTER the experiment ran but BEFORE the summary was written —
# destroying the evidence of a completed run because one optional field was
# missing. A missing field is an INCONCLUSIVE outcome, which the classifier
# below decides; it is not a reason to exit silently.
# json_build_object pretty-prints as `"walBytes" : 16777216` — with spaces
# around the colon. Matching `"field":N` therefore parsed nothing while the
# samples themselves were perfectly good, and every counter defaulted to 0.
# The whole run then classified INCONCLUSIVE on complete data.
_jqf_pick() {
  local field="$1"
  { grep -oE "\"$field\"[[:space:]]*:[[:space:]]*[0-9]+" || true; } \
    | head -n1 | sed -E 's/.*[^0-9]([0-9]+)$/\1/'
}
jqf() {
  local phase="$1" field="$2"
  { grep "\"phase\":\"$phase\"" "$SAMPLES" || true; } | tail -n1 | _jqf_pick "$field"
}
jqf_first() {
  local phase="$1" field="$2"
  { grep "\"phase\":\"$phase\"" "$SAMPLES" || true; } | head -n1 | _jqf_pick "$field"
}

# ── PHASE 1: BASELINE ─────────────────────────────────────────────────────
log "phase: baseline (${BASELINE_S}s, both repos reachable)"
writer_start
switcher_start
sample_for baseline "$BASELINE_S"

# ── PHASE 2: OUTAGE (M1 blackhole) ────────────────────────────────────────
# docker network disconnect drops packets rather than refusing them, which is
# the closest available model of a dead VPS: SSH hangs to timeout instead of
# failing fast. That distinction matters, because a fast RST and a hang
# produce very different archive_command behaviour.
log "phase: outage — disconnecting repo2 (blackhole)"
OUTAGE_START="$(ts)"
docker network disconnect "$NET" "$R2C" >/dev/null 2>&1 || true
sample_for outage "$OUTAGE_S"
OUTAGE_END="$(ts)"

PG_STATE="$(docker inspect "$PGC" --format '{{.State.Status}}' 2>/dev/null || echo unknown)"
docker logs "$PGC" > "$SCRATCH/pg.log" 2>&1 || true
docker exec "$PGC" cat /tmp/writes.log > "$SCRATCH/writes.log" 2>/dev/null || true

# ── PHASE 3: RECOVERY ─────────────────────────────────────────────────────
log "phase: recovery — reconnecting repo2"
docker network connect "$NET" "$R2C" >/dev/null 2>&1 || true
RECOVERY_START="$(ts)"
sample_for recovery "$RECOVERY_S"
writer_stop
switcher_stop

REPO2_CHECK_RC=0
 docker exec -u postgres "$PGC" pgbackrest --stanza=noramedi check >/dev/null 2>&1 || REPO2_CHECK_RC=$?

# ── CLASSIFY ──────────────────────────────────────────────────────────────
BASE_ARCHIVED="$(jqf baseline archivedCount)"; BASE_ARCHIVED="${BASE_ARCHIVED:-0}"
OUT_ARCHIVED_FIRST="$(jqf_first outage archivedCount)"; OUT_ARCHIVED_FIRST="${OUT_ARCHIVED_FIRST:-0}"
OUT_ARCHIVED="$(jqf outage archivedCount)"; OUT_ARCHIVED="${OUT_ARCHIVED:-0}"
OUT_FAILED="$(jqf outage failedCount)"; OUT_FAILED="${OUT_FAILED:-0}"
OUT_READY="$(jqf outage readyCount)"; OUT_READY="${OUT_READY:-0}"
OUT_WAL="$(jqf outage walBytes)"; OUT_WAL="${OUT_WAL:-0}"
BASE_WAL="$(jqf baseline walBytes)"; BASE_WAL="${BASE_WAL:-0}"
REC_READY="$(jqf recovery readyCount)"; REC_READY="${REC_READY:-0}"
REC_ARCHIVED="$(jqf recovery archivedCount)"; REC_ARCHIVED="${REC_ARCHIVED:-0}"
ROWS_AFTER="$(jqf recovery committedRows)"; ROWS_AFTER="${ROWS_AFTER:-0}"
ROWS_OUTAGE="$(jqf outage committedRows)"; ROWS_OUTAGE="${ROWS_OUTAGE:-0}"

# THE finding. If archivedCount advanced while repo2 was unreachable, then
# archive-push reported success having written repo1 only, PostgreSQL is free
# to recycle a segment that never reached repo2, and the off-host chain has a
# hole nothing reports. That blocks activation on this build outright.
ARCHIVED_ADVANCED_DURING_OUTAGE=false
[[ "$OUT_ARCHIVED" -gt "$OUT_ARCHIVED_FIRST" ]] && ARCHIVED_ADVANCED_DURING_OUTAGE=true

if [[ "$ARCHIVED_ADVANCED_DURING_OUTAGE" == true ]]; then
  PUSH_MODE="PARTIAL_SUCCESS"
elif [[ "$OUT_FAILED" -gt 0 ]]; then
  PUSH_MODE="FAILS_COMMAND"
elif [[ "$OUT_READY" -gt 0 ]]; then
  PUSH_MODE="RETAINS_PENDING"
else
  PUSH_MODE="INDETERMINATE"
fi

BACKLOG_DRAINED=false
[[ "$REC_READY" -eq 0 ]] && [[ "$REC_ARCHIVED" -ge "$OUT_ARCHIVED" ]] && [[ "$REPO2_CHECK_RC" -eq 0 ]] && BACKLOG_DRAINED=true

COMMITS_LOST=0
[[ "$ROWS_AFTER" -lt "$ROWS_OUTAGE" ]] && COMMITS_LOST=$(( ROWS_OUTAGE - ROWS_AFTER ))

SAMPLE_COUNT="$(wc -l < "$SAMPLES" | tr -d ' ')"

OUTCOME="PASS"
[[ "$PUSH_MODE" == "INDETERMINATE" ]] && OUTCOME="INCONCLUSIVE"
[[ "$SAMPLE_COUNT" -lt 6 ]] && OUTCOME="INCONCLUSIVE"
[[ "$ARCHIVED_ADVANCED_DURING_OUTAGE" == true ]] && OUTCOME="FAIL"
[[ "$COMMITS_LOST" -gt 0 ]] && OUTCOME="FAIL"
[[ "$BACKLOG_DRAINED" != true ]] && OUTCOME="FAIL"
# A run without a repo2 base backup can still establish the archive-push
# semantics, and must never be able to present itself as a full Gate 0 PASS.
# The cap is applied LAST so it cannot mask a FAIL or an INCONCLUSIVE.
if [[ "$REPO2_BASE_BACKUP_PRESENT" != true ]] && [[ "$OUTCOME" == "PASS" ]]; then
  OUTCOME="PASS_ARCHIVE_SEMANTICS_ONLY"
fi

# ── SUMMARY ───────────────────────────────────────────────────────────────
# Built here rather than inline in the heredoc below. `bash -n` does NOT parse
# heredoc bodies, so a command substitution inside one is a syntax error that
# surfaces only at runtime — and this heredoc runs AFTER the whole experiment,
# so the cost of that mistake is the entire run's evidence.
EXTRA_NON_CLAIM=""
if [[ "$REPO2_BASE_BACKUP_PRESENT" != true ]]; then
  EXTRA_NON_CLAIM=",
    \"No repo2 base backup existed during this run (blocker: ${REPO2_BACKUP_BLOCKER:-unknown}). repo2 RESTORABILITY is untested; the archive-push semantics are the only claim.\""
fi

emit_summary() {
  cat <<EOF
{
  "schemaVersion": 1,
  "taskId": "F4-FCR-003-GATE0",
  "runId": "$RUN",
  "mode": "$MODE",
  "outcome": "$OUTCOME",
  "evidenceClass": "OBSERVED_LOCAL_ONLY",
  "build": {
    "pgbackrestVersion": "${PGBR_VERSION:-unknown}",
    "pgbackrestVersionRequested": "${PGBR_PIN:-}",
    "pgbackrestVersionPinHonoured": "$PGBR_PIN_HONOURED",
    "postgresVersion": "${PG_VERSION:-unknown}",
    "postgresImage": "$PG_IMAGE",
    "dockerServerVersion": "$DOCKER_SERVER",
    "dockerOsArch": "$DOCKER_OSARCH"
  },
  "topology": {
    "networkInternal": true,
    "repo2Transport": "ssh-repo-host",
    "repo2BaseBackupInitiatedFrom": "$REPO2_BACKUP_INITIATED_FROM",
    "repo2BaseBackupPresent": $REPO2_BASE_BACKUP_PRESENT,
    "repo2BaseBackupBlocker": "$REPO2_BACKUP_BLOCKER",
    "reverseSshTrustRequired": $REVERSE_SSH_REQUIRED,
    "sharedFilesystemBytes": 2147483648,
    "archiveMode": "on",
    "archiveAsync": false,
    "spoolPathConfigured": false,
    "archivePushQueueMaxConfigured": false,
    "processMax": 2,
    "archiveCommand": "pgbackrest --stanza=noramedi archive-push %p"
  },
  "outage": {
    "startedAt": "$OUTAGE_START",
    "endedAt": "$OUTAGE_END",
    "durationSeconds": $OUTAGE_S,
    "injectionMode": "M1_BLACKHOLE",
    "archivePushFailureMode": "$PUSH_MODE",
    "archivedCountAdvancedDuringOutage": $ARCHIVED_ADVANCED_DURING_OUTAGE,
    "archivedCountFirst": $OUT_ARCHIVED_FIRST,
    "archivedCountLast": $OUT_ARCHIVED,
    "failedCountLast": $OUT_FAILED,
    "readyCountLast": $OUT_READY,
    "walBytesBaseline": $BASE_WAL,
    "walBytesPeak": $OUT_WAL,
    "postgresState": "$PG_STATE"
  },
  "recovery": {
    "startedAt": "$RECOVERY_START",
    "readyCountAfter": $REC_READY,
    "archivedCountAfter": $REC_ARCHIVED,
    "repo2CheckExitCode": $REPO2_CHECK_RC,
    "backlogFullyDrained": $BACKLOG_DRAINED,
    "acknowledgedCommitsLost": $COMMITS_LOST
  },
  "sampleCount": $SAMPLE_COUNT,
  "sampleIntervalSeconds": $SAMPLE_INTERVAL,
  "syntheticDataOnly": true,
  "productionAccessed": false,
  "phiPresent": false,
  "explicitNonClaims": [
    "Does not close R-030, R-030-DB or R-030-FILES.",
    "Does not satisfy FIRST_CUSTOMER_RECOVERY_GATE.",
    "Does not authorize runbook 16.5 or any production configuration change.",
    "Proves unreachability semantics only — a severed container network is no model of an independent failure domain.",
    "WAL growth is synthetic and accelerated; production rates are not reproduced.",
    "Applies to the pgBackRest build named above until an operator confirms production version parity."${EXTRA_NON_CLAIM}
  ]
}
EOF
}

if [[ -n "$SUMMARY_FILE" ]]; then
  emit_summary > "$SUMMARY_FILE" || { fail "could not write summary file"; exit "$INCONCLUSIVE_EXIT"; }
  log "summary written to $SUMMARY_FILE"
else
  emit_summary
fi

# The scratch directory is destroyed by cleanup, so the per-tick samples — the
# only record of the SHAPE of the stall, as opposed to its classified endpoints
# — do not survive the run unless they are copied out deliberately.
if [[ -n "$SAMPLES_FILE" ]]; then
  if cp "$SAMPLES" "$SAMPLES_FILE" 2>/dev/null; then
    log "samples written to $SAMPLES_FILE ($SAMPLE_COUNT ticks)"
  else
    fail "could not write samples file '$SAMPLES_FILE'"
    exit "$INCONCLUSIVE_EXIT"
  fi
fi

log "archive-push failure mode: $PUSH_MODE"
log "archivedCount advanced during outage: $ARCHIVED_ADVANCED_DURING_OUTAGE"
log "backlog drained: $BACKLOG_DRAINED | acknowledged commits lost: $COMMITS_LOST"
log "GATE0 outcome: $OUTCOME"

case "$OUTCOME" in
  PASS) exit 0 ;;
  # Exit 0 as well: the experiment ran and its evidence is complete FOR THE
  # QUESTION IT ANSWERED. The narrower claim is carried by the outcome string
  # and the extra non-claim, not by an exit code an operator would read as a
  # broken run.
  PASS_ARCHIVE_SEMANTICS_ONLY) exit 0 ;;
  INCONCLUSIVE) exit "$INCONCLUSIVE_EXIT" ;;
  *) exit 1 ;;
esac
