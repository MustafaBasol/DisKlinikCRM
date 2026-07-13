using System.Security.Cryptography;
using System.Text;
using NoraMedi.Bridge.Core.Updates;
using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Tests.Updates;

internal sealed class FakeInstallerRunner(int? exitCode) : ISilentInstallerRunner
{
    public string? LastInstallerPath { get; private set; }

    public Task<int?> RunAsync(string installerPath, TimeSpan timeout, CancellationToken cancellationToken)
    {
        LastInstallerPath = installerPath;
        return Task.FromResult(exitCode);
    }
}

internal sealed class FakeServiceStateProvider(string? status, string? installedVersion = null) : IServiceStateProvider
{
    public string? GetStatus(string serviceName) => status;
    public string? GetInstalledProductVersion(string serviceName) => installedVersion;
}

public class UpdateHelperRunnerTests : IDisposable
{
    private readonly string _stagedPath;

    public UpdateHelperRunnerTests()
    {
        _stagedPath = Path.Combine(Path.GetTempPath(), $"nmb-helper-{Guid.NewGuid():N}.exe");
        File.WriteAllBytes(_stagedPath, Encoding.UTF8.GetBytes("installer-content"));
    }

    public void Dispose()
    {
        try { File.Delete(_stagedPath); } catch (IOException) { }
    }

    private string ActualHash() => Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(_stagedPath)));

    [Fact]
    public async Task RunAsync_MissingStagedFile_FailsWithoutRunningInstaller()
    {
        var installerRunner = new FakeInstallerRunner(0);
        var runner = new UpdateHelperRunner(installerRunner, new FakeServiceStateProvider("Running"));
        var instruction = new UpdateHelperInstruction(@"C:\does\not\exist.exe", "a".PadLeft(64, 'a'), "0.4.7", false, null);

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal("InstallFailed", result.Outcome);
        Assert.Null(installerRunner.LastInstallerPath);
    }

    [Fact]
    public async Task RunAsync_HashMismatch_FailsBeforeRunningInstaller()
    {
        var installerRunner = new FakeInstallerRunner(0);
        var runner = new UpdateHelperRunner(installerRunner, new FakeServiceStateProvider("Running"));
        var instruction = new UpdateHelperInstruction(_stagedPath, "b".PadLeft(64, 'b'), "0.4.7", false, null);

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal("InstallFailed", result.Outcome);
        Assert.Equal(nameof(UpdateErrorCategory.HashMismatch), result.ErrorCategory);
        Assert.Null(installerRunner.LastInstallerPath);
    }

    [Fact]
    public async Task RunAsync_RequireTrustedSignatureWithNoThumbprint_FailsUnsigned()
    {
        var installerRunner = new FakeInstallerRunner(0);
        var runner = new UpdateHelperRunner(installerRunner, new FakeServiceStateProvider("Running"));
        var instruction = new UpdateHelperInstruction(_stagedPath, ActualHash(), "0.4.7", RequireTrustedSignature: true, ExpectedPublisherThumbprint: null);

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal(nameof(UpdateErrorCategory.UnsignedPackage), result.ErrorCategory);
        Assert.Null(installerRunner.LastInstallerPath);
    }

    [Fact]
    public async Task RunAsync_WrongPublisherViaTrustOverride_FailsWithoutRunningInstaller()
    {
        var installerRunner = new FakeInstallerRunner(0);
        var runner = new UpdateHelperRunner(installerRunner, new FakeServiceStateProvider("Running"), trustVerifierOverride: (_, _) => SignatureTrustResult.WrongPublisher);
        var instruction = new UpdateHelperInstruction(_stagedPath, ActualHash(), "0.4.7", true, "a".PadLeft(40, 'a'));

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal(nameof(UpdateErrorCategory.WrongPublisher), result.ErrorCategory);
        Assert.Null(installerRunner.LastInstallerPath);
    }

    [Fact]
    public async Task RunAsync_TrustedPublisherAndServiceReturnsRunning_Succeeds()
    {
        var installerRunner = new FakeInstallerRunner(0);
        var runner = new UpdateHelperRunner(
            installerRunner,
            new FakeServiceStateProvider("Running", installedVersion: "0.4.7"),
            trustVerifierOverride: (_, _) => SignatureTrustResult.TrustedPublisher,
            pinnedThumbprintOverride: _ => true);
        var instruction = new UpdateHelperInstruction(_stagedPath, ActualHash(), "0.4.7", true, "a".PadLeft(40, 'a'));

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal("Succeeded", result.Outcome);
        Assert.False(result.RebootRequired);
        Assert.Equal(_stagedPath, installerRunner.LastInstallerPath);
    }

    [Fact]
    public async Task RunAsync_TrustedPublisherNotInPinnedAllowlist_FailsWithUntrustedPublisher()
    {
        // Even when the server-declared thumbprint matches what Authenticode verified (TrustedPublisher),
        // the bridge's own compiled-in allowlist is a second, independent gate — a compromised server
        // cannot expand which signers are ever accepted, it can only narrow within this local list.
        var installerRunner = new FakeInstallerRunner(0);
        var runner = new UpdateHelperRunner(
            installerRunner,
            new FakeServiceStateProvider("Running", installedVersion: "0.4.7"),
            trustVerifierOverride: (_, _) => SignatureTrustResult.TrustedPublisher,
            pinnedThumbprintOverride: _ => false);
        var instruction = new UpdateHelperInstruction(_stagedPath, ActualHash(), "0.4.7", true, "a".PadLeft(40, 'a'));

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal("InstallFailed", result.Outcome);
        Assert.Equal(nameof(UpdateErrorCategory.UntrustedPublisher), result.ErrorCategory);
        Assert.Null(installerRunner.LastInstallerPath);
    }

    [Fact]
    public async Task RunAsync_ProductionDefaultEmptyAllowlist_RejectsEvenAServerTrustedPublisher()
    {
        // No trustVerifierOverride / pinnedThumbprintOverride: exercises the real, shipped default —
        // Trust.PinnedPublisherThumbprints.Values is empty until PR 7 provisions a production
        // certificate, so this must fail closed, not fall back to trusting the server's say-so.
        var installerRunner = new FakeInstallerRunner(0);
        var runner = new UpdateHelperRunner(installerRunner, new FakeServiceStateProvider("Running"), trustVerifierOverride: (_, _) => SignatureTrustResult.TrustedPublisher);
        var instruction = new UpdateHelperInstruction(_stagedPath, ActualHash(), "0.4.7", true, "a".PadLeft(40, 'a'));

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal("InstallFailed", result.Outcome);
        Assert.Equal(nameof(UpdateErrorCategory.UntrustedPublisher), result.ErrorCategory);
        Assert.Null(installerRunner.LastInstallerPath);
    }

    [Fact]
    public async Task RunAsync_ExitCode3010_ReportsRebootRequiredTruthfully_NotSucceeded()
    {
        var runner = new UpdateHelperRunner(new FakeInstallerRunner(3010), new FakeServiceStateProvider("Running", installedVersion: "0.4.7"));
        var instruction = new UpdateHelperInstruction(_stagedPath, ActualHash(), "0.4.7", false, null);

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal("RebootRequired", result.Outcome);
        Assert.True(result.RebootRequired);
    }

    [Fact]
    public async Task RunAsync_InstalledVersionDoesNotMatchExpected_ReportsPostInstallVersionMismatch()
    {
        var runner = new UpdateHelperRunner(new FakeInstallerRunner(0), new FakeServiceStateProvider("Running", installedVersion: "0.4.6"));
        var instruction = new UpdateHelperInstruction(_stagedPath, ActualHash(), "0.4.7", false, null);

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal("InstallFailed", result.Outcome);
        Assert.Equal(nameof(UpdateErrorCategory.PostInstallVersionMismatch), result.ErrorCategory);
    }

    [Fact]
    public async Task RunAsync_NonZeroNonRebootExitCode_ReportsInstallFailed()
    {
        var runner = new UpdateHelperRunner(new FakeInstallerRunner(1603), new FakeServiceStateProvider("Running"));
        var instruction = new UpdateHelperInstruction(_stagedPath, ActualHash(), "0.4.7", false, null);

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal("InstallFailed", result.Outcome);
        Assert.Equal(1603, result.ProcessExitCode);
    }

    [Fact]
    public async Task RunAsync_InstallerNeverExits_ReportsInstallFailed_NotSuccessBeforeVerification()
    {
        var runner = new UpdateHelperRunner(new FakeInstallerRunner(null), new FakeServiceStateProvider("Running"));
        var instruction = new UpdateHelperInstruction(_stagedPath, ActualHash(), "0.4.7", false, null);

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(1), CancellationToken.None);

        Assert.Equal("InstallFailed", result.Outcome);
    }

    [Fact]
    public async Task RunAsync_InstallerSucceedsButServiceNeverReturnsRunning_ReportsInstallFailedNotSucceeded()
    {
        var runner = new UpdateHelperRunner(new FakeInstallerRunner(0), new FakeServiceStateProvider("Stopped"));
        var instruction = new UpdateHelperInstruction(_stagedPath, ActualHash(), "0.4.7", false, null);

        var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(5), TimeSpan.FromMilliseconds(1500), CancellationToken.None);

        Assert.Equal("InstallFailed", result.Outcome);
        Assert.Equal(nameof(UpdateErrorCategory.ServiceUnavailable), result.ErrorCategory);
    }
}
