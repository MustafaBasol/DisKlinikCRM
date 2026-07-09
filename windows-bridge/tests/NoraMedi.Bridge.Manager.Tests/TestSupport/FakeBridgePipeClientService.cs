using NoraMedi.Bridge.Core.Diagnostics;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.Tests.TestSupport;

/// <summary>
/// Scriptable fake for <see cref="IBridgePipeClientService"/> — the seam
/// every ViewModel test uses instead of a real named pipe/Service. Each
/// method result is settable via the corresponding `NextXxx` field; leaving
/// it null makes the call fail with <see cref="ManagerErrorKind.Internal"/>
/// so a missed setup fails loudly instead of silently succeeding.
/// </summary>
public sealed class FakeBridgePipeClientService : IBridgePipeClientService
{
    public PipeCallResult<ServiceStatusPayload>? NextServiceStatus { get; set; }
    public PipeCallResult<IReadOnlyList<FolderBindingInfo>>? NextBindings { get; set; }
    public PipeCallResult<ValidateFolderResponse>? NextValidateFolder { get; set; }
    public PipeCallResult<AddOrUpdateFolderBindingResponse>? NextAddOrUpdateBinding { get; set; }
    public PipeCallResult<bool>? NextRemoveBinding { get; set; }
    public PipeCallResult<TestConnectionResponse>? NextTestConnection { get; set; }
    public PipeCallResult<QueueSummaryResponse>? NextQueueSummary { get; set; }
    public PipeCallResult<RetryFailedItemResponse>? NextRetryFailedItem { get; set; }
    public PipeCallResult<DiagnosticsSnapshot>? NextExportDiagnostics { get; set; }
    public PipeCallResult<CheckForUpdatesResponse>? NextCheckForUpdates { get; set; }
    public PipeCallResult<ProvisionWithPairingCodeResponse>? NextProvisionWithPairingCode { get; set; }
    public PipeCallResult<GetAvailableServerBindingsResponse>? NextAvailableServerBindings { get; set; }

    public int GetServiceStatusCallCount { get; private set; }
    public int GetBindingsCallCount { get; private set; }
    public int ValidateFolderCallCount { get; private set; }
    public int AddOrUpdateFolderBindingCallCount { get; private set; }
    public int RemoveFolderBindingCallCount { get; private set; }
    public int TestConnectionCallCount { get; private set; }
    public int GetQueueSummaryCallCount { get; private set; }
    public int RetryFailedItemCallCount { get; private set; }
    public int ExportDiagnosticsCallCount { get; private set; }
    public int CheckForUpdatesCallCount { get; private set; }
    public int ProvisionWithPairingCodeCallCount { get; private set; }
    public int GetAvailableServerBindingsCallCount { get; private set; }

    public string? LastValidatedPath { get; private set; }
    public string? LastAddOrUpdatePath { get; private set; }
    public string? LastRemovedWatchId { get; private set; }
    public string? LastRetryIngestKey { get; private set; }
    public string? LastPairingCode { get; private set; }

    public Task<PipeCallResult<ServiceStatusPayload>> GetServiceStatusAsync(CancellationToken cancellationToken = default)
    {
        GetServiceStatusCallCount++;
        return Task.FromResult(NextServiceStatus ?? PipeCallResult<ServiceStatusPayload>.Fail(ManagerErrorKind.Internal));
    }

    public Task<PipeCallResult<IReadOnlyList<FolderBindingInfo>>> GetBindingsAsync(CancellationToken cancellationToken = default)
    {
        GetBindingsCallCount++;
        return Task.FromResult(NextBindings ?? PipeCallResult<IReadOnlyList<FolderBindingInfo>>.Fail(ManagerErrorKind.Internal));
    }

    public Task<PipeCallResult<ValidateFolderResponse>> ValidateFolderAsync(string path, CancellationToken cancellationToken = default)
    {
        ValidateFolderCallCount++;
        LastValidatedPath = path;
        return Task.FromResult(NextValidateFolder ?? PipeCallResult<ValidateFolderResponse>.Fail(ManagerErrorKind.Internal));
    }

    public Task<PipeCallResult<AddOrUpdateFolderBindingResponse>> AddOrUpdateFolderBindingAsync(
        string? watchId, string path, string deviceId, string? modality, CancellationToken cancellationToken = default)
    {
        AddOrUpdateFolderBindingCallCount++;
        LastAddOrUpdatePath = path;
        return Task.FromResult(NextAddOrUpdateBinding ?? PipeCallResult<AddOrUpdateFolderBindingResponse>.Fail(ManagerErrorKind.Internal));
    }

    public Task<PipeCallResult<bool>> RemoveFolderBindingAsync(string watchId, CancellationToken cancellationToken = default)
    {
        RemoveFolderBindingCallCount++;
        LastRemovedWatchId = watchId;
        return Task.FromResult(NextRemoveBinding ?? PipeCallResult<bool>.Fail(ManagerErrorKind.Internal));
    }

    public Task<PipeCallResult<TestConnectionResponse>> TestConnectionAsync(CancellationToken cancellationToken = default)
    {
        TestConnectionCallCount++;
        return Task.FromResult(NextTestConnection ?? PipeCallResult<TestConnectionResponse>.Fail(ManagerErrorKind.Internal));
    }

    public Task<PipeCallResult<QueueSummaryResponse>> GetQueueSummaryAsync(CancellationToken cancellationToken = default)
    {
        GetQueueSummaryCallCount++;
        return Task.FromResult(NextQueueSummary ?? PipeCallResult<QueueSummaryResponse>.Fail(ManagerErrorKind.Internal));
    }

    public Task<PipeCallResult<RetryFailedItemResponse>> RetryFailedItemAsync(string ingestKey, CancellationToken cancellationToken = default)
    {
        RetryFailedItemCallCount++;
        LastRetryIngestKey = ingestKey;
        return Task.FromResult(NextRetryFailedItem ?? PipeCallResult<RetryFailedItemResponse>.Fail(ManagerErrorKind.Internal));
    }

    public Task<PipeCallResult<DiagnosticsSnapshot>> ExportDiagnosticsAsync(CancellationToken cancellationToken = default)
    {
        ExportDiagnosticsCallCount++;
        return Task.FromResult(NextExportDiagnostics ?? PipeCallResult<DiagnosticsSnapshot>.Fail(ManagerErrorKind.Internal));
    }

    public Task<PipeCallResult<CheckForUpdatesResponse>> CheckForUpdatesAsync(CancellationToken cancellationToken = default)
    {
        CheckForUpdatesCallCount++;
        return Task.FromResult(NextCheckForUpdates ?? PipeCallResult<CheckForUpdatesResponse>.Fail(ManagerErrorKind.Internal));
    }

    public Task<PipeCallResult<ProvisionWithPairingCodeResponse>> ProvisionWithPairingCodeAsync(
        string pairingCode, string? computerDisplayName, CancellationToken cancellationToken = default)
    {
        ProvisionWithPairingCodeCallCount++;
        LastPairingCode = pairingCode;
        return Task.FromResult(NextProvisionWithPairingCode ?? PipeCallResult<ProvisionWithPairingCodeResponse>.Fail(ManagerErrorKind.Internal));
    }

    public Task<PipeCallResult<GetAvailableServerBindingsResponse>> GetAvailableServerBindingsAsync(CancellationToken cancellationToken = default)
    {
        GetAvailableServerBindingsCallCount++;
        return Task.FromResult(NextAvailableServerBindings ?? PipeCallResult<GetAvailableServerBindingsResponse>.Fail(ManagerErrorKind.Internal));
    }
}
