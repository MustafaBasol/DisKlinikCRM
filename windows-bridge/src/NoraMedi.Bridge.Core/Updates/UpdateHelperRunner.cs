using System.Diagnostics;
using System.Security.Cryptography;
using NoraMedi.Bridge.Core.Updates.Rollback;
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

    /// <summary>Returns the installed product version of the service's own binary (e.g. its assembly/file version), or null if it cannot be determined.</summary>
    string? GetInstalledProductVersion(string serviceName);
}

/// <summary>
/// Abstraction over uninstalling the currently-installed product before a
/// rollback install runs — lets <see cref="UpdateHelperRunner"/> be unit
/// tested without invoking real MSI APIs. Needed only for rollback: WiX's
/// <c>MajorUpgrade</c> element (see installer/NoraMedi.Bridge.Installer/Package.wxs)
/// sets <c>DowngradeErrorMessage</c>, which makes msiexec refuse to silently
/// install a lower ProductVersion over a higher one under the same
/// UpgradeCode — an explicit uninstall-then-install is the documented way
/// around that guard (see docs/update-runbook.md "Rollback execution").
/// </summary>
public interface IProductUninstaller
{
    /// <summary>Finds the ProductCode currently registered for <paramref name="upgradeCode"/> and uninstalls it silently. Returns the msiexec exit code, or null if no matching product was found or the process never started/exited within <paramref name="timeout"/>.</summary>
    Task<int?> UninstallAsync(string upgradeCode, TimeSpan timeout, CancellationToken cancellationToken);
}

[System.Runtime.Versioning.SupportedOSPlatform("windows")]
public sealed class WindowsMsiProductUninstaller : IProductUninstaller
{
    private const int ErrorSuccess = 0;
    private const int ErrorNoMoreItems = 259;

    public async Task<int?> UninstallAsync(string upgradeCode, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var productCode = FindInstalledProductCode(upgradeCode);
        if (productCode is null) return null;

        var psi = new ProcessStartInfo
        {
            FileName = "msiexec.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        // Fixed, hardcoded uninstall command line — never built from any
        // caller-supplied string, same discipline as ProcessSilentInstallerRunner.
        psi.ArgumentList.Add("/x");
        psi.ArgumentList.Add(productCode);
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

    /// <summary>P/Invoke MsiEnumRelatedProductsW — the documented Windows Installer API for "which ProductCode is installed for this UpgradeCode".</summary>
    private static string? FindInstalledProductCode(string upgradeCode)
    {
        var buffer = new System.Text.StringBuilder(39);
        var result = MsiEnumRelatedProductsW(upgradeCode, 0, 0, buffer);
        return result == ErrorSuccess ? buffer.ToString() : null;
    }

    [System.Runtime.InteropServices.DllImport("msi.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int MsiEnumRelatedProductsW(string lpUpgradeCode, uint dwReserved, uint iProductIndex, System.Text.StringBuilder lpProductBuf);
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

    /// <summary>
    /// Resolves the service's ImagePath from the SCM registry key and reads
    /// the FileVersionInfo off the actual binary on disk — independent of
    /// anything the just-run installer or instruction file claims, so a
    /// silent-installer exit code alone can never be mistaken for "the
    /// expected version is actually running".
    /// </summary>
    public string? GetInstalledProductVersion(string serviceName)
    {
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                $@"SYSTEM\CurrentControlSet\Services\{serviceName}");
            var imagePath = key?.GetValue("ImagePath") as string;
            if (string.IsNullOrWhiteSpace(imagePath)) return null;

            var exePath = ExtractExecutablePath(imagePath);
            if (exePath is null || !File.Exists(exePath)) return null;

            var info = System.Diagnostics.FileVersionInfo.GetVersionInfo(exePath);
            return info.ProductVersion ?? info.FileVersion;
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return null;
        }
    }

    private static string? ExtractExecutablePath(string imagePath)
    {
        var trimmed = imagePath.Trim();
        if (trimmed.StartsWith('"'))
        {
            var closingQuote = trimmed.IndexOf('"', 1);
            return closingQuote > 0 ? trimmed[1..closingQuote] : null;
        }

        var spaceIndex = trimmed.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        return spaceIndex > 0 ? trimmed[..(spaceIndex + 4)] : trimmed;
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
    Func<string, string, SignatureTrustResult>? trustVerifierOverride = null,
    Func<string, bool>? pinnedThumbprintOverride = null,
    IProductUninstaller? productUninstaller = null)
{
    public const string ServiceName = "NoraMediBridge";
    private const int ExitCodeSuccess = 0;
    private const int ExitCodeRebootRequired = 3010; // ERROR_SUCCESS_REBOOT_REQUIRED

    /// <summary>
    /// Runs a rollback: independently re-verify the cached installer's
    /// hash+signer (defense in depth — never trust <see cref="RollbackManager"/>'s
    /// prior verification blindly, same rationale as <see cref="RunAsync"/>),
    /// uninstall the currently-installed (unhealthy) product via its
    /// UpgradeCode (required — WiX blocks a same-UpgradeCode silent
    /// downgrade otherwise), then install the rollback target and confirm the
    /// service comes back up running the expected (older) version.
    /// </summary>
    public async Task<RollbackHelperResult> RunRollbackAsync(
        RollbackHelperInstruction instruction, TimeSpan installTimeout, TimeSpan serviceWaitTimeout, CancellationToken cancellationToken)
    {
        if (!File.Exists(instruction.CachedInstallerPath))
        {
            return RollbackFail(RollbackErrorCategory.InstallerFailure, null, null);
        }

        FileStream lockStream;
        try
        {
            lockStream = new FileStream(instruction.CachedInstallerPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return RollbackFail(RollbackErrorCategory.InstallerFailure, null, null);
        }

        using (lockStream)
        {
            var actualHash = ComputeSha256(lockStream);
            if (!string.Equals(actualHash, instruction.ExpectedSha256, StringComparison.OrdinalIgnoreCase))
            {
                return RollbackFail(RollbackErrorCategory.CacheHashMismatch, null, null);
            }

            var trust = trustVerifierOverride is not null
                ? trustVerifierOverride(instruction.CachedInstallerPath, instruction.ExpectedPublisherThumbprint)
                : AuthenticodeVerifier.Verify(instruction.CachedInstallerPath, instruction.ExpectedPublisherThumbprint);
            var isPinned = pinnedThumbprintOverride is not null
                ? pinnedThumbprintOverride(instruction.ExpectedPublisherThumbprint)
                : Trust.PinnedPublisherThumbprints.Contains(instruction.ExpectedPublisherThumbprint);

            if (trust != SignatureTrustResult.TrustedPublisher || !isPinned)
            {
                return RollbackFail(RollbackErrorCategory.CacheSignerUntrusted, null, null);
            }

            var uninstaller = productUninstaller ?? new WindowsMsiProductUninstaller();
            var uninstallExit = await uninstaller.UninstallAsync(instruction.UpgradeCode, installTimeout, cancellationToken);
            if (uninstallExit is null || (uninstallExit != ExitCodeSuccess && uninstallExit != ExitCodeRebootRequired))
            {
                return RollbackFail(RollbackErrorCategory.UninstallFailed, uninstallExit, null);
            }

            var installExit = await installerRunner.RunAsync(instruction.CachedInstallerPath, installTimeout, cancellationToken);
            if (installExit is null || (installExit != ExitCodeSuccess && installExit != ExitCodeRebootRequired))
            {
                return RollbackFail(RollbackErrorCategory.InstallerFailure, uninstallExit, installExit);
            }

            var deadline = DateTimeOffset.UtcNow + serviceWaitTimeout;
            while (DateTimeOffset.UtcNow < deadline)
            {
                if (serviceStateProvider.GetStatus(ServiceName) == "Running")
                {
                    var installedVersion = serviceStateProvider.GetInstalledProductVersion(ServiceName);
                    if (!VersionsMatch(installedVersion, instruction.ExpectedVersion))
                    {
                        return RollbackFail(RollbackErrorCategory.PostRollbackVersionMismatch, uninstallExit, installExit);
                    }

                    return new RollbackHelperResult(nameof(RollbackLifecycleState.Succeeded), nameof(RollbackErrorCategory.None), uninstallExit, installExit, DateTimeOffset.UtcNow);
                }

                try { await Task.Delay(1000, cancellationToken); }
                catch (OperationCanceledException) { break; }
            }

            return RollbackFail(RollbackErrorCategory.ServiceUnavailable, uninstallExit, installExit);
        }
    }

    private static RollbackHelperResult RollbackFail(RollbackErrorCategory category, int? uninstallExit, int? installExit) =>
        new(nameof(RollbackLifecycleState.Failed), category.ToString(), uninstallExit, installExit, DateTimeOffset.UtcNow);

    public async Task<UpdateHelperResult> RunAsync(
        UpdateHelperInstruction instruction, TimeSpan installTimeout, TimeSpan serviceWaitTimeout, CancellationToken cancellationToken)
    {
        if (!File.Exists(instruction.StagedInstallerPath))
        {
            return Fail(UpdateErrorCategory.InstallerFailure, null);
        }

        // Held open (FileShare.Read: readers/the installer's own execute-open are fine, writers are
        // not) from the moment we first read the file for hashing all the way through the installer
        // process actually running — closes the TOCTOU window where hash/signature verification and
        // execution each separately re-open the file by path with nothing preventing substitution in
        // between. A non-admin attacker still can't write here (ProgramDataAcl.ProtectFile already
        // restricts the staging directory to LocalSystem/Administrators), but this removes reliance
        // on that ACL being the *only* thing closing the gap.
        FileStream lockStream;
        try
        {
            lockStream = new FileStream(instruction.StagedInstallerPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return Fail(UpdateErrorCategory.InstallerFailure, null);
        }

        using (lockStream)
        {
            var actualHash = ComputeSha256(lockStream);
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

                // Defense in depth, same rationale as UpdateManager.StageAsync: the instruction file's
                // ExpectedPublisherThumbprint ultimately traces back to the server's release descriptor.
                // The helper is the last gate before LocalSystem code execution, so it independently
                // checks the thumbprint against the bridge's own compiled-in allowlist too — not just
                // against whatever this instruction file (however trustworthy its ACL) declares.
                var isPinnedPublisher = pinnedThumbprintOverride is not null
                    ? pinnedThumbprintOverride(instruction.ExpectedPublisherThumbprint!)
                    : Trust.PinnedPublisherThumbprints.Contains(instruction.ExpectedPublisherThumbprint!);
                if (!isPinnedPublisher)
                {
                    return Fail(UpdateErrorCategory.UntrustedPublisher, null);
                }
            }

            var exitCode = await installerRunner.RunAsync(instruction.StagedInstallerPath, installTimeout, cancellationToken);
            if (exitCode is null)
            {
                return Fail(UpdateErrorCategory.InstallerFailure, null);
            }

            return await FinishAsync(instruction, exitCode.Value, serviceWaitTimeout, cancellationToken);
        }
    }

    private async Task<UpdateHelperResult> FinishAsync(
        UpdateHelperInstruction instruction, int exitCode, TimeSpan serviceWaitTimeout, CancellationToken cancellationToken)
    {
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
                if (!string.IsNullOrEmpty(instruction.ExpectedVersion))
                {
                    var installedVersion = serviceStateProvider.GetInstalledProductVersion(ServiceName);
                    if (!VersionsMatch(installedVersion, instruction.ExpectedVersion))
                    {
                        // The installer exited success and the service is Running again, but it is
                        // not running the version this instruction was staged for — e.g. the wrong
                        // (older/different) installer file got staged. Reporting "Succeeded" here
                        // would be a lie the Manager and telemetry would both believe.
                        return new UpdateHelperResult(
                            "InstallFailed", nameof(UpdateErrorCategory.PostInstallVersionMismatch),
                            exitCode, rebootRequired, DateTimeOffset.UtcNow);
                    }
                }

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

    /// <summary>
    /// Compares only Major.Minor.Build — MSI's own significant fields
    /// (<see cref="UpdateVersion.IsValidMsiProductVersion"/>) — so a
    /// FileVersionInfo fourth field (e.g. a build-metadata revision Windows
    /// Installer never considers) can't cause a false mismatch.
    /// </summary>
    private static bool VersionsMatch(string? installedVersion, string expectedVersion)
    {
        if (!UpdateVersion.TryParse(installedVersion, out var installed)) return false;
        if (!UpdateVersion.TryParse(expectedVersion, out var expected)) return false;
        return installed.Major == expected.Major && installed.Minor == expected.Minor && installed.Build == expected.Build;
    }

    private static UpdateHelperResult Fail(UpdateErrorCategory category, int? exitCode) =>
        new("InstallFailed", category.ToString(), exitCode, false, DateTimeOffset.UtcNow);

    private static string ComputeSha256(Stream stream)
    {
        stream.Position = 0;
        using var sha256 = SHA256.Create();
        return Convert.ToHexStringLower(sha256.ComputeHash(stream));
    }
}
