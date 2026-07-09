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
    ];

    private static readonly HashSet<PipeOperation> AllowedWhenFeatureDisabled =
    [
        PipeOperation.GetServiceStatus,
        PipeOperation.CheckForUpdates,
    ];

    /// <summary>Mutating or sensitive operations — provisioning, binding changes, retries, and network tests — require an administrator identity.</summary>
    public static bool IsPrivileged(PipeOperation operation) => PrivilegedOperations.Contains(operation);

    /// <summary>The only operations answered while the feature flag is off — plain status/version queries with no network or state side effects.</summary>
    public static bool IsAllowedWhenFeatureDisabled(PipeOperation operation) => AllowedWhenFeatureDisabled.Contains(operation);
}
