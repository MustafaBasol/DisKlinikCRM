namespace NoraMedi.Bridge.Core.Ipc;

/// <summary>
/// Payload DTOs for every <see cref="PipeOperation"/>. Unlike server-facing
/// DTOs and logs, these MAY carry real local folder paths — the Manager UI
/// runs on the same clinic PC as the service and needs the actual path to
/// let a user pick/verify a folder. The "never send the full path" rule
/// applies to the server (see docs/security.md), not to this local IPC hop.
/// </summary>
public sealed record ServiceStatusPayload(
    string AgentVersion,
    string InstallationId,
    bool Paired,
    string ConnectionState,
    string AuthState,
    DateTimeOffset? LastHeartbeatAt,
    int PendingCount,
    int ProcessingCount,
    int FailedCount,
    int CompletedCount);

public sealed record FolderBindingInfo(string WatchId, string Path, string DeviceId, string? Modality, bool Available);

public sealed record ValidateFolderRequest(string Path);

public sealed record ValidateFolderResponse(bool Exists, bool Readable, string? Message);

public sealed record AddOrUpdateFolderBindingRequest(string? WatchId, string Path, string DeviceId, string? Modality);

public sealed record AddOrUpdateFolderBindingResponse(string WatchId);

public sealed record RemoveFolderBindingRequest(string WatchId);

public sealed record TestConnectionResponse(bool Reachable, int? StatusCode, string? Message);

public sealed record QueueSummaryResponse(int Pending, int Processing, int Failed, int Completed);

public sealed record RetryFailedItemRequest(string IngestKey);

public sealed record RetryFailedItemResponse(bool Ok, string? Message);

/// <summary>
/// Real update status (PR 6/7) — truthfully reflects the persisted
/// <see cref="Updates.UpdateState"/>. Returned by both
/// <see cref="PipeOperation.CheckForUpdates"/> (triggers a real server
/// round-trip first) and <see cref="PipeOperation.GetUpdateStatus"/>
/// (read-only, just reports the last-known state — used by the Manager to
/// poll progress without re-triggering a check).
/// </summary>
public sealed record UpdateStatusPayload(
    string Lifecycle,
    string? InstalledVersion,
    string? OfferedVersion,
    long DownloadedBytes,
    long? TotalBytes,
    string ErrorCategory,
    bool RebootRequired,
    DateTimeOffset UpdatedAtUtc);

/// <summary>
/// No fields by design — installing means "install the release the last
/// successful check already staged and verified." A caller cannot smuggle
/// an arbitrary URL/path/version/argument through this request; see
/// docs/update-architecture.md "IPC contract changes".
/// </summary>
public sealed record InstallUpdateRequest;

public sealed record InstallUpdateResponse(bool Launched, UpdateStatusPayload Status, string? Message);

/// <summary>
/// Request for the pairing-code redemption operation (see PipeOperation.ProvisionWithPairingCode).
/// Deliberately contains no credential of any kind — only the short-lived,
/// single-use, rate-limited 8-digit code a human reads from the NoraMedi UI.
/// </summary>
public sealed record ProvisionWithPairingCodeRequest(string PairingCode, string? ComputerDisplayName = null);

/// <summary>
/// Machine-readable reason a pairing attempt did not succeed, distinct
/// enough that the Manager can show an actionable, localized message
/// instead of a single generic "connection required" for every failure.
/// Mirrors <see cref="Http.PairingResultCategory"/> plus the
/// service-local "feature disabled" case that never reaches the HTTP call.
/// </summary>
public enum PairingErrorCategory
{
    FeatureDisabled,
    InvalidOrExpiredCode,
    RateLimited,
    InvalidRequest,
    ServerError,
    NetworkFailure,
}

public sealed record ProvisionWithPairingCodeResponse(
    bool Ok,
    string? BridgeAgentId,
    string? ClinicName,
    int? BindingCount,
    string? ErrorMessage,
    PairingErrorCategory? ErrorCategory = null,
    string? CorrelationId = null);

/// <summary>
/// One device/binding already known to the NoraMedi backend for this clinic
/// (surfaced via bootstrap/pairing — see <see cref="Http.BootstrapBinding"/>),
/// offered to the Manager so a non-technical user can pick a device from a
/// readable list instead of typing a raw device ID. <see cref="BindingId"/>
/// is the server-side binding identifier; it is distinct from the purely
/// local <see cref="FolderBindingInfo.WatchId"/>.
/// </summary>
public sealed record AvailableServerBindingInfo(
    string BindingId,
    string DeviceId,
    string DisplayName,
    string? Modality,
    string Status,
    string? AcquisitionType);

/// <summary>
/// Response for <see cref="PipeOperation.GetAvailableServerBindings"/>. May
/// legitimately be an empty list — e.g. before the Service has any cached
/// catalog from the backend yet — which the Manager must render as a "no
/// devices available yet" empty state, never as fabricated/placeholder rows.
/// </summary>
public sealed record GetAvailableServerBindingsResponse(IReadOnlyList<AvailableServerBindingInfo> Bindings);
