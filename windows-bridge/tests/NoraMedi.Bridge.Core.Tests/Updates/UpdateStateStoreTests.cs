using NoraMedi.Bridge.Core.Updates;

namespace NoraMedi.Bridge.Core.Tests.Updates;

public class UpdateStateStoreTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("nmb-updatestate-").FullName;
    private static readonly string CurrentUserSid = System.Security.Principal.WindowsIdentity.GetCurrent().User!.Value;

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    [Fact]
    public void Load_NoFileYet_ReturnsIdle()
    {
        var store = new UpdateStateStore(_dir, CurrentUserSid);
        var state = store.Load("0.4.7");
        Assert.Equal(UpdateLifecycleState.Idle, state.Lifecycle);
        Assert.Equal("0.4.7", state.InstalledVersion);
    }

    [Fact]
    public void SaveThenLoad_RoundTripsExactState()
    {
        var store = new UpdateStateStore(_dir, CurrentUserSid);
        var saved = new UpdateState(UpdateLifecycleState.Verified, "0.4.6", "0.4.7", @"C:\staged.exe", "abc123", 100, 200, UpdateErrorCategory.None, false, DateTimeOffset.UtcNow);

        store.Save(saved);
        var loaded = store.Load("0.4.6");

        Assert.Equal(saved.Lifecycle, loaded.Lifecycle);
        Assert.Equal(saved.OfferedVersion, loaded.OfferedVersion);
        Assert.Equal(saved.StagedInstallerPath, loaded.StagedInstallerPath);
    }

    [Fact]
    public void Load_CorruptFile_FailsSafeToIdle_NeverThrows()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(Path.Combine(_dir, "state.json"), "{ this is not valid json ");

        var store = new UpdateStateStore(_dir, CurrentUserSid);
        var state = store.Load("0.4.7");

        Assert.Equal(UpdateLifecycleState.Idle, state.Lifecycle);
    }

    [Fact]
    public void ReconcileOnStartup_LeftoverInProgressState_BecomesInterrupted()
    {
        var store = new UpdateStateStore(_dir, CurrentUserSid);
        store.Save(new UpdateState(UpdateLifecycleState.Downloading, "0.4.6", "0.4.7", null, null, 10, 100, UpdateErrorCategory.None, false, DateTimeOffset.UtcNow));

        var result = store.ReconcileOnStartup("0.4.6");

        Assert.Equal(UpdateLifecycleState.Interrupted, result.Lifecycle);
        Assert.Equal(UpdateLifecycleState.Interrupted, store.Load("0.4.6").Lifecycle);
    }

    [Fact]
    public void ReconcileOnStartup_TerminalState_IsLeftUnchanged()
    {
        var store = new UpdateStateStore(_dir, CurrentUserSid);
        store.Save(new UpdateState(UpdateLifecycleState.UpToDate, "0.4.7", null, null, null, 0, null, UpdateErrorCategory.None, false, DateTimeOffset.UtcNow));

        var result = store.ReconcileOnStartup("0.4.7");

        Assert.Equal(UpdateLifecycleState.UpToDate, result.Lifecycle);
    }

    [Fact]
    public void Load_AfterSuccessfulSelfUpdate_ReconcilesStaleInstalledVersionToLiveAgentVersion()
    {
        // Regression: after a self-update replaces the running binary,
        // state.json may still hold the pre-update version if nothing else
        // wrote a fresher record yet. Load() must never keep reporting a
        // stale installed version.
        var store = new UpdateStateStore(_dir, CurrentUserSid);
        store.Save(new UpdateState(UpdateLifecycleState.UpToDate, "0.4.7", null, null, null, 0, null, UpdateErrorCategory.None, false, DateTimeOffset.UtcNow));

        var loaded = store.Load("0.4.8");

        Assert.Equal("0.4.8", loaded.InstalledVersion);
    }

    [Fact]
    public void Save_WritesAtomically_NoTempFileLeftBehind()
    {
        var store = new UpdateStateStore(_dir, CurrentUserSid);
        store.Save(UpdateState.Idle("0.4.7"));

        Assert.True(File.Exists(Path.Combine(_dir, "state.json")));
        Assert.False(File.Exists(Path.Combine(_dir, "state.json.tmp")));
    }
}
