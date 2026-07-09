using NoraMedi.Bridge.Core.Diagnostics;

namespace NoraMedi.Bridge.Core.Ipc;

/// <summary>
/// Implemented by whatever owns the running bridge state (queue, watchers,
/// auth state, API client) — the Worker Service in production, a fake in
/// tests. <see cref="BridgePipeServer"/> only knows how to frame/route
/// messages; it has no bridge logic of its own.
/// </summary>
public interface IBridgePipeRequestHandler
{
    /// <summary>Mirrors BridgeOptions.Enabled — the pipe server consults this to enforce PipeOperationPolicy's feature-flag gate.</summary>
    bool FeatureEnabled { get; }

    Task<ServiceStatusPayload> GetServiceStatusAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<FolderBindingInfo>> GetBindingsAsync(CancellationToken cancellationToken);

    Task<ValidateFolderResponse> ValidateFolderAsync(ValidateFolderRequest request, CancellationToken cancellationToken);

    Task<AddOrUpdateFolderBindingResponse> AddOrUpdateFolderBindingAsync(AddOrUpdateFolderBindingRequest request, CancellationToken cancellationToken);

    Task RemoveFolderBindingAsync(RemoveFolderBindingRequest request, CancellationToken cancellationToken);

    Task<TestConnectionResponse> TestConnectionAsync(CancellationToken cancellationToken);

    Task<QueueSummaryResponse> GetQueueSummaryAsync(CancellationToken cancellationToken);

    Task<RetryFailedItemResponse> RetryFailedItemAsync(RetryFailedItemRequest request, CancellationToken cancellationToken);

    Task<DiagnosticsSnapshot> ExportDiagnosticsAsync(CancellationToken cancellationToken);

    Task<CheckForUpdatesResponse> CheckForUpdatesAsync(CancellationToken cancellationToken);

    Task<ProvisionWithPairingCodeResponse> ProvisionWithPairingCodeAsync(ProvisionWithPairingCodeRequest request, CancellationToken cancellationToken);

    Task<GetAvailableServerBindingsResponse> GetAvailableServerBindingsAsync(CancellationToken cancellationToken);
}
