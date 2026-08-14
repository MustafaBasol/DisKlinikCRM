import React, { useEffect, useState } from 'react';
import {
  HardDrive,
  RefreshCw,
  PlayCircle,
  FlaskConical,
  CheckCircle2,
  XCircle,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
  Loader2,
  FileText,
  Files,
  Clock,
  Timer,
  Database,
  ScrollText,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlatformApi } from '../../context/PlatformAuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BackupFileMeta {
  filename: string;
  createdAt: string;
  sizeBytes: number;
  sizeHuman: string;
}

interface BackupStatus {
  backupDirAccessible: boolean;
  scriptExists: boolean;
  scriptExecutable: boolean;
  cronExists: boolean;
  logExists: boolean;
  retentionDays: number;
  totalBackupCount: number;
  totalSizeBytes: number;
  totalSizeHuman: string;
  latestBackup: BackupFileMeta | null;
  recentBackups: BackupFileMeta[];
  currentlyRunning: boolean;
  // Present only on GET /platform/recovery/status (dbBackup tier).
  latestBackupAgeMinutes?: number | null;
  staleThresholdHours?: number | null;
  stale?: boolean;
}

interface FileBackupRunSummary {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  trigger: string;
  filesScanned: number | null;
  filesCopied: number | null;
  filesVerified: number | null;
  filesSkipped: number | null;
  filesFailed: number | null;
  filesMissing: number | null;
  bytesCopied: string | number | null;
}

interface FileBackupTotals {
  entries: number | null;
  verified: number | null;
  failed: number | null;
  missingSource: number | null;
}

interface FileBackupStatus {
  enabled: boolean;
  destinationConfigured: boolean;
  destinationKind: string;
  destinationOffHost: boolean;
  currentlyRunning: boolean;
  lastRun: FileBackupRunSummary | null;
  totals: FileBackupTotals | null;
  lastRunAgeMinutes: number | null;
  stale: boolean;
  staleThresholdHours: number | null;
}

interface DrillSummary {
  id: string;
  kind: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  sourceArtifactAt: string | null;
  sourceArtifactAgeMinutes: number | null;
  samplesAttempted: number | null;
  samplesPassed: number | null;
  samplesFailed: number | null;
  cleanupVerified: boolean | null;
  residualArtifact: string | null;
  errorCode: string | null;
  ageMinutes: number | null;
}

interface DrillsStatus {
  lastDbRestoreTest: DrillSummary | null;
  lastFileRestoreRehearsal: DrillSummary | null;
  staleThresholdHours: number | null;
  dbRestoreTestStale: boolean;
  fileRestoreRehearsalStale: boolean;
  residualArtifacts: DrillSummary[] | null;
  runningDrills: number | null;
}

interface RecoveryStatus {
  dbBackup: BackupStatus;
  fileBackup: FileBackupStatus | null;
  drills: DrillsStatus | null;
}

interface RunBackupResult {
  success: boolean;
  durationMs: number;
  latestBackup: BackupFileMeta | null;
  error?: string;
}

interface RestoreTestResult {
  backupFilename: string;
  /**
   * The scratch database the restore test created. The server redacts this to
   * a placeholder when it verified the drop; when cleanup FAILED it returns
   * the real name, because that is the exact object the operator has to drop
   * by hand. Never mask or truncate it in the UI.
   */
  tempDbName: string;
  success: boolean;
  tableCount?: number;
  platformAdminCount?: number;
  planCount?: number;
  migrationsCount?: number;
  durationMs: number;
  errorSummary?: string;
  /**
   * False ⇒ a full plaintext copy of the patient database is still on the
   * production cluster. The status endpoint also reports this on the next
   * refresh, but the operator who pressed the button must see it immediately,
   * in the result panel, not only after re-reading the page.
   */
  cleanupVerified?: boolean;
  /** Ledger row id for this drill, for cross-referencing the evidence table. */
  drillRunId?: string | null;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ ok: boolean; labelOk: string; labelFail: string }> = ({ ok, labelOk, labelFail }) =>
  ok ? (
    <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 text-xs font-medium">
      <CheckCircle2 size={14} /> {labelOk}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-red-500 dark:text-red-400 text-xs font-medium">
      <XCircle size={14} /> {labelFail}
    </span>
  );

const InfoRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-800 last:border-0">
    <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
    <span className="text-sm font-medium text-gray-900 dark:text-white">{value}</span>
  </div>
);

/**
 * Loud, full-width banner for states an operator must not be able to scroll
 * past: no backup at all, file backup switched off, an on-host-only
 * destination, a never-run drill, a residual plaintext DB copy left behind.
 * `alarm` is red and carries a shield icon, `warn` is amber.
 */
const AlertBanner: React.FC<{
  level: 'alarm' | 'warn';
  title: string;
  detail?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ level, title, detail, children }) => (
  <div
    role="alert"
    className={`rounded-xl border-2 p-4 ${
      level === 'alarm'
        ? 'bg-red-50 dark:bg-red-950/40 border-red-500 dark:border-red-600'
        : 'bg-amber-50 dark:bg-amber-950/30 border-amber-400 dark:border-amber-600'
    }`}
  >
    <div className="flex items-start gap-3">
      {level === 'alarm' ? (
        <ShieldAlert size={22} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle size={22} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={`font-bold text-sm uppercase tracking-wide ${
            level === 'alarm' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
          }`}
        >
          {title}
        </p>
        {detail && (
          <p className={`text-sm mt-1 ${level === 'alarm' ? 'text-red-700 dark:text-red-200' : 'text-amber-800 dark:text-amber-200'}`}>
            {detail}
          </p>
        )}
        {children}
      </div>
    </div>
  </div>
);

/** Counter tile — turns red the moment a "should always be zero" counter isn't. */
const CounterTile: React.FC<{ label: string; value: React.ReactNode; danger?: boolean }> = ({ label, value, danger }) => (
  <div
    className={`p-3 rounded-lg border ${
      danger
        ? 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-700'
        : 'bg-gray-50 dark:bg-gray-800/40 border-gray-100 dark:border-gray-800'
    }`}
  >
    <p className={`text-xs mb-0.5 ${danger ? 'text-red-700 dark:text-red-300 font-semibold' : 'text-gray-500'}`}>{label}</p>
    <p
      className={`text-xl font-bold flex items-center gap-1.5 ${
        danger ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-white'
      }`}
    >
      {danger && <AlertTriangle size={16} />}
      {value}
    </p>
  </div>
);

const SectionCard: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
    <div className="flex items-center gap-2 mb-4">
      {icon}
      <h2 className="font-semibold text-gray-900 dark:text-white">{title}</h2>
    </div>
    {children}
  </div>
);

// ── Pure formatting helpers (locale-free parts) ───────────────────────────────

const minutesSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
};

const formatBytes = (raw: string | number | null | undefined): string => {
  if (raw === null || raw === undefined || raw === '') return '—';
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (!Number.isFinite(n) || n < 0) return String(raw);
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
};

const num = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Enum tokens the backend emits. Anything unmapped is rendered verbatim (it is
// a machine token, not prose, so it stays readable in every language).
const RUN_STATUS_KEYS: Record<string, string> = {
  completed: 'statusCompleted',
  passed: 'statusPassed',
  failed: 'statusFailed',
  running: 'statusRunning',
  partial: 'statusPartial',
  skipped: 'statusSkipped',
};

const TRIGGER_KEYS: Record<string, string> = {
  scheduled: 'triggerScheduled',
  manual: 'triggerManual',
  startup: 'triggerStartup',
};

const OK_STATUSES = new Set(['completed', 'passed']);

/**
 * Statuses that mean "still working", not "finished badly" (F4-FCR-001-R1 /
 * H1-UI). Treating these as failures painted the whole page red during every
 * normal nightly sweep, and — because a row that has not finished cannot have
 * verified its own cleanup — also raised a cleanup alarm for a run that simply
 * had not got there yet. An operator who learns that red is routine stops
 * reading red at all, which is the actual danger.
 *
 * This state is bounded: a row abandoned by a crashed process is swept to
 * `failed` by the recovery reapers, so "in progress" cannot persist forever.
 */
const IN_PROGRESS_STATUSES = new Set(['running']);

/** In flight = an in-progress status AND no finish timestamp yet. */
const isInFlight = (status: string | null | undefined, finishedAt: string | null | undefined): boolean =>
  !!status && IN_PROGRESS_STATUSES.has(status) && !finishedAt;

// ── Component ─────────────────────────────────────────────────────────────────

const PlatformBackups: React.FC = () => {
  const { t, i18n } = useTranslation(['platform']);
  const api = usePlatformApi();

  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [recovery, setRecovery] = useState<RecoveryStatus | null>(null);
  const [recoveryDegraded, setRecoveryDegraded] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [logs, setLogs] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [logsVisible, setLogsVisible] = useState(false);

  const [runLoading, setRunLoading] = useState(false);
  const [runResult, setRunResult] = useState<RunBackupResult | null>(null);
  const [runError, setRunError] = useState('');

  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreTestResult | null>(null);
  const [restoreError, setRestoreError] = useState('');

  // ── i18n-aware formatters ───────────────────────────────────────────────────

  const formatAge = (minutes: number | null | undefined): string => {
    if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return t('platform:backups.ageUnknown');
    const m = Math.max(0, Math.round(minutes));
    if (m < 1) return t('platform:backups.ageJustNow');
    if (m < 60) return t('platform:backups.ageMinutesAgo', { n: m });
    if (m < 2880) return t('platform:backups.ageHoursAgo', { n: Math.floor(m / 60) });
    return t('platform:backups.ageDaysAgo', { n: Math.floor(m / 1440) });
  };

  const formatDuration = (ms: number | null | undefined): string => {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return t('platform:backups.ageUnknown');
    if (ms < 1000) return t('platform:backups.durationMs', { n: Math.round(ms) });
    const totalSec = ms / 1000;
    if (totalSec < 60) return t('platform:backups.durationSeconds', { n: totalSec.toFixed(1) });
    return t('platform:backups.durationMinutes', { m: Math.floor(totalSec / 60), s: Math.round(totalSec % 60) });
  };

  const localDate = (iso: string | null | undefined): string =>
    iso ? new Date(iso).toLocaleString(i18n.language || 'tr') : '—';

  const runStatusLabel = (raw: string | null | undefined): string => {
    if (!raw) return t('platform:backups.ageUnknown');
    const key = RUN_STATUS_KEYS[raw];
    return key ? t(`platform:backups.${key}`) : raw;
  };

  const triggerLabel = (raw: string | null | undefined): string => {
    if (!raw) return t('platform:backups.ageUnknown');
    const key = TRIGGER_KEYS[raw];
    return key ? t(`platform:backups.${key}`) : raw;
  };

  // ── Fetch status ────────────────────────────────────────────────────────────
  // One call to the consolidated recovery endpoint. If it is unavailable (older
  // server, route error) we degrade to the legacy DB-only status endpoint
  // rather than rendering a blank page.

  const fetchStatus = async () => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const res = await api.get('/platform/recovery/status');
      const data = res.data as RecoveryStatus | null;
      if (!data || !data.dbBackup) throw new Error('malformed recovery payload');
      setRecovery(data);
      setStatus(data.dbBackup);
      setRecoveryDegraded(false);
    } catch {
      setRecovery(null);
      setRecoveryDegraded(true);
      try {
        const res = await api.get('/platform/backups/status');
        setStatus(res.data);
      } catch {
        setStatus(null);
        setStatusError(t('platform:backups.statusLoadFailed'));
      }
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => { void fetchStatus(); }, []);

  // ── Fetch logs ──────────────────────────────────────────────────────────────

  const fetchLogs = () => {
    setLogsLoading(true);
    setLogsError('');
    api
      .get('/platform/backups/logs', { params: { lines: 100 } })
      .then((res) => { setLogs(res.data.lines ?? []); setLogsVisible(true); })
      .catch(() => setLogsError(t('platform:backups.logsLoadFailed')))
      .finally(() => setLogsLoading(false));
  };

  // ── Run backup ──────────────────────────────────────────────────────────────

  const handleRunBackup = async () => {
    setRunLoading(true);
    setRunResult(null);
    setRunError('');
    try {
      const res = await api.post('/platform/backups/run');
      setRunResult(res.data);
      void fetchStatus();
    } catch (err: any) {
      if (err.response?.status === 409) {
        setRunError(t('platform:backups.alreadyRunning'));
      } else {
        setRunError(err.response?.data?.error ?? t('platform:backups.runFailed'));
      }
    } finally {
      setRunLoading(false);
    }
  };

  // ── Restore test ────────────────────────────────────────────────────────────

  const handleRestoreTest = async () => {
    setRestoreLoading(true);
    setRestoreResult(null);
    setRestoreError('');
    try {
      const res = await api.post('/platform/backups/restore-test');
      setRestoreResult(res.data);
      void fetchStatus();
    } catch (err: any) {
      if (err.response?.status === 409) {
        setRestoreError(t('platform:backups.alreadyRunning'));
      } else {
        setRestoreError(err.response?.data?.error ?? t('platform:backups.restoreTestFailed'));
      }
    } finally {
      setRestoreLoading(false);
    }
  };

  // ── Derived recovery posture ────────────────────────────────────────────────

  const fileBackup = recovery?.fileBackup ?? null;
  const drills = recovery?.drills ?? null;
  const residualArtifacts = (drills?.residualArtifacts ?? []).filter((d) => !!d && !!d.residualArtifact);

  const dbThresholdHours = status?.staleThresholdHours ?? null;
  const dbAgeMinutes = status?.latestBackup
    ? (typeof status.latestBackupAgeMinutes === 'number'
        ? status.latestBackupAgeMinutes
        : minutesSince(status.latestBackup.createdAt))
    : null;
  const dbNoBackup = !!status && !status.latestBackup;
  // Without a server-supplied threshold (legacy fallback endpoint) we can show
  // the age but must not claim the backup is fresh — that would be a green
  // light we have no basis for.
  const dbStalenessKnown = typeof status?.stale === 'boolean' || dbThresholdHours !== null;
  const dbStale = !!status?.latestBackup && (
    typeof status.stale === 'boolean'
      ? status.stale
      : dbAgeMinutes !== null && dbThresholdHours !== null && dbAgeMinutes > dbThresholdHours * 60
  );

  const fileRun = fileBackup?.lastRun ?? null;
  const fileRunAgeMinutes = fileBackup
    ? (typeof fileBackup.lastRunAgeMinutes === 'number' ? fileBackup.lastRunAgeMinutes : minutesSince(fileRun?.startedAt))
    : null;
  // The server derives freshness from `finishedAt` only, so a sweep that is
  // still in flight reports `stale: true` for the duration of the run. That is
  // the right server-side default (an unfinished run produced no artifact) but
  // it is not something to alarm a human about while the run is happening —
  // the card below shows it as in-progress instead. Bounded by the reaper: an
  // abandoned run is swept to `failed` within the reaper cutoff, after which
  // the stale warning appears normally.
  const fileRunInFlight = isInFlight(fileRun?.status, fileRun?.finishedAt);
  const fileRunFailures = num(fileRun?.filesFailed) > 0 || num(fileRun?.filesMissing) > 0;
  const fileTotalsFailures = num(fileBackup?.totals?.failed) > 0 || num(fileBackup?.totals?.missingSource) > 0;

  // ── Drill card ──────────────────────────────────────────────────────────────

  const renderDrill = (titleKey: string, drill: DrillSummary | null, stale: boolean) => {
    if (!drill) {
      return (
        <div className="rounded-xl border-2 border-red-500 dark:border-red-600 bg-red-50 dark:bg-red-950/40 p-5">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert size={18} className="text-red-600 dark:text-red-400" />
            <h3 className="font-semibold text-red-700 dark:text-red-300">{t(titleKey)}</h3>
          </div>
          <p className="text-sm font-bold uppercase tracking-wide text-red-700 dark:text-red-300">
            {t('platform:backups.drillNeverRun')}
          </p>
          <p className="text-sm text-red-700 dark:text-red-200 mt-1">{t('platform:backups.drillNeverRunDetail')}</p>
        </div>
      );
    }

    const inFlight = isInFlight(drill.status, drill.finishedAt);
    const ok = OK_STATUSES.has(drill.status);
    const samplesFailed = num(drill.samplesFailed) > 0;
    // A named residual object is always an alarm. `cleanupVerified: false` on
    // its own is only meaningful once the drill has finished — before that it
    // is simply "not yet", not "leaked".
    const cleanupBad = !!drill.residualArtifact || (!inFlight && drill.cleanupVerified === false);
    const bad = cleanupBad || samplesFailed || (!inFlight && !ok);
    const ageMinutes = typeof drill.ageMinutes === 'number' ? drill.ageMinutes : minutesSince(drill.startedAt);

    return (
      <div
        data-testid={`drill-card-${drill.kind}`}
        data-state={bad ? 'bad' : inFlight ? 'in-progress' : stale ? 'stale' : 'ok'}
        className={`rounded-xl border p-5 ${
          bad
            ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30'
            : inFlight
              ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/20'
              : stale
                ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20'
                : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900'
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          {bad ? (
            <XCircle size={18} className="text-red-600 dark:text-red-400" />
          ) : inFlight ? (
            <Loader2 size={18} className="animate-spin text-blue-600 dark:text-blue-400" />
          ) : (
            <CheckCircle2 size={18} className="text-green-600 dark:text-green-400" />
          )}
          <h3 className="font-semibold text-gray-900 dark:text-white">{t(titleKey)}</h3>
        </div>

        {stale && (
          <p className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <AlertTriangle size={14} />
            {t('platform:backups.drillStaleWarning', { hours: drills?.staleThresholdHours ?? '—' })}
          </p>
        )}

        <InfoRow
          label={t('platform:backups.drillStatus')}
          value={
            <span
              className={
                bad
                  ? 'text-red-600 dark:text-red-400 font-semibold'
                  : inFlight
                    ? 'inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold'
                    : 'text-green-600 dark:text-green-400 font-semibold'
              }
            >
              {inFlight && <Loader2 size={13} className="animate-spin" />}
              {runStatusLabel(drill.status)}
            </span>
          }
        />
        <InfoRow label={t('platform:backups.drillAge')} value={`${formatAge(ageMinutes)} — ${localDate(drill.startedAt)}`} />
        <InfoRow label={t('platform:backups.drillTrigger')} value={triggerLabel(drill.trigger)} />
        <InfoRow label={t('platform:backups.drillDuration')} value={formatDuration(drill.durationMs)} />
        <InfoRow
          label={t('platform:backups.drillRpo')}
          value={
            drill.sourceArtifactAgeMinutes === null || drill.sourceArtifactAgeMinutes === undefined
              ? t('platform:backups.ageUnknown')
              : formatAge(drill.sourceArtifactAgeMinutes)
          }
        />
        <InfoRow
          label={t('platform:backups.drillSamples')}
          value={
            <span className={samplesFailed ? 'text-red-600 dark:text-red-400 font-semibold' : undefined}>
              {t('platform:backups.drillSamplesValue', { passed: num(drill.samplesPassed), attempted: num(drill.samplesAttempted) })}
              {samplesFailed ? ` — ${t('platform:backups.drillSamplesFailed', { failed: num(drill.samplesFailed) })}` : ''}
            </span>
          }
        />
        <InfoRow
          label={t('platform:backups.drillCleanup')}
          value={
            inFlight ? (
              // Not "cleanup failed" — the drill has not reached its cleanup
              // step yet. Reporting a red alarm here would train operators to
              // ignore the one signal that means a plaintext database copy was
              // actually left behind.
              <span className="text-sm text-gray-500 dark:text-gray-400">{t('platform:backups.ageUnknown')}</span>
            ) : (
              <StatusBadge
                ok={drill.cleanupVerified === true}
                labelOk={t('platform:backups.cleanupVerified')}
                labelFail={t('platform:backups.cleanupNotVerified')}
              />
            )
          }
        />
        {drill.errorCode && (
          <InfoRow
            label={t('platform:backups.drillErrorCode')}
            value={<span className="font-mono text-xs text-red-600 dark:text-red-400">{drill.errorCode}</span>}
          />
        )}
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <HardDrive size={24} className="text-blue-500" />
          {t('platform:backups.title')}
        </h1>
        <button
          onClick={() => { void fetchStatus(); }}
          disabled={statusLoading}
          className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          {statusLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {t('platform:actions.refresh')}
        </button>
      </div>

      {statusLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 size={28} className="animate-spin text-blue-500" />
        </div>
      ) : statusError ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
          <AlertCircle size={18} />
          <span>{statusError}</span>
        </div>
      ) : status ? (
        <>
          {/* ── Residual restore artifacts (highest severity) ──────────────── */}
          {residualArtifacts.length > 0 && (
            <AlertBanner
              level="alarm"
              title={t('platform:backups.residualTitle')}
              detail={t('platform:backups.residualDetail')}
            >
              <ul className="mt-3 space-y-2">
                {residualArtifacts.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white dark:bg-red-950/60 border border-red-300 dark:border-red-700 rounded-lg px-3 py-2"
                  >
                    <Trash2 size={14} className="text-red-600 dark:text-red-400 shrink-0" />
                    <code className="font-mono text-sm font-bold text-red-700 dark:text-red-300 break-all">
                      {d.residualArtifact}
                    </code>
                    <span className="text-xs text-red-700 dark:text-red-300">
                      {t('platform:backups.residualStartedAt')}: {localDate(d.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </AlertBanner>
          )}

          {/* ── Top-level recovery alarms ──────────────────────────────────── */}
          {dbNoBackup && (
            <AlertBanner
              level="alarm"
              title={t('platform:backups.noBackupAlarmTitle')}
              detail={t('platform:backups.noBackupAlarmDetail')}
            />
          )}
          {dbStale && (
            <AlertBanner
              level="warn"
              title={t('platform:backups.dbStaleTitle')}
              detail={t('platform:backups.dbStaleDetail', {
                age: formatAge(dbAgeMinutes),
                hours: dbThresholdHours ?? '—',
              })}
            />
          )}
          {fileBackup && !fileBackup.enabled && (
            <AlertBanner
              level="alarm"
              title={t('platform:backups.fileDisabledTitle')}
              detail={t('platform:backups.fileDisabledDetail')}
            />
          )}
          {fileBackup && fileBackup.enabled && !fileBackup.destinationConfigured && (
            <AlertBanner
              level="alarm"
              title={t('platform:backups.fileNoDestinationTitle')}
              detail={t('platform:backups.fileNoDestinationDetail')}
            />
          )}
          {fileBackup && fileBackup.enabled && fileBackup.destinationConfigured && !fileBackup.destinationOffHost && (
            <AlertBanner
              level="alarm"
              title={t('platform:backups.fileOnHostTitle')}
              detail={t('platform:backups.fileOnHostDetail')}
            />
          )}
          {fileBackup && fileBackup.enabled && fileRunFailures && (
            <AlertBanner
              level="alarm"
              title={t('platform:backups.fileFailuresTitle')}
              detail={t('platform:backups.fileFailuresDetail', {
                failed: num(fileRun?.filesFailed),
                missing: num(fileRun?.filesMissing),
              })}
            />
          )}
          {fileBackup && fileBackup.enabled && fileBackup.stale && !fileRunInFlight && (
            <AlertBanner
              level="warn"
              title={t('platform:backups.fileStaleTitle')}
              detail={t('platform:backups.fileStaleDetail', {
                age: fileRun ? formatAge(fileRunAgeMinutes) : t('platform:backups.fileNeverRun'),
                hours: fileBackup.staleThresholdHours ?? '—',
              })}
            />
          )}
          {recoveryDegraded && (
            <AlertBanner
              level="warn"
              title={t('platform:backups.recoveryUnavailableTitle')}
              detail={t('platform:backups.recoveryUnavailableDetail')}
            />
          )}

          {/* ── Infrastructure health ─────────────────────────────────────── */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Left: infra status */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Database size={18} className="text-blue-500" />
                <h2 className="font-semibold text-gray-900 dark:text-white">{t('platform:backups.infraTitle')}</h2>
              </div>
              <InfoRow
                label={t('platform:backups.backupDir')}
                value={<StatusBadge ok={status.backupDirAccessible} labelOk={t('platform:backups.accessible')} labelFail={t('platform:backups.inaccessible')} />}
              />
              <InfoRow
                label={t('platform:backups.backupScript')}
                value={<StatusBadge ok={status.scriptExists && status.scriptExecutable} labelOk={t('platform:backups.ready')} labelFail={t('platform:backups.missing')} />}
              />
              <InfoRow
                label={t('platform:backups.cronFile')}
                value={<StatusBadge ok={status.cronExists} labelOk={t('platform:backups.exists')} labelFail={t('platform:backups.missing')} />}
              />
              <InfoRow
                label={t('platform:backups.logFile')}
                value={<StatusBadge ok={status.logExists} labelOk={t('platform:backups.exists')} labelFail={t('platform:backups.missing')} />}
              />
              <InfoRow label={t('platform:backups.retentionDays')} value={`${status.retentionDays} ${t('platform:privacy.days')}`} />
              {dbThresholdHours !== null && (
                <InfoRow
                  label={t('platform:backups.staleThreshold')}
                  value={t('platform:backups.hoursValue', { n: dbThresholdHours })}
                />
              )}
            </div>

            {/* Right: summary */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
              <div className="flex items-center gap-2 mb-4">
                <FileText size={18} className="text-purple-500" />
                <h2 className="font-semibold text-gray-900 dark:text-white">{t('platform:backups.summaryTitle')}</h2>
              </div>
              <InfoRow label={t('platform:backups.totalCount')} value={status.totalBackupCount} />
              <InfoRow label={t('platform:backups.totalSize')} value={status.totalSizeHuman} />
              {status.latestBackup ? (
                <>
                  <InfoRow label={t('platform:backups.latestFile')} value={
                    <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{status.latestBackup.filename}</span>
                  } />
                  <InfoRow
                    label={t('platform:backups.latestCreated')}
                    value={new Date(status.latestBackup.createdAt).toLocaleString(i18n.language || 'tr')}
                  />
                  <InfoRow
                    label={t('platform:backups.latestAge')}
                    value={
                      <span
                        className={`inline-flex items-center gap-1.5 font-semibold ${
                          dbStale
                            ? 'text-red-600 dark:text-red-400'
                            : dbStalenessKnown
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-gray-900 dark:text-white'
                        }`}
                      >
                        {dbStale ? <AlertTriangle size={14} /> : dbStalenessKnown ? <CheckCircle2 size={14} /> : null}
                        {formatAge(dbAgeMinutes)}
                        {dbStale ? ` — ${t('platform:backups.staleLabel')}` : ''}
                      </span>
                    }
                  />
                  <InfoRow label={t('platform:backups.latestSize')} value={status.latestBackup.sizeHuman} />
                </>
              ) : (
                <div className="mt-3 rounded-lg border-2 border-red-500 dark:border-red-600 bg-red-50 dark:bg-red-950/40 p-3">
                  <p className="inline-flex items-center gap-2 text-sm font-bold text-red-700 dark:text-red-300">
                    <ShieldAlert size={16} />
                    {t('platform:backups.noBackups')}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── File backup tier ──────────────────────────────────────────── */}
          {fileBackup && (
            <div className="grid md:grid-cols-2 gap-4">
              <SectionCard
                icon={<Files size={18} className={fileBackup.enabled ? 'text-cyan-500' : 'text-red-500'} />}
                title={t('platform:backups.fileTitle')}
              >
                <InfoRow
                  label={t('platform:backups.fileEnabled')}
                  value={
                    fileBackup.enabled ? (
                      <StatusBadge ok labelOk={t('platform:backups.enabledLabel')} labelFail={t('platform:backups.disabledLabel')} />
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">
                        <ShieldAlert size={13} />
                        {t('platform:backups.disabledLabel')}
                      </span>
                    )
                  }
                />
                <InfoRow
                  label={t('platform:backups.fileDestinationConfigured')}
                  value={
                    <StatusBadge
                      ok={fileBackup.destinationConfigured}
                      labelOk={t('platform:backups.configuredLabel')}
                      labelFail={t('platform:backups.notConfiguredLabel')}
                    />
                  }
                />
                <InfoRow
                  label={t('platform:backups.fileDestinationKind')}
                  value={
                    fileBackup.destinationKind === 'none' || !fileBackup.destinationKind
                      ? <span className="text-red-600 dark:text-red-400 font-semibold">{t('platform:backups.destKindNone')}</span>
                      : <span className="font-mono text-xs">{fileBackup.destinationKind}</span>
                  }
                />
                <InfoRow
                  label={t('platform:backups.fileDestinationOffHost')}
                  value={
                    fileBackup.destinationOffHost ? (
                      <StatusBadge ok labelOk={t('platform:backups.offHostYes')} labelFail={t('platform:backups.offHostNo')} />
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">
                        <ShieldAlert size={13} />
                        {t('platform:backups.offHostNo')}
                      </span>
                    )
                  }
                />
                <InfoRow
                  label={t('platform:backups.currentlyRunning')}
                  value={fileBackup.currentlyRunning ? t('platform:backups.yes') : t('platform:backups.no')}
                />
                {fileBackup.staleThresholdHours !== null && fileBackup.staleThresholdHours !== undefined && (
                  <InfoRow
                    label={t('platform:backups.staleThreshold')}
                    value={t('platform:backups.hoursValue', { n: fileBackup.staleThresholdHours })}
                  />
                )}
              </SectionCard>

              <SectionCard icon={<Clock size={18} className="text-cyan-500" />} title={t('platform:backups.fileLastRunTitle')}>
                {fileRun ? (
                  <>
                    <InfoRow
                      label={t('platform:backups.fileRunStatus')}
                      value={
                        <span
                          data-testid="file-run-status"
                          data-state={fileRunInFlight ? 'in-progress' : OK_STATUSES.has(fileRun.status) ? 'ok' : 'bad'}
                          className={
                            fileRunInFlight
                              ? 'inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold'
                              : OK_STATUSES.has(fileRun.status)
                                ? 'text-green-600 dark:text-green-400 font-semibold'
                                : 'text-red-600 dark:text-red-400 font-semibold'
                          }
                        >
                          {fileRunInFlight && <Loader2 size={13} className="animate-spin" />}
                          {runStatusLabel(fileRun.status)}
                        </span>
                      }
                    />
                    <InfoRow
                      label={t('platform:backups.fileRunAge')}
                      value={
                        <span className={fileBackup.stale && !fileRunInFlight ? 'text-red-600 dark:text-red-400 font-semibold' : undefined}>
                          {formatAge(fileRunAgeMinutes)} — {localDate(fileRun.startedAt)}
                        </span>
                      }
                    />
                    <InfoRow label={t('platform:backups.fileRunTrigger')} value={triggerLabel(fileRun.trigger)} />
                    <InfoRow label={t('platform:backups.bytesCopied')} value={formatBytes(fileRun.bytesCopied)} />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
                      <CounterTile label={t('platform:backups.filesScanned')} value={num(fileRun.filesScanned)} />
                      <CounterTile label={t('platform:backups.filesCopied')} value={num(fileRun.filesCopied)} />
                      <CounterTile label={t('platform:backups.filesVerified')} value={num(fileRun.filesVerified)} />
                      <CounterTile label={t('platform:backups.filesSkipped')} value={num(fileRun.filesSkipped)} />
                      <CounterTile label={t('platform:backups.filesFailed')} value={num(fileRun.filesFailed)} danger={num(fileRun.filesFailed) > 0} />
                      <CounterTile label={t('platform:backups.filesMissing')} value={num(fileRun.filesMissing)} danger={num(fileRun.filesMissing) > 0} />
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border-2 border-red-500 dark:border-red-600 bg-red-50 dark:bg-red-950/40 p-3">
                    <p className="inline-flex items-center gap-2 text-sm font-bold text-red-700 dark:text-red-300">
                      <ShieldAlert size={16} />
                      {t('platform:backups.fileNeverRun')}
                    </p>
                  </div>
                )}

                {fileBackup.totals && (
                  <>
                    <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {t('platform:backups.fileTotalsTitle')}
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <CounterTile label={t('platform:backups.totalEntries')} value={num(fileBackup.totals.entries)} />
                      <CounterTile label={t('platform:backups.totalVerified')} value={num(fileBackup.totals.verified)} />
                      <CounterTile
                        label={t('platform:backups.totalFailed')}
                        value={num(fileBackup.totals.failed)}
                        danger={num(fileBackup.totals.failed) > 0}
                      />
                      <CounterTile
                        label={t('platform:backups.totalMissingSource')}
                        value={num(fileBackup.totals.missingSource)}
                        danger={num(fileBackup.totals.missingSource) > 0}
                      />
                    </div>
                    {fileTotalsFailures && (
                      <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
                        <AlertTriangle size={14} />
                        {t('platform:backups.fileTotalsFailuresNote')}
                      </p>
                    )}
                  </>
                )}
              </SectionCard>
            </div>
          )}

          {/* ── Restore drills ────────────────────────────────────────────── */}
          {drills && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Timer size={18} className="text-violet-500" />
                <h2 className="font-semibold text-gray-900 dark:text-white">{t('platform:backups.drillsTitle')}</h2>
                {num(drills.runningDrills) > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                    <Loader2 size={12} className="animate-spin" />
                    {t('platform:backups.drillsRunning', { n: num(drills.runningDrills) })}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">{t('platform:backups.drillsNote')}</p>
              <div className="grid md:grid-cols-2 gap-4">
                {renderDrill('platform:backups.drillDbTitle', drills.lastDbRestoreTest, drills.dbRestoreTestStale)}
                {renderDrill('platform:backups.drillFileTitle', drills.lastFileRestoreRehearsal, drills.fileRestoreRehearsalStale)}
              </div>
            </div>
          )}

          {/* ── Recent backups table ──────────────────────────────────────── */}
          {(status.recentBackups ?? []).length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                <Clock size={16} className="text-gray-400" />
                <h2 className="font-semibold text-gray-900 dark:text-white">{t('platform:backups.recentTitle')}</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800">
                    <th className="text-left px-5 py-3">{t('platform:backups.colFilename')}</th>
                    <th className="text-left px-5 py-3">{t('platform:backups.colCreated')}</th>
                    <th className="text-right px-5 py-3">{t('platform:backups.colSize')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(status.recentBackups ?? []).map((f) => (
                    <tr key={f.filename} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{f.filename}</td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                        {new Date(f.createdAt).toLocaleString(i18n.language || 'tr')}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600 dark:text-gray-400">{f.sizeHuman}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Actions ───────────────────────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">{t('platform:backups.actionsTitle')}</h2>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleRunBackup}
                disabled={runLoading || restoreLoading || status.currentlyRunning}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {runLoading ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
                {t('platform:backups.runNowBtn')}
              </button>
              <button
                onClick={handleRestoreTest}
                disabled={runLoading || restoreLoading}
                className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {restoreLoading ? <Loader2 size={15} className="animate-spin" /> : <FlaskConical size={15} />}
                {t('platform:backups.restoreTestBtn')}
              </button>
              <button
                onClick={logsVisible ? () => setLogsVisible(false) : fetchLogs}
                disabled={logsLoading}
                className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors"
              >
                {logsLoading ? <Loader2 size={15} className="animate-spin" /> : <ScrollText size={15} />}
                {logsVisible ? t('platform:backups.hideLogsBtn') : t('platform:backups.showLogsBtn')}
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">{t('platform:backups.actionsNote')}</p>
          </div>

          {/* ── Run result ────────────────────────────────────────────────── */}
          {runError && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
              <AlertCircle size={18} />
              <span className="text-sm">{runError}</span>
            </div>
          )}
          {runResult && (
            <div className={`rounded-xl border p-5 ${
              runResult.success
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}>
              <div className="flex items-center gap-2 mb-3">
                {runResult.success
                  ? <CheckCircle2 size={18} className="text-green-600 dark:text-green-400" />
                  : <XCircle size={18} className="text-red-600 dark:text-red-400" />}
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {runResult.success ? t('platform:backups.runSuccess') : t('platform:backups.runFailed')}
                </h3>
                <span className="ml-auto text-xs text-gray-500">{(runResult.durationMs / 1000).toFixed(1)}s</span>
              </div>
              {runResult.latestBackup && (
                <p className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                  {runResult.latestBackup.filename} — {runResult.latestBackup.sizeHuman}
                </p>
              )}
              {runResult.error && (
                <p className="text-sm text-red-600 dark:text-red-400 mt-2 font-mono">{runResult.error}</p>
              )}
            </div>
          )}

          {/* ── Restore test result ───────────────────────────────────────── */}
          {restoreError && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
              <AlertCircle size={18} />
              <span className="text-sm">{restoreError}</span>
            </div>
          )}
          {restoreResult && (
            <div className={`rounded-xl border p-5 ${
              restoreResult.success
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}>
              <div className="flex items-center gap-2 mb-4">
                {restoreResult.success
                  ? <CheckCircle2 size={18} className="text-green-600 dark:text-green-400" />
                  : <XCircle size={18} className="text-red-600 dark:text-red-400" />}
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {restoreResult.success ? t('platform:backups.restoreTestSuccess') : t('platform:backups.restoreTestFailed')}
                </h3>
                <span className="ml-auto text-xs text-gray-500">{(restoreResult.durationMs / 1000).toFixed(1)}s</span>
              </div>

              {/* A restore test that could not drop its scratch database has
                  left a full plaintext copy of the patient database on the
                  production cluster. The operator who pressed the button must
                  see that here and now, with the exact database name — that
                  string is what they type into DROP DATABASE, so it is shown
                  verbatim, never masked or truncated. */}
              {restoreResult.cleanupVerified === false && (
                <div className="mb-4">
                  <AlertBanner level="alarm" title={t('platform:backups.residualTitle')} detail={t('platform:backups.residualDetail')}>
                    <div className="mt-3 flex flex-wrap items-center gap-2 bg-white dark:bg-red-950/60 border border-red-300 dark:border-red-700 rounded-lg px-3 py-2">
                      <Trash2 size={14} className="text-red-600 dark:text-red-400 shrink-0" />
                      <code className="font-mono text-sm font-bold text-red-700 dark:text-red-300 break-all">
                        {restoreResult.tempDbName}
                      </code>
                    </div>
                  </AlertBanner>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="p-3 bg-white/60 dark:bg-gray-900/40 rounded-lg">
                  <p className="text-xs text-gray-500 mb-0.5">{t('platform:backups.restoreFile')}</p>
                  <p className="text-sm font-mono font-medium text-gray-900 dark:text-white">{restoreResult.backupFilename}</p>
                </div>
                {restoreResult.tableCount !== undefined && (
                  <div className="p-3 bg-white/60 dark:bg-gray-900/40 rounded-lg">
                    <p className="text-xs text-gray-500 mb-0.5">{t('platform:backups.tableCount')}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{restoreResult.tableCount}</p>
                  </div>
                )}
                {restoreResult.platformAdminCount !== undefined && (
                  <div className="p-3 bg-white/60 dark:bg-gray-900/40 rounded-lg">
                    <p className="text-xs text-gray-500 mb-0.5">{t('platform:backups.platformAdminCount')}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{restoreResult.platformAdminCount}</p>
                  </div>
                )}
                {restoreResult.planCount !== undefined && (
                  <div className="p-3 bg-white/60 dark:bg-gray-900/40 rounded-lg">
                    <p className="text-xs text-gray-500 mb-0.5">{t('platform:backups.planCount')}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{restoreResult.planCount}</p>
                  </div>
                )}
                {restoreResult.migrationsCount !== undefined && (
                  <div className="p-3 bg-white/60 dark:bg-gray-900/40 rounded-lg">
                    <p className="text-xs text-gray-500 mb-0.5">{t('platform:backups.migrationsCount')}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{restoreResult.migrationsCount}</p>
                  </div>
                )}
              </div>
              {restoreResult.errorSummary && (
                <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <p className="text-xs font-mono text-red-600 dark:text-red-400">{restoreResult.errorSummary}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Log panel ─────────────────────────────────────────────────── */}
          {logsError && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
              <AlertCircle size={18} />
              <span className="text-sm">{logsError}</span>
            </div>
          )}
          {logsVisible && logs.length > 0 && (
            <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-2">
                <ScrollText size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-300">{t('platform:backups.logsTitle')}</span>
                <span className="ml-auto text-xs text-gray-500">{logs.length} {t('platform:backups.lines')}</span>
              </div>
              <div className="p-4 max-h-96 overflow-y-auto font-mono text-xs text-gray-300 space-y-0.5">
                {logs.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all leading-5">{line}</div>
                ))}
              </div>
            </div>
          )}
          {logsVisible && logs.length === 0 && !logsLoading && (
            <div className="bg-gray-950 rounded-xl border border-gray-800 p-6 text-center text-gray-500 text-sm">
              {t('platform:backups.logsEmpty')}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

export default PlatformBackups;
