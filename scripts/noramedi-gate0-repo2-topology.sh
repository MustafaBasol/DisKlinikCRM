#!/usr/bin/env bash
#
# noramedi-gate0-repo2-topology.sh — F4-FCR-003-R2
#
# Answers ONE question, on a pinned pgBackRest build, in a disposable container:
#
#   Can `backup --repo=2` be invoked ON THE POSTGRESQL HOST for a repo2 that has
#   NO repository host?
#
# Background. On production's pgBackRest 2.50, `backup --repo=2` is refused when
# `repo2-host` is configured:
#
#   ERROR: [072]: backup command must be run on the repository host
#
# That error is raised by repoIsLocalVerify(), whose whole test is whether
# repoN-host is SET. It is not about --repo=2 and not about running backup on
# the primary. A repository reached over S3 or SFTP has no repository host, so
# the check cannot fire. This harness proves that empirically rather than by
# reading the source, because the runbook publishes operator commands and a
# wrong answer here means CHECKPOINT 7 fails on activation day.
#
# It also measures the confidentiality claim rather than asserting it: a PHI
# marker is written, and the repository's stored bytes are searched for it.
#
# Deploy to: nowhere. This is a developer/CI harness.
# Requires:  docker, network access to apt-archive.postgresql.org
#
# Exit codes:
#   0  every requested shape allowed primary-driven backup (TOPOLOGY_CONFIRMED)
#   2  a shape was REFUSED with ERROR [072] (TOPOLOGY_REFUTED — a real finding)
#   3  precondition failure (docker missing, image build failed, pin unhonoured)
#   4  a shape failed for a reason unrelated to topology (INDETERMINATE)
#
# NO PRODUCTION CONTACT. Synthetic data only. Nothing here authorizes anything.

set -euo pipefail

# Container-internal paths must never be translated by MSYS/Git-Bash. Native
# Windows binaries (docker's build context, openssl) are converted explicitly at
# the call site instead — see winpath().
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

PGBR_VERSION_REQ="${NORAMEDI_GATE0_PGBACKREST_VERSION:-2.50}"
PG_IMAGE="${NORAMEDI_GATE0_POSTGRES_IMAGE:-postgres:16.14-bookworm}"
MINIO_IMAGE="${NORAMEDI_GATE0_MINIO_IMAGE:-minio/minio:RELEASE.2025-04-08T15-41-24Z}"
SHAPES="repohost,s3,sftp"
SUMMARY_FILE=""
KEEP="false"

PRECONDITION_EXIT=3
REFUTED_EXIT=2
INDETERMINATE_EXIT=4

usage() {
  cat <<'USAGE'
Usage: noramedi-gate0-repo2-topology.sh [options]

  --shapes repohost,s3,sftp   which repo2 shapes to exercise
                              (default: all three; `repohost` is the negative
                              control and MUST be refused with ERROR [072])
  --pgbackrest-version VER    pgBackRest series to pin      (default: 2.50)
  --postgres-image IMAGE      base image                    (default: postgres:16.14-bookworm)
  --summary-file PATH         write the JSON summary here
  --keep                      leave containers running for inspection
  -h, --help

Environment: NORAMEDI_GATE0_PGBACKREST_VERSION, NORAMEDI_GATE0_POSTGRES_IMAGE,
             NORAMEDI_GATE0_MINIO_IMAGE
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --shapes)             SHAPES="${2:?}"; shift 2 ;;
    --pgbackrest-version) PGBR_VERSION_REQ="${2:?}"; shift 2 ;;
    --postgres-image)     PG_IMAGE="${2:?}"; shift 2 ;;
    --summary-file)       SUMMARY_FILE="${2:?}"; shift 2 ;;
    --keep)               KEEP="true"; shift ;;
    -h|--help)            usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
NS="ngt-$$"
IMG="noramedi-gate0-topology:${PGBR_VERSION_REQ}"
SFTP_IMG="noramedi-gate0-topology-sftp"
NET="${NS}-net"
VOL="${NS}-minio"
SCRATCH="$(mktemp -d)"

MARKER="PHIDIAGNOSISSENSITIVEMARKER"
BUCKET="noramedi-repo2"
S3KEY="noramedigate0key"
S3SECRET="noramedigate0secretnoramedigate0secret"
CIPHER1="repo1-passphrase-aaaaaaaaaaaaaaaaaaaaaaaa"
CIPHER2="repo2-passphrase-bbbbbbbbbbbbbbbbbbbbbbbb"

log()  { echo "[gate0-topology] $*"; }
fail() { echo "[gate0-topology] FAIL: $*" >&2; }

winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

cleanup() {
  if [[ "$KEEP" == "true" ]]; then
    log "--keep: leaving containers and ${SCRATCH} in place"
    return
  fi
  docker rm -f "${NS}-pg" "${NS}-minio" "${NS}-sftp" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
  rm -rf "$SCRATCH" || true
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || { fail "docker is not available"; exit "$PRECONDITION_EXIT"; }
docker version >/dev/null 2>&1   || { fail "docker daemon is not responding"; exit "$PRECONDITION_EXIT"; }

# ── The pinned image. Same pin mechanism as the unreachability harness: the
#    live PGDG repo keeps only the newest builds, so an old series resolves
#    through apt-archive. An unresolvable pin is a HARD failure — a result
#    labelled 2.50 that never ran on 2.50 is worse than no result. ──────────
cat > "$SCRATCH/Dockerfile" <<'DOCKEREOF'
ARG PG_IMAGE=postgres:16.14-bookworm
FROM ${PG_IMAGE}
ARG PGBR_PIN=
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
      if [ -z "$PKG" ]; then echo "PGBACKREST_PIN_UNAVAILABLE" >&2; exit 90; fi; \
      echo "PGBACKREST_PIN_RESOLVED: $PKG"; \
      apt-get install -y --no-install-recommends "pgbackrest=$PKG"; \
      apt-mark hold pgbackrest; \
    else \
      apt-get install -y --no-install-recommends pgbackrest; \
    fi; \
    apt-get install -y --no-install-recommends procps; \
    rm -rf /var/lib/apt/lists/*
DOCKEREOF

log "building ${IMG} (pgBackRest pin ${PGBR_VERSION_REQ})"
if ! docker build -t "$IMG" \
      --build-arg "PG_IMAGE=$PG_IMAGE" --build-arg "PGBR_PIN=$PGBR_VERSION_REQ" \
      "$(winpath "$SCRATCH")" > "$SCRATCH/build.log" 2>&1; then
  tail -20 "$SCRATCH/build.log" >&2 || true
  if grep -q 'PGBACKREST_PIN_UNAVAILABLE' "$SCRATCH/build.log" 2>/dev/null; then
    fail "pgBackRest '${PGBR_VERSION_REQ}' is not resolvable in the PGDG archive for this base image. Report TOPOLOGY = NOT_PROVEN rather than substituting another build."
  else
    fail "image build failed (tail above)"
  fi
  exit "$PRECONDITION_EXIT"
fi

PGBR_VERSION="$(docker run --rm "$IMG" pgbackrest version 2>/dev/null | head -n1 || true)"
log "running binary: ${PGBR_VERSION:-unknown}"

# The pin is verified against the RUNNING binary, not the package name apt
# reported, so a build that silently satisfied the pin with something else
# cannot produce a mislabelled result.
if [[ "$PGBR_VERSION" != "pgBackRest $PGBR_VERSION_REQ" && "$PGBR_VERSION" != "pgBackRest $PGBR_VERSION_REQ."* ]]; then
  fail "version pin not honoured: requested '$PGBR_VERSION_REQ', running '$PGBR_VERSION'"
  exit "$PRECONDITION_EXIT"
fi

docker network create "$NET" >/dev/null

# ── Per-shape config. Neither sets repo2-host; that is the entire point. ────
write_conf() {
  local shape="$1" extra="$2"
  docker exec -u root "${NS}-pg" bash -c "
set -e
install -d -o postgres -g postgres -m 0750 /var/lib/pgbackrest /var/log/pgbackrest
install -d -m 0755 /etc/pgbackrest
cat > /etc/pgbackrest/pgbackrest.conf <<'CONF'
[global]
repo1-path=/var/lib/pgbackrest
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=${CIPHER1}
repo1-retention-full=2
${extra}
repo2-cipher-type=aes-256-cbc
repo2-cipher-pass=${CIPHER2}
repo2-retention-full=2
log-level-console=info
start-fast=y
[noramedi]
pg1-path=/var/lib/postgresql/data
CONF
chown postgres:postgres /etc/pgbackrest/pgbackrest.conf
chmod 0600 /etc/pgbackrest/pgbackrest.conf"
}

start_pg() {
  docker rm -f "${NS}-pg" >/dev/null 2>&1 || true
  docker run -d --name "${NS}-pg" --network "$NET" -e POSTGRES_PASSWORD=gate0 "$IMG" \
    -c archive_mode=on \
    -c "archive_command=pgbackrest --stanza=noramedi archive-push %p" \
    -c archive_timeout=30s >/dev/null
  local i
  for i in $(seq 1 60); do
    docker exec "${NS}-pg" pg_isready -U postgres >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

seed_marker() {
  docker exec -u postgres "${NS}-pg" psql -U postgres -q \
    -c "CREATE TABLE IF NOT EXISTS patients(id int, diagnosis text);" \
    -c "INSERT INTO patients SELECT g, '${MARKER}' || g FROM generate_series(1,3000) g;" \
    -c "CHECKPOINT;" >/dev/null 2>&1
}

# ── S3 shape ───────────────────────────────────────────────────────────────
setup_s3() {
  mkdir -p "$SCRATCH/certs"
  openssl req -new -x509 -nodes -days 2 -newkey rsa:2048 \
    -keyout "$(winpath "$SCRATCH/certs/private.key")" \
    -out    "$(winpath "$SCRATCH/certs/public.crt")" \
    -subj "/CN=minio" -addext "subjectAltName=DNS:minio,IP:127.0.0.1" >/dev/null 2>&1
  chmod 644 "$SCRATCH/certs/public.crt" "$SCRATCH/certs/private.key"

  docker volume create "$VOL" >/dev/null
  docker run -d --name "${NS}-minio" --network "$NET" --network-alias minio \
    -e "MINIO_ROOT_USER=$S3KEY" -e "MINIO_ROOT_PASSWORD=$S3SECRET" \
    -v "$(winpath "$SCRATCH/certs"):/root/.minio/certs:ro" -v "$VOL:/data" \
    "$MINIO_IMAGE" server /data --address ":9000" >/dev/null

  local i
  for i in $(seq 1 30); do
    docker run --rm --network "$NET" -v "$(winpath "$SCRATCH/certs"):/c:ro" \
      curlimages/curl:latest -s --cacert /c/public.crt \
      https://minio:9000/minio/health/live >/dev/null 2>&1 && break
    [[ "$i" == 30 ]] && return 1
    sleep 1
  done
  docker run --rm --network "$NET" -e "MC_HOST_m=https://${S3KEY}:${S3SECRET}@minio:9000" \
    --entrypoint sh "$MINIO_IMAGE" -c "mc --insecure mb m/${BUCKET} >/dev/null 2>&1" || true

  start_pg || return 1
  docker exec -i -u root "${NS}-pg" tee /usr/local/share/ca-certificates/minio.crt \
    < "$SCRATCH/certs/public.crt" >/dev/null
  docker exec -u root "${NS}-pg" update-ca-certificates >/dev/null 2>&1

  write_conf s3 "repo2-type=s3
repo2-path=/noramedi
repo2-s3-bucket=${BUCKET}
repo2-s3-endpoint=minio:9000
repo2-s3-region=us-east-1
repo2-s3-uri-style=path
repo2-s3-key=${S3KEY}
repo2-s3-key-secret=${S3SECRET}
repo2-storage-ca-file=/usr/local/share/ca-certificates/minio.crt"
}

# grep the object store's on-disk bytes with real coreutils; the minio image's
# busybox has no find/awk, which silently produced empty results in early runs.
scan_s3() {
  docker run --rm -v "$VOL:/data:ro" debian:bookworm-slim bash -c "
    raw=\$(grep -r -a -o '${MARKER}' /data 2>/dev/null | wc -l)
    mkdir -p /tmp/un; i=0
    find /data -type f -print0 | while IFS= read -r -d '' f; do
      gzip -dc \"\$f\" > \"/tmp/un/o\$i\" 2>/dev/null || cp \"\$f\" \"/tmp/un/o\$i\"
      i=\$((i+1))
    done
    dec=\$(grep -r -a -o '${MARKER}' /tmp/un 2>/dev/null | wc -l)
    echo \"\$(find /data -type f | wc -l) \$raw \$dec\"
  " 2>/dev/null | tail -1
}

# ── SFTP shape. The endpoint deliberately has NO pgBackRest, to demonstrate it
#    is storage rather than a repository host. ──────────────────────────────
setup_sftp() {
  cat > "$SCRATCH/Dockerfile.sftp" <<'EOF'
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd \
    && useradd -m -s /bin/bash pgbackrest \
    && mkdir -p /var/lib/pgbackrest /home/pgbackrest/.ssh \
    && chown -R pgbackrest:pgbackrest /var/lib/pgbackrest /home/pgbackrest/.ssh \
    && chmod 0700 /home/pgbackrest/.ssh
# ⛔ PROHIBITED FOR FIRST-CUSTOMER ACTIVATION — LOCAL TEST FIXTURE ONLY.
#
# libssh2 in the Debian pgBackRest build may offer only the SHA-1 "ssh-rsa"
# signature algorithm, which OpenSSH >= 8.8 disables by default. Without this
# the run fails with ERROR [101] libssh2 error [-18] — an AUTH failure, not a
# topology refusal, which would make this harness report INDETERMINATE for a
# reason that has nothing to do with the topology question it exists to answer.
#
# This line is therefore scaffolding inside a THROWAWAY CONTAINER that is
# built, used and deleted within one harness run, holds no real data, and is
# never reachable from outside the local Docker network. It is NOT a
# recommendation, NOT operator guidance, and NOT an authorization.
#
# Doing this on the real secondary is PROHIBITED (F4-FCR-004-R1). The accepted
# first-customer contract is MODERN SSH ONLY, and the stop rule is:
#   MODERN SSH AUTH CANNOT BE NEGOTIATED => NO-GO.
# Escalate — provider/OS/package upgrade, transport pivot to S3, or provider
# pivot — and do not weaken a real sshd. See runbook §22.4b and §22.4c.
RUN printf 'PubkeyAcceptedAlgorithms +ssh-rsa\nHostkeyAlgorithms +ssh-rsa\n' \
      > /etc/ssh/sshd_config.d/10-libssh2-compat.conf
CMD ["/usr/sbin/sshd","-D","-e"]
EOF
  docker build -f "$(winpath "$SCRATCH/Dockerfile.sftp")" -t "$SFTP_IMG" \
    "$(winpath "$SCRATCH")" > "$SCRATCH/sftp-build.log" 2>&1 || return 1

  docker run -d --name "${NS}-sftp" --network "$NET" --network-alias sftphost "$SFTP_IMG" >/dev/null
  sleep 3

  # Keys are generated on the endpoint (the postgres image has no ssh-keygen)
  # and the private half is piped in over stdin. PEM is required by libssh2.
  docker exec -u root "${NS}-sftp" bash -c '
    ssh-keygen -m PEM -t rsa -b 3072 -N "" -f /tmp/repo2 -q
    install -o pgbackrest -g pgbackrest -m 0600 /tmp/repo2.pub /home/pgbackrest/.ssh/authorized_keys'

  start_pg || return 1
  docker exec -u root "${NS}-pg" install -d -o postgres -g postgres -m 0700 /var/lib/postgresql/.ssh
  docker exec "${NS}-sftp" cat /tmp/repo2 \
    | docker exec -i -u root "${NS}-pg" tee /var/lib/postgresql/.ssh/repo2 >/dev/null
  docker exec "${NS}-sftp" cat /tmp/repo2.pub \
    | docker exec -i -u root "${NS}-pg" tee /var/lib/postgresql/.ssh/repo2.pub >/dev/null
  docker exec -u root "${NS}-pg" bash -c \
    'chown postgres:postgres /var/lib/postgresql/.ssh/repo2*; chmod 600 /var/lib/postgresql/.ssh/repo2; chmod 644 /var/lib/postgresql/.ssh/repo2.pub'

  # ⛔ host-key-check-type=none is LOCAL FIXTURE SCAFFOLDING, NOT a config
  # shape any real deployment may use. The endpoint here is a container whose
  # host key is generated at build time and destroyed with it, so there is no
  # stable fingerprint to pin and nothing to impersonate on a private Docker
  # network. This harness answers a TOPOLOGY question (does ERROR [072] fire?),
  # not a host-key question.
  #
  # The accepted first-customer contract is the opposite of this line:
  #   repo2-sftp-host-key-check-type=fingerprint
  #   repo2-sftp-host-key-hash-type=sha256
  #   repo2-sftp-host-fingerprint=<64 lowercase hex chars>
  # `none` is a PREFLIGHT FAILURE (noramedi-pgbackrest-preflight.sh), and so is
  # omitting the check type — on pgBackRest 2.50 the default is `strict`, under
  # which a pinned fingerprint is never compared. See runbook §22.4c.
  write_conf sftp "repo2-type=sftp
repo2-path=/var/lib/pgbackrest
repo2-sftp-host=sftphost
repo2-sftp-host-user=pgbackrest
repo2-sftp-private-key-file=/var/lib/postgresql/.ssh/repo2
repo2-sftp-public-key-file=/var/lib/postgresql/.ssh/repo2.pub
repo2-sftp-host-key-hash-type=sha256
repo2-sftp-host-key-check-type=none"
}

# ── NEGATIVE CONTROL. The repo-host shape, which MUST be refused with
#    ERROR [072]. Without this the harness could only ever confirm, and a
#    harness that cannot fail proves nothing — the lesson of R1-F1, where a
#    guard reported CLEAN on precisely the input containing the defect.
#
#    repo2-host deliberately points at a host that does not exist. The check is
#    a config-time test in cmdBackup(), evaluated before any connection is
#    attempted, so an unreachable host still yields 072 and not a network
#    error. If this shape ever stops being refused, the build is >= 2.55.0 and
#    §22.4b's version claim needs revisiting. ────────────────────────────────
setup_repohost() {
  start_pg || return 1
  write_conf repohost "repo2-host=repo-host.invalid
repo2-host-user=pgbackrest
repo2-path=/var/lib/pgbackrest"
}

scan_repohost() { echo "0 0 0"; }

scan_sftp() {
  docker exec "${NS}-sftp" sh -c "
    raw=\$(grep -r -a -o '${MARKER}' /var/lib/pgbackrest 2>/dev/null | wc -l)
    mkdir -p /tmp/un; i=0
    for f in \$(find /var/lib/pgbackrest -type f); do
      gzip -dc \"\$f\" > /tmp/un/o\$i 2>/dev/null || cp \"\$f\" /tmp/un/o\$i; i=\$((i+1))
    done
    dec=\$(grep -r -a -o '${MARKER}' /tmp/un 2>/dev/null | wc -l)
    echo \"\$(find /var/lib/pgbackrest -type f | wc -l) \$raw \$dec\"
  " 2>/dev/null | tail -1
}

# ── Run one shape ──────────────────────────────────────────────────────────
RESULTS=""
OVERALL=0

run_shape() {
  local shape="$1"
  local out rc backup_rc info_rc verify_rc restore_rc scan
  log "=== shape: repo2-type=${shape} ==="

  docker rm -f "${NS}-pg" "${NS}-minio" "${NS}-sftp" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true

  if ! "setup_${shape}"; then
    fail "${shape}: environment setup failed — INDETERMINATE, not a topology result"
    RESULTS="${RESULTS}${RESULTS:+,}{\"shape\":\"${shape}\",\"outcome\":\"INDETERMINATE_SETUP\"}"
    [[ "$OVERALL" -eq 0 ]] && OVERALL="$INDETERMINATE_EXIT"
    return
  fi

  docker exec -u postgres "${NS}-pg" pgbackrest --stanza=noramedi stanza-create >/dev/null 2>&1 || true
  seed_marker

  set +e
  out="$(docker exec -u postgres "${NS}-pg" \
        pgbackrest --stanza=noramedi backup --repo=2 --type=full 2>&1)"
  backup_rc=$?
  set -e

  if grep -q '\[072\]' <<<"$out"; then
    if [[ "$shape" == "repohost" ]]; then
      log "repohost: REFUSED with ERROR [072] — EXPECTED. The control is non-vacuous:"
      log "          this harness can distinguish a refused shape from an allowed one."
      RESULTS="${RESULTS}${RESULTS:+,}{\"shape\":\"repohost\",\"role\":\"negative-control\",\"outcome\":\"REFUSED_072\",\"expected\":\"REFUSED_072\",\"controlHeld\":true,\"backupExit\":${backup_rc}}"
      return
    fi
    fail "${shape}: REFUSED with ERROR [072] — primary-driven backup is NOT possible for this shape"
    echo "$out" | tail -5 >&2
    RESULTS="${RESULTS}${RESULTS:+,}{\"shape\":\"${shape}\",\"outcome\":\"REFUSED_072\",\"backupExit\":${backup_rc}}"
    OVERALL="$REFUTED_EXIT"
    return
  fi

  if [[ "$shape" == "repohost" ]]; then
    fail "repohost: NOT refused. The negative control did not hold, so an ALLOWED verdict for the other shapes carries no weight."
    fail "          Either this build is >= 2.55.0 (where the check was removed) or the control config is wrong."
    RESULTS="${RESULTS}${RESULTS:+,}{\"shape\":\"repohost\",\"role\":\"negative-control\",\"outcome\":\"NOT_REFUSED\",\"expected\":\"REFUSED_072\",\"controlHeld\":false,\"backupExit\":${backup_rc}}"
    OVERALL="$REFUTED_EXIT"
    return
  fi

  if [[ "$backup_rc" -ne 0 ]]; then
    fail "${shape}: backup failed WITHOUT ERROR [072] — this is not a topology refusal"
    echo "$out" | tail -5 >&2
    RESULTS="${RESULTS}${RESULTS:+,}{\"shape\":\"${shape}\",\"outcome\":\"INDETERMINATE_BACKUP\",\"backupExit\":${backup_rc}}"
    [[ "$OVERALL" -eq 0 ]] && OVERALL="$INDETERMINATE_EXIT"
    return
  fi

  set +e
  docker exec -u postgres "${NS}-pg" pgbackrest --stanza=noramedi info   --repo=2 >/dev/null 2>&1; info_rc=$?
  docker exec -u postgres "${NS}-pg" pgbackrest --stanza=noramedi verify --repo=2 >/dev/null 2>&1; verify_rc=$?
  docker exec -u postgres "${NS}-pg" bash -c \
    'rm -rf /tmp/r2 && mkdir -p /tmp/r2 && pgbackrest --stanza=noramedi restore --repo=2 --pg1-path=/tmp/r2 --type=none' \
    >/dev/null 2>&1; restore_rc=$?
  set -e

  scan="$("scan_${shape}")"
  local files raw dec
  files="$(awk '{print $1}' <<<"$scan")"
  raw="$(awk  '{print $2}' <<<"$scan")"
  dec="$(awk  '{print $3}' <<<"$scan")"

  log "${shape}: backup=0 info=${info_rc} verify=${verify_rc} restore=${restore_rc}"
  log "${shape}: stored objects=${files:-?} plaintext-marker raw=${raw:-?} decompressed=${dec:-?}"

  if [[ "${raw:-1}" != "0" || "${dec:-1}" != "0" ]]; then
    fail "${shape}: PLAINTEXT PHI MARKER FOUND IN repo2 — the encryption claim FAILS"
    OVERALL="$REFUTED_EXIT"
  fi

  RESULTS="${RESULTS}${RESULTS:+,}{\"shape\":\"${shape}\",\"outcome\":\"ALLOWED\",\"backupExit\":0,\"infoExit\":${info_rc},\"verifyExit\":${verify_rc},\"restoreExit\":${restore_rc},\"storedObjects\":${files:-0},\"plaintextMarkerRaw\":${raw:-0},\"plaintextMarkerDecompressed\":${dec:-0}}"
}

IFS=',' read -r -a SHAPE_LIST <<< "$SHAPES"
for shape in "${SHAPE_LIST[@]}"; do
  case "$shape" in
    repohost|s3|sftp) run_shape "$shape" ;;
    *) fail "unknown shape '$shape' (expected repohost, s3 or sftp)"; exit 2 ;;
  esac
done

VERDICT="TOPOLOGY_CONFIRMED"
[[ "$OVERALL" == "$REFUTED_EXIT" ]]      && VERDICT="TOPOLOGY_REFUTED"
[[ "$OVERALL" == "$INDETERMINATE_EXIT" ]] && VERDICT="INDETERMINATE"

SUMMARY="{\"schemaVersion\":1,\"taskId\":\"F4-FCR-003-R2\",\"runId\":\"${RUN_ID}\",\"evidenceClass\":\"OBSERVED_LOCAL_ONLY\",\"productionAccessed\":false,\"productionMutated\":false,\"syntheticDataOnly\":true,\"pgbackrestVersion\":\"${PGBR_VERSION}\",\"pgbackrestVersionRequested\":\"${PGBR_VERSION_REQ}\",\"postgresImage\":\"${PG_IMAGE}\",\"question\":\"can backup --repo=2 be invoked on the PostgreSQL host for a repo2 with no repository host\",\"verdict\":\"${VERDICT}\",\"shapes\":[${RESULTS}]}"

echo
echo "$SUMMARY"
if [[ -n "$SUMMARY_FILE" ]]; then
  printf '%s\n' "$SUMMARY" > "$SUMMARY_FILE"
  log "summary written to ${SUMMARY_FILE}"
fi

echo
case "$VERDICT" in
  TOPOLOGY_CONFIRMED)
    log "VERDICT: on ${PGBR_VERSION}, every no-repo-host shape exercised allowed"
    log "         primary-driven backup, and the repo-host control was refused."
    if ! grep -q '"shape":"repohost"' <<<"$RESULTS"; then
      log "NOTE:    the repohost negative control was NOT exercised in this run, so"
      log "         nothing here demonstrates the harness is able to detect a refusal."
    fi
    log "This is OBSERVED_LOCAL_ONLY. It does NOT close R-030-DB and authorizes nothing." ;;
  TOPOLOGY_REFUTED)
    log "VERDICT: a shape was refused, or plaintext PHI was found. Runbook §22.4b is WRONG and must be corrected before activation." ;;
  *)
    log "VERDICT: indeterminate — the harness failed for reasons unrelated to topology. Do not read this as either answer." ;;
esac

exit "$OVERALL"
