using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using NoraMedi.Bridge.Core.Http;
using NoraMedi.Bridge.Core.Updates;
using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Tests.Updates;

public class UpdateManagerTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("nmb-updatemgr-").FullName;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly string CurrentUserSid = System.Security.Principal.WindowsIdentity.GetCurrent().User!.Value;

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    private (UpdateManager manager, UpdateManagerFakeHandler handler) Make(
        string installedVersion = "0.4.6", bool requireTrustedSignature = false,
        Func<string, string, SignatureTrustResult>? trustOverride = null,
        Func<string, bool>? pinnedThumbprintOverride = null)
    {
        var handler = new UpdateManagerFakeHandler();
        var apiClient = new BridgeApiClient(new HttpClient(handler), "https://api.noramedi.test");
        var options = new UpdateOptions { UpdatesDirectory = _dir, RequireTrustedSignature = requireTrustedSignature };
        var stateStore = new UpdateStateStore(_dir, CurrentUserSid);
        var downloader = new UpdateDownloader(new HttpClient(handler), options, CurrentUserSid);
        var manager = new UpdateManager(options, stateStore, downloader, apiClient, installedVersion, NullLogger.Instance, trustOverride, pinnedThumbprintOverride);
        return (manager, handler);
    }

    private static string ConfigJson(string mode, object? release) =>
        JsonSerializer.Serialize(new { mode, release }, JsonOptions);

    private static object Release(string version, string sha256, bool signed = false, string? publisherThumbprint = null, string? minimumSourceVersion = null) => new
    {
        version,
        downloadUrl = "https://cdn.example.com/setup.exe",
        sha256,
        signed,
        publisherThumbprint,
        minimumSourceVersion,
        notes = (string?)null,
    };

    private static string HashOf(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    [Fact]
    public async Task CheckAsync_NoCredential_ReturnsDisabledServiceUnavailable()
    {
        var (manager, _) = Make();
        var state = await manager.CheckAsync(null, CancellationToken.None);
        Assert.Equal(UpdateLifecycleState.Disabled, state.Lifecycle);
        Assert.Equal(UpdateErrorCategory.ServiceUnavailable, state.ErrorCategory);
    }

    [Fact]
    public async Task CheckAsync_ServerModeDisabled_ReturnsDisabled()
    {
        var (manager, handler) = Make();
        handler.ConfigJson = ConfigJson("disabled", null);

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.Disabled, state.Lifecycle);
    }

    [Fact]
    public async Task CheckAsync_NetworkFailure_ReturnsDisabledWithNetworkFailureCategory()
    {
        var (manager, handler) = Make();
        handler.ConfigStatus = HttpStatusCode.InternalServerError;

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.Disabled, state.Lifecycle);
        Assert.Equal(UpdateErrorCategory.NetworkFailure, state.ErrorCategory);
    }

    [Fact]
    public async Task CheckAsync_EqualVersion_ReturnsUpToDate_NeverStages()
    {
        var (manager, handler) = Make(installedVersion: "0.4.7");
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf([1])));

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.UpToDate, state.Lifecycle);
    }

    [Fact]
    public async Task CheckAsync_OlderOfferedVersion_ReturnsUpToDate_AntiDowngrade()
    {
        var (manager, handler) = Make(installedVersion: "0.4.7");
        handler.ConfigJson = ConfigJson("notify", Release("0.4.6", HashOf([1])));

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.UpToDate, state.Lifecycle);
    }

    [Fact]
    public async Task CheckAsync_MalformedOfferedVersion_ReturnsUnsupported()
    {
        var (manager, handler) = Make();
        handler.ConfigJson = ConfigJson("notify", Release("not-a-version", HashOf([1])));

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.Unsupported, state.Lifecycle);
    }

    [Fact]
    public async Task CheckAsync_InstalledBelowMinimumSourceVersion_ReturnsUnsupported()
    {
        var (manager, handler) = Make(installedVersion: "0.3.0");
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf([1]), minimumSourceVersion: "0.4.0"));

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.Unsupported, state.Lifecycle);
        Assert.Equal(UpdateErrorCategory.UnsupportedSourceVersion, state.ErrorCategory);
    }

    [Fact]
    public async Task CheckAsync_NotifyMode_NewerVersion_HashMismatchIsReportedTruthfully()
    {
        var (manager, handler) = Make(installedVersion: "0.4.6");
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf([9, 9, 9])));
        handler.DownloadBytes = Encoding.UTF8.GetBytes("different-bytes-than-the-hash-expects");

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.VerificationFailed, state.Lifecycle);
        Assert.Equal(UpdateErrorCategory.HashMismatch, state.ErrorCategory);
    }

    [Fact]
    public async Task CheckAsync_NotifyMode_NewerVersion_MatchingHash_ReachesVerified_TrustNotRequired()
    {
        var body = Encoding.UTF8.GetBytes("installer-bytes");
        var (manager, handler) = Make(installedVersion: "0.4.6", requireTrustedSignature: false);
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf(body)));
        handler.DownloadBytes = body;

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.Verified, state.Lifecycle);
        Assert.NotNull(manager.CurrentState.StagedInstallerPath);
        Assert.True(File.Exists(manager.CurrentState.StagedInstallerPath));
    }

    [Fact]
    public async Task CheckAsync_NotifyMode_FeedsRealDownloadByteCountIntoState()
    {
        // Regression test for the Copilot-flagged gap: StageAsync never passed an IProgress callback
        // into UpdateDownloader.DownloadAsync, so TotalBytes stayed null and DownloadedBytes stuck at
        // whatever it was before the transfer — the Manager's "X of Y MB" label could never be real.
        var body = Encoding.UTF8.GetBytes("installer-bytes-for-progress-check");
        var (manager, handler) = Make(installedVersion: "0.4.6");
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf(body)));
        handler.DownloadBytes = body;

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.Verified, state.Lifecycle);
        Assert.Equal(body.Length, state.TotalBytes);
        Assert.Equal(body.Length, state.DownloadedBytes);
    }

    [Fact]
    public async Task CheckAsync_UnsignedReleaseWhenTrustRequired_VerificationFailsUnsigned()
    {
        var body = Encoding.UTF8.GetBytes("payload");
        var (manager, handler) = Make(installedVersion: "0.4.6", requireTrustedSignature: true);
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf(body), signed: false));
        handler.DownloadBytes = body;

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.VerificationFailed, state.Lifecycle);
        Assert.Equal(UpdateErrorCategory.UnsignedPackage, state.ErrorCategory);
    }

    [Fact]
    public async Task CheckAsync_WrongPublisher_VerificationFailsWithWrongPublisherCategory()
    {
        var body = Encoding.UTF8.GetBytes("payload");
        var (manager, handler) = Make(installedVersion: "0.4.6", requireTrustedSignature: true, trustOverride: (_, _) => SignatureTrustResult.WrongPublisher);
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf(body), signed: true, publisherThumbprint: "a".PadLeft(40, 'a')));
        handler.DownloadBytes = body;

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.VerificationFailed, state.Lifecycle);
        Assert.Equal(UpdateErrorCategory.WrongPublisher, state.ErrorCategory);
    }

    [Fact]
    public async Task CheckAsync_TrustedPublisher_ReachesVerifiedState()
    {
        var body = Encoding.UTF8.GetBytes("trusted-installer");
        var (manager, handler) = Make(
            installedVersion: "0.4.6", requireTrustedSignature: true,
            trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher,
            pinnedThumbprintOverride: _ => true);
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf(body), signed: true, publisherThumbprint: "a".PadLeft(40, 'a')));
        handler.DownloadBytes = body;

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.Verified, state.Lifecycle);
    }

    [Fact]
    public async Task CheckAsync_TrustedPublisherButNotInPinnedAllowlist_VerificationFailsUntrustedPublisher()
    {
        // The server's declared thumbprint matching what Authenticode verified is not enough on its
        // own — a compromised server/release-config could declare any signer it controls. The bridge's
        // own compiled-in allowlist (Trust.PinnedPublisherThumbprints) is the independent trust anchor
        // the server cannot redefine.
        var body = Encoding.UTF8.GetBytes("trusted-installer");
        var (manager, handler) = Make(
            installedVersion: "0.4.6", requireTrustedSignature: true,
            trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher,
            pinnedThumbprintOverride: _ => false);
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf(body), signed: true, publisherThumbprint: "a".PadLeft(40, 'a')));
        handler.DownloadBytes = body;

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.VerificationFailed, state.Lifecycle);
        Assert.Equal(UpdateErrorCategory.UntrustedPublisher, state.ErrorCategory);
        Assert.False(File.Exists(state.StagedInstallerPath));
    }

    [Fact]
    public async Task CheckAsync_ProductionDefaultEmptyAllowlist_FailsClosedEvenWithServerTrustedPublisher()
    {
        // No pinnedThumbprintOverride supplied: exercises the real shipped default
        // (Trust.PinnedPublisherThumbprints.Values is empty pending PR 7's production certificate).
        // A server that returns a thumbprint Authenticode happily verifies must still be rejected.
        var body = Encoding.UTF8.GetBytes("trusted-installer");
        var (manager, handler) = Make(installedVersion: "0.4.6", requireTrustedSignature: true, trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher);
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf(body), signed: true, publisherThumbprint: "a".PadLeft(40, 'a')));
        handler.DownloadBytes = body;

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.VerificationFailed, state.Lifecycle);
        Assert.Equal(UpdateErrorCategory.UntrustedPublisher, state.ErrorCategory);
    }

    [Fact]
    public async Task CheckAsync_AfterPriorRebootRequired_ClearsStaleRebootRequiredFlag()
    {
        // Regression test for the Copilot-flagged "RebootRequired sticky forever" bug: SetState's
        // OR-forward previously meant a reboot-required install result never got cleared by any
        // later check, even a later UpToDate result implying the machine is already current.
        var (manager, handler) = Make(installedVersion: "0.4.7");
        manager.RecordInstallResult(UpdateLifecycleState.RebootRequired, UpdateErrorCategory.None, rebootRequired: true);
        Assert.True(manager.CurrentState.RebootRequired);

        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf([1])));
        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(UpdateLifecycleState.UpToDate, state.Lifecycle);
        Assert.False(state.RebootRequired);
    }

    [Fact]
    public async Task CheckAsync_ConcurrentCalls_SecondReturnsAlreadyInProgress()
    {
        var (manager, handler) = Make();
        handler.ConfigJson = ConfigJson("disabled", null);
        handler.ConfigDelay = TimeSpan.FromMilliseconds(200);

        var first = manager.CheckAsync("cred", CancellationToken.None);
        await Task.Delay(20); // let the first call actually acquire the gate before the second races it
        var second = await manager.CheckAsync("cred", CancellationToken.None);
        await first;

        Assert.Equal(UpdateErrorCategory.AlreadyInProgress, second.ErrorCategory);
    }

    [Fact]
    public void TryLaunchInstall_WithoutVerifiedState_ReturnsAlreadyInProgressNeverLaunches()
    {
        var (manager, _) = Make();

        var state = manager.TryLaunchInstall();

        Assert.NotEqual(UpdateLifecycleState.InstallLaunched, state.Lifecycle);
        Assert.Equal(UpdateErrorCategory.AlreadyInProgress, state.ErrorCategory);
    }

    [Fact]
    public async Task CheckAsync_TrustedPublisher_ThenTryLaunchInstall_TransitionsToInstallLaunched()
    {
        var body = Encoding.UTF8.GetBytes("trusted-installer");
        var (manager, handler) = Make(
            installedVersion: "0.4.6", requireTrustedSignature: true,
            trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher,
            pinnedThumbprintOverride: _ => true);
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf(body), signed: true, publisherThumbprint: "a".PadLeft(40, 'a')));
        handler.DownloadBytes = body;
        await manager.CheckAsync("cred", CancellationToken.None);

        var state = manager.TryLaunchInstall();

        Assert.Equal(UpdateLifecycleState.InstallLaunched, state.Lifecycle);
    }

    [Fact]
    public async Task CheckAsync_Verified_PersistsTheServerDeclaredPublisherThumbprint_ForHelperRevalidation()
    {
        // Regression test: the helper's defense-in-depth re-check must
        // validate against the exact thumbprint the server's release
        // descriptor declared and UpdateManager already verified against —
        // not a separate, unrelated config value. If this ever regresses to
        // reading from somewhere else, InstallUpdate would silently fail
        // every time trust is required.
        var body = Encoding.UTF8.GetBytes("trusted-installer");
        var thumbprint = "b".PadLeft(40, 'b');
        var (manager, handler) = Make(
            installedVersion: "0.4.6", requireTrustedSignature: true,
            trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher,
            pinnedThumbprintOverride: _ => true);
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf(body), signed: true, publisherThumbprint: thumbprint));
        handler.DownloadBytes = body;

        var state = await manager.CheckAsync("cred", CancellationToken.None);

        Assert.Equal(thumbprint, state.StagedPublisherThumbprint);

        var launched = manager.TryLaunchInstall();
        Assert.Equal(thumbprint, launched.StagedPublisherThumbprint);
    }

    [Fact]
    public async Task TryLaunchInstall_ConcurrentCallers_OnlyOneTransitionsToInstallLaunched()
    {
        // Regression test for a real defect found during PR #149 physical
        // acceptance (Test 8, concurrent InstallUpdate IPC calls): TryLaunchInstall's
        // CurrentState read + Verified check + SetState(InstallLaunched) was
        // unsynchronized, so two callers racing each other could both observe
        // Verified and both transition to InstallLaunched — in the real
        // Service, each then launches its own UpdateHelper + msiexec process
        // (confirmed physically via two independent helper-result-*.json
        // files), violating the documented single-flight guarantee.
        var body = Encoding.UTF8.GetBytes("trusted-installer");
        var (manager, handler) = Make(
            installedVersion: "0.4.6", requireTrustedSignature: true,
            trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher,
            pinnedThumbprintOverride: _ => true);
        handler.ConfigJson = ConfigJson("notify", Release("0.4.7", HashOf(body), signed: true, publisherThumbprint: "a".PadLeft(40, 'a')));
        handler.DownloadBytes = body;
        await manager.CheckAsync("cred", CancellationToken.None);

        var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => Task.Run(() => manager.TryLaunchInstall())));

        // Lifecycle alone can't discriminate here: once the winner persists
        // InstallLaunched, every racing loser's CurrentState read (inside its
        // own lock turn) *also* observes InstallLaunched — see
        // BridgeOrchestrator.InstallUpdateAsync's matching fix. ErrorCategory
        // is the real per-call outcome: exactly one call must transition the
        // state machine (None), the rest must be told they didn't
        // (AlreadyInProgress) regardless of what Lifecycle now reads.
        Assert.Single(results, r => r.ErrorCategory == UpdateErrorCategory.None);
        Assert.Equal(19, results.Count(r => r.ErrorCategory == UpdateErrorCategory.AlreadyInProgress));
        Assert.All(results, r => Assert.Equal(UpdateLifecycleState.InstallLaunched, r.Lifecycle));
    }
}
