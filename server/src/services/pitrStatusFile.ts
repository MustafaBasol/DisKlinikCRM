/**
 * pitrStatusFile.ts — F4-FCR-002
 *
 * READER for the PITR / WAL-archive status document published by
 * scripts/noramedi-pgbackrest-status.sh at /var/lib/noramedi/pitr-status.json.
 *
 * DIRECTION MATTERS. Every other status file in this program is written by the
 * application and read by the shell (recoveryStatusFile.ts writes,
 * noramedi-opscheck.sh reads). This one is the reverse: a root-owned shell
 * script writes it and the application reads it. The application therefore:
 *
 *   - never invokes pgbackrest,
 *   - never shells out at all,
 *   - never needs the PostgreSQL superuser,
 *   - never reads the repository cipher passphrase.
 *
 * That is deliberate. `runBackup()` already hands an external script the whole
 * process environment, and adding a second exec path — reachable from an HTTP
 * route, in a process that runs as root — to a subsystem holding a physical
 * copy of every patient table is not a trade worth making for a status panel.
 *
 * FAIL CLOSED, ALWAYS. Missing, unreadable, malformed, wrong-version, stale,
 * or future-dated all resolve to "unavailable" with a bounded machine-readable
 * reason. There is no path on which an absent document reads as healthy —
 * "we could not tell" must never render the same as "it is fine".
 *
 * NO SECRETS AND NO PHI. The document contains states, counts, timestamps and
 * WAL segment names only. This module additionally refuses to surface any
 * string it did not validate against a strict shape, so a corrupted or hostile
 * file cannot push arbitrary text through the Platform Admin API.
 */
import fs from 'node:fs/promises';

/**
 * The only schema version this reader understands.
 *
 * Independent of RECOVERY_STATUS_SCHEMA_VERSION: different file, different
 * writer, different lifecycle. Bumping one must never force a bump of the
 * other — which matters, because the opscheck already installed in production
 * hard-fails any recovery-status document whose version is not 1.
 */
export const PITR_STATUS_SCHEMA_VERSION = 1;

export const DEFAULT_PITR_STATUS_FILE = '/var/lib/noramedi/pitr-status.json';

/**
 * Staleness bound for the document's own `generatedAt`, in minutes.
 *
 * 120 matches NORAMEDI_OPSCHECK_PITR_STATUS_MAX_AGE_HOURS=2 in
 * scripts/noramedi-opscheck.sh. The admin page and the monitor must not
 * disagree about what "stale" means; an operator comparing a green page
 * against a red alert will believe the page.
 */
export const DEFAULT_PITR_STATUS_MAX_AGE_MINUTES = 120;

export function resolvePitrStatusFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = typeof env.NORAMEDI_PITR_STATUS_FILE === 'string' ? env.NORAMEDI_PITR_STATUS_FILE.trim() : '';
  return raw === '' ? DEFAULT_PITR_STATUS_FILE : raw;
}

/**
 * Why the document could not be used. A bounded enum, never free text — the
 * value crosses the HTTP boundary to Platform Admin, and the file is written
 * by an external process whose output is not trusted.
 */
export type PitrStatusUnavailableReason =
  | 'not_configured'
  | 'unreadable'
  | 'malformed'
  | 'unsupported_schema_version'
  | 'stale'
  | 'clock_skew';

/** Tri-state. Deliberately not a boolean — see `offHost` below. */
export type PitrOffHostState = 'no' | 'unproven' | 'yes';

export interface PitrArchiveStatus {
  mode: string;
  commandOk: boolean;
  walLevel?: string;
  timeoutSeconds?: number;
  failedCount?: number;
  archivedCount?: number;
  lastArchivedAt?: string;
  lastArchivedAgeMinutes?: number;
  lastFailedAt?: string;
}

export interface PitrRepoStatus {
  installed: boolean;
  stanza?: string;
  statusOk: boolean;
  statusMessage?: string;
  version?: string;
  cipherType: string;
  encrypted: boolean;
  checkStatus: string;
  checkAt?: string;
  checkAgeMinutes?: number;
  lastBackupAt?: string;
  lastBackupAgeMinutes?: number;
  lastBackupType?: string;
  backupCount?: number;
  walMin?: string;
  walMax?: string;
  /**
   * TRI-STATE, and the reason this is not a boolean.
   *
   * 'no'       — same host, a local path, a loopback endpoint, or plaintext.
   * 'unproven' — a genuinely remote, encrypted repository is configured, but
   *              no restore has ever been performed from it. Configuration is
   *              not proof: a remote-looking hostname can still resolve to
   *              this machine, and an existing repository is no evidence that
   *              anything is recoverable from it.
   * 'yes'      — a restore drill sourced from that repository has passed
   *              within the proof validity window.
   *
   * Collapsing 'unproven' into either neighbour is the failure this type
   * exists to prevent. Rendered as a distinct third state in the UI.
   */
  offHost: PitrOffHostState;
  tier: string;
  offHostReason?: string;
}

export interface PitrStatusDocument {
  schemaVersion: number;
  generatedAt: string;
  archive: PitrArchiveStatus;
  repo: PitrRepoStatus;
}

export interface PitrStatusUnavailable {
  available: false;
  reason: PitrStatusUnavailableReason;
  /** Present for 'stale'/'clock_skew', where the document parsed but was rejected. */
  generatedAt?: string;
  ageMinutes?: number;
  filePath: string;
}

export interface PitrStatusAvailable {
  available: true;
  filePath: string;
  generatedAt: string;
  ageMinutes: number;
  archive: PitrArchiveStatus;
  repo: PitrRepoStatus;
  /**
   * Whether continuous WAL archiving is actually active. FALSE is the correct,
   * expected value today: production runs archive_mode=off and PITR activation
   * needs both a granted freeze exception and a PostgreSQL restart.
   */
  pitrActive: boolean;
}

export type PitrStatus = PitrStatusAvailable | PitrStatusUnavailable;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** A short, identifier-shaped token. Anything else is dropped, not truncated. */
function safeToken(value: unknown, maxLength = 64): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length === 0 || value.length > maxLength) return undefined;
  return /^[A-Za-z0-9_.:+-]+$/.test(value) ? value : undefined;
}

function isoString(value: unknown): string | undefined {
  return typeof value === 'string' && ISO_RE.test(value) ? value : undefined;
}

function uint(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function offHostState(value: unknown): PitrOffHostState {
  // Anything unrecognised collapses to the SAFEST state, never the most
  // optimistic one: under-claiming durability is safe, over-claiming it is not.
  return value === 'yes' || value === 'unproven' ? value : 'no';
}

/**
 * Parses and validates the document. Pure — no filesystem, no clock of its
 * own — so the whole contract is unit-testable without a real file.
 */
export function parsePitrStatusDocument(
  raw: string,
  now: Date,
  filePath: string,
  maxAgeMinutes: number = DEFAULT_PITR_STATUS_MAX_AGE_MINUTES,
): PitrStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { available: false, reason: 'malformed', filePath };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { available: false, reason: 'malformed', filePath };
  }

  const doc = parsed as Record<string, unknown>;

  if (doc.schemaVersion !== PITR_STATUS_SCHEMA_VERSION) {
    // Never interpreted on a guess. A future writer may mean something
    // different by the same field names.
    return { available: false, reason: 'unsupported_schema_version', filePath };
  }

  const generatedAt = isoString(doc.generatedAt);
  if (!generatedAt) return { available: false, reason: 'malformed', filePath };

  const generatedMs = Date.parse(generatedAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(generatedMs)) return { available: false, reason: 'malformed', filePath };
  if (generatedMs > nowMs) {
    // Clock skew fails closed. A future timestamp would otherwise produce a
    // negative age and read as the freshest possible document.
    return { available: false, reason: 'clock_skew', generatedAt, filePath };
  }

  const ageMinutes = Math.floor((nowMs - generatedMs) / 60000);
  if (ageMinutes > maxAgeMinutes) {
    // The writer died. Its last contents still look healthy forever, which is
    // exactly why this gate exists.
    return { available: false, reason: 'stale', generatedAt, ageMinutes, filePath };
  }

  const rawArchive = doc.archive;
  const rawRepo = doc.repo;
  if (typeof rawArchive !== 'object' || rawArchive === null || Array.isArray(rawArchive)) {
    return { available: false, reason: 'malformed', filePath };
  }
  if (typeof rawRepo !== 'object' || rawRepo === null || Array.isArray(rawRepo)) {
    return { available: false, reason: 'malformed', filePath };
  }
  const a = rawArchive as Record<string, unknown>;
  const r = rawRepo as Record<string, unknown>;

  const mode = safeToken(a.mode, 16) ?? 'unknown';
  const commandOk = bool(a.commandOk) ?? false;

  const archive: PitrArchiveStatus = { mode, commandOk };
  const walLevel = safeToken(a.walLevel, 16);
  if (walLevel !== undefined) archive.walLevel = walLevel;
  const timeoutSeconds = uint(a.timeoutSeconds);
  if (timeoutSeconds !== undefined) archive.timeoutSeconds = timeoutSeconds;
  const failedCount = uint(a.failedCount);
  if (failedCount !== undefined) archive.failedCount = failedCount;
  const archivedCount = uint(a.archivedCount);
  if (archivedCount !== undefined) archive.archivedCount = archivedCount;
  const lastArchivedAt = isoString(a.lastArchivedAt);
  if (lastArchivedAt !== undefined) archive.lastArchivedAt = lastArchivedAt;
  const lastArchivedAgeMinutes = uint(a.lastArchivedAgeMinutes);
  if (lastArchivedAgeMinutes !== undefined) archive.lastArchivedAgeMinutes = lastArchivedAgeMinutes;
  const lastFailedAt = isoString(a.lastFailedAt);
  if (lastFailedAt !== undefined) archive.lastFailedAt = lastFailedAt;

  const cipherType = safeToken(r.cipherType, 32) ?? 'none';
  const repo: PitrRepoStatus = {
    installed: bool(r.installed) ?? false,
    statusOk: bool(r.statusOk) ?? false,
    cipherType,
    // The repository holds a physical copy of every table, including
    // özel nitelikli sağlık verisi, and no patient column is encrypted at
    // column level. Only the one cipher this program configures counts.
    encrypted: cipherType === 'aes-256-cbc',
    checkStatus: safeToken(r.checkStatus, 16) ?? 'not_run',
    offHost: offHostState(r.offHost),
    tier: safeToken(r.tier, 4) ?? 'T0',
  };
  const stanza = safeToken(r.stanza, 32);
  if (stanza !== undefined) repo.stanza = stanza;
  const version = safeToken(r.version, 32);
  if (version !== undefined) repo.version = version;
  const checkAt = isoString(r.checkAt);
  if (checkAt !== undefined) repo.checkAt = checkAt;
  const checkAgeMinutes = uint(r.checkAgeMinutes);
  if (checkAgeMinutes !== undefined) repo.checkAgeMinutes = checkAgeMinutes;
  const lastBackupAt = isoString(r.lastBackupAt);
  if (lastBackupAt !== undefined) repo.lastBackupAt = lastBackupAt;
  const lastBackupAgeMinutes = uint(r.lastBackupAgeMinutes);
  if (lastBackupAgeMinutes !== undefined) repo.lastBackupAgeMinutes = lastBackupAgeMinutes;
  const lastBackupType = safeToken(r.lastBackupType, 8);
  if (lastBackupType !== undefined) repo.lastBackupType = lastBackupType;
  const backupCount = uint(r.backupCount);
  if (backupCount !== undefined) repo.backupCount = backupCount;
  const walMin = safeToken(r.walMin, 40);
  if (walMin !== undefined) repo.walMin = walMin;
  const walMax = safeToken(r.walMax, 40);
  if (walMax !== undefined) repo.walMax = walMax;
  const offHostReason = safeToken(r.offHostReason, 48);
  if (offHostReason !== undefined) repo.offHostReason = offHostReason;
  const statusMessage = typeof r.statusMessage === 'string'
    ? r.statusMessage.slice(0, 120).replace(/[^\x20-\x7E]/g, ' ')
    : undefined;
  if (statusMessage !== undefined) repo.statusMessage = statusMessage;

  return {
    available: true,
    filePath,
    generatedAt,
    ageMinutes,
    archive,
    repo,
    // BOTH conditions. archive_mode=on with a tampered archive_command is the
    // most dangerous state available here: PostgreSQL marks segments archived
    // and recycles them while nothing reaches the repository, and every
    // dashboard stays green. That must not report as "PITR active".
    pitrActive: (mode === 'on' || mode === 'always') && commandOk,
  };
}

/**
 * Reads the document from disk. Never throws and never rejects — a Platform
 * Admin page must not 500 because a monitoring file is absent, which is the
 * normal state today.
 */
export async function readPitrStatus(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<PitrStatus> {
  const filePath = resolvePitrStatusFilePath(env);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    // ENOENT is the expected, un-alarming case: PITR is not activated, so
    // nothing has written the file. Distinguished from a genuine read error so
    // the UI can say "not configured" rather than "something is broken".
    const code = (err as NodeJS.ErrnoException | null)?.code;
    return { available: false, reason: code === 'ENOENT' ? 'not_configured' : 'unreadable', filePath };
  }
  return parsePitrStatusDocument(raw, now, filePath);
}
