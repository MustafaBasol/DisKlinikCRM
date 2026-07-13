using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using NoraMedi.Bridge.Core.Updates;
using NoraMedi.Bridge.Core.Updates.Rollback;
using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Tests.Updates.Rollback;

public class RollbackManagerTests : IDisposable
{
    private readonly string _updatesDir = Directory.CreateTempSubdirectory("nmb-rollback-mgr-").FullName;
    private const string UpgradeCode = "12BB6A03-A76B-40B2-828E-7DAF6FB4A61E";
    private const string ValidThumbprint = "c123456789012345678901234567890123456789";
    private static readonly string CurrentUserSid = System.Security.Principal.WindowsIdentity.GetCurrent().User!.Value;

    public void Dispose()
    {
        try { Directory.Delete(_updatesDir, recursive: true); } catch (IOException) { }
    }

    private string RollbackDir => Path.Combine(_updatesDir, "rollback");

    private RollbackManager Make(
        Func<string, string, SignatureTrustResult>? trustOverride = null,
        Func<string, bool>? pinnedOverride = null)
    {
        var downloader = new UpdateDownloader(new HttpClient(new UnusedHandler()), new UpdateOptions { UpdatesDirectory = _updatesDir }, CurrentUserSid);
        var cache = new RollbackCache(downloader, RollbackDir, CurrentUserSid);
        var stateStore = new RollbackStateStore(_updatesDir, CurrentUserSid);
        return new RollbackManager(cache, stateStore, UpgradeCode, NullLogger.Instance, trustOverride, pinnedOverride);
    }

    /// <summary>Directly seeds the on-disk rollback cache (manifest + file) the way <see cref="RollbackCache.EnsureCachedAsync"/> would have, without a real network round trip.</summary>
    private (string path, string hash) SeedCache(string version, string content = "prior-good-installer")
    {
        Directory.CreateDirectory(RollbackDir);
        var body = Encoding.UTF8.GetBytes(content);
        var hash = Convert.ToHexStringLower(SHA256.HashData(body));
        var path = Path.Combine(RollbackDir, "NoraMediBridgeSetup.exe");
        File.WriteAllBytes(path, body);
        var manifest = new RollbackCacheManifest(version, path, hash, ValidThumbprint, DateTimeOffset.UtcNow);
        var json = System.Text.Json.JsonSerializer.Serialize(manifest, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        File.WriteAllText(Path.Combine(RollbackDir, "manifest.json"), json);
        return (path, hash);
    }

    [Fact]
    public void TryPrepareRollback_NoCachedPackage_ReturnsNullAndInterventionRequired()
    {
        var manager = Make();

        var instruction = manager.TryPrepareRollback("0.4.8");

        Assert.Null(instruction);
        var state = manager.CurrentState;
        Assert.Equal(RollbackLifecycleState.InterventionRequired, state.Lifecycle);
        Assert.Equal(RollbackErrorCategory.NoCachedPackage, state.ErrorCategory);
    }

    [Fact]
    public void TryPrepareRollback_ValidCachedPackage_ReturnsInstructionAndPreparingState()
    {
        SeedCache("0.4.7");
        var manager = Make(trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);

        var instruction = manager.TryPrepareRollback("0.4.8");

        Assert.NotNull(instruction);
        Assert.Equal("0.4.7", instruction!.ExpectedVersion);
        Assert.Equal(UpgradeCode, instruction.UpgradeCode);
        Assert.Equal(RollbackLifecycleState.Preparing, manager.CurrentState.Lifecycle);
    }

    [Fact]
    public void TryPrepareRollback_CachedFileTamperedAfterCaching_HashMismatch_InterventionRequired()
    {
        var (path, _) = SeedCache("0.4.7");
        File.WriteAllText(path, "tampered-after-the-fact");
        var manager = Make(trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);

        var instruction = manager.TryPrepareRollback("0.4.8");

        Assert.Null(instruction);
        var state = manager.CurrentState;
        Assert.Equal(RollbackLifecycleState.InterventionRequired, state.Lifecycle);
        Assert.Equal(RollbackErrorCategory.CacheHashMismatch, state.ErrorCategory);
    }

    [Fact]
    public void TryPrepareRollback_UntrustedSigner_ReturnsNullAndInterventionRequired()
    {
        SeedCache("0.4.7");
        var manager = Make(trustOverride: (_, _) => SignatureTrustResult.WrongPublisher, pinnedOverride: _ => true);

        var instruction = manager.TryPrepareRollback("0.4.8");

        Assert.Null(instruction);
        Assert.Equal(RollbackErrorCategory.CacheSignerUntrusted, manager.CurrentState.ErrorCategory);
    }

    [Fact]
    public void TryPrepareRollback_UnpinnedSigner_ReturnsNullEvenIfAuthenticodeTrusted()
    {
        SeedCache("0.4.7");
        var manager = Make(trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => false);

        var instruction = manager.TryPrepareRollback("0.4.8");

        Assert.Null(instruction);
        Assert.Equal(RollbackErrorCategory.CacheSignerUntrusted, manager.CurrentState.ErrorCategory);
    }

    [Fact]
    public void TryPrepareRollback_CachedVersionEqualsFailedVersion_TargetVersionMismatch()
    {
        // Would happen only if caching logic somehow cached the same version that's about to fail —
        // must never "roll back" to the exact same broken build.
        SeedCache("0.4.8");
        var manager = Make(trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);

        var instruction = manager.TryPrepareRollback("0.4.8");

        Assert.Null(instruction);
        Assert.Equal(RollbackErrorCategory.TargetVersionMismatch, manager.CurrentState.ErrorCategory);
    }

    [Fact]
    public void TryPrepareRollback_SecondAttemptForSameOfferedVersionAfterFailure_IsLoopPrevented()
    {
        SeedCache("0.4.7");
        var manager = Make(trustOverride: (_, _) => SignatureTrustResult.WrongPublisher, pinnedOverride: _ => true);

        var first = manager.TryPrepareRollback("0.4.8");
        Assert.Null(first); // fails due to untrusted signer -> InterventionRequired, AttemptedForOfferedVersion recorded

        var second = manager.TryPrepareRollback("0.4.8");

        Assert.Null(second);
        Assert.Equal(RollbackErrorCategory.LoopPrevented, manager.CurrentState.ErrorCategory);
    }

    [Fact]
    public void TryPrepareRollback_DifferentOfferedVersionAfterPriorFailure_IsNotLoopPrevented()
    {
        SeedCache("0.4.7");
        var manager = Make(trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);

        var first = manager.TryPrepareRollback("0.4.8");
        Assert.NotNull(first);
        manager.RecordResult(new RollbackHelperResult(nameof(RollbackLifecycleState.Failed), nameof(RollbackErrorCategory.InstallerFailure), 0, 1603, DateTimeOffset.UtcNow), "0.4.8", "0.4.7");

        // A later, different broken release (0.4.9) is a fresh rollback decision, not the same loop.
        var second = manager.TryPrepareRollback("0.4.9");

        Assert.NotNull(second);
    }

    [Fact]
    public void TryPrepareRollback_WhileAlreadyInProgress_ReturnsNullWithoutOverwritingState()
    {
        SeedCache("0.4.7");
        var manager = Make(trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);
        var first = manager.TryPrepareRollback("0.4.8");
        Assert.NotNull(first);
        manager.MarkLaunched("0.4.8", "0.4.7");
        Assert.True(manager.CurrentState.IsInProgress);

        var second = manager.TryPrepareRollback("0.4.8");

        Assert.Null(second);
        // Still Uninstalling — the second call must not have clobbered the in-flight state.
        Assert.Equal(RollbackLifecycleState.Uninstalling, manager.CurrentState.Lifecycle);
    }

    [Fact]
    public void RecordResult_Success_SetsSucceededState()
    {
        var manager = Make();
        manager.RecordResult(new RollbackHelperResult(nameof(RollbackLifecycleState.Succeeded), nameof(RollbackErrorCategory.None), 0, 0, DateTimeOffset.UtcNow), "0.4.8", "0.4.7");

        var state = manager.CurrentState;
        Assert.Equal(RollbackLifecycleState.Succeeded, state.Lifecycle);
        Assert.Equal("0.4.7", state.TargetVersion);
    }

    [Fact]
    public void RecordResult_Failure_SetsInterventionRequiredNeverAutoRetried()
    {
        var manager = Make();
        manager.RecordResult(new RollbackHelperResult(nameof(RollbackLifecycleState.Failed), nameof(RollbackErrorCategory.PostRollbackVersionMismatch), 0, 0, DateTimeOffset.UtcNow), "0.4.8", "0.4.7");

        var state = manager.CurrentState;
        Assert.Equal(RollbackLifecycleState.InterventionRequired, state.Lifecycle);
        Assert.Equal(RollbackErrorCategory.PostRollbackVersionMismatch, state.ErrorCategory);
    }

    [Fact]
    public void ReconcileOnStartup_StaleInProgressState_BecomesInterventionRequired()
    {
        SeedCache("0.4.7");
        var manager = Make(trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);
        manager.TryPrepareRollback("0.4.8");
        manager.MarkLaunched("0.4.8", "0.4.7");
        Assert.True(manager.CurrentState.IsInProgress);

        // Simulate a fresh process (crash/kill mid-rollback) reconciling on startup.
        var freshManager = Make(trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);
        freshManager.ReconcileOnStartup();

        Assert.Equal(RollbackLifecycleState.InterventionRequired, freshManager.CurrentState.Lifecycle);
    }

    [Fact]
    public void CurrentState_WhenNeverAttempted_IsNone()
    {
        var manager = Make();
        Assert.Equal(RollbackLifecycleState.None, manager.CurrentState.Lifecycle);
    }
}

internal sealed class UnusedHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
        throw new InvalidOperationException("This test double should never make a real HTTP call.");
}
