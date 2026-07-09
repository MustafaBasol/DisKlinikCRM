using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Resources;
using NoraMedi.Bridge.Manager.Tests.TestSupport;
using NoraMedi.Bridge.Manager.ViewModels;

namespace NoraMedi.Bridge.Manager.Tests;

public class BindingsViewModelTests
{
    [Fact]
    public async Task RefreshAsync_PopulatesBindingsFromResult()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextBindings = PipeCallResult<IReadOnlyList<FolderBindingInfo>>.Ok(
                [new FolderBindingInfo("watch-1", @"C:\Scans\Xray", "device-1", "PANO", true)]),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService());

        await vm.RefreshAsync();

        Assert.Single(vm.Bindings);
        Assert.Equal("watch-1", vm.Bindings[0].WatchId);
    }

    [Fact]
    public void BrowseFolderCommand_SetsFolderPathFromDialogAndResetsValidation()
    {
        var dialog = new FakeFileDialogService { NextPickedFolder = @"D:\Images\Sensor" };
        var vm = new BindingsViewModel(new FakeBridgePipeClientService(), dialog);

        vm.BrowseFolderCommand.Execute(null);

        Assert.Equal(@"D:\Images\Sensor", vm.FolderPath);
        Assert.Null(vm.IsFolderValid);
        Assert.Equal(1, dialog.PickFolderCallCount);
        Assert.Equal(Strings.Dialog_FolderPickerTitle, dialog.LastPickFolderTitle);
    }

    [Fact]
    public async Task ValidateFolderAsync_ExistsAndReadable_MarksValid()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextValidateFolder = PipeCallResult<ValidateFolderResponse>.Ok(new ValidateFolderResponse(true, true, null)),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService()) { FolderPath = @"C:\Scans" };

        await vm.ValidateFolderAsync();

        Assert.True(vm.IsFolderValid);
        Assert.Equal(StatusLabels.Connected, vm.FolderStatusLabel);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(false, false)]
    public async Task ValidateFolderAsync_NotExistsOrNotReadable_MarksInaccessible(bool exists, bool readable)
    {
        var fake = new FakeBridgePipeClientService
        {
            NextValidateFolder = PipeCallResult<ValidateFolderResponse>.Ok(new ValidateFolderResponse(exists, readable, "denied")),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService()) { FolderPath = @"C:\Scans" };

        await vm.ValidateFolderAsync();

        Assert.False(vm.IsFolderValid);
        Assert.Equal(StatusLabels.FolderInaccessible, vm.FolderStatusLabel);
    }

    [Fact]
    public void SaveCommand_Disabled_UntilFolderValidated()
    {
        var vm = new BindingsViewModel(new FakeBridgePipeClientService(), new FakeFileDialogService())
        {
            FolderPath = @"C:\Scans",
            DeviceId = "device-1",
        };

        Assert.False(vm.SaveCommand.CanExecute(null));
    }

    [Fact]
    public async Task SaveAsync_AfterSuccessfulValidation_AddsBindingAndRefreshes()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextValidateFolder = PipeCallResult<ValidateFolderResponse>.Ok(new ValidateFolderResponse(true, true, null)),
            NextAddOrUpdateBinding = PipeCallResult<AddOrUpdateFolderBindingResponse>.Ok(new AddOrUpdateFolderBindingResponse("watch-9")),
            NextBindings = PipeCallResult<IReadOnlyList<FolderBindingInfo>>.Ok(
                [new FolderBindingInfo("watch-9", @"C:\Scans", "device-1", null, true)]),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService())
        {
            FolderPath = @"C:\Scans",
            DeviceId = "device-1",
        };
        await vm.ValidateFolderAsync();

        await vm.SaveAsync();

        Assert.Equal("watch-9", vm.WatchId);
        Assert.Equal(1, fake.AddOrUpdateFolderBindingCallCount);
        Assert.Single(vm.Bindings);
    }

    [Fact]
    public async Task SaveAsync_BackendFailure_SurfacesPlainLabelWithoutThrowing()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextValidateFolder = PipeCallResult<ValidateFolderResponse>.Ok(new ValidateFolderResponse(true, true, null)),
            NextAddOrUpdateBinding = PipeCallResult<AddOrUpdateFolderBindingResponse>.Fail(ManagerErrorKind.Internal),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService())
        {
            FolderPath = @"C:\Scans",
            DeviceId = "device-1",
        };
        await vm.ValidateFolderAsync();

        await vm.SaveAsync();

        Assert.Null(vm.WatchId);
        Assert.Equal(StatusLabels.ServiceUnavailable, vm.StatusMessage);
    }

    [Fact]
    public async Task SaveAsync_Unauthorized_RaisesUnauthorizedDetected()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextValidateFolder = PipeCallResult<ValidateFolderResponse>.Ok(new ValidateFolderResponse(true, true, null)),
            NextAddOrUpdateBinding = PipeCallResult<AddOrUpdateFolderBindingResponse>.Fail(ManagerErrorKind.Unauthorized),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService())
        {
            FolderPath = @"C:\Scans",
            DeviceId = "device-1",
        };
        await vm.ValidateFolderAsync();
        var raised = false;
        vm.UnauthorizedDetected += (_, _) => raised = true;

        await vm.SaveAsync();

        Assert.True(raised);
    }

    [Fact]
    public async Task RemoveAsync_Success_ClearsFormAndRefreshes()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextRemoveBinding = PipeCallResult<bool>.Ok(true),
            NextBindings = PipeCallResult<IReadOnlyList<FolderBindingInfo>>.Ok([]),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService()) { WatchId = "watch-1" };

        await vm.RemoveAsync();

        Assert.Null(vm.WatchId);
        Assert.Equal("watch-1", fake.LastRemovedWatchId);
        Assert.Empty(vm.Bindings);
    }

    [Fact]
    public async Task RemoveAsync_Failure_KeepsWatchIdAndSurfacesMessage()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextRemoveBinding = PipeCallResult<bool>.Fail(ManagerErrorKind.NotFound),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService()) { WatchId = "watch-1" };

        await vm.RemoveAsync();

        Assert.Equal("watch-1", vm.WatchId);
        Assert.Equal(StatusLabels.ConnectionRequired, vm.StatusMessage);
    }

    [Fact]
    public async Task RefreshAvailableServerBindingsAsync_PopulatesCatalogFromResult()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextAvailableServerBindings = PipeCallResult<GetAvailableServerBindingsResponse>.Ok(
                new GetAvailableServerBindingsResponse(
                    [new AvailableServerBindingInfo("binding-1", "device-1", "Sensor 1 (Op Room)", "IO", "active", "sensor")])),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService());

        await vm.RefreshAvailableServerBindingsAsync();

        Assert.Single(vm.AvailableServerBindings);
        Assert.Equal("device-1", vm.AvailableServerBindings[0].DeviceId);
        Assert.True(vm.HasAvailableServerBindings);
        Assert.False(vm.HasNoAvailableServerBindings);
        Assert.Equal(1, fake.GetAvailableServerBindingsCallCount);
    }

    [Fact]
    public async Task RefreshAvailableServerBindingsAsync_EmptyCatalog_ShowsNoDevicesEmptyState()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextAvailableServerBindings = PipeCallResult<GetAvailableServerBindingsResponse>.Ok(
                new GetAvailableServerBindingsResponse([])),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService());

        await vm.RefreshAvailableServerBindingsAsync();

        Assert.Empty(vm.AvailableServerBindings);
        Assert.True(vm.HasNoAvailableServerBindings);
        Assert.False(vm.HasAvailableServerBindings);
    }

    [Fact]
    public async Task SelectedAvailableBinding_SetsDeviceIdAndModality_WithoutManualEntry()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextAvailableServerBindings = PipeCallResult<GetAvailableServerBindingsResponse>.Ok(
                new GetAvailableServerBindingsResponse(
                    [new AvailableServerBindingInfo("binding-1", "device-42", "Sensor West", "PANO", "active", "sensor")])),
            NextValidateFolder = PipeCallResult<ValidateFolderResponse>.Ok(new ValidateFolderResponse(true, true, null)),
            NextAddOrUpdateBinding = PipeCallResult<AddOrUpdateFolderBindingResponse>.Ok(new AddOrUpdateFolderBindingResponse("watch-1")),
            NextBindings = PipeCallResult<IReadOnlyList<FolderBindingInfo>>.Ok([]),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService()) { FolderPath = @"C:\Scans" };
        await vm.RefreshAvailableServerBindingsAsync();

        vm.SelectedAvailableBinding = vm.AvailableServerBindings[0];
        await vm.ValidateFolderAsync();
        await vm.SaveAsync();

        Assert.Equal(@"C:\Scans", fake.LastAddOrUpdatePath);
        Assert.Equal("device-42", vm.DeviceId);
        Assert.Equal("PANO", vm.Modality);
        Assert.Equal(1, fake.AddOrUpdateFolderBindingCallCount);
    }

    [Fact]
    public void SelectedBinding_PopulatesEditFormFromExistingBinding()
    {
        var fake = new FakeBridgePipeClientService();
        var vm = new BindingsViewModel(fake, new FakeFileDialogService());
        var existing = new FolderBindingInfo("watch-5", @"C:\Scans\Pano", "device-7", "PANO", true);

        vm.SelectedBinding = existing;

        Assert.Equal("watch-5", vm.WatchId);
        Assert.Equal(@"C:\Scans\Pano", vm.FolderPath);
        Assert.Equal("device-7", vm.DeviceId);
        Assert.Equal("PANO", vm.Modality);
        Assert.True(vm.IsFolderValid);
        Assert.Equal(StatusLabels.Connected, vm.FolderStatusLabel);
    }

    [Fact]
    public void SelectedBinding_MatchesCatalogEntryByDeviceId()
    {
        var fake = new FakeBridgePipeClientService();
        var vm = new BindingsViewModel(fake, new FakeFileDialogService());
        var catalogEntry = new AvailableServerBindingInfo("binding-1", "device-7", "Sensor 1", "PANO", "active", "sensor");
        vm.AvailableServerBindings.Add(catalogEntry);

        vm.SelectedBinding = new FolderBindingInfo("watch-5", @"C:\Scans\Pano", "device-7", "PANO", true);

        Assert.Same(catalogEntry, vm.SelectedAvailableBinding);
    }

    [Fact]
    public async Task UpdateSelectedBindingCommand_UpdatesExistingBindingInPlaceAndRefreshes()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextValidateFolder = PipeCallResult<ValidateFolderResponse>.Ok(new ValidateFolderResponse(true, true, null)),
            NextAddOrUpdateBinding = PipeCallResult<AddOrUpdateFolderBindingResponse>.Ok(new AddOrUpdateFolderBindingResponse("watch-5")),
            NextBindings = PipeCallResult<IReadOnlyList<FolderBindingInfo>>.Ok(
                [new FolderBindingInfo("watch-5", @"C:\Scans\Pano2", "device-7", "PANO", true)]),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService());
        vm.SelectedBinding = new FolderBindingInfo("watch-5", @"C:\Scans\Pano", "device-7", "PANO", true);
        vm.FolderPath = @"C:\Scans\Pano2";
        await vm.ValidateFolderAsync();

        await ((AsyncRelayCommand)vm.UpdateSelectedBindingCommand).ExecuteAsync();

        Assert.Equal(1, fake.AddOrUpdateFolderBindingCallCount);
        Assert.Equal("watch-5", vm.WatchId);
        Assert.Single(vm.Bindings);
    }

    [Fact]
    public async Task RemoveSelectedBindingCommand_RemovesExistingBindingAndRefreshes()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextRemoveBinding = PipeCallResult<bool>.Ok(true),
            NextBindings = PipeCallResult<IReadOnlyList<FolderBindingInfo>>.Ok([]),
        };
        var vm = new BindingsViewModel(fake, new FakeFileDialogService());
        vm.SelectedBinding = new FolderBindingInfo("watch-5", @"C:\Scans\Pano", "device-7", "PANO", true);

        await ((AsyncRelayCommand)vm.RemoveSelectedBindingCommand).ExecuteAsync();

        Assert.Equal("watch-5", fake.LastRemovedWatchId);
        Assert.Null(vm.WatchId);
        Assert.Empty(vm.Bindings);
    }
}
