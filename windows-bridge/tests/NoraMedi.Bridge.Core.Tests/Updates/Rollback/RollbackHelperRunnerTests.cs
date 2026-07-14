using System.Security.Cryptography;
using System.Text;
using NoraMedi.Bridge.Core.Updates;
using NoraMedi.Bridge.Core.Updates.Rollback;
using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Tests.Updates.Rollback;

internal sealed class FakeProductUninstaller(int? exitCode) : IProductUninstaller
{
    public string? LastUpgradeCode { get; private set; }
    public bool Called { get; private set; }

    public Task<int?> UninstallAsync(string upgradeCode, TimeSpan timeout, CancellationToken cancellationToken)
    {
        Called = true;
        LastUpgradeCode = upgradeCode;
        return Task.FromResult(exitCode);
    }
}

public class RollbackHelperRunnerTests : IDisposable
{
    private readonly string _cachedPath;
    private const string UpgradeCode = "12BB6A03-A76B-40B2-828E-7DAF6FB4A61E";
    private const string ValidThumbprint = "c123456789012345678901234567890123456789";

    public RollbackHelperRunnerTests()
    {
        _cachedPath = Path.Combine(Path.GetTempPath(), $"nmb-rollback-{Guid.NewGuid():N}.exe");
        File.WriteAllBytes(_cachedPath, Encoding.UTF8.GetBytes("prior-trusted-installer"));
    }

    public void Dispose()
    {
        try { File.Delete(_cachedPath); } catch (IOException) { }
    }

    private string ActualHash() => Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(_cachedPath)));

    private static UpdateHelperRunner Make(
        FakeInstallerRunner installerRunner, FakeServiceStateProvider serviceState, FakeProductUninstaller uninstaller,
        Func<string, string, SignatureTrustResult>? trustOverride = null, Func<string, bool>? pinnedOverride = null) =>
        new(installerRunner, serviceState, trustOverride, pinnedOverride, uninstaller);

    [Fact]
    public async Task RunRollbackAsync_MissingCachedFile_FailsWithoutUninstalling()
    {
        var uninstaller = new FakeProductUninstaller(0);
        var runner = Make(new FakeInstallerRunner(0), new FakeServiceStateProvider("Running"), uninstaller);
        var instruction = new RollbackHelperInstruction(@"C:\does\not\exist.exe", "a".PadLeft(64, 'a'), "0.4.7", ValidThumbprint, UpgradeCode);

        var result = await runner.RunRollbackAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal("Failed", result.Outcome);
        Assert.False(uninstaller.Called);
    }

    [Fact]
    public async Task RunRollbackAsync_HashMismatch_FailsWithoutUninstalling()
    {
        var uninstaller = new FakeProductUninstaller(0);
        var runner = Make(new FakeInstallerRunner(0), new FakeServiceStateProvider("Running"), uninstaller);
        var instruction = new RollbackHelperInstruction(_cachedPath, "b".PadLeft(64, 'b'), "0.4.7", ValidThumbprint, UpgradeCode);

        var result = await runner.RunRollbackAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal("Failed", result.Outcome);
        Assert.Equal(nameof(RollbackErrorCategory.CacheHashMismatch), result.ErrorCategory);
        Assert.False(uninstaller.Called);
    }

    [Fact]
    public async Task RunRollbackAsync_UntrustedSigner_FailsWithoutUninstalling()
    {
        var uninstaller = new FakeProductUninstaller(0);
        var runner = Make(new FakeInstallerRunner(0), new FakeServiceStateProvider("Running"), uninstaller,
            trustOverride: (_, _) => SignatureTrustResult.WrongPublisher, pinnedOverride: _ => true);
        var instruction = new RollbackHelperInstruction(_cachedPath, ActualHash(), "0.4.7", ValidThumbprint, UpgradeCode);

        var result = await runner.RunRollbackAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal(nameof(RollbackErrorCategory.CacheSignerUntrusted), result.ErrorCategory);
        Assert.False(uninstaller.Called);
    }

    [Fact]
    public async Task RunRollbackAsync_UninstallFails_StopsBeforeInstalling()
    {
        var installerRunner = new FakeInstallerRunner(0);
        var uninstaller = new FakeProductUninstaller(1603); // generic MSI failure exit code
        var runner = Make(installerRunner, new FakeServiceStateProvider("Running"), uninstaller,
            trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);
        var instruction = new RollbackHelperInstruction(_cachedPath, ActualHash(), "0.4.7", ValidThumbprint, UpgradeCode);

        var result = await runner.RunRollbackAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal(nameof(RollbackErrorCategory.UninstallFailed), result.ErrorCategory);
        Assert.True(uninstaller.Called);
        Assert.Null(installerRunner.LastInstallerPath);
    }

    [Fact]
    public async Task RunRollbackAsync_UninstallSucceeds_UsesTheDeclaredUpgradeCode()
    {
        var uninstaller = new FakeProductUninstaller(0);
        var runner = Make(new FakeInstallerRunner(0), new FakeServiceStateProvider("Running", "0.4.7"), uninstaller,
            trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);
        var instruction = new RollbackHelperInstruction(_cachedPath, ActualHash(), "0.4.7", ValidThumbprint, UpgradeCode);

        await runner.RunRollbackAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal(UpgradeCode, uninstaller.LastUpgradeCode);
    }

    [Fact]
    public async Task RunRollbackAsync_InstallerFailsAfterUninstall_ReportsInstallerFailure()
    {
        var installerRunner = new FakeInstallerRunner(1603);
        var uninstaller = new FakeProductUninstaller(0);
        var runner = Make(installerRunner, new FakeServiceStateProvider("Running"), uninstaller,
            trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);
        var instruction = new RollbackHelperInstruction(_cachedPath, ActualHash(), "0.4.7", ValidThumbprint, UpgradeCode);

        var result = await runner.RunRollbackAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal(nameof(RollbackErrorCategory.InstallerFailure), result.ErrorCategory);
        Assert.Equal(0, result.UninstallExitCode);
        Assert.Equal(1603, result.InstallExitCode);
    }

    [Fact]
    public async Task RunRollbackAsync_ServiceNeverReachesRunning_ReportsServiceUnavailable()
    {
        var uninstaller = new FakeProductUninstaller(0);
        var runner = Make(new FakeInstallerRunner(0), new FakeServiceStateProvider(status: null), uninstaller,
            trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);
        var instruction = new RollbackHelperInstruction(_cachedPath, ActualHash(), "0.4.7", ValidThumbprint, UpgradeCode);

        var result = await runner.RunRollbackAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromMilliseconds(500), CancellationToken.None);

        Assert.Equal(nameof(RollbackErrorCategory.ServiceUnavailable), result.ErrorCategory);
    }

    [Fact]
    public async Task RunRollbackAsync_ServiceRunningButWrongVersion_ReportsPostRollbackVersionMismatch()
    {
        var uninstaller = new FakeProductUninstaller(0);
        var runner = Make(new FakeInstallerRunner(0), new FakeServiceStateProvider("Running", installedVersion: "0.4.8"), uninstaller,
            trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);
        var instruction = new RollbackHelperInstruction(_cachedPath, ActualHash(), "0.4.7", ValidThumbprint, UpgradeCode);

        var result = await runner.RunRollbackAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal(nameof(RollbackErrorCategory.PostRollbackVersionMismatch), result.ErrorCategory);
    }

    [Fact]
    public async Task RunRollbackAsync_FullSuccessPath_UninstallsThenInstallsThenVerifiesVersion()
    {
        var installerRunner = new FakeInstallerRunner(0);
        var uninstaller = new FakeProductUninstaller(0);
        var runner = Make(installerRunner, new FakeServiceStateProvider("Running", "0.4.7"), uninstaller,
            trustOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedOverride: _ => true);
        var instruction = new RollbackHelperInstruction(_cachedPath, ActualHash(), "0.4.7", ValidThumbprint, UpgradeCode);

        var result = await runner.RunRollbackAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal(nameof(RollbackLifecycleState.Succeeded), result.Outcome);
        Assert.True(uninstaller.Called);
        Assert.Equal(_cachedPath, installerRunner.LastInstallerPath);
    }
}
