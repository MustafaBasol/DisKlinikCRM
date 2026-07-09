using System.IO;
using System.Text.Json;
using NoraMedi.Bridge.Core.Diagnostics;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Tests.TestSupport;
using NoraMedi.Bridge.Manager.ViewModels;

namespace NoraMedi.Bridge.Manager.Tests;

public class DiagnosticsViewModelTests : IDisposable
{
    private readonly List<string> _tempFiles = [];

    private string TempFilePath()
    {
        var path = Path.Combine(Path.GetTempPath(), $"noramedi-diag-test-{Guid.NewGuid():N}.json");
        _tempFiles.Add(path);
        return path;
    }

    public void Dispose()
    {
        foreach (var file in _tempFiles.Where(File.Exists))
        {
            File.Delete(file);
        }
    }

    private static DiagnosticsSnapshot MakeSnapshot() => new(
        "1.2.3",
        "install-42",
        DateTimeOffset.UtcNow.AddHours(-2),
        "online",
        "authenticated",
        DateTimeOffset.UtcNow,
        5, 1, 2, 100,
        [new WatchFolderDiagnostics("watch-1", true), new WatchFolderDiagnostics("watch-2", false)]);

    [Fact]
    public async Task ExportAsync_WritesExactlyTheSnapshotFields_NothingExtra()
    {
        var savePath = TempFilePath();
        var fake = new FakeBridgePipeClientService
        {
            NextExportDiagnostics = PipeCallResult<DiagnosticsSnapshot>.Ok(MakeSnapshot()),
        };
        var dialog = new FakeFileDialogService { NextSavePath = savePath };
        var vm = new DiagnosticsViewModel(fake, dialog);

        await vm.ExportAsync();

        Assert.True(vm.LastExportSucceeded);
        var json = await File.ReadAllTextAsync(savePath);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var expectedKeys = new[]
        {
            "agentVersion", "installationId", "startedAt", "connectionState", "authState",
            "lastHeartbeatAt", "pendingCount", "processingCount", "failedCount", "completedCount", "watchedFolders",
        };
        var actualKeys = root.EnumerateObject().Select(p => p.Name).ToArray();

        Assert.Equal(expectedKeys.OrderBy(k => k), actualKeys.OrderBy(k => k));
        Assert.Equal("1.2.3", root.GetProperty("agentVersion").GetString());

        var folders = root.GetProperty("watchedFolders");
        Assert.Equal(2, folders.GetArrayLength());
        var folderKeys = folders[0].EnumerateObject().Select(p => p.Name).OrderBy(k => k).ToArray();
        Assert.Equal(new[] { "available", "watchId" }, folderKeys);
    }

    [Fact]
    public async Task ExportAsync_UserCancelsSaveDialog_DoesNotWriteFile()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextExportDiagnostics = PipeCallResult<DiagnosticsSnapshot>.Ok(MakeSnapshot()),
        };
        var dialog = new FakeFileDialogService { NextSavePath = null };
        var vm = new DiagnosticsViewModel(fake, dialog);

        await vm.ExportAsync();

        Assert.False(vm.LastExportSucceeded);
        Assert.Equal(1, dialog.PickSaveFileCallCount);
    }

    [Fact]
    public async Task ExportAsync_Unauthorized_RaisesUnauthorizedDetectedAndDoesNotPromptForSave()
    {
        var fake = new FakeBridgePipeClientService
        {
            NextExportDiagnostics = PipeCallResult<DiagnosticsSnapshot>.Fail(ManagerErrorKind.Unauthorized),
        };
        var dialog = new FakeFileDialogService();
        var vm = new DiagnosticsViewModel(fake, dialog);
        var raised = false;
        vm.UnauthorizedDetected += (_, _) => raised = true;

        await vm.ExportAsync();

        Assert.True(raised);
        Assert.Equal(0, dialog.PickSaveFileCallCount);
        Assert.False(vm.LastExportSucceeded);
    }
}
