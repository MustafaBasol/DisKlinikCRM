import React, { useEffect, useState } from 'react';
import {
  HardDrive,
  RefreshCw,
  PlayCircle,
  FlaskConical,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  FileText,
  Clock,
  Database,
  ScrollText,
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
}

interface RunBackupResult {
  success: boolean;
  durationMs: number;
  latestBackup: BackupFileMeta | null;
  error?: string;
}

interface RestoreTestResult {
  backupFilename: string;
  tempDbName: string;
  success: boolean;
  tableCount?: number;
  platformAdminCount?: number;
  planCount?: number;
  migrationsCount?: number;
  durationMs: number;
  errorSummary?: string;
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

// ── Component ─────────────────────────────────────────────────────────────────

const PlatformBackups: React.FC = () => {
  const { t, i18n } = useTranslation(['platform']);
  const api = usePlatformApi();

  const [status, setStatus] = useState<BackupStatus | null>(null);
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

  // ── Fetch status ────────────────────────────────────────────────────────────

  const fetchStatus = () => {
    setStatusLoading(true);
    setStatusError('');
    api
      .get('/platform/backups/status')
      .then((res) => setStatus(res.data))
      .catch(() => setStatusError(t('platform:backups.statusLoadFailed')))
      .finally(() => setStatusLoading(false));
  };

  useEffect(() => { fetchStatus(); }, []);

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
      fetchStatus();
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
          onClick={fetchStatus}
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
                  <InfoRow label={t('platform:backups.latestSize')} value={status.latestBackup.sizeHuman} />
                </>
              ) : (
                <p className="text-sm text-gray-400 mt-3">{t('platform:backups.noBackups')}</p>
              )}
            </div>
          </div>

          {/* ── Recent backups table ──────────────────────────────────────── */}
          {status.recentBackups.length > 0 && (
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
                  {status.recentBackups.map((f) => (
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
