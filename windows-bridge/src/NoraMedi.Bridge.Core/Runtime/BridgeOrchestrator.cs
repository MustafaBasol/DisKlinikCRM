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

        Directory.CreateDirectory(_options.ProgramDataRoot);
        _queue = new SqliteBridgeQueue(_options.SpoolDirectory, _options.QueueDatabasePath);
        _credentialStore = new DpapiCredentialStore(_options.CredentialPath);
        _authState = new BridgeAuthState(_credentialStore);
        _bindingsStore = new FolderBindingsStore(_options.BindingsPath);
        _installationId = InstallationIdProvider.GetOrCreate(_options.InstallationIdPath);
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
    }

    private void RebuildWatcher()
    {
        _watcherAdapter?.Stop();
        var bindings = _bindingsStore.Load();
        _watcherAdapter = new FolderWatchAdapter(bindings, TimeSpan.FromMilliseconds(_options.StabilityMs));
        _watcherAdapter.FileAcquired += OnFileAcquired;
        if (_started && _options.Enabled) _watcherAdapter.Start();
    }

    private void OnFileAcquired(object? sender, AcquiredFile file)
    {
        try
        {
            var bytes = File.ReadAllBytes(file.SourcePath);
            _queue.Enqueue(bytes, file.Binding.WatchId, file.Binding.DeviceId, file.Binding.Modality);
        }
        catch (IOException ex)
        {
            _logger.LogWarning(ex, "Failed to read acquired file for watch {WatchId}", file.Binding.WatchId);
        }
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
                    var delay = BackoffCalculator.Compute(nextAttempt, TimeSpan.FromMilliseconds(_options.BackoffBaseMs), TimeSpan.FromMilliseconds(_options.BackoffCapMs));
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
        if (result.Ok)
        {
            _authState.MarkValid();
            _lastHeartbeatAt = DateTimeOffset.UtcNow;
        }
        else if (result.StatusCode == 401)
        {
            _authState.MarkInvalid();
        }
    }

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
        var pairRequest = new PairRequest(
            Code: request.PairingCode,
            InstallationId: _installationId,
            AgentVersion: _agentVersion,
            ComputerDisplayName: request.ComputerDisplayName,
            OsVersion: RuntimeInformation.OSDescription,
            Architecture: RuntimeInformation.OSArchitecture.ToString());

        var result = await _apiClient.RedeemPairingCodeAsync(pairRequest, cancellationToken);
        if (result is null)
        {
            return new ProvisionWithPairingCodeResponse(false, null, null, null, "Invalid or expired pairing code.");
        }

        _credentialStore.Save(result.BridgeCredential);
        _authState.MarkValid();
        return new ProvisionWithPairingCodeResponse(true, result.BridgeAgentId, result.ClinicName, result.Bindings.Count, null);
    }

    public async ValueTask DisposeAsync()
    {
        if (_drainTimer is not null) await _drainTimer.DisposeAsync();
        if (_heartbeatTimer is not null) await _heartbeatTimer.DisposeAsync();
        if (_watcherAdapter is not null) await _watcherAdapter.DisposeAsync();
        _queue.Dispose();
    }
}
