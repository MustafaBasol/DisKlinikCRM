using System.Diagnostics;
using System.Security.Cryptography;
using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Updates;

/// <summary>Abstraction over launching the actual silent installer process — lets <see cref="UpdateHelperRunner"/> be unit tested without spawning a real process.</summary>
public interface ISilentInstallerRunner
{
    /// <summary>Returns the process exit code, or null if the process never started or did not exit within <paramref name="timeout"/>.</summary>
    Task<int?> RunAsync(string installerPath, TimeSpan timeout, CancellationToken cancellationToken);
}

/// <summary>Abstraction over reading the NoraMediBridge Windows service's current SCM status — lets <see cref="UpdateHelperRunner"/> be unit tested without a real service.</summary>
public interface IServiceStateProvider
{
    /// <summary>Returns the service's <c>ServiceControllerStatus</c> name (e.g. "Running"), or null if the service is not installed/queryable.</summary>
    string? GetStatus(string serviceName);
}

[System.Runtime.Versioning.SupportedOSPlatform("windows")]
public sealed class ProcessSilentInstallerRunner : ISilentInstallerRunner
{
    public async Task<int?> RunAsync(string installerPath, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var psi = new ProcessStartInfo
        {
            FileName = installerPath,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        // Fixed, hardcoded silent-upgrade command line — matches docs/installer.md's
        // documented supported invocation exactly. Never built from any
        // caller-supplied string.
        psi.ArgumentList.Add("/quiet");
        psi.ArgumentList.Add("/norestart");

        using var process = Process.Start(psi);
        if (process is null) return null;

        using var timeoutCts = new CancellationTokenSource(timeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
        try
        {
            await process.WaitForExitAsync(linked.Token);
        }
        catch (OperationCanceledException)
        {
            return null;
        }

        return process.ExitCode;
    }
}

[System.Runtime.Versioning.SupportedOSPlatform("windows")]
public sealed class WindowsServiceStateProvider : IServiceStateProvider
{
    public string? GetStatus(string serviceName)
    {
        try
        {
            using var controller = new System.ServiceProcess.ServiceController(serviceName);
            return controller.Status.ToString();
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return null;
        }
    }
}

/// <summary>
/// The narrow, purpose-built logic NoraMedi.Bridge.UpdateHelper's Program.cs
/// runs: independently re-validate the staged installer, run the one fixed
/// silent-install command, wait for the service to come back up, and
/// produce a truthful result. See docs/update-architecture.md "Self-update
/// handoff". This class has no dependency on being an actual separate
/// process so it is exercised by NoraMedi.Bridge.Core.Tests directly — the
/// UpdateHelper executable itself is a thin Program.cs wrapper around it.
/// </summary>
public sealed class UpdateHelperRunner(
    ISilentInstallerRunner installerRunner,
    IServiceStateProvider serviceStateProvider,
    Func<string, string, SignatureTrustResult>? trustVerifierOverride = null)
{
    public const string ServiceName = "NoraMediBridge";
    private const int ExitCodeSuccess = 0;
    private const int ExitCodeRebootRequired = 3010; // ERROR_SUCCESS_REBOOT_REQUIRED

    public async Task<UpdateHelperResult> RunAsync(
        UpdateHelperInstruction instruction, TimeSpan installTimeout, TimeSpan serviceWaitTimeout, CancellationToken cancellationToken)
    {
        if (!File.Exists(instruction.StagedInstallerPath))
        {
            return Fail(UpdateErrorCategory.InstallerFailure, null);
        }

        var actualHash = ComputeSha256(instruction.StagedInstallerPath);
        if (!string.Equals(actualHash, instruction.ExpectedSha256, StringComparison.OrdinalIgnoreCase))
        {
            return Fail(UpdateErrorCategory.HashMismatch, null);
        }

        if (instruction.RequireTrustedSignature)
        {
            if (string.IsNullOrEmpty(instruction.ExpectedPublisherThumbprint))
            {
                return Fail(UpdateErrorCategory.UnsignedPackage, null);
            }

            var trust = trustVerifierOverride is not null
                ? trustVerifierOverride(instruction.StagedInstallerPath, instruction.ExpectedPublisherThumbprint)
                : AuthenticodeVerifier.Verify(instruction.StagedInstallerPath, instruction.ExpectedPublisherThumbprint);

            if (trust != SignatureTrustResult.TrustedPublisher)
            {
                var category = trust switch
                {
                    SignatureTrustResult.Unsigned => UpdateErrorCategory.UnsignedPackage,
                    SignatureTrustResult.WrongPublisher => UpdateErrorCategory.WrongPublisher,
                    _ => UpdateErrorCategory.TamperedSignature,
                };
                return Fail(category, null);
            }
        }

        var exitCode = await installerRunner.RunAsync(instruction.StagedInstallerPath, installTimeout, cancellationToken);
        if (exitCode is null)
        {
            return Fail(UpdateErrorCategory.InstallerFailure, null);
        }

        var rebootRequired = exitCode == ExitCodeRebootRequired;
        if (exitCode != ExitCodeSuccess && !rebootRequired)
        {
            return Fail(UpdateErrorCategory.InstallerFailure, exitCode);
        }

        var deadline = DateTimeOffset.UtcNow + serviceWaitTimeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (serviceStateProvider.GetStatus(ServiceName) == "Running")
            {
                return new UpdateHelperResult(
                    rebootRequired ? "RebootRequired" : "Succeeded",
                    "None", exitCode, rebootRequired, DateTimeOffset.UtcNow);
            }

            try { await Task.Delay(1000, cancellationToken); }
            catch (OperationCanceledException) { break; }
        }

        // The installer itself reported success/reboot-required, but the
        // service never came back to Running within the bounded wait —
        // truthfully a failure requiring support triage, not a silent success.
        return new UpdateHelperResult("InstallFailed", nameof(UpdateErrorCategory.ServiceUnavailable), exitCode, rebootRequired, DateTimeOffset.UtcNow);
    }

    private static UpdateHelperResult Fail(UpdateErrorCategory category, int? exitCode) =>
        new("InstallFailed", category.ToString(), exitCode, false, DateTimeOffset.UtcNow);

    private static string ComputeSha256(string path)
    {
        using var stream = File.OpenRead(path);
        using var sha256 = SHA256.Create();
        return Convert.ToHexStringLower(sha256.ComputeHash(stream));
    }
}
