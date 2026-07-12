using Microsoft.Extensions.Logging;
using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Updates;

/// <summary>
/// Composition root for the update subsystem: owns the single-flight gate,
/// drives the state machine through check → download → verify → (launch
/// install), and is the only thing <see cref="Runtime.BridgeOrchestrator"/>
/// and the Named Pipe IPC surface talk to. See docs/update-architecture.md.
/// </summary>
public sealed class UpdateManager
{
    private readonly UpdateOptions _options;
    private readonly UpdateStateStore _stateStore;
    private readonly UpdateDownloader _downloader;
    private readonly Http.BridgeApiClient _apiClient;
    private readonly string _agentVersion;
    private readonly ILogger _logger;
    private readonly Func<string, string, SignatureTrustResult>? _trustVerifierOverride;
    private readonly Func<string, bool>? _pinnedThumbprintOverride;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public UpdateManager(
        UpdateOptions options,
        UpdateStateStore stateStore,
        UpdateDownloader downloader,
        Http.BridgeApiClient apiClient,
        string agentVersion,
        ILogger logger,
        Func<string, string, SignatureTrustResult>? trustVerifierOverride = null,
        Func<string, bool>? pinnedThumbprintOverride = null)
    {
        _options = options;
        _stateStore = stateStore;
        _downloader = downloader;
        _apiClient = apiClient;
        _agentVersion = agentVersion;
        _logger = logger;
        _trustVerifierOverride = trustVerifierOverride;
        _pinnedThumbprintOverride = pinnedThumbprintOverride;
    }

    public UpdateState CurrentState => _stateStore.Load(_agentVersion);

    /// <summary>The server's mode from the most recent successful check — consulted by <see cref="Updates.UpdateBackgroundLoop"/> to decide whether a verified release may be auto-installed.</summary>
    public UpdatePolicyMode LastKnownMode { get; private set; } = UpdatePolicyMode.Disabled;

    /// <summary>
    /// Reads the server's release descriptor, compares against the
    /// installed version, and — for <see cref="UpdatePolicyMode.Notify"/>
    /// or <see cref="UpdatePolicyMode.Automatic"/> — stages
    /// (downloads+verifies) a newer release. Never installs; installation is
    /// a separate, explicit, admin-gated step (see
    /// <see cref="TryLaunchInstall"/>). Returns the resulting state
    /// whether or not an update was found.
    /// </summary>
    public async Task<UpdateState> CheckAsync(string? credential, CancellationToken cancellationToken)
    {
        if (!await _gate.WaitAsync(0, cancellationToken))
        {
            return CurrentState with { ErrorCategory = UpdateErrorCategory.AlreadyInProgress };
        }

        try
        {
            // A fresh check supersedes any reboot-required status left over from a previous install
            // attempt — otherwise RebootRequired sticks forever (see resetRebootRequired doc comment
            // on SetState) and the Manager keeps showing "reboot required" even after the machine
            // has since rebooted and a later check finds everything up to date.
            SetState(UpdateLifecycleState.Checking, UpdateErrorCategory.None, resetRebootRequired: true);

            if (credential is null)
            {
                return SetState(UpdateLifecycleState.Disabled, UpdateErrorCategory.ServiceUnavailable);
            }

            var config = await _apiClient.GetUpdateConfigAsync(credential, cancellationToken);
            if (config is null)
            {
                return SetState(UpdateLifecycleState.Disabled, UpdateErrorCategory.NetworkFailure);
            }

            var mode = UpdatePolicyModeParser.Parse(config.Mode);
            LastKnownMode = mode;
            if (mode == UpdatePolicyMode.Disabled || config.Release is null)
            {
                return SetState(UpdateLifecycleState.Disabled, UpdateErrorCategory.Disabled);
            }

            var release = config.Release;

            if (!UpdateVersion.TryParse(_agentVersion, out var installed) || !UpdateVersion.TryParse(release.Version, out var offered))
            {
                return SetState(UpdateLifecycleState.Unsupported, UpdateErrorCategory.UnsupportedSourceVersion);
            }

            if (release.MinimumSourceVersion is not null
                && UpdateVersion.TryParse(release.MinimumSourceVersion, out var minSource)
                && installed < minSource)
            {
                return SetState(UpdateLifecycleState.Unsupported, UpdateErrorCategory.UnsupportedSourceVersion);
            }

            if (!UpdateVersion.IsUpgrade(installed, offered))
            {
                return SetState(UpdateLifecycleState.UpToDate, UpdateErrorCategory.None);
            }

            SetState(UpdateLifecycleState.UpdateAvailable, UpdateErrorCategory.None, offeredVersion: release.Version);

            if (mode is UpdatePolicyMode.Notify or UpdatePolicyMode.Automatic)
            {
                await StageAsync(release, cancellationToken);
            }

            return CurrentState;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task StageAsync(ServerUpdateRelease release, CancellationToken cancellationToken)
    {
        SetState(UpdateLifecycleState.Downloading, UpdateErrorCategory.None, offeredVersion: release.Version);

        // Feeds the downloader's real streaming byte count back into the persisted state so
        // GetUpdateStatus (polled by the Manager) can show actual "X of Y MB" progress instead of a
        // stale value stuck at whatever the last state transition happened to record. Throttled to
        // avoid a state.json disk write per 80KB read-loop iteration on a fast connection.
        var lastReported = DateTimeOffset.MinValue;
        var progress = new Progress<(long downloaded, long? total)>(p =>
        {
            var now = DateTimeOffset.UtcNow;
            if (now - lastReported < TimeSpan.FromMilliseconds(500)) return;
            lastReported = now;
            SetState(UpdateLifecycleState.Downloading, UpdateErrorCategory.None, offeredVersion: release.Version,
                downloadedBytes: p.downloaded, totalBytes: p.total);
        });

        var download = await _downloader.DownloadAsync(release.DownloadUrl, release.Sha256, cancellationToken, progress);
        switch (download.Kind)
        {
            case DownloadOutcomeKind.Success:
                break;
            case DownloadOutcomeKind.HashMismatch:
                SetState(UpdateLifecycleState.VerificationFailed, UpdateErrorCategory.HashMismatch, offeredVersion: release.Version);
                return;
            case DownloadOutcomeKind.TooLarge:
                SetState(UpdateLifecycleState.DownloadFailed, UpdateErrorCategory.DownloadTooLarge, offeredVersion: release.Version);
                return;
            case DownloadOutcomeKind.RejectedUrl:
            case DownloadOutcomeKind.HttpFailure:
            case DownloadOutcomeKind.NetworkFailure:
            case DownloadOutcomeKind.Cancelled:
            default:
                SetState(UpdateLifecycleState.DownloadFailed, UpdateErrorCategory.NetworkFailure, offeredVersion: release.Version);
                return;
        }

        SetState(UpdateLifecycleState.Verifying, UpdateErrorCategory.None, offeredVersion: release.Version, stagedPath: download.StagedPath, downloadedBytes: download.Bytes);

        if (_options.RequireTrustedSignature)
        {
            if (string.IsNullOrEmpty(release.PublisherThumbprint) || !release.Signed)
            {
                DeleteStaged(download.StagedPath);
                SetState(UpdateLifecycleState.VerificationFailed, UpdateErrorCategory.UnsignedPackage, offeredVersion: release.Version);
                return;
            }

            var trustResult = _trustVerifierOverride is not null
                ? _trustVerifierOverride(download.StagedPath!, release.PublisherThumbprint)
                : AuthenticodeVerifier.Verify(download.StagedPath!, release.PublisherThumbprint);

            if (trustResult != SignatureTrustResult.TrustedPublisher)
            {
                _logger.LogWarning("update.verification_failed reason={Reason}", trustResult);
                DeleteStaged(download.StagedPath);
                var category = trustResult switch
                {
                    SignatureTrustResult.Unsigned => UpdateErrorCategory.UnsignedPackage,
                    SignatureTrustResult.WrongPublisher => UpdateErrorCategory.WrongPublisher,
                    _ => UpdateErrorCategory.TamperedSignature,
                };
                SetState(UpdateLifecycleState.VerificationFailed, category, offeredVersion: release.Version);
                return;
            }

            // The server declaring a thumbprint (and Authenticode agreeing with it) only proves
            // "this file matches what the server told us to expect" — it does NOT prove NoraMedi
            // signed it. A compromised backend/release config could declare any validly-signed
            // thumbprint it controls. The bridge's own compiled-in allowlist is the independent
            // ceiling: the server can narrow the accepted signer for one release, but cannot expand
            // it beyond this local list. See Trust/PinnedPublisherThumbprints.cs.
            var isPinnedPublisher = _pinnedThumbprintOverride is not null
                ? _pinnedThumbprintOverride(release.PublisherThumbprint!)
                : Trust.PinnedPublisherThumbprints.Contains(release.PublisherThumbprint!);
            if (!isPinnedPublisher)
            {
                _logger.LogWarning("update.verification_failed reason=UntrustedPublisher");
                DeleteStaged(download.StagedPath);
                SetState(UpdateLifecycleState.VerificationFailed, UpdateErrorCategory.UntrustedPublisher, offeredVersion: release.Version);
                return;
            }
        }

        SetState(UpdateLifecycleState.Verified, UpdateErrorCategory.None, offeredVersion: release.Version,
            stagedPath: download.StagedPath, stagedSha256: release.Sha256, downloadedBytes: download.Bytes,
            stagedPublisherThumbprint: release.PublisherThumbprint);
    }

    /// <summary>
    /// Marks the staged, already-verified release ready for the helper
    /// process to install. Takes no parameters — see docs/update-architecture.md
    /// "IPC contract changes" for why: there is nothing here for a caller to
    /// smuggle a different URL/path/args into.
    /// </summary>
    public UpdateState TryLaunchInstall()
    {
        var state = CurrentState;
        if (state.Lifecycle != UpdateLifecycleState.Verified || state.StagedInstallerPath is null)
        {
            return state with { ErrorCategory = UpdateErrorCategory.AlreadyInProgress };
        }

        return SetState(UpdateLifecycleState.InstallLaunched, UpdateErrorCategory.None,
            offeredVersion: state.OfferedVersion, stagedPath: state.StagedInstallerPath, stagedSha256: state.StagedInstallerSha256,
            stagedPublisherThumbprint: state.StagedPublisherThumbprint);
    }

    /// <summary>Called by the Service after re-reading the helper's result log — see docs/update-architecture.md "Self-update handoff".</summary>
    public void RecordInstallResult(UpdateLifecycleState finalState, UpdateErrorCategory errorCategory, bool rebootRequired)
    {
        SetState(finalState, errorCategory, rebootRequired: rebootRequired);
    }

    /// <summary>
    /// Called once on Worker start: reclassifies any non-terminal leftover
    /// state as <c>Interrupted</c> (crash/kill during a check/download/
    /// install), then — if a helper result file is waiting from an install
    /// launched just before this process last stopped — finalizes it to its
    /// true terminal state instead of leaving it as the generic
    /// <c>Interrupted</c>.
    /// </summary>
    public void ReconcileHelperResultOnStartup()
    {
        _stateStore.ReconcileOnStartup(_agentVersion);
        TryReconcileHelperResult();
    }

    /// <summary>
    /// Polled every background-loop tick too: an install failure that never
    /// required the Service process itself to restart (e.g. msiexec exited
    /// non-zero before touching the running service) leaves this process
    /// alive to pick up the helper's result without waiting for the next
    /// Service startup.
    /// </summary>
    public void TryReconcileHelperResult()
    {
        var resultPath = FindLatestHelperResultFile();
        if (resultPath is null) return;

        UpdateHelperResult? result;
        try
        {
            var json = File.ReadAllText(resultPath);
            result = System.Text.Json.JsonSerializer.Deserialize<UpdateHelperResult>(json, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        }
        catch (Exception ex) when (ex is IOException or System.Text.Json.JsonException or UnauthorizedAccessException)
        {
            result = null;
        }

        DeleteStaged(resultPath);
        if (result is null) return;

        var lifecycle = result.Outcome switch
        {
            nameof(UpdateLifecycleState.Succeeded) => UpdateLifecycleState.Succeeded,
            nameof(UpdateLifecycleState.RebootRequired) => UpdateLifecycleState.RebootRequired,
            _ => UpdateLifecycleState.InstallFailed,
        };
        var errorCategory = Enum.TryParse<UpdateErrorCategory>(result.ErrorCategory, out var parsed) ? parsed : UpdateErrorCategory.Unknown;
        RecordInstallResult(lifecycle, lifecycle == UpdateLifecycleState.InstallFailed ? errorCategory : UpdateErrorCategory.None, result.RebootRequired);

        // A successful install means the newly-installed Service process reports its own
        // (new) installed version on the next state read — this record's InstalledVersion
        // is intentionally left as-is here; the Service always constructs UpdateManager
        // with its own current AgentVersion.Current at startup.
    }

    private string? FindLatestHelperResultFile()
    {
        if (!Directory.Exists(_options.UpdatesDirectory)) return null;
        return Directory.EnumerateFiles(_options.UpdatesDirectory, "helper-result-*.json")
            .OrderByDescending(f => f)
            .FirstOrDefault();
    }

    private void DeleteStaged(string? path)
    {
        if (path is null) return;
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    private UpdateState SetState(
        UpdateLifecycleState lifecycle,
        UpdateErrorCategory errorCategory,
        string? offeredVersion = null,
        string? stagedPath = null,
        string? stagedSha256 = null,
        long? downloadedBytes = null,
        bool rebootRequired = false,
        string? stagedPublisherThumbprint = null,
        bool resetRebootRequired = false,
        long? totalBytes = null)
    {
        var current = _stateStore.Load(_agentVersion);
        var next = current with
        {
            Lifecycle = lifecycle,
            OfferedVersion = offeredVersion ?? current.OfferedVersion,
            StagedInstallerPath = stagedPath ?? current.StagedInstallerPath,
            StagedInstallerSha256 = stagedSha256 ?? current.StagedInstallerSha256,
            StagedPublisherThumbprint = stagedPublisherThumbprint ?? current.StagedPublisherThumbprint,
            DownloadedBytes = downloadedBytes ?? current.DownloadedBytes,
            TotalBytes = totalBytes ?? current.TotalBytes,
            ErrorCategory = errorCategory,
            // OR-forward within one install attempt (multiple SetState calls before the terminal
            // RebootRequired/Succeeded state shouldn't lose a true set earlier), but resetRebootRequired
            // (passed only when a fresh CheckAsync cycle starts) intentionally breaks the chain — a new
            // check cycle re-evaluates reality from scratch instead of parroting a stale prior result forever.
            RebootRequired = resetRebootRequired ? rebootRequired : (rebootRequired || current.RebootRequired),
            UpdatedAtUtc = DateTimeOffset.UtcNow,
        };
        _stateStore.Save(next);
        return next;
    }
}
