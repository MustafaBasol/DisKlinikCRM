using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Extensions.Logging;
using NoraMedi.Bridge.Core.Acquisition;
using NoraMedi.Bridge.Core.Diagnostics;
using NoraMedi.Bridge.Core.Http;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Core.Queue;
using NoraMedi.Bridge.Core.Security;

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

    private FolderWatchAdapter? _watcherAdapter;
    private Timer? _drainTimer;
    private Timer? _heartbeatTimer;
    private DateTimeOffset? _lastHeartbeatAt;
    private bool _draining;
    private bool _started;

    public BridgeOrchestrator(BridgeOptions options, BridgeApiClient apiClient, string agentVersion, ILogger<BridgeOrchestrator> logger)
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

    public Task<CheckForUpdatesResponse> CheckForUpdatesAsync(CancellationToken cancellationToken) =>
        Task.FromResult(CheckForUpdatesResponse.NotSupported());

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
        _queue.Dispose();
    }
}
