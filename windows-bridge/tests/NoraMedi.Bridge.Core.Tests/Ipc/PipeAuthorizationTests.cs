using NoraMedi.Bridge.Core.Ipc;

namespace NoraMedi.Bridge.Core.Tests.Ipc;

/// <summary>
/// Covers the two IPC-layer authorization gates BridgePipeServer enforces on
/// top of the transport-level pipe ACL: per-operation identity authorization
/// (PipeOperationPolicy.IsPrivileged) and the feature-flag gate
/// (PipeOperationPolicy.IsAllowedWhenFeatureDisabled). Uses an injected
/// identity resolver so these behave deterministically regardless of which
/// Windows account actually runs the test process.
/// </summary>
public class PipeAuthorizationTests : IAsyncLifetime
{
    private static readonly PipeClientIdentity Admin = new("TEST\\admin-user", IsAdministrator: true);
    private static readonly PipeClientIdentity StandardUser = new("TEST\\standard-user", IsAdministrator: false);

    private readonly string _pipeName = "nmb-authz-" + Guid.NewGuid().ToString("N");
    private readonly FakeBridgePipeRequestHandler _handler = new();
    private BridgePipeServer? _server;

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (_server is not null) await _server.DisposeAsync();
    }

    private async Task StartServer(PipeClientIdentity? identity)
    {
        _server = new BridgePipeServer(_pipeName, _handler, maxInstances: 2, identityResolver: _ => identity);
        _server.Start();
        await Task.Yield();
    }

    [Fact]
    public async Task AnonymousOrUnresolvedIdentity_IsRejectedEvenForASafeOperation()
    {
        await StartServer(identity: null);

        var response = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.GetServiceStatus);

        Assert.False(response.Success);
        Assert.Equal(PipeErrorCodes.Unauthorized, response.ErrorCode);
        Assert.DoesNotContain(nameof(FakeBridgePipeRequestHandler.GetServiceStatusAsync), _handler.Calls);
    }

    [Fact]
    public async Task StandardUser_CanCallSafeReadOnlyOperations()
    {
        await StartServer(StandardUser);

        var response = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.GetServiceStatus);

        Assert.True(response.Success);
    }

    [Theory]
    [InlineData(nameof(PipeOperation.AddOrUpdateFolderBinding))]
    [InlineData(nameof(PipeOperation.RemoveFolderBinding))]
    [InlineData(nameof(PipeOperation.RetryFailedItem))]
    [InlineData(nameof(PipeOperation.TestConnection))]
    [InlineData(nameof(PipeOperation.ProvisionWithPairingCode))]
    public async Task StandardUser_IsRejectedForEveryPrivilegedOperation(string operationName)
    {
        await StartServer(StandardUser);
        var operation = Enum.Parse<PipeOperation>(operationName);

        var response = await BridgePipeClient.SendAsync(_pipeName, operation, PayloadFor(operation));

        Assert.False(response.Success);
        Assert.Equal(PipeErrorCodes.Unauthorized, response.ErrorCode);
        Assert.Empty(_handler.Calls);
    }

    [Theory]
    [InlineData(nameof(PipeOperation.AddOrUpdateFolderBinding))]
    [InlineData(nameof(PipeOperation.RemoveFolderBinding))]
    [InlineData(nameof(PipeOperation.RetryFailedItem))]
    [InlineData(nameof(PipeOperation.TestConnection))]
    [InlineData(nameof(PipeOperation.ProvisionWithPairingCode))]
    public async Task Administrator_CanCallPrivilegedOperations(string operationName)
    {
        await StartServer(Admin);
        var operation = Enum.Parse<PipeOperation>(operationName);

        var response = await BridgePipeClient.SendAsync(_pipeName, operation, PayloadFor(operation));

        Assert.True(response.Success);
    }

    [Theory]
    [InlineData(nameof(PipeOperation.GetServiceStatus))]
    [InlineData(nameof(PipeOperation.CheckForUpdates))]
    public async Task FeatureDisabled_StillAnswersSafeStatusAndVersionQueries(string operationName)
    {
        _handler.FeatureEnabled = false;
        await StartServer(Admin);
        var operation = Enum.Parse<PipeOperation>(operationName);

        var response = await BridgePipeClient.SendAsync(_pipeName, operation);

        Assert.True(response.Success);
    }

    [Theory]
    [InlineData(nameof(PipeOperation.GetBindings))]
    [InlineData(nameof(PipeOperation.ValidateFolder))]
    [InlineData(nameof(PipeOperation.GetQueueSummary))]
    [InlineData(nameof(PipeOperation.ExportDiagnostics))]
    [InlineData(nameof(PipeOperation.AddOrUpdateFolderBinding))]
    [InlineData(nameof(PipeOperation.RemoveFolderBinding))]
    [InlineData(nameof(PipeOperation.RetryFailedItem))]
    [InlineData(nameof(PipeOperation.TestConnection))]
    [InlineData(nameof(PipeOperation.ProvisionWithPairingCode))]
    [InlineData(nameof(PipeOperation.GetAvailableServerBindings))]
    public async Task FeatureDisabled_BlocksEveryOtherOperation_EvenForAnAdministrator(string operationName)
    {
        _handler.FeatureEnabled = false;
        await StartServer(Admin);
        var operation = Enum.Parse<PipeOperation>(operationName);

        var response = await BridgePipeClient.SendAsync(_pipeName, operation, PayloadFor(operation));

        Assert.False(response.Success);
        Assert.Equal(PipeErrorCodes.FeatureDisabled, response.ErrorCode);
        Assert.Empty(_handler.Calls);
    }

    private static object? PayloadFor(PipeOperation operation) => operation switch
    {
        PipeOperation.ValidateFolder => new ValidateFolderRequest(@"C:\Export"),
        PipeOperation.AddOrUpdateFolderBinding => new AddOrUpdateFolderBindingRequest(null, @"C:\Export", "device-1", "IO"),
        PipeOperation.RemoveFolderBinding => new RemoveFolderBindingRequest("watch-1"),
        PipeOperation.RetryFailedItem => new RetryFailedItemRequest(new string('a', 64)),
        PipeOperation.ProvisionWithPairingCode => new ProvisionWithPairingCodeRequest("12345678"),
        _ => null,
    };
}
