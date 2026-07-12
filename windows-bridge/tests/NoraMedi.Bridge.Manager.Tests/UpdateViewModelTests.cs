using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Resources;
using NoraMedi.Bridge.Manager.Tests.TestSupport;
using NoraMedi.Bridge.Manager.ViewModels;

namespace NoraMedi.Bridge.Manager.Tests;

public class UpdateViewModelTests
{
    private static UpdateStatusPayload Status(string lifecycle, string? offered = null, string errorCategory = "None", bool reboot = false, long downloaded = 0, long? total = null) =>
        new(lifecycle, "0.4.6", offered, downloaded, total, errorCategory, reboot, DateTimeOffset.UtcNow);

    [Fact]
    public async Task CheckForUpdatesAsync_UpToDate_ShowsTruthfulLabelAndDisablesInstall()
    {
        var fake = new FakeBridgePipeClientService { NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("UpToDate")) };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.True(vm.IsSupported);
        Assert.Equal(Strings.Update_UpToDate, vm.Message);
        Assert.False(vm.CanInstall);
        Assert.Equal("0.4.6", vm.InstalledVersion);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_UpdateAvailable_ShowsOfferedVersion()
    {
        var fake = new FakeBridgePipeClientService { NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("UpdateAvailable", "0.4.7")) };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.Equal(Strings.Update_Available, vm.Message);
        Assert.Equal("0.4.7", vm.OfferedVersion);
        Assert.True(vm.HasOfferedVersion);
        Assert.False(vm.CanInstall);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_Verified_EnablesInstallCommand()
    {
        var fake = new FakeBridgePipeClientService { NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("Verified", "0.4.7")) };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.Equal(Strings.Update_ReadyToInstall, vm.Message);
        Assert.True(vm.CanInstall);
        Assert.True(vm.InstallUpdateCommand.CanExecute(null));
    }

    [Fact]
    public async Task CheckForUpdatesAsync_Downloading_ShowsIndeterminateAndByteProgress()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("Downloading", "0.4.7", downloaded: 5 * 1024 * 1024, total: 20 * 1024 * 1024)),
        };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.Equal(Strings.Update_Downloading, vm.Message);
        Assert.True(vm.IsIndeterminate);
        Assert.Equal("5.0 / 20.0 MB", vm.DownloadProgressText);
        vm.Dispose();
    }

    [Fact]
    public async Task CheckForUpdatesAsync_DownloadFailed_ShowsRetryableMessage()
    {
        var fake = new FakeBridgePipeClientService { NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("DownloadFailed", "0.4.7", errorCategory: "NetworkFailure")) };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.Equal(Strings.Update_DownloadFailed, vm.Message);
        Assert.False(vm.CanInstall);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_VerificationFailed_HashMismatch_ShowsIntegrityMessage()
    {
        var fake = new FakeBridgePipeClientService { NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("VerificationFailed", "0.4.7", errorCategory: "HashMismatch")) };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.Equal(Strings.Update_VerificationFailed, vm.Message);
    }

    [Theory]
    [InlineData("UnsignedPackage")]
    [InlineData("WrongPublisher")]
    [InlineData("TamperedSignature")]
    public async Task CheckForUpdatesAsync_VerificationFailed_PublisherReasons_ShowDistinctMessage(string errorCategory)
    {
        var fake = new FakeBridgePipeClientService { NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("VerificationFailed", "0.4.7", errorCategory: errorCategory)) };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.Equal(Strings.Update_PublisherVerificationFailed, vm.Message);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_Disabled_ShowsDisabledMessage()
    {
        var fake = new FakeBridgePipeClientService { NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("Disabled", errorCategory: "Disabled")) };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.Equal(Strings.Update_Disabled, vm.Message);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_Unsupported_ShowsUnsupportedSourceVersionMessage()
    {
        var fake = new FakeBridgePipeClientService { NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("Unsupported", errorCategory: "UnsupportedSourceVersion")) };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.Equal(Strings.Update_UnsupportedSourceVersion, vm.Message);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_TransportFailure_ShowsPlainLabelNotException()
    {
        var fake = new FakeBridgePipeClientService { NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Fail(ManagerErrorKind.ServiceUnavailable) };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.False(vm.IsSupported);
        Assert.Equal(StatusLabels.ServiceUnavailable, vm.Message);
    }

    [Fact]
    public async Task InstallUpdateAsync_WhenNotVerified_DoesNothingAndNeverCallsPipe()
    {
        var fake = new FakeBridgePipeClientService();
        var vm = new UpdateViewModel(fake);

        await vm.InstallUpdateAsync();

        Assert.Equal(0, fake.InstallUpdateCallCount);
    }

    [Fact]
    public async Task InstallUpdateAsync_AfterVerified_LaunchesAndShowsInstalling()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("Verified", "0.4.7")),
            NextInstallUpdate = PipeCallResult<InstallUpdateResponse>.Ok(new InstallUpdateResponse(true, Status("InstallLaunched", "0.4.7"), null)),
        };
        var vm = new UpdateViewModel(fake);
        await vm.CheckForUpdatesAsync();

        await vm.InstallUpdateAsync();

        Assert.Equal(1, fake.InstallUpdateCallCount);
        Assert.Equal(Strings.Update_Installing, vm.Message);
        vm.Dispose();
    }

    [Fact]
    public async Task InstallUpdateAsync_RebootRequired_SurfacesRebootFlagTruthfully()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("Verified", "0.4.7")),
            NextInstallUpdate = PipeCallResult<InstallUpdateResponse>.Ok(new InstallUpdateResponse(true, Status("RebootRequired", "0.4.7", reboot: true), null)),
        };
        var vm = new UpdateViewModel(fake);
        await vm.CheckForUpdatesAsync();

        await vm.InstallUpdateAsync();

        Assert.Equal(Strings.Update_RebootRequired, vm.Message);
        Assert.True(vm.RebootRequired);
    }

    [Fact]
    public async Task InstallUpdateAsync_Succeeded_ShowsSuccessMessage_NeverBeforeCompletion()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("Verified", "0.4.7")),
            NextInstallUpdate = PipeCallResult<InstallUpdateResponse>.Ok(new InstallUpdateResponse(true, Status("Succeeded", "0.4.7"), null)),
        };
        var vm = new UpdateViewModel(fake);
        await vm.CheckForUpdatesAsync();
        Assert.NotEqual(Strings.Update_Succeeded, vm.Message);

        await vm.InstallUpdateAsync();

        Assert.Equal(Strings.Update_Succeeded, vm.Message);
    }

    [Fact]
    public async Task InstallUpdateAsync_InstallerFailure_ShowsFailureNotSuccess()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("Verified", "0.4.7")),
            NextInstallUpdate = PipeCallResult<InstallUpdateResponse>.Ok(new InstallUpdateResponse(false, Status("InstallFailed", "0.4.7", errorCategory: "Unknown"), "helper launch failed")),
        };
        var vm = new UpdateViewModel(fake);
        await vm.CheckForUpdatesAsync();

        await vm.InstallUpdateAsync();

        Assert.Equal(Strings.Update_InstallerFailed, vm.Message);
        Assert.NotEqual(Strings.Update_Succeeded, vm.Message);
    }

    [Fact]
    public async Task CheckForUpdatesAsync_Interrupted_ShowsInterruptedMessage()
    {
        var fake = new FakeBridgePipeClientService { NextCheckForUpdates = PipeCallResult<UpdateStatusPayload>.Ok(Status("Interrupted")) };
        var vm = new UpdateViewModel(fake);

        await vm.CheckForUpdatesAsync();

        Assert.Equal(Strings.Update_Interrupted, vm.Message);
    }

    [Fact]
    public void InstallUpdateCommand_DisabledUntilVerified()
    {
        var vm = new UpdateViewModel(new FakeBridgePipeClientService());

        Assert.False(vm.InstallUpdateCommand.CanExecute(null));
    }
}
