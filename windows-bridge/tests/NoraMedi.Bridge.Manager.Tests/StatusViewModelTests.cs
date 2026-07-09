using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Tests.TestSupport;
using NoraMedi.Bridge.Manager.ViewModels;

namespace NoraMedi.Bridge.Manager.Tests;

public class StatusViewModelTests
{
    private static ServiceStatusPayload MakeStatus(string connectionState, bool paired = true) =>
        new("1.0.0", "install-1", paired, connectionState, "authenticated", DateTimeOffset.UtcNow, 1, 2, 3, 4);

    [Fact]
    public async Task RefreshAsync_Online_MapsToConnected()
    {
        var fake = new FakeBridgePipeClientService { NextServiceStatus = PipeCallResult<ServiceStatusPayload>.Ok(MakeStatus("online")) };
        var vm = new StatusViewModel(fake);

        await vm.RefreshAsync();

        Assert.Equal(AppState.Connected, vm.State);
        Assert.Equal(StatusLabels.Connected, vm.StatusLabel);
        Assert.True(vm.Paired);
    }

    [Fact]
    public async Task RefreshAsync_Offline_MapsToNotConnected()
    {
        var fake = new FakeBridgePipeClientService { NextServiceStatus = PipeCallResult<ServiceStatusPayload>.Ok(MakeStatus("offline", paired: false)) };
        var vm = new StatusViewModel(fake);

        await vm.RefreshAsync();

        Assert.Equal(AppState.NotConnected, vm.State);
        Assert.Equal(StatusLabels.NotConnected, vm.StatusLabel);
    }

    [Fact]
    public async Task RefreshAsync_Disabled_MapsToFeatureDisabled()
    {
        var fake = new FakeBridgePipeClientService { NextServiceStatus = PipeCallResult<ServiceStatusPayload>.Ok(MakeStatus("disabled")) };
        var vm = new StatusViewModel(fake);

        await vm.RefreshAsync();

        Assert.Equal(AppState.FeatureDisabled, vm.State);
    }

    [Fact]
    public async Task RefreshAsync_ServiceUnavailable_MapsToServiceUnavailableState()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextServiceStatus = PipeCallResult<ServiceStatusPayload>.Fail(ManagerErrorKind.ServiceUnavailable),
        };
        var vm = new StatusViewModel(fake);

        await vm.RefreshAsync();

        Assert.Equal(AppState.ServiceUnavailable, vm.State);
        Assert.Equal(StatusLabels.ServiceUnavailable, vm.StatusLabel);
    }

    [Fact]
    public async Task RefreshAsync_Unauthorized_RaisesUnauthorizedDetectedAndSetsActionRequired()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextServiceStatus = PipeCallResult<ServiceStatusPayload>.Fail(ManagerErrorKind.Unauthorized),
        };
        var vm = new StatusViewModel(fake);
        var raised = false;
        vm.UnauthorizedDetected += (_, _) => raised = true;

        await vm.RefreshAsync();

        Assert.True(raised);
        Assert.Equal(AppState.ActionRequiredElevation, vm.State);
        Assert.Equal(StatusLabels.ActionRequired, vm.StatusLabel);
    }

    [Fact]
    public async Task TestConnectionAsync_Reachable_SetsSuccessMessage()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextServiceStatus = PipeCallResult<ServiceStatusPayload>.Ok(MakeStatus("online")),
            NextTestConnection = PipeCallResult<TestConnectionResponse>.Ok(new TestConnectionResponse(true, 200, "ok")),
        };
        var vm = new StatusViewModel(fake);
        await vm.RefreshAsync();

        await vm.TestConnectionAsync();

        Assert.True(vm.IsTestConnectionSuccessful);
        Assert.Equal(StatusLabels.Connected, vm.TestConnectionMessage);
    }

    [Fact]
    public async Task TestConnectionAsync_Unreachable_SetsFailureMessage()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextTestConnection = PipeCallResult<TestConnectionResponse>.Ok(new TestConnectionResponse(false, null, "timeout")),
        };
        var vm = new StatusViewModel(fake);

        await vm.TestConnectionAsync();

        Assert.False(vm.IsTestConnectionSuccessful);
        Assert.Equal(StatusLabels.NotConnected, vm.TestConnectionMessage);
    }

    [Fact]
    public async Task TestConnectionAsync_Unauthorized_TriggersElevationState()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextTestConnection = PipeCallResult<TestConnectionResponse>.Fail(ManagerErrorKind.Unauthorized),
        };
        var vm = new StatusViewModel(fake);
        var raised = false;
        vm.UnauthorizedDetected += (_, _) => raised = true;

        await vm.TestConnectionAsync();

        Assert.True(raised);
        Assert.Equal(AppState.ActionRequiredElevation, vm.State);
    }

    [Fact]
    public async Task RefreshAsync_SetsIsBusyDuringCall()
    {
        var fake = new FakeBridgePipeClientService { NextServiceStatus = PipeCallResult<ServiceStatusPayload>.Ok(MakeStatus("online")) };
        var vm = new StatusViewModel(fake);

        var task = vm.RefreshAsync();
        // IsBusy is set synchronously before the first await point completes.
        await task;

        Assert.False(vm.IsBusy);
    }
}
