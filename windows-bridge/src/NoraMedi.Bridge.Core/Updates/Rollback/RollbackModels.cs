using System.Text.Json.Serialization;

namespace NoraMedi.Bridge.Core.Updates.Rollback;

/// <summary>
/// Server-declared previously-trusted release the bridge caches locally
/// BEFORE installing a new version, so it can revert without contacting the
/// server if the new version fails its post-install health check. Optional —
/// null when the operator hasn't declared a rollback target for the current
/// release. See docs/update-runbook.md "Staged rollout & rollback".
/// </summary>
public sealed record RollbackPackageDescriptor(
    [property: JsonPropertyName("version")] string Version,
    [property: JsonPropertyName("downloadUrl")] string DownloadUrl,
    [property: JsonPropertyName("sha256")] string Sha256,
    [property: JsonPropertyName("publisherThumbprint")] string PublisherThumbprint);

/// <summary>
/// What's actually on disk in the ACL-protected rollback cache
/// (<c>updates\rollback\</c>) — at most one entry at a time. Distinct from
/// <see cref="RollbackPackageDescriptor"/>: this is the *local, already
/// hash+signer-verified* record the bridge trusts on its own, not merely
/// what the server most recently declared.
/// </summary>
public sealed record RollbackCacheManifest(
    string Version,
    string InstallerPath,
    string Sha256,
    string PublisherThumbprint,
    DateTimeOffset CachedAtUtc);

/// <summary>Every lifecycle state the rollback state machine can be in — surfaced to the Manager alongside <see cref="UpdateLifecycleState"/>.</summary>
public enum RollbackLifecycleState
{
    /// <summary>No rollback ever attempted for the current installed version.</summary>
    None,
    Preparing,
    Uninstalling,
    Installing,
    Succeeded,
    Failed,
    /// <summary>A rollback was attempted and failed, or a second rollback for the same offered version was requested — no further automatic retry. Requires manual/support intervention.</summary>
    InterventionRequired,
}

public enum RollbackErrorCategory
{
    None,
    NoCachedPackage,
    CacheHashMismatch,
    CacheSignerUntrusted,
    TargetVersionMismatch,
    AlreadyInProgress,
    LoopPrevented,
    UninstallFailed,
    InstallerFailure,
    ServiceUnavailable,
    PostRollbackVersionMismatch,
    Unknown,
}

/// <summary>
/// Persisted to <c>updates\rollback-state.json</c>, atomically, ACL-protected
/// — same pattern as <see cref="UpdateStateStore"/>. <see cref="AttemptedForOfferedVersion"/>
/// is the loop-prevention key: once a rollback has been attempted (success or
/// failure) for a given offered (now-failed) version, a second automatic
/// attempt for that SAME offered version is refused — see
/// <see cref="Rollback.RollbackManager.TryLaunchRollback"/>.
/// </summary>
public sealed record RollbackState(
    RollbackLifecycleState Lifecycle,
    RollbackErrorCategory ErrorCategory,
    string? AttemptedForOfferedVersion,
    string? TargetVersion,
    DateTimeOffset UpdatedAtUtc)
{
    public static RollbackState Idle => new(RollbackLifecycleState.None, RollbackErrorCategory.None, null, null, DateTimeOffset.UtcNow);

    public bool IsInProgress => Lifecycle is RollbackLifecycleState.Preparing or RollbackLifecycleState.Uninstalling or RollbackLifecycleState.Installing;
}
