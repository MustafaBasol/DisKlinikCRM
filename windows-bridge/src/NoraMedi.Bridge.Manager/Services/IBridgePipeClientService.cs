using NoraMedi.Bridge.Core.Diagnostics;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;

namespace NoraMedi.Bridge.Manager.Services;

/// <summary>
/// Thin adapter over <see cref="BridgePipeClient"/>: the one seam ViewModels
/// depend on so they can be unit tested with a fake, without a real named
/// pipe or Service process. Every method maps transport failures and backend
/// error codes into a <see cref="PipeCallResult{T}"/> — ViewModels never see
/// a raw exception or a raw <c>PipeErrorCodes</c> string.
/// </summary>
public interface IBridgePipeClientService
{
    Task<PipeCallResult<ServiceStatusPayload>> GetServiceStatusAsync(CancellationToken cancellationToken = default);

    Task<PipeCallResult<IReadOnlyList<FolderBindingInfo>>> GetBindingsAsync(CancellationToken cancellationToken = default);

    Task<PipeCallResult<ValidateFolderResponse>> ValidateFolderAsync(string path, CancellationToken cancellationToken = default);

    Task<PipeCallResult<AddOrUpdateFolderBindingResponse>> AddOrUpdateFolderBindingAsync(
        string? watchId, string path, string deviceId, string? modality, CancellationToken cancellationToken = default);

    Task<PipeCallResult<bool>> RemoveFolderBindingAsync(string watchId, CancellationToken cancellationToken = default);

    Task<PipeCallResult<TestConnectionResponse>> TestConnectionAsync(CancellationToken cancellationToken = default);

    Task<PipeCallResult<QueueSummaryResponse>> GetQueueSummaryAsync(CancellationToken cancellationToken = default);

    Task<PipeCallResult<RetryFailedItemResponse>> RetryFailedItemAsync(string ingestKey, CancellationToken cancellationToken = default);

    Task<PipeCallResult<DiagnosticsSnapshot>> ExportDiagnosticsAsync(CancellationToken cancellationToken = default);

    Task<PipeCallResult<UpdateStatusPayload>> CheckForUpdatesAsync(CancellationToken cancellationToken = default);

    Task<PipeCallResult<UpdateStatusPayload>> GetUpdateStatusAsync(CancellationToken cancellationToken = default);

    Task<PipeCallResult<InstallUpdateResponse>> InstallUpdateAsync(CancellationToken cancellationToken = default);

    Task<PipeCallResult<ProvisionWithPairingCodeResponse>> ProvisionWithPairingCodeAsync(
        string pairingCode, string? computerDisplayName, CancellationToken cancellationToken = default);

    Task<PipeCallResult<GetAvailableServerBindingsResponse>> GetAvailableServerBindingsAsync(CancellationToken cancellationToken = default);
}
