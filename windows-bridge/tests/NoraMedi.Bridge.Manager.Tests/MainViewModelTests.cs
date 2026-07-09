using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Tests.TestSupport;
using NoraMedi.Bridge.Manager.ViewModels;

namespace NoraMedi.Bridge.Manager.Tests;

public class MainViewModelTests
{
    [Fact]
    public async Task PrivilegedOperationUnauthorized_SetsElevationRequired()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextServiceStatus = PipeCallResult<ServiceStatusPayload>.Ok(
                new ServiceStatusPayload("1.0", "install-1", true, "online", "authenticated", DateTimeOffset.UtcNow, 0, 0, 0, 0)),
            NextTestConnection = PipeCallResult<TestConnectionResponse>.Fail(ManagerErrorKind.Unauthorized),
        };
        var elevation = new FakeElevationService { IsElevated = false };
        var vm = new MainViewModel(fake, new FakeFileDialogService(), elevation);
        await vm.InitializeAsync();

        Assert.False(vm.IsElevationRequired);

        await vm.Status.TestConnectionAsync();

        Assert.True(vm.IsElevationRequired);
    }

    [Fact]
    public void RestartElevatedCommand_DelegatesToElevationService()
    {
        var elevation = new FakeElevationService();
        var vm = new MainViewModel(new FakeBridgePipeClientService(), new FakeFileDialogService(), elevation);

        vm.RestartElevatedCommand.Execute(null);

        Assert.Equal(1, elevation.RestartElevatedCallCount);
    }

    [Fact]
    public async Task BindingsUnauthorized_AlsoSetsSharedElevationFlag()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextValidateFolder = PipeCallResult<ValidateFolderResponse>.Ok(new ValidateFolderResponse(true, true, null)),
            NextAddOrUpdateBinding = PipeCallResult<AddOrUpdateFolderBindingResponse>.Fail(ManagerErrorKind.Unauthorized),
        };
        var vm = new MainViewModel(fake, new FakeFileDialogService(), new FakeElevationService());
        vm.Bindings.FolderPath = @"C:\Scans";
        vm.Bindings.DeviceId = "device-1";
        await vm.Bindings.ValidateFolderAsync();

        await vm.Bindings.SaveAsync();

        Assert.True(vm.IsElevationRequired);
    }

    [Fact]
    public async Task InitializeAsync_FetchesStatusAndBindings()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextServiceStatus = PipeCallResult<ServiceStatusPayload>.Ok(
                new ServiceStatusPayload("1.0", "install-1", false, "offline", "invalid", null, 0, 0, 0, 0)),
            NextBindings = PipeCallResult<IReadOnlyList<FolderBindingInfo>>.Ok(
                [new FolderBindingInfo("watch-1", @"C:\Scans", "device-1", "IO", true)]),
        };
        var vm = new MainViewModel(fake, new FakeFileDialogService(), new FakeElevationService());

        await vm.InitializeAsync();

        Assert.Equal(1, fake.GetServiceStatusCallCount);
        Assert.Equal(1, fake.GetBindingsCallCount);
        Assert.Single(vm.Bindings.Bindings);
        // Not yet paired: the server device catalog is meaningless before pairing, so it must not be fetched.
        Assert.Equal(0, fake.GetAvailableServerBindingsCallCount);
    }

    [Fact]
    public async Task InitializeAsync_WhenAlreadyPaired_AlsoFetchesAvailableServerBindings()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextServiceStatus = PipeCallResult<ServiceStatusPayload>.Ok(
                new ServiceStatusPayload("1.0", "install-1", true, "online", "valid", DateTimeOffset.UtcNow, 0, 0, 0, 0)),
            NextBindings = PipeCallResult<IReadOnlyList<FolderBindingInfo>>.Ok([]),
            NextAvailableServerBindings = PipeCallResult<GetAvailableServerBindingsResponse>.Ok(
                new GetAvailableServerBindingsResponse(
                    [new AvailableServerBindingInfo("binding-1", "device-1", "Sensor 1", "IO", "active", "sensor")])),
        };
        var vm = new MainViewModel(fake, new FakeFileDialogService(), new FakeElevationService());

        await vm.InitializeAsync();

        Assert.Equal(1, fake.GetAvailableServerBindingsCallCount);
        Assert.Single(vm.Bindings.AvailableServerBindings);
    }

    [Fact]
    public async Task SuccessfulPairing_TriggersStatusAndBindingsRefresh()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextServiceStatus = PipeCallResult<ServiceStatusPayload>.Ok(
                new ServiceStatusPayload("1.0", "install-1", true, "online", "valid", DateTimeOffset.UtcNow, 0, 0, 0, 0)),
            NextBindings = PipeCallResult<IReadOnlyList<FolderBindingInfo>>.Ok([]),
            NextAvailableServerBindings = PipeCallResult<GetAvailableServerBindingsResponse>.Ok(
                new GetAvailableServerBindingsResponse([])),
            NextProvisionWithPairingCode = PipeCallResult<ProvisionWithPairingCodeResponse>.Ok(
                new ProvisionWithPairingCodeResponse(true, "agent-1", "Demo Clinic", 0, null)),
        };
        var vm = new MainViewModel(fake, new FakeFileDialogService(), new FakeElevationService());
        vm.Pairing.SetInput("12345678");

        await vm.Pairing.SubmitAsync();
        // PairingSucceeded is handled by an async-void lambda; give the
        // continuation a chance to run before asserting on its side effects.
        await Task.Delay(50);

        Assert.True(fake.GetServiceStatusCallCount >= 1);
        Assert.True(fake.GetBindingsCallCount >= 1);
        Assert.True(fake.GetAvailableServerBindingsCallCount >= 1);
    }

    [Fact]
    public void RefreshAllCommand_IsAlwaysAvailable()
    {
        var vm = new MainViewModel(new FakeBridgePipeClientService(), new FakeFileDialogService(), new FakeElevationService());

        Assert.True(vm.RefreshAllCommand.CanExecute(null));
    }
}
