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
}
