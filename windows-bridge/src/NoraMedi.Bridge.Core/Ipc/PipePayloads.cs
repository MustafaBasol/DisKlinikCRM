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
/// Truthful "not implemented" response — this phase deliberately ships no
/// real updater (see spec section "Scope exclusions"). A future Manager
/// must never be told an update is available/installing when it is not.
/// </summary>
public sealed record CheckForUpdatesResponse(bool Supported, string Message)
{
    public static CheckForUpdatesResponse NotSupported() => new(
        false,
        "Automatic updates are not available in this release. Install the latest signed installer manually.");
}

/// <summary>
/// Request for the pairing-code redemption operation (see PipeOperation.ProvisionWithPairingCode).
/// Deliberately contains no credential of any kind — only the short-lived,
/// single-use, rate-limited 8-digit code a human reads from the NoraMedi UI.
/// </summary>
public sealed record ProvisionWithPairingCodeRequest(string PairingCode, string? ComputerDisplayName = null);

public sealed record ProvisionWithPairingCodeResponse(bool Ok, string? BridgeAgentId, string? ClinicName, int? BindingCount, string? ErrorMessage);
