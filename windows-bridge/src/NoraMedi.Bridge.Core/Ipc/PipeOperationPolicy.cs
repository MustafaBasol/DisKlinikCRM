namespace NoraMedi.Bridge.Core.Ipc;

/// <summary>
/// Authorization policy for the Named Pipe IPC surface, independent of
/// transport-level ACLs (see BridgePipeServer). Two orthogonal gates apply
/// to every request:
///  - Identity: mutating/sensitive operations require the connecting local
///    identity to be an administrator; read-only status/config queries only
///    require a non-anonymous, successfully-identified local connection.
///  - Feature flag: while BridgeSelfService:Enabled is false the service is
///    dormant by design (see BridgeOptions.Enabled) — only the two safe
///    status/version queries answer normally; every operation that would
///    touch the network, spend a credential, or mutate persisted state is
///    refused instead of silently no-op'ing.
/// </summary>
public static class PipeOperationPolicy
{
    private static readonly HashSet<PipeOperation> PrivilegedOperations =
    [
        PipeOperation.AddOrUpdateFolderBinding,
        PipeOperation.RemoveFolderBinding,
        PipeOperation.RetryFailedItem,
        PipeOperation.TestConnection,
        PipeOperation.ProvisionWithPairingCode,

        // Installing an update as LocalSystem is the highest-privilege
        // action this pipe exposes — same tier as provisioning, never
        // reachable by a non-admin local caller. See docs/update-architecture.md.
        PipeOperation.InstallUpdate,
    ];

    private static readonly HashSet<PipeOperation> AllowedWhenFeatureDisabled =
    [
        PipeOperation.GetServiceStatus,
        PipeOperation.CheckForUpdates,
        PipeOperation.GetUpdateStatus,
    ];

    // GetAvailableServerBindings deliberately appears in neither set above:
    // it is read-only like GetBindings (not privileged), but — unlike
    // GetServiceStatus/CheckForUpdates — a device catalog is meaningless
    // before the clinic is paired/enabled, so it is blocked while the
    // feature flag is off, same as GetBindings.

    /// <summary>Mutating or sensitive operations — provisioning, binding changes, retries, and network tests — require an administrator identity.</summary>
    public static bool IsPrivileged(PipeOperation operation) => PrivilegedOperations.Contains(operation);

    /// <summary>The only operations answered while the feature flag is off — plain status/version queries with no network or state side effects.</summary>
    public static bool IsAllowedWhenFeatureDisabled(PipeOperation operation) => AllowedWhenFeatureDisabled.Contains(operation);
}
