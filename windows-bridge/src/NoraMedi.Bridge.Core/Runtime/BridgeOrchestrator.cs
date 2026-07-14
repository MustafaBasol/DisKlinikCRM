using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Extensions.Logging;
using NoraMedi.Bridge.Core.Acquisition;
using NoraMedi.Bridge.Core.Diagnostics;
using NoraMedi.Bridge.Core.Http;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Core.Queue;
using NoraMedi.Bridge.Core.Security;
using NoraMedi.Bridge.Core.Updates;
using NoraMedi.Bridge.Core.Updates.Rollback;

namespace NoraMedi.Bridge.Core.Runtime;

/// <summary>
/// Wires every Core component into the running bridge: watcher → queue →
/// uploader → heartbeat, plus the Named Pipe request handler the Manager
/// talks to. Mirrors bridge-agent/src/service.ts's shape (BridgeService)
/// while adding the SQLite/DPAPI/Windows-Service-specific pieces the Node
/// agent doesn't need. The Worker Service in NoraMedi.Bridge.Service is a
/// thin OS-integration shell around this class — all bridging logic lives here.
/// </summary>
public sealed class BridgeOrchestrator : IBridgePipeRequestHandler, IAsyncDisposable
{
    private readonly BridgeOptions _options;
    private readonly BridgeApiClient _apiClient;
    private readonly string _agentVersion;
    private readonly ILogger<BridgeOrchestrator> _logger;

    private readonly SqliteBridgeQueue _queue;
    private readonly DpapiCredentialStore _credentialStore;
    private readonly BridgeAuthState _authState;
    private readonly FolderBindingsStore _bindingsStore;
    private readonly ServerBindingsCatalogStore _serverBindingsCatalogStore;
    private readonly string _installationId;
    private readonly DateTimeOffset _startedAt = DateTimeOffset.UtcNow;
    private readonly Lock _drainGate = new();

    private readonly UpdateOptions _updateOptions;
    private readonly UpdateManager _updateManager;
    private readonly UpdateDownloader _updateDownloader;
    private readonly UpdateBackgroundLoop _updateLoop;
    private readonly HttpClient _updateHttpClient;
    private readonly bool _ownsUpdateHttpClient;

    private readonly RollbackCache _rollbackCache;
    private readonly RollbackManager _rollbackManager;
    private readonly PostUpdateHealthTracker _healthTracker;
    private const string InstallerUpgradeCode = "12BB6A03-A76B-40B2-828E-7DAF6FB4A61E"; // windows-bridge/installer/NoraMedi.Bridge.Installer/Package.wxs UpgradeCode — must stay in sync.

    private FolderWatchAdapter? _watcherAdapter;
    private Timer? _drainTimer;
    private Timer? _heartbeatTimer;
    private DateTimeOffset? _lastHeartbeatAt;
    private bool _draining;
    private bool _started;

    public BridgeOrchestrator(
        BridgeOptions options, BridgeApiClient apiClient, string agentVersion, ILogger<BridgeOrchestrator> logger,
        UpdateOptions? updateOptions = null, HttpClient? updateHttpClient = null)
    {
        _options = options;
        _apiClient = apiClient;
        _agentVersion = agentVersion;
        _logger = logger;

        // Lock down the whole ProgramData tree BEFORE any subcomponent below
        // creates the queue database, credential blob, bindings file, spool
        // directory, or installation-id file — every one of those must be
        // born under a directory ACL that already excludes broad Users/Everyone
        // access, not retrofitted afterward.
        ProgramDataAcl.ProtectDirectory(_options.ProgramDataRoot, _options.ServiceAccountSid);
        _queue = new SqliteBridgeQueue(_options.SpoolDirectory, _options.QueueDatabasePath, _options.ServiceAccountSid);
        _credentialStore = new DpapiCredentialStore(_options.CredentialPath, extraAccountSid: _options.ServiceAccountSid);
        _authState = new BridgeAuthState(_credentialStore);
        _bindingsStore = new FolderBindingsStore(_options.BindingsPath, _options.ServiceAccountSid);
        _serverBindingsCatalogStore = new ServerBindingsCatalogStore(_options.ServerBindingsCatalogPath, _options.ServiceAccountSid);
        _installationId = InstallationIdProvider.GetOrCreate(_options.InstallationIdPath, _options.ServiceAccountSid);

        _updateOptions = updateOptions ?? new UpdateOptions { UpdatesDirectory = Path.Combine(_options.ProgramDataRoot, "updates") };
        _ownsUpdateHttpClient = updateHttpClient is null;
        _updateHttpClient = updateHttpClient ?? new HttpClient();
        var updateStateStore = new UpdateStateStore(_updateOptions.UpdatesDirectory, _options.ServiceAccountSid);
        _updateDownloader = new UpdateDownloader(_updateHttpClient, _updateOptions, _options.ServiceAccountSid);
        _updateManager = new UpdateManager(_updateOptions, updateStateStore, _updateDownloader, _apiClient, _agentVersion, _logger);
        _updateLoop = new UpdateBackgroundLoop(
            _updateManager, _updateDownloader, _updateOptions,
            () => _authState.TryGetCredential(),
            () => _queue.Counts()[QueueItemState.Processing] > 0,
            () => _updateManager.LastKnownMode,
            OnAutomaticInstallReady,
            _logger);

        var rollbackDirectory = Path.Combine(_updateOptions.UpdatesDirectory, "rollback");
        _rollbackCache = new RollbackCache(_updateDownloader, rollbackDirectory, _options.ServiceAccountSid);
        var rollbackStateStore = new RollbackStateStore(_updateOptions.UpdatesDirectory, _options.ServiceAccountSid);
        _rollbackManager = new RollbackManager(_rollbackCache, rollbackStateStore, InstallerUpgradeCode, _logger);
        _healthTracker = new PostUpdateHealthTracker(_updateOptions.UpdatesDirectory, _options.ServiceAccountSid);

        // Cache the declared rollback target BEFORE the new version is ever
        // installed — see docs/update-runbook.md "Staged rollout & rollback".
        // Fire-and-forget: a caching failure must never block the forward
        // update itself; it only means a subsequent health-check failure
        // will find no cached target and correctly report InterventionRequired
        // instead of silently "rolling back" to nothing.
        _updateManager.ReleaseVerified += release =>
        {
            if (release.Rollback is null) return;
            _ = CacheRollbackTargetSafeAsync(release.Rollback);
        };
    }

    private async Task CacheRollbackTargetSafeAsync(RollbackPackageDescriptor package)
    {
        try
        {
            await _rollbackManager.EnsureRollbackTargetCachedAsync(package, CancellationToken.None);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or HttpRequestException)
        {
            _logger.LogWarning(ex, "rollback.cache_target_failed");
        }
    }

    public void Start()
    {
        if (_started) return;
        _started = true;

        if (!_options.Enabled)
        {
            _logger.LogInformation("Bridge self-service feature is disabled (BridgeSelfService:Enabled=false) — service is running in dormant mode.");
            return;
        }

        _queue.RecoverOnStartup();
        RebuildWatcher();
        _watcherAdapter?.Start();

        _drainTimer = new Timer(_ => _ = SafeDrainOnceAsync(), null, TimeSpan.Zero, TimeSpan.FromMilliseconds(_options.DrainPollMs));
        _heartbeatTimer = new Timer(_ => _ = SafeHeartbeatTickAsync(), null, TimeSpan.Zero, TimeSpan.FromSeconds(_options.HeartbeatIntervalSeconds));

        _updateManager.ReconcileHelperResultOnStartup();
        _rollbackManager.ReconcileOnStartup();
        TryReconcileRollbackHelperResult();

        // Post-update health check (PR 7/7): the only self-reportable signal
        // this process can honestly give without an external observer is "did
        // I keep crashing and getting relaunched right after this version
        // installed" — see PostUpdateHealthTracker's doc comment for why this
        // is deliberately NOT based on backend/heartbeat reachability. Only
        // evaluated when the update state machine shows THIS version just
        // succeeded a self-update (never for a version that was installed by
        // the MSI/first-run installer directly, or one already running fine
        // for a while — CurrentState.Lifecycle stays Succeeded only until the
        // next check cycle moves it to UpToDate).
        var updateState = _updateManager.CurrentState;
        if (updateState.Lifecycle == UpdateLifecycleState.Succeeded
            && string.Equals(updateState.OfferedVersion, _agentVersion, StringComparison.OrdinalIgnoreCase)
            && _healthTracker.RecordBootAndCheckCrashLoop(_agentVersion))
        {
            _logger.LogError("update.crash_loop_detected version={Version} — triggering automatic rollback", _agentVersion);
            TryLaunchRollback(_agentVersion);
        }

        _updateLoop.Start();

        // Re-fetch the server's device/binding catalog on every restart so the
        // Manager's device selector doesn't rely solely on whatever was cached
        // at the moment of the last pairing — a device added/renamed/retired
        // server-side while the Service was stopped must show up on the next
        // restart. Fire-and-forget: a failed/timed-out refresh just leaves the
        // existing cache in place (see RefreshServerBindingsCatalogAsync).
        _ = SafeRefreshServerBindingsCatalogAsync();
    }

    private void RebuildWatcher()
    {
        _watcherAdapter?.Stop();
        var bindings = _bindingsStore.Load();
        _watcherAdapter = new FolderWatchAdapter(bindings, TimeSpan.FromMilliseconds(_options.StabilityMs), maxFileSizeBytes: _options.MaxAcquiredFileSizeBytes);
        _watcherAdapter.FileAcquired += OnFileAcquired;
        if (_started && _options.Enabled) _watcherAdapter.Start();
    }

    private void OnFileAcquired(object? sender, AcquiredFile file)
    {
        try
        {
            // Admission checks run on FileInfo.Length alone, strictly before any
            // File.ReadAllBytes — a hostile or misbehaving source folder must
            // never be able to force an unbounded in-memory allocation.
            FileInfo info;
            try
            {
                info = new FileInfo(file.SourcePath);
                if (!info.Exists) return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return;
            }

            if (info.Length > _options.MaxAcquiredFileSizeBytes)
            {
                _logger.LogWarning(
                    "Rejected acquired file for watch {WatchId}: {Size} bytes exceeds MaxAcquiredFileSizeBytes",
                    file.Binding.WatchId, info.Length);
                return;
            }

            if (!HasSpoolCapacity(info.Length))
            {
                _logger.LogWarning(
                    "Rejected acquired file for watch {WatchId}: spool capacity or minimum free disk space would be exceeded",
                    file.Binding.WatchId);
                return;
            }

            var bytes = File.ReadAllBytes(file.SourcePath);
            _queue.Enqueue(bytes, file.Binding.WatchId, file.Binding.DeviceId, file.Binding.Modality);
        }
        catch (IOException ex)
        {
            _logger.LogWarning(ex, "Failed to read acquired file for watch {WatchId}", file.Binding.WatchId);
        }
        catch (Exception ex) when (ex is ObjectDisposedException or InvalidOperationException)
        {
            // The watcher's polling Timer.Dispose() (see FolderWatchAdapter/SingleFolderWatcher)
            // does not wait for an in-flight callback to finish, so a tick can still be
            // running here after DisposeAsync has already torn down the queue's SQLite
            // connection during shutdown. The source file is untouched either way — on
            // the next start it is observed and acquired again — so dropping this one
            // in-flight acquisition during shutdown is safe.
            _logger.LogWarning(ex, "Dropped an in-flight acquisition for watch {WatchId} during shutdown", file.Binding.WatchId);
        }
    }

    private bool HasSpoolCapacity(long incomingBytes)
    {
        if (_queue.TotalSpoolBytes() + incomingBytes > _options.MaxSpoolBytes) return false;

        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(_options.SpoolDirectory));
            if (string.IsNullOrEmpty(root)) return true;
            var drive = new DriveInfo(root);
            if (drive.AvailableFreeSpace - incomingBytes < _options.MinFreeDiskBytes) return false;
        }
        catch (Exception ex) when (ex is IOException or ArgumentException or UnauthorizedAccessException)
        {
            // Cannot determine free space — fail safe by rejecting rather than risking disk exhaustion.
            return false;
        }

        return true;
    }

    private async Task SafeDrainOnceAsync()
    {
        try
        {
            await DrainOnceAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled error while draining the upload queue");
        }
    }

    private async Task DrainOnceAsync()
    {
        lock (_drainGate)
        {
            if (_draining) return;
            _draining = true;
        }

        try
        {
            if (!_authState.IsValid) return;
            foreach (var item in _queue.ListReadyPending())
            {
                if (!_authState.IsValid) break;
                await ProcessItemAsync(item);
            }
        }
        finally
        {
            lock (_drainGate) { _draining = false; }
        }
    }

    private async Task ProcessItemAsync(QueueItemRecord meta)
    {
        _queue.MoveToProcessing(meta.IngestKey);

        byte[] bytes;
        try
        {
            bytes = await File.ReadAllBytesAsync(meta.SpoolFilePath);
        }
        catch (IOException)
        {
            _queue.Fail(meta.IngestKey, ErrorCategory.QuarantinedOrphan);
            return;
        }

        var credential = _authState.TryGetCredential();
        if (credential is null)
        {
            // Not paired yet — keep the item pending with a short, fixed delay rather than burning an attempt.
            _queue.RetryLater(meta.IngestKey, meta.AttemptCount, DateTimeOffset.UtcNow.AddSeconds(30));
            return;
        }

        var outcome = await _apiClient.UploadStudyAsync(credential, meta, bytes);
        LogUploadOutcome(meta, outcome);

        switch (outcome.Category)
        {
            case ResponseCategory.Success:
                _queue.Complete(meta.IngestKey);
                break;

            case ResponseCategory.AuthFailure:
                _queue.RetryLater(meta.IngestKey, meta.AttemptCount, DateTimeOffset.UtcNow);
                _authState.MarkInvalid();
                break;

            case ResponseCategory.Permanent:
                _queue.Fail(meta.IngestKey, outcome.ErrorCategory ?? ErrorCategory.BadRequest);
                break;

            case ResponseCategory.Retryable:
            default:
                var nextAttempt = meta.AttemptCount + 1;
                if (nextAttempt >= _options.MaxAttempts)
                {
                    _queue.Fail(meta.IngestKey, ErrorCategory.MaxAttemptsExceeded, nextAttempt);
                }
                else
                {
                    var backoff = BackoffCalculator.Compute(nextAttempt, TimeSpan.FromMilliseconds(_options.BackoffBaseMs), TimeSpan.FromMilliseconds(_options.BackoffCapMs));
                    // A server-supplied Retry-After (429) can extend the wait beyond our
                    // own backoff, but never past BackoffCapMs — an external response
                    // header must never be able to stall an item indefinitely.
                    var delay = outcome.RetryAfter is { } retryAfter && retryAfter > backoff
                        ? TimeSpan.FromMilliseconds(Math.Min(retryAfter.TotalMilliseconds, _options.BackoffCapMs))
                        : backoff;
                    _queue.RetryLater(meta.IngestKey, nextAttempt, DateTimeOffset.UtcNow.Add(delay));
                }
                break;
        }
    }

    private void LogUploadOutcome(QueueItemRecord meta, UploadOutcome outcome) =>
        _logger.LogInformation(
            "upload.outcome watchId={WatchId} ingestKey={IngestKey} category={Category} duplicate={Duplicate} errorCategory={ErrorCategory}",
            meta.WatchId, DiagnosticsRedactor.ShortIngestKey(meta.IngestKey), outcome.Category, outcome.Duplicate, outcome.ErrorCategory);

    private async Task SafeHeartbeatTickAsync()
    {
        try
        {
            // Runs unconditionally (even while unpaired) so failed/completed
            // items never accumulate on disk forever regardless of pairing state.
            _queue.PurgeExpired(
                DateTimeOffset.UtcNow,
                TimeSpan.FromDays(_options.FailedRetentionDays),
                TimeSpan.FromDays(_options.CompletedRetentionDays));

            await HeartbeatTickAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled error while sending heartbeat");
        }
    }

    private async Task HeartbeatTickAsync()
    {
        if (!_authState.IsValid && !_authState.CredentialChangedSinceInvalidated()) return;

        var credential = _authState.TryGetCredential();
        if (credential is null) return;

        var counts = _queue.Counts();
        var request = new HeartbeatRequest(
            AgentVersion: _agentVersion,
            OsVersion: RuntimeInformation.OSDescription,
            Architecture: RuntimeInformation.OSArchitecture.ToString(),
            PendingCount: counts[QueueItemState.Pending],
            FailedCount: counts[QueueItemState.Failed]);

        var result = await _apiClient.HeartbeatAsync(credential, request);

        // Safe to log: outcome/category/status code and the server origin
        // (never the path, query, credential, or any queue/patient content).
        if (result.Ok)
        {
            _logger.LogInformation(
                "heartbeat.ok serverUrl={ServerUrlOrigin} statusCode={StatusCode}",
                _options.SafeServerUrlOrigin, result.StatusCode);
            _authState.MarkValid();
            _lastHeartbeatAt = DateTimeOffset.UtcNow;
        }
        else if (result.StatusCode == 401)
        {
            _logger.LogWarning(
                "heartbeat.failed serverUrl={ServerUrlOrigin} statusCode={StatusCode} category={Category}",
                _options.SafeServerUrlOrigin, result.StatusCode, result.Category);
            _authState.MarkInvalid();
        }
        else
        {
            _logger.LogWarning(
                "heartbeat.failed serverUrl={ServerUrlOrigin} statusCode={StatusCode} category={Category} networkError={NetworkError}",
                _options.SafeServerUrlOrigin, result.StatusCode, result.Category, result.NetworkError);
        }
    }

    private async Task SafeRefreshServerBindingsCatalogAsync()
    {
        try
        {
            await RefreshServerBindingsCatalogAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled error while refreshing the server binding catalog");
        }
    }

    /// <summary>
    /// Re-fetches the server's device/binding catalog via bootstrap and
    /// replaces the cached copy. A missing credential, network failure, or
    /// non-2xx response leaves whatever is already cached untouched — this
    /// is a best-effort refresh, not the only source of the catalog (pairing
    /// already seeds it — see <see cref="ProvisionWithPairingCodeAsync"/>).
    /// </summary>
    private async Task RefreshServerBindingsCatalogAsync()
    {
        var credential = _authState.TryGetCredential();
        if (credential is null) return;

        var bootstrap = await _apiClient.BootstrapAsync(credential);
        if (bootstrap is null) return;

        _serverBindingsCatalogStore.Save(bootstrap.Bindings.Select(ToAvailableServerBindingInfo).ToList());
    }

    private static AvailableServerBindingInfo ToAvailableServerBindingInfo(BootstrapBinding binding) => new(
        binding.Id,
        binding.DeviceId,
        binding.DisplayName,
        string.IsNullOrEmpty(binding.Modality) ? null : binding.Modality,
        binding.Status,
        binding.AcquisitionType);

    public bool FeatureEnabled => _options.Enabled;

    public Task<ServiceStatusPayload> GetServiceStatusAsync(CancellationToken cancellationToken)
    {
        var counts = _queue.Counts();
        var connectionState = !_options.Enabled ? "disabled" : _authState.IsValid ? "online" : "offline";
        return Task.FromResult(new ServiceStatusPayload(
            _agentVersion,
            _installationId,
            _credentialStore.Exists,
            connectionState,
            _authState.IsValid ? "valid" : "invalid",
            _lastHeartbeatAt,
            counts[QueueItemState.Pending],
            counts[QueueItemState.Processing],
            counts[QueueItemState.Failed],
            counts[QueueItemState.Completed]));
    }

    public Task<IReadOnlyList<FolderBindingInfo>> GetBindingsAsync(CancellationToken cancellationToken)
    {
        var availability = (_watcherAdapter?.GetAvailability() ?? []).ToDictionary(a => a.WatchId, a => a.Available);
        IReadOnlyList<FolderBindingInfo> result = _bindingsStore.Load()
            .Select(b => new FolderBindingInfo(b.WatchId, b.Path, b.DeviceId, b.Modality, availability.GetValueOrDefault(b.WatchId)))
            .ToList();
        return Task.FromResult(result);
    }

    public Task<ValidateFolderResponse> ValidateFolderAsync(ValidateFolderRequest request, CancellationToken cancellationToken)
    {
        var exists = Directory.Exists(request.Path);
        var readable = exists && TryListDirectory(request.Path);
        var message = !exists ? "Folder does not exist." : !readable ? "Folder exists but is not readable." : null;
        return Task.FromResult(new ValidateFolderResponse(exists, readable, message));
    }

    private static bool TryListDirectory(string path)
    {
        try
        {
            _ = Directory.EnumerateFileSystemEntries(path).Take(1).ToList();
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    public Task<AddOrUpdateFolderBindingResponse> AddOrUpdateFolderBindingAsync(AddOrUpdateFolderBindingRequest request, CancellationToken cancellationToken)
    {
        var binding = _bindingsStore.AddOrUpdate(request.WatchId, request.Path, request.DeviceId, request.Modality);
        RebuildWatcher();
        return Task.FromResult(new AddOrUpdateFolderBindingResponse(binding.WatchId));
    }

    public Task RemoveFolderBindingAsync(RemoveFolderBindingRequest request, CancellationToken cancellationToken)
    {
        _bindingsStore.Remove(request.WatchId);
        RebuildWatcher();
        return Task.CompletedTask;
    }

    public async Task<TestConnectionResponse> TestConnectionAsync(CancellationToken cancellationToken)
    {
        if (!_options.Enabled)
        {
            return new TestConnectionResponse(false, null, "Bridge self-service is disabled.");
        }

        var credential = _authState.TryGetCredential();
        if (credential is null)
        {
            return new TestConnectionResponse(false, null, "Not paired with NoraMedi yet.");
        }

        var bootstrap = await _apiClient.BootstrapAsync(credential, cancellationToken);
        return bootstrap is null
            ? new TestConnectionResponse(false, null, "Could not reach NoraMedi or the credential was rejected.")
            : new TestConnectionResponse(true, 200, null);
    }

    public Task<QueueSummaryResponse> GetQueueSummaryAsync(CancellationToken cancellationToken)
    {
        var counts = _queue.Counts();
        return Task.FromResult(new QueueSummaryResponse(
            counts[QueueItemState.Pending], counts[QueueItemState.Processing], counts[QueueItemState.Failed], counts[QueueItemState.Completed]));
    }

    public Task<RetryFailedItemResponse> RetryFailedItemAsync(RetryFailedItemRequest request, CancellationToken cancellationToken)
    {
        try
        {
            _queue.RequeueFailed(request.IngestKey);
            return Task.FromResult(new RetryFailedItemResponse(true, null));
        }
        catch (InvalidOperationException ex)
        {
            return Task.FromResult(new RetryFailedItemResponse(false, ex.Message));
        }
    }

    public Task<DiagnosticsSnapshot> ExportDiagnosticsAsync(CancellationToken cancellationToken)
    {
        var counts = _queue.Counts();
        var watched = (_watcherAdapter?.GetAvailability() ?? [])
            .Select(a => new WatchFolderDiagnostics(a.WatchId, a.Available))
            .ToList();

        return Task.FromResult(new DiagnosticsSnapshot(
            _agentVersion,
            _installationId,
            _startedAt,
            !_options.Enabled ? "disabled" : _authState.IsValid ? "online" : "offline",
            _authState.IsValid ? "valid" : "invalid",
            _lastHeartbeatAt,
            counts[QueueItemState.Pending],
            counts[QueueItemState.Processing],
            counts[QueueItemState.Failed],
            counts[QueueItemState.Completed],
            watched));
    }

    public async Task<UpdateStatusPayload> CheckForUpdatesAsync(CancellationToken cancellationToken)
    {
        if (!_options.Enabled) return ToUpdateStatusPayload(UpdateState.Idle(_agentVersion) with { Lifecycle = UpdateLifecycleState.Disabled, ErrorCategory = UpdateErrorCategory.Disabled });
        var credential = _authState.TryGetCredential();
        var state = await _updateManager.CheckAsync(credential, cancellationToken);
        return ToUpdateStatusPayload(state);
    }

    public Task<UpdateStatusPayload> GetUpdateStatusAsync(CancellationToken cancellationToken) =>
        Task.FromResult(ToUpdateStatusPayload(_updateManager.CurrentState));

    /// <summary>
    /// Launches the narrow, purpose-built update helper process (see
    /// docs/update-architecture.md "Self-update handoff") against the
    /// release the last successful check already downloaded and verified.
    /// Never accepts any parameter that could redirect what gets installed
    /// — see <see cref="InstallUpdateRequest"/>.
    /// </summary>
    public Task<InstallUpdateResponse> InstallUpdateAsync(InstallUpdateRequest request, CancellationToken cancellationToken)
    {
        var state = _updateManager.TryLaunchInstall();
        // Checking ErrorCategory, not Lifecycle: once TryLaunchInstall's
        // transition is correctly serialized (see its own doc comment), every
        // caller racing after the winner reads back a persisted Lifecycle of
        // InstallLaunched too — that value alone can no longer distinguish
        // "I just launched it" from "someone else already did". ErrorCategory
        // is the per-call outcome signal: AlreadyInProgress means the state
        // machine did NOT transition for *this* call. Found alongside the
        // TryLaunchInstall concurrency fix during PR #149 physical acceptance
        // (Test 8) — without this, every racing caller would still launch its
        // own real helper/msiexec process even with TryLaunchInstall locked.
        if (state.ErrorCategory == UpdateErrorCategory.AlreadyInProgress)
        {
            return Task.FromResult(new InstallUpdateResponse(false, ToUpdateStatusPayload(state), "No verified update is staged to install."));
        }

        var launched = TryLaunchUpdateHelper(state);
        if (!launched)
        {
            _updateManager.RecordInstallResult(UpdateLifecycleState.InstallFailed, UpdateErrorCategory.Unknown, rebootRequired: false);
        }

        return Task.FromResult(new InstallUpdateResponse(launched, ToUpdateStatusPayload(_updateManager.CurrentState), launched ? null : "Failed to launch the update helper process."));
    }

    /// <summary>
    /// Copies UpdateHelper.exe and its dependencies out of the MSI-owned
    /// Program Files tree into a private ProgramData working copy, and
    /// returns the copy's exe path (or null if the source is missing).
    ///
    /// PR 7/7 physical acceptance testing on real hardware found that
    /// running the helper directly from AppContext.BaseDirectory\UpdateHelper
    /// (its as-installed location) let Windows Installer's Restart Manager
    /// integration force-close it mid-install: those files are versioned
    /// payload the SAME MSI transaction the helper just launched needs to
    /// overwrite, so RM saw the running exe holding them open and shut it
    /// down (Event ID 10002, "'NoraMedi.Bridge.UpdateHelper' application or
    /// service is being shut down") - killing the one process responsible
    /// for observing the new service come up and writing the helper-result
    /// file. With no result to reconcile on the next boot, the update
    /// Lifecycle never reaches Succeeded, which silently defeated
    /// PostUpdateHealthTracker's crash-loop rollback detector (it only
    /// evaluates when Lifecycle==Succeeded). Running from a private copy
    /// outside the MSI's own component set - the standard pattern for a
    /// self-updater that replaces its own install directory - means the
    /// running process is never one of the files being replaced.
    /// </summary>
    private string? StageDetachedUpdateHelper()
    {
        var sourceDir = Path.Combine(AppContext.BaseDirectory, "UpdateHelper");
        var sourceExe = Path.Combine(sourceDir, "NoraMedi.Bridge.UpdateHelper.exe");
        if (!File.Exists(sourceExe))
        {
            return null;
        }

        var stagedDir = Path.Combine(_updateOptions.UpdatesDirectory, "helper-runtime");
        DetachedHelperStaging.CopyTree(sourceDir, stagedDir);
        ProgramDataAcl.ProtectDirectory(stagedDir, _options.ServiceAccountSid);
        return Path.Combine(stagedDir, "NoraMedi.Bridge.UpdateHelper.exe");
    }

    private bool TryLaunchUpdateHelper(UpdateState state)
    {
        try
        {
            var helperExe = StageDetachedUpdateHelper();
            if (helperExe is null)
            {
                _logger.LogError("update.helper_missing path={Path}", DiagnosticsRedactor.RedactPath(Path.Combine(AppContext.BaseDirectory, "UpdateHelper", "NoraMedi.Bridge.UpdateHelper.exe")));
                return false;
            }

            var instructionPath = Path.Combine(_updateOptions.UpdatesDirectory, "helper-instruction.json");
            // The expected publisher thumbprint travels with the staged
            // state (the value the server's release descriptor declared and
            // UpdateManager already verified against at staging time) — NOT
            // a separate local config value — so the helper's defense-in-depth
            // re-check validates against the exact same trust anchor.
            var instruction = new UpdateHelperInstruction(
                state.StagedInstallerPath!, state.StagedInstallerSha256!, state.OfferedVersion!,
                _updateOptions.RequireTrustedSignature, state.StagedPublisherThumbprint);
            var json = System.Text.Json.JsonSerializer.Serialize(instruction, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
            var tmp = instructionPath + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, instructionPath, overwrite: true);
            ProgramDataAcl.ProtectFile(instructionPath, _options.ServiceAccountSid);

            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = helperExe,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add(instructionPath);
            using var process = System.Diagnostics.Process.Start(psi);
            return process is not null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            _logger.LogError(ex, "update.helper_launch_failed");
            return false;
        }
    }

    public Task<RollbackStatusPayload> GetRollbackStatusAsync(CancellationToken cancellationToken)
    {
        var state = _rollbackManager.CurrentState;
        return Task.FromResult(new RollbackStatusPayload(
            state.Lifecycle.ToString(), state.ErrorCategory.ToString(), state.AttemptedForOfferedVersion, state.TargetVersion, state.UpdatedAtUtc));
    }

    /// <summary>
    /// Mirrors <see cref="TryLaunchUpdateHelper"/> for the rollback path:
    /// asks <see cref="RollbackManager"/> for a verified instruction (which
    /// already re-checked hash/signer and loop-prevention), writes it to an
    /// ACL-protected file, and launches the same helper executable with the
    /// distinguishing "rollback" argument (see NoraMedi.Bridge.UpdateHelper's
    /// Program.cs). Never reachable via IPC — only called from this class's
    /// own post-update health check.
    /// </summary>
    private void TryLaunchRollback(string offeredVersionThatFailed)
    {
        var instruction = _rollbackManager.TryPrepareRollback(offeredVersionThatFailed);
        if (instruction is null) return; // RollbackManager has already persisted a truthful terminal state.

        try
        {
            var helperExe = StageDetachedUpdateHelper();
            if (helperExe is null)
            {
                _logger.LogError("rollback.helper_missing path={Path}", DiagnosticsRedactor.RedactPath(Path.Combine(AppContext.BaseDirectory, "UpdateHelper", "NoraMedi.Bridge.UpdateHelper.exe")));
                _rollbackManager.RecordResult(new RollbackHelperResult("Failed", nameof(RollbackErrorCategory.Unknown), null, null, DateTimeOffset.UtcNow), offeredVersionThatFailed, instruction.ExpectedVersion);
                return;
            }

            var instructionPath = Path.Combine(_updateOptions.UpdatesDirectory, "rollback-helper-instruction.json");
            var json = System.Text.Json.JsonSerializer.Serialize(instruction, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
            var tmp = instructionPath + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, instructionPath, overwrite: true);
            ProgramDataAcl.ProtectFile(instructionPath, _options.ServiceAccountSid);

            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = helperExe,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("rollback");
            psi.ArgumentList.Add(instructionPath);
            using var process = System.Diagnostics.Process.Start(psi);
            if (process is null)
            {
                _rollbackManager.RecordResult(new RollbackHelperResult("Failed", nameof(RollbackErrorCategory.Unknown), null, null, DateTimeOffset.UtcNow), offeredVersionThatFailed, instruction.ExpectedVersion);
                return;
            }

            _rollbackManager.MarkLaunched(offeredVersionThatFailed, instruction.ExpectedVersion);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            _logger.LogError(ex, "rollback.helper_launch_failed");
            _rollbackManager.RecordResult(new RollbackHelperResult("Failed", nameof(RollbackErrorCategory.Unknown), null, null, DateTimeOffset.UtcNow), offeredVersionThatFailed, instruction.ExpectedVersion);
        }
    }

    /// <summary>Mirrors <see cref="UpdateManager.TryReconcileHelperResult"/> for rollback result files — called once at startup (before the health check re-evaluates) so a rollback the helper already finished gets its true terminal state without any delay.</summary>
    private void TryReconcileRollbackHelperResult()
    {
        if (!Directory.Exists(_updateOptions.UpdatesDirectory)) return;
        var resultPath = Directory.EnumerateFiles(_updateOptions.UpdatesDirectory, "rollback-helper-result-*.json")
            .OrderByDescending(f => f)
            .FirstOrDefault();
        if (resultPath is null) return;

        RollbackHelperResult? result;
        try
        {
            var json = File.ReadAllText(resultPath);
            result = System.Text.Json.JsonSerializer.Deserialize<RollbackHelperResult>(json, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        }
        catch (Exception ex) when (ex is IOException or System.Text.Json.JsonException or UnauthorizedAccessException)
        {
            result = null;
        }

        try { if (File.Exists(resultPath)) File.Delete(resultPath); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }

        if (result is null) return;

        var current = _rollbackManager.CurrentState;
        if (current.AttemptedForOfferedVersion is null || current.TargetVersion is null) return;
        _rollbackManager.RecordResult(result, current.AttemptedForOfferedVersion, current.TargetVersion);
    }

    private void OnAutomaticInstallReady(UpdateState state)
    {
        var launchedState = _updateManager.TryLaunchInstall();
        if (launchedState.Lifecycle != UpdateLifecycleState.InstallLaunched) return;

        if (!TryLaunchUpdateHelper(launchedState))
        {
            _updateManager.RecordInstallResult(UpdateLifecycleState.InstallFailed, UpdateErrorCategory.Unknown, rebootRequired: false);
        }
    }

    private static UpdateStatusPayload ToUpdateStatusPayload(UpdateState state) => new(
        state.Lifecycle.ToString(),
        state.InstalledVersion,
        state.OfferedVersion,
        state.DownloadedBytes,
        state.TotalBytes,
        state.ErrorCategory.ToString(),
        state.RebootRequired,
        state.UpdatedAtUtc);

    public async Task<ProvisionWithPairingCodeResponse> ProvisionWithPairingCodeAsync(ProvisionWithPairingCodeRequest request, CancellationToken cancellationToken)
    {
        var correlationId = Guid.NewGuid().ToString("N")[..8];

        if (!_options.Enabled)
        {
            return new ProvisionWithPairingCodeResponse(false, null, null, null, "Bridge self-service is disabled.", PairingErrorCategory.FeatureDisabled, correlationId);
        }

        var pairRequest = new PairRequest(
            Code: request.PairingCode,
            InstallationId: _installationId,
            AgentVersion: _agentVersion,
            ComputerDisplayName: request.ComputerDisplayName,
            OsVersion: RuntimeInformation.OSDescription,
            Architecture: RuntimeInformation.OSArchitecture.ToString());

        var outcome = await _apiClient.RedeemPairingCodeAsync(pairRequest, cancellationToken);

        // Safe to log: endpoint category, outcome category, HTTP status, code
        // *length* (never the code itself), correlation id. Never the code,
        // its hash, or the credential — see docs/security.md.
        _logger.LogInformation(
            "pairing.attempt correlationId={CorrelationId} endpoint={Endpoint} serverUrl={ServerUrlOrigin} category={Category} statusCode={StatusCode} codeLength={CodeLength} agentVersion={AgentVersion}",
            correlationId, "imaging/bridge/pair", _options.SafeServerUrlOrigin, outcome.Category, outcome.StatusCode, request.PairingCode.Length, _agentVersion);

        if (outcome.Category != PairingResultCategory.Success || outcome.Response is null)
        {
            var (errorMessage, errorCategory) = outcome.Category switch
            {
                PairingResultCategory.InvalidOrExpiredCode => ("Invalid or expired pairing code.", PairingErrorCategory.InvalidOrExpiredCode),
                PairingResultCategory.RateLimited => ("Too many pairing attempts. Try again later.", PairingErrorCategory.RateLimited),
                PairingResultCategory.BadRequest => ("The pairing request was rejected.", PairingErrorCategory.InvalidRequest),
                PairingResultCategory.ServerError => ("The server could not process the request.", PairingErrorCategory.ServerError),
                PairingResultCategory.MalformedResponse => ("Received an unexpected response from the server.", PairingErrorCategory.ServerError),
                PairingResultCategory.NetworkFailure => ("Could not reach the NoraMedi server.", PairingErrorCategory.NetworkFailure),
                _ => ("Invalid or expired pairing code.", PairingErrorCategory.InvalidOrExpiredCode),
            };
            return new ProvisionWithPairingCodeResponse(false, null, null, null, errorMessage, errorCategory, correlationId);
        }

        _credentialStore.Save(outcome.Response.BridgeCredential);
        _authState.MarkValid();
        _serverBindingsCatalogStore.Save(outcome.Response.Bindings.Select(ToAvailableServerBindingInfo).ToList());
        return new ProvisionWithPairingCodeResponse(true, outcome.Response.BridgeAgentId, outcome.Response.ClinicName, outcome.Response.Bindings.Count, null, null, correlationId);
    }

    /// <summary>
    /// Serves the device/binding catalog cached from the last successful
    /// pairing or bootstrap refresh (see <see cref="ServerBindingsCatalogStore"/>).
    /// A revoked/invalid credential must never keep surfacing a stale
    /// catalog it can no longer vouch for — <see cref="BridgeAuthState.IsValid"/>
    /// being false (401 seen, not yet recovered) returns an empty list
    /// instead, driving the Manager's truthful "no devices available yet"
    /// empty state until pairing or a successful heartbeat restores trust.
    /// </summary>
    public Task<GetAvailableServerBindingsResponse> GetAvailableServerBindingsAsync(CancellationToken cancellationToken)
    {
        if (!_authState.IsValid)
        {
            return Task.FromResult(new GetAvailableServerBindingsResponse([]));
        }

        return Task.FromResult(new GetAvailableServerBindingsResponse(_serverBindingsCatalogStore.Load()));
    }

    public async ValueTask DisposeAsync()
    {
        if (_drainTimer is not null) await _drainTimer.DisposeAsync();
        if (_heartbeatTimer is not null) await _heartbeatTimer.DisposeAsync();
        if (_watcherAdapter is not null) await _watcherAdapter.DisposeAsync();
        await _updateLoop.DisposeAsync();
        if (_ownsUpdateHttpClient) _updateHttpClient.Dispose();
        _queue.Dispose();
    }
}
