using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Tests.TestSupport;
using NoraMedi.Bridge.Manager.ViewModels;

namespace NoraMedi.Bridge.Manager.Tests;

public class UpdateViewModelTests
{
    [Fact]
    public async Task CheckForUpdatesAsync_AlwaysShowsTruthfulNotSupportedMessage()
    {
        var notSupported = CheckForUpdatesResponse.NotSupported();
        var fake = new FakeBridgePipeClientService
        {
            NextCheckForUpdates = PipeCallResult<CheckForUpdatesResponse>.Ok(notSupported),
        };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.False(vm.IsSupported);
        Assert.Equal(notSupported.Message, vm.Message);
        Assert.Contains("install", vm.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_TransportFailure_ShowsPlainLabelNotException()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextCheckForUpdates = PipeCallResult<CheckForUpdatesResponse>.Fail(ManagerErrorKind.ServiceUnavailable),
        };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.False(vm.IsSupported);
        Assert.Equal(StatusLabels.ServiceUnavailable, vm.Message);
    }
}
