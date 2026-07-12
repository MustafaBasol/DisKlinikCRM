using NoraMedi.Bridge.Core.Diagnostics;
using NoraMedi.Bridge.Core.Ipc;

namespace NoraMedi.Bridge.Core.Tests.Ipc;

/// <summary>A scripted, in-memory handler standing in for the real Worker Service state during pipe-transport tests.</summary>
internal sealed class FakeBridgePipeRequestHandler : IBridgePipeRequestHandler
{
    public List<string> Calls { get; } = [];
    public Exception? ThrowOnNextCall { get; set; }
    public bool FeatureEnabled { get; set; } = true;

    private void Record(string name)
    {
        Calls.Add(name);
        if (ThrowOnNextCall is { } ex)
        {
            ThrowOnNextCall = null;
            throw ex;
        }
    }

    public Task<ServiceStatusPayload> GetServiceStatusAsync(CancellationToken cancellationToken)
    {
        Record(nameof(GetServiceStatusAsync));
        return Task.FromResult(new ServiceStatusPayload("1.0.0", "install-123", true, "online", "valid", DateTimeOffset.UtcNow, 1, 0, 0, 5));
    }

    public Task<IReadOnlyList<FolderBindingInfo>> GetBindingsAsync(CancellationToken cancellationToken)
    {
        Record(nameof(GetBindingsAsync));
        IReadOnlyList<FolderBindingInfo> result = [new FolderBindingInfo("watch-1", @"C:\Export", "device-1", "IO", true)];
        return Task.FromResult(result);
    }

    public Task<ValidateFolderResponse> ValidateFolderAsync(ValidateFolderRequest request, CancellationToken cancellationToken)
    {
        Record(nameof(ValidateFolderAsync));
        return Task.FromResult(new ValidateFolderResponse(Directory.Exists(request.Path), true, null));
    }

    public Task<AddOrUpdateFolderBindingResponse> AddOrUpdateFolderBindingAsync(AddOrUpdateFolderBindingRequest request, CancellationToken cancellationToken)
    {
        Record(nameof(AddOrUpdateFolderBindingAsync));
        return Task.FromResult(new AddOrUpdateFolderBindingResponse(request.WatchId ?? "generated-watch-id"));
    }

    public Task RemoveFolderBindingAsync(RemoveFolderBindingRequest request, CancellationToken cancellationToken)
    {
        Record(nameof(RemoveFolderBindingAsync));
        return Task.CompletedTask;
    }

    public Task<TestConnectionResponse> TestConnectionAsync(CancellationToken cancellationToken)
    {
        Record(nameof(TestConnectionAsync));
        return Task.FromResult(new TestConnectionResponse(true, 200, null));
    }

    public Task<QueueSummaryResponse> GetQueueSummaryAsync(CancellationToken cancellationToken)
    {
        Record(nameof(GetQueueSummaryAsync));
        return Task.FromResult(new QueueSummaryResponse(2, 1, 0, 10));
    }

    public Task<RetryFailedItemResponse> RetryFailedItemAsync(RetryFailedItemRequest request, CancellationToken cancellationToken)
    {
        Record(nameof(RetryFailedItemAsync));
        return Task.FromResult(new RetryFailedItemResponse(true, null));
    }

    public Task<DiagnosticsSnapshot> ExportDiagnosticsAsync(CancellationToken cancellationToken)
    {
        Record(nameof(ExportDiagnosticsAsync));
        return Task.FromResult(new DiagnosticsSnapshot("1.0.0", "install-123", DateTimeOffset.UtcNow, "online", "valid", DateTimeOffset.UtcNow, 1, 0, 0, 5, [new WatchFolderDiagnostics("watch-1", true)]));
    }

    public Task<UpdateStatusPayload> CheckForUpdatesAsync(CancellationToken cancellationToken)
    {
        Record(nameof(CheckForUpdatesAsync));
        return Task.FromResult(new UpdateStatusPayload("UpToDate", "1.0.0", null, 0, null, "None", false, DateTimeOffset.UtcNow));
    }

    public Task<UpdateStatusPayload> GetUpdateStatusAsync(CancellationToken cancellationToken)
    {
        Record(nameof(GetUpdateStatusAsync));
        return Task.FromResult(new UpdateStatusPayload("UpToDate", "1.0.0", null, 0, null, "None", false, DateTimeOffset.UtcNow));
    }

    public Task<InstallUpdateResponse> InstallUpdateAsync(InstallUpdateRequest request, CancellationToken cancellationToken)
    {
        Record(nameof(InstallUpdateAsync));
        return Task.FromResult(new InstallUpdateResponse(false, new UpdateStatusPayload("UpToDate", "1.0.0", null, 0, null, "None", false, DateTimeOffset.UtcNow), "Nothing to install."));
    }

    public Task<ProvisionWithPairingCodeResponse> ProvisionWithPairingCodeAsync(ProvisionWithPairingCodeRequest request, CancellationToken cancellationToken)
    {
        Record(nameof(ProvisionWithPairingCodeAsync));
        return Task.FromResult(new ProvisionWithPairingCodeResponse(true, "agent-1", "Demo Clinic", 1, null));
    }

    public Task<GetAvailableServerBindingsResponse> GetAvailableServerBindingsAsync(CancellationToken cancellationToken)
    {
        Record(nameof(GetAvailableServerBindingsAsync));
        IReadOnlyList<AvailableServerBindingInfo> result = [new AvailableServerBindingInfo("binding-1", "device-1", "Sensor 1 (Op Room)", "IO", "active", "sensor")];
        return Task.FromResult(new GetAvailableServerBindingsResponse(result));
    }
}
