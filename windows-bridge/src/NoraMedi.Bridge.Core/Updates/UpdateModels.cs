using System.Text.Json.Serialization;

namespace NoraMedi.Bridge.Core.Updates;

/// <summary>Response shape of GET /api/public/imaging/bridge/update (server/src/services/imaging/bridgeUpdateConfig.ts).</summary>
public sealed record ServerUpdateConfig(
    [property: JsonPropertyName("mode")] string Mode,
    [property: JsonPropertyName("release")] ServerUpdateRelease? Release);

public sealed record ServerUpdateRelease(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("downloadUrl")] string DownloadUrl,
    [property: JsonPropertyName("sha256")] string Sha256,
    [property: JsonPropertyName("signed")] bool Signed,
    [property: JsonPropertyName("publisherThumbprint")] string? PublisherThumbprint,
    [property: JsonPropertyName("minimumSourceVersion")] string? MinimumSourceVersion,
    [property: JsonPropertyName("notes")] string? Notes,
    // PR 7/7 fields — nullable/defaulted so a JSON payload from an older server
    // (or a test fixture that predates staged rollout) still deserializes.
    // The server has already made the rollout/channel decision for this bridge
    // by the time this descriptor is served (see bridgeUpdateConfig.ts
    // eligibility filtering) — the bridge never re-evaluates eligibility itself.
    [property: JsonPropertyName("releaseId")] string? ReleaseId = null,
    [property: JsonPropertyName("rollback")] Rollback.RollbackPackageDescriptor? Rollback = null);

/// <summary>Fail-closed local interpretation of <see cref="ServerUpdateConfig.Mode"/>.</summary>
public enum UpdatePolicyMode
{
    Disabled,
    Notify,
    Automatic,
}

public static class UpdatePolicyModeParser
{
    public static UpdatePolicyMode Parse(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        "notify" => UpdatePolicyMode.Notify,
        "automatic" => UpdatePolicyMode.Automatic,
        _ => UpdatePolicyMode.Disabled,
    };
}

/// <summary>
/// Every lifecycle state the update state machine can be in, persisted to
/// <c>updates\state.json</c> (see <see cref="UpdateStateStore"/>) and
/// surfaced to the Manager via <see cref="Ipc.GetUpdateStatusResponse"/>.
/// </summary>
public enum UpdateLifecycleState
{
    Idle,
    Checking,
    UpToDate,
    UpdateAvailable,
    Downloading,
    Verifying,
    Verified,
    DownloadFailed,
    VerificationFailed,
    InstallLaunched,
    Installing,
    Succeeded,
    InstallFailed,
    RebootRequired,
    Interrupted,
    Disabled,
    Unsupported,
}

/// <summary>Coarse retryability hint for the Manager — never a raw exception, never a stack trace.</summary>
public enum UpdateErrorCategory
{
    None,
    NetworkFailure,
    DownloadTooLarge,
    HashMismatch,
    UnsignedPackage,
    WrongPublisher,
    TamperedSignature,
    /// <summary>Signature is valid and matches the server-declared thumbprint, but that thumbprint is not in the bridge's own compiled-in trust anchor (<see cref="Trust.PinnedPublisherThumbprints"/>) — the server alone cannot authorize a signer.</summary>
    UntrustedPublisher,
    InstallerFailure,
    ServiceUnavailable,
    Disabled,
    UnsupportedSourceVersion,
    AlreadyInProgress,
    CorruptState,
    /// <summary>Installer ran, exited successfully, and the service reached Running, but the installed product version does not match the release that was offered.</summary>
    PostInstallVersionMismatch,
    Unknown,
}

/// <summary>
/// The persisted state machine record. Written atomically as a whole —
/// see <see cref="UpdateStateStore"/> — never partially updated in place.
/// </summary>
public sealed record UpdateState(
    UpdateLifecycleState Lifecycle,
    string? InstalledVersion,
    string? OfferedVersion,
    string? StagedInstallerPath,
    string? StagedInstallerSha256,
    long DownloadedBytes,
    long? TotalBytes,
    UpdateErrorCategory ErrorCategory,
    bool RebootRequired,
    DateTimeOffset UpdatedAtUtc,
    string? StagedPublisherThumbprint = null)
{
    public static UpdateState Idle(string installedVersion) => new(
        UpdateLifecycleState.Idle, installedVersion, null, null, null, 0, null,
        UpdateErrorCategory.None, false, DateTimeOffset.UtcNow);

    public bool IsTerminal => Lifecycle is UpdateLifecycleState.Idle or UpdateLifecycleState.UpToDate
        or UpdateLifecycleState.Succeeded or UpdateLifecycleState.InstallFailed
        or UpdateLifecycleState.DownloadFailed or UpdateLifecycleState.VerificationFailed
        or UpdateLifecycleState.RebootRequired or UpdateLifecycleState.Disabled
        or UpdateLifecycleState.Unsupported;

    /// <summary>True while a check/download/install is actively in flight — the single-flight gate condition.</summary>
    public bool IsInProgress => !IsTerminal;
}
