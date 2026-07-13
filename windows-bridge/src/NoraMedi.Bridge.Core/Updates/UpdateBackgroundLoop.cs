using Microsoft.Extensions.Logging;
using NoraMedi.Bridge.Core.Queue;

namespace NoraMedi.Bridge.Core.Updates;

/// <summary>
/// Timer-driven background update checking — deliberately its own
/// <see cref="Timer"/>, independent of the drain/heartbeat timers in
/// <see cref="Runtime.BridgeOrchestrator"/>, so a slow or stuck update check
/// can never delay queue draining or heartbeat. See
/// docs/update-architecture.md "Background checking loop".
/// </summary>
public sealed class UpdateBackgroundLoop : IAsyncDisposable
{
    private readonly UpdateManager _updateManager;
    private readonly UpdateDownloader _downloader;
    private readonly UpdateOptions _options;
    private readonly Func<string?> _credentialProvider;
    private readonly Func<bool> _hasActiveUploadInFlight;
    private readonly Func<UpdatePolicyMode> _lastKnownModeProvider;
    private readonly Action<UpdateState> _onVerifiedForAutomaticInstall;
    private readonly ILogger _logger;
    private Timer? _timer;
    private int _consecutiveFailures;
    private DateTimeOffset _nextAllowedCheckUtc = DateTimeOffset.MinValue;

    public UpdateBackgroundLoop(
        UpdateManager updateManager,
        UpdateDownloader downloader,
        UpdateOptions options,
        Func<string?> credentialProvider,
        Func<bool> hasActiveUploadInFlight,
        Func<UpdatePolicyMode> lastKnownModeProvider,
        Action<UpdateState> onVerifiedForAutomaticInstall,
        ILogger logger)
    {
        _updateManager = updateManager;
        _downloader = downloader;
        _options = options;
        _credentialProvider = credentialProvider;
        _hasActiveUploadInFlight = hasActiveUploadInFlight;
        _lastKnownModeProvider = lastKnownModeProvider;
        _onVerifiedForAutomaticInstall = onVerifiedForAutomaticInstall;
        _logger = logger;
    }

    public void Start()
    {
        if (_timer is not null) return;
        var jitter = TimeSpan.FromSeconds(Random.Shared.Next(0, Math.Max(1, _options.StartupJitterSeconds)));
        _timer = new Timer(_ => _ = SafeTickAsync(), null, jitter, TimeSpan.FromMinutes(_options.CheckIntervalMinutes));
    }

    private async Task SafeTickAsync()
    {
        try
        {
            await TickAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled error in update background loop");
        }
    }

    /// <summary>Internal (not private) solely so NoraMedi.Bridge.Core.Tests can drive one tick deterministically instead of waiting on a real Timer.</summary>
    internal async Task TickAsync(CancellationToken cancellationToken)
    {
        _updateManager.TryReconcileHelperResult();

        if (DateTimeOffset.UtcNow < _nextAllowedCheckUtc)
        {
            // Bounded backoff from a prior failed check is still in effect — skip this tick
            // rather than hammering the server every fixed interval regardless of outcome.
            return;
        }

        _downloader.CleanupStaleFiles(DateTimeOffset.UtcNow);

        var credential = _credentialProvider();
        var state = await _updateManager.CheckAsync(credential, cancellationToken);

        if (state.ErrorCategory is UpdateErrorCategory.NetworkFailure or UpdateErrorCategory.Unknown)
        {
            _consecutiveFailures++;
            var backoff = BackoffCalculator.Compute(_consecutiveFailures, TimeSpan.FromMilliseconds(_options.BackoffBaseMs), TimeSpan.FromMilliseconds(_options.BackoffCapMs));
            _nextAllowedCheckUtc = DateTimeOffset.UtcNow + backoff;
            _logger.LogWarning("update.check_failed consecutiveFailures={Count} nextRetryIn={Backoff}", _consecutiveFailures, backoff);
            return;
        }
        _consecutiveFailures = 0;
        _nextAllowedCheckUtc = DateTimeOffset.MinValue;

        if (state.Lifecycle != UpdateLifecycleState.Verified) return;
        if (_lastKnownModeProvider() != UpdatePolicyMode.Automatic) return;

        // Queue-drain safety: never install while an item is actively uploading —
        // wait for the next tick rather than interrupting an in-flight transfer.
        if (_hasActiveUploadInFlight())
        {
            _logger.LogInformation("update.automatic_install_deferred reason=upload_in_flight");
            return;
        }

        _onVerifiedForAutomaticInstall(state);
    }

    public ValueTask DisposeAsync() => _timer?.DisposeAsync() ?? ValueTask.CompletedTask;
}
