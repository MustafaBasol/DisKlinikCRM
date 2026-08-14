/**
 * PlatformBackups.recovery.vitest.test.tsx — F4-FCR-001 operator surface.
 *
 * The recovery posture of the whole product is only visible to a human on this
 * one page, so these tests pin the states that must never render as neutral
 * text: no DB backup at all, a stale DB backup, file backup switched off, an
 * on-host-only destination, failed/missing files, a never-run restore drill,
 * and a residual plaintext database copy left on production (whose exact name
 * must be shown verbatim so the operator can drop it).
 *
 * Also pins the graceful degradation contract: if GET /platform/recovery/status
 * fails, the page falls back to the legacy DB-only status endpoint instead of
 * rendering blank.
 *
 * i18n is mocked to echo keys — same pattern as
 * src/components/reports/__tests__/ReportExportControls.vitest.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import React from 'react';
import PlatformBackups from '../PlatformBackups';

const mockT = (key: string) => key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: 'en' } }),
}));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../../context/PlatformAuthContext', () => ({
  usePlatformApi: () => ({ get: apiGet, post: apiPost }),
}));

const K = (k: string) => `platform:backups.${k}`;

const dbBackup = (over: Record<string, unknown> = {}) => ({
  backupDirAccessible: true,
  scriptExists: true,
  scriptExecutable: true,
  cronExists: true,
  logExists: true,
  retentionDays: 7,
  totalBackupCount: 7,
  totalSizeBytes: 3310167,
  totalSizeHuman: '3.2 MB',
  latestBackup: {
    filename: 'noramedi_2026-08-14.sql.gz',
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    sizeBytes: 512000,
    sizeHuman: '500 KB',
  },
  recentBackups: [],
  currentlyRunning: false,
  latestBackupAgeMinutes: 60,
  staleThresholdHours: 30,
  stale: false,
  ...over,
});

const fileBackup = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  destinationConfigured: true,
  destinationKind: 's3',
  destinationOffHost: true,
  currentlyRunning: false,
  lastRun: {
    id: 'run-1',
    startedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    finishedAt: new Date(Date.now() - 88 * 60 * 1000).toISOString(),
    status: 'completed',
    trigger: 'scheduled',
    filesScanned: 120,
    filesCopied: 118,
    filesVerified: 118,
    filesSkipped: 2,
    filesFailed: 0,
    filesMissing: 0,
    bytesCopied: '10485760',
  },
  totals: { entries: 118, verified: 118, failed: 0, missingSource: 0 },
  lastRunAgeMinutes: 90,
  stale: false,
  staleThresholdHours: 30,
  ...over,
});

const drill = (over: Record<string, unknown> = {}) => ({
  id: 'drill-1',
  kind: 'file_restore_rehearsal',
  trigger: 'scheduled',
  status: 'passed',
  startedAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
  finishedAt: new Date(Date.now() - 119 * 60 * 1000).toISOString(),
  durationMs: 4210,
  sourceArtifactAt: new Date(Date.now() - 185 * 60 * 1000).toISOString(),
  sourceArtifactAgeMinutes: 65,
  samplesAttempted: 5,
  samplesPassed: 5,
  samplesFailed: 0,
  cleanupVerified: true,
  residualArtifact: null,
  errorCode: null,
  ageMinutes: 120,
  ...over,
});

const drills = (over: Record<string, unknown> = {}) => ({
  lastDbRestoreTest: drill({ id: 'drill-db', kind: 'db_restore_test' }),
  lastFileRestoreRehearsal: drill(),
  staleThresholdHours: 168,
  dbRestoreTestStale: false,
  fileRestoreRehearsalStale: false,
  residualArtifacts: [],
  runningDrills: 0,
  ...over,
});

/** Wire the recovery endpoint to `payload`; legacy endpoints stay available. */
const mountWithRecovery = (payload: unknown) => {
  apiGet.mockImplementation((url: string) => {
    if (url === '/platform/recovery/status') return Promise.resolve({ data: payload });
    if (url === '/platform/backups/status') return Promise.resolve({ data: dbBackup() });
    if (url === '/platform/backups/logs') return Promise.resolve({ data: { lines: [] } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  return render(<PlatformBackups />);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlatformBackups — data source', () => {
  it('reads the consolidated recovery endpoint once, not the legacy status endpoint', async () => {
    mountWithRecovery({ dbBackup: dbBackup(), fileBackup: fileBackup(), drills: drills() });
    await screen.findByText(K('fileTitle'));
    expect(apiGet).toHaveBeenCalledWith('/platform/recovery/status');
    expect(apiGet).not.toHaveBeenCalledWith('/platform/backups/status');
  });

  it('degrades to the legacy DB-only status endpoint when the recovery route errors', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/platform/recovery/status') return Promise.reject(new Error('500'));
      if (url === '/platform/backups/status') return Promise.resolve({ data: dbBackup() });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    render(<PlatformBackups />);

    // DB tier still renders, plus an explicit "detail unavailable" warning.
    await screen.findByText(K('recoveryUnavailableTitle'));
    expect(screen.getByText(K('infraTitle'))).toBeInTheDocument();
    expect(screen.getByText('noramedi_2026-08-14.sql.gz')).toBeInTheDocument();
    // No file-backup / drill sections are invented from missing data.
    expect(screen.queryByText(K('fileTitle'))).not.toBeInTheDocument();
    expect(screen.queryByText(K('drillsTitle'))).not.toBeInTheDocument();
  });

  it('keeps the existing actions working (run-now, restore test, log viewer)', async () => {
    mountWithRecovery({ dbBackup: dbBackup(), fileBackup: fileBackup(), drills: drills() });
    await screen.findByText(K('fileTitle'));
    expect(screen.getByRole('button', { name: K('runNowBtn') })).toBeEnabled();
    expect(screen.getByRole('button', { name: K('restoreTestBtn') })).toBeEnabled();
    expect(screen.getByRole('button', { name: K('showLogsBtn') })).toBeEnabled();
  });
});

describe('PlatformBackups — database backup staleness', () => {
  it('renders the computed age next to the latest backup date when healthy', async () => {
    mountWithRecovery({ dbBackup: dbBackup(), fileBackup: fileBackup(), drills: drills() });
    expect(await screen.findByText(K('latestAge'))).toBeInTheDocument();
    expect(screen.queryByText(K('dbStaleTitle'))).not.toBeInTheDocument();
    expect(screen.queryByText(K('noBackupAlarmTitle'))).not.toBeInTheDocument();
  });

  it('raises a warning banner when the DB backup is stale', async () => {
    mountWithRecovery({
      dbBackup: dbBackup({ stale: true, latestBackupAgeMinutes: 4000 }),
      fileBackup: fileBackup(),
      drills: drills(),
    });
    expect(await screen.findByText(K('dbStaleTitle'))).toBeInTheDocument();
    expect(screen.getByText(K('staleLabel'), { exact: false })).toBeInTheDocument();
  });

  it('treats "no backup at all" as an alarm, never as neutral empty state', async () => {
    mountWithRecovery({
      dbBackup: dbBackup({ latestBackup: null, totalBackupCount: 0, latestBackupAgeMinutes: null, stale: true }),
      fileBackup: fileBackup(),
      drills: drills(),
    });
    const banner = await screen.findByText(K('noBackupAlarmTitle'));
    expect(banner).toBeInTheDocument();
    expect(banner.closest('[role="alert"]')).not.toBeNull();
    // The legacy neutral "no backups yet" line is still shown, but inside the alarm box.
    expect(screen.getByText(K('noBackups'))).toBeInTheDocument();
  });
});

describe('PlatformBackups — file backup tier', () => {
  it('renders the file backup section with every counter', async () => {
    mountWithRecovery({ dbBackup: dbBackup(), fileBackup: fileBackup(), drills: drills() });
    expect(await screen.findByText(K('fileTitle'))).toBeInTheDocument();
    for (const k of ['filesVerified', 'filesSkipped', 'filesFailed', 'filesMissing']) {
      expect(screen.getByText(K(k))).toBeInTheDocument();
    }
    for (const k of ['totalEntries', 'totalVerified', 'totalFailed', 'totalMissingSource']) {
      expect(screen.getByText(K(k))).toBeInTheDocument();
    }
    expect(screen.getByText(K('fileDestinationOffHost'))).toBeInTheDocument();
    expect(screen.getByText(K('fileDestinationKind'))).toBeInTheDocument();
  });

  it('makes enabled:false a loud alarm — attachments and imaging have no second copy', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup({ enabled: false, destinationConfigured: false, destinationKind: 'none', destinationOffHost: false, lastRun: null, lastRunAgeMinutes: null, stale: true }),
      drills: drills(),
    });
    const banner = await screen.findByText(K('fileDisabledTitle'));
    expect(banner.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByText(K('fileDisabledDetail'))).toBeInTheDocument();
    expect(screen.getByText(K('fileNeverRun'))).toBeInTheDocument();
  });

  it('makes destinationOffHost:false a loud alarm — a same-host copy is not a backup', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup({ destinationOffHost: false, destinationKind: 'local' }),
      drills: drills(),
    });
    const banner = await screen.findByText(K('fileOnHostTitle'));
    expect(banner.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByText(K('offHostNo'))).toBeInTheDocument();
  });

  it('alarms on filesFailed > 0 or filesMissing > 0 instead of printing plain numbers', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup({
        lastRun: { ...fileBackup().lastRun, filesFailed: 3, filesMissing: 2, status: 'failed' },
        totals: { entries: 118, verified: 113, failed: 3, missingSource: 2 },
      }),
      drills: drills(),
    });
    const banner = await screen.findByText(K('fileFailuresTitle'));
    expect(banner.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByText(K('fileTotalsFailuresNote'))).toBeInTheDocument();
  });

  it('warns when the last file backup run is stale', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup({ stale: true, lastRunAgeMinutes: 5000 }),
      drills: drills(),
    });
    expect(await screen.findByText(K('fileStaleTitle'))).toBeInTheDocument();
  });
});

describe('PlatformBackups — restore drills', () => {
  it('renders RTO, RPO and sample counts for both drill kinds', async () => {
    mountWithRecovery({ dbBackup: dbBackup(), fileBackup: fileBackup(), drills: drills() });
    expect(await screen.findByText(K('drillsTitle'))).toBeInTheDocument();
    expect(screen.getByText(K('drillDbTitle'))).toBeInTheDocument();
    expect(screen.getByText(K('drillFileTitle'))).toBeInTheDocument();
    expect(screen.getAllByText(K('drillDuration'))).toHaveLength(2);
    expect(screen.getAllByText(K('drillRpo'))).toHaveLength(2);
    expect(screen.getAllByText(K('drillSamples'))).toHaveLength(2);
  });

  it('treats a never-run drill as an alarm', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup(),
      drills: drills({ lastDbRestoreTest: null, dbRestoreTestStale: true }),
    });
    expect(await screen.findByText(K('drillNeverRun'))).toBeInTheDocument();
    expect(screen.getByText(K('drillNeverRunDetail'))).toBeInTheDocument();
  });

  it('surfaces the stale flag as a warning on the drill card', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup(),
      drills: drills({ fileRestoreRehearsalStale: true }),
    });
    expect(await screen.findByText(K('drillStaleWarning'))).toBeInTheDocument();
  });

  it('handles a fully null drill payload without crashing', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup({ lastRun: null, totals: null, lastRunAgeMinutes: null }),
      drills: drills({
        lastDbRestoreTest: null,
        lastFileRestoreRehearsal: null,
        residualArtifacts: null,
        runningDrills: null,
        staleThresholdHours: null,
      }),
    });
    expect(await screen.findByText(K('drillsTitle'))).toBeInTheDocument();
    expect(screen.getAllByText(K('drillNeverRun'))).toHaveLength(2);
  });
});

describe('PlatformBackups — residual restore artifacts', () => {
  it('lists every residual artifact name verbatim, unmasked and untruncated', async () => {
    const residual = 'noramedi_restore_test_20260814_031500_a9f3c1';
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup(),
      drills: drills({
        residualArtifacts: [
          drill({ id: 'r1', status: 'failed', cleanupVerified: false, residualArtifact: residual }),
        ],
      }),
    });
    const banner = await screen.findByText(K('residualTitle'));
    expect(banner.closest('[role="alert"]')).not.toBeNull();
    // The exact object name must be present character-for-character.
    expect(screen.getByText(residual)).toBeInTheDocument();
    expect(screen.getByText(K('residualDetail'))).toBeInTheDocument();
  });

  it('renders one row per residual artifact', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup(),
      drills: drills({
        residualArtifacts: [
          drill({ id: 'r1', residualArtifact: 'noramedi_restore_test_a' }),
          drill({ id: 'r2', residualArtifact: 'noramedi_restore_test_b' }),
          // A drill with no residual object must not produce a row.
          drill({ id: 'r3', residualArtifact: null }),
        ],
      }),
    });
    await screen.findByText(K('residualTitle'));
    expect(screen.getByText('noramedi_restore_test_a')).toBeInTheDocument();
    expect(screen.getByText('noramedi_restore_test_b')).toBeInTheDocument();
    expect(screen.getAllByText(K('residualStartedAt'), { exact: false })).toHaveLength(2);
  });

  it('shows no residual alert when the list is empty', async () => {
    mountWithRecovery({ dbBackup: dbBackup(), fileBackup: fileBackup(), drills: drills() });
    await screen.findByText(K('fileTitle'));
    expect(screen.queryByText(K('residualTitle'))).not.toBeInTheDocument();
  });
});

/**
 * F4-FCR-001-R1 (H1-UI): a run that is legitimately IN FLIGHT is neither a
 * success nor a failure. Rendering `status: 'running'` as a red failure card —
 * and its not-yet-reached cleanup step as a cleanup alarm — painted the page
 * red during every normal nightly sweep, which is how operators learn to
 * ignore red.
 */
describe('PlatformBackups — in-flight runs are not failures', () => {
  const runningDrill = (over: Record<string, unknown> = {}) =>
    drill({
      status: 'running',
      finishedAt: null,
      durationMs: null,
      samplesAttempted: 0,
      samplesPassed: 0,
      samplesFailed: 0,
      // A row that has not finished cannot have verified its own cleanup yet;
      // the server default for an open ledger row is false.
      cleanupVerified: false,
      residualArtifact: null,
      ageMinutes: 3,
      ...over,
    });

  it('renders a drill still running as in-progress, not as a red failure', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup(),
      drills: drills({ lastFileRestoreRehearsal: runningDrill(), runningDrills: 1 }),
    });
    await screen.findByText(K('drillsTitle'));

    const card = screen.getByTestId('drill-card-file_restore_rehearsal');
    expect(card.dataset.state).toBe('in-progress');
    expect(card.className).not.toContain('red');
    expect(within(card).getByText(K('statusRunning'))).toBeInTheDocument();
    // The finished, healthy drill next to it must still read as OK.
    expect(screen.getByTestId('drill-card-db_restore_test').dataset.state).toBe('ok');
  });

  it('suppresses the cleanup alarm for a drill that has not finished', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup(),
      drills: drills({ lastFileRestoreRehearsal: runningDrill(), runningDrills: 1 }),
    });
    await screen.findByText(K('drillsTitle'));

    const card = screen.getByTestId('drill-card-file_restore_rehearsal');
    expect(within(card).queryByText(K('cleanupNotVerified'))).not.toBeInTheDocument();
    expect(within(card).queryByText(K('cleanupVerified'))).not.toBeInTheDocument();
  });

  it('still alarms on cleanupVerified:false once the drill HAS finished', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup(),
      drills: drills({
        lastFileRestoreRehearsal: drill({ status: 'failed', cleanupVerified: false }),
      }),
    });
    await screen.findByText(K('drillsTitle'));

    const card = screen.getByTestId('drill-card-file_restore_rehearsal');
    expect(card.dataset.state).toBe('bad');
    expect(within(card).getByText(K('cleanupNotVerified'))).toBeInTheDocument();
  });

  it('still alarms on a residual artifact even while the drill is running', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup(),
      drills: drills({
        lastFileRestoreRehearsal: runningDrill({ residualArtifact: 'noramedi_restore_test_leak' }),
      }),
    });
    await screen.findByText(K('drillsTitle'));
    expect(screen.getByTestId('drill-card-file_restore_rehearsal').dataset.state).toBe('bad');
  });

  it('renders an in-flight file backup run as in-progress and holds back the stale warning', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup({
        lastRun: { ...fileBackup().lastRun, status: 'running', finishedAt: null },
        // The server derives freshness from finishedAt only, so an unfinished
        // run reports stale: true for the duration of the sweep.
        lastRunAgeMinutes: null,
        stale: true,
      }),
      drills: drills(),
    });
    await screen.findByText(K('fileTitle'));

    expect(screen.getByTestId('file-run-status').dataset.state).toBe('in-progress');
    expect(screen.getByText(K('statusRunning'))).toBeInTheDocument();
    expect(screen.queryByText(K('fileStaleTitle'))).not.toBeInTheDocument();
  });

  it('keeps painting a FINISHED failed file backup run red', async () => {
    mountWithRecovery({
      dbBackup: dbBackup(),
      fileBackup: fileBackup({ lastRun: { ...fileBackup().lastRun, status: 'failed' }, stale: true }),
      drills: drills(),
    });
    await screen.findByText(K('fileTitle'));

    expect(screen.getByTestId('file-run-status').dataset.state).toBe('bad');
    expect(screen.getByText(K('fileStaleTitle'))).toBeInTheDocument();
  });
});

/**
 * F4-FCR-001-R1 (L3): the operator who triggers a restore test must see, in
 * the immediate result panel, that the drill failed to drop its scratch
 * database — a full plaintext copy of the patient database left on the
 * production cluster — together with the exact name they need for DROP
 * DATABASE.
 */
describe('PlatformBackups — restore test result panel', () => {
  const restoreTestResult = (over: Record<string, unknown> = {}) => ({
    backupFilename: 'noramedi_2026-08-14.sql.gz',
    tempDbName: '[redacted-test-db]',
    success: true,
    tableCount: 84,
    platformAdminCount: 2,
    planCount: 4,
    migrationsCount: 61,
    durationMs: 12345,
    cleanupVerified: true,
    drillRunId: 'drill-db',
    ...over,
  });

  const clickRestoreTest = async (payload: unknown) => {
    apiPost.mockResolvedValue({ data: payload });
    mountWithRecovery({ dbBackup: dbBackup(), fileBackup: fileBackup(), drills: drills() });
    await screen.findByText(K('fileTitle'));
    // act() wraps the click AND the promise flush it triggers: the handler
    // sets state twice (result, then the follow-up status refetch), and both
    // land after the click returns.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: K('restoreTestBtn') }));
    });
  };

  it('alarms with the leaked database name verbatim when cleanup was not verified', async () => {
    const leaked = 'noramedi_restore_test_20260814_031500_a9f3c1';
    await clickRestoreTest(restoreTestResult({ cleanupVerified: false, tempDbName: leaked }));

    const banner = await screen.findByText(K('residualTitle'));
    expect(banner.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByText(K('residualDetail'))).toBeInTheDocument();
    // Character-for-character: this string is what the operator has to drop.
    expect(screen.getByText(leaked)).toBeInTheDocument();
  });

  it('shows no cleanup alarm when the scratch database was dropped', async () => {
    await clickRestoreTest(restoreTestResult());

    expect(await screen.findByText(K('restoreTestSuccess'))).toBeInTheDocument();
    expect(screen.queryByText(K('residualTitle'))).not.toBeInTheDocument();
    expect(screen.queryByText(K('residualDetail'))).not.toBeInTheDocument();
  });

  it('alarms on a failed restore test that also leaked its scratch database', async () => {
    const leaked = 'noramedi_restore_test_20260814_040000_bb12ef';
    await clickRestoreTest(
      restoreTestResult({ success: false, cleanupVerified: false, tempDbName: leaked, errorSummary: 'pg_restore_failed' }),
    );

    expect(await screen.findByText(K('restoreTestFailed'))).toBeInTheDocument();
    expect(screen.getByText(leaked)).toBeInTheDocument();
    expect(screen.getByText('pg_restore_failed')).toBeInTheDocument();
  });
});
