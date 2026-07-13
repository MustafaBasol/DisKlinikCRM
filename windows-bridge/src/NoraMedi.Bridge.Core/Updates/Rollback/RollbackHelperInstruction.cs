namespace NoraMedi.Bridge.Core.Updates.Rollback;

/// <summary>
/// The entire instruction surface handed to NoraMedi.Bridge.UpdateHelper for
/// a rollback run (distinct from <see cref="UpdateHelperInstruction"/>, and
/// launched with a distinguishing second argument — see
/// docs/update-runbook.md "Rollback execution"). Every field is resolved
/// server-side-then-locally-cached by <see cref="RollbackManager"/>, never
/// caller/IPC-suppliable — the IPC rollback trigger takes no parameters, the
/// same structural guarantee <see cref="UpdateHelperInstruction"/> already
/// gives the forward-update path.
/// </summary>
public sealed record RollbackHelperInstruction(
    string CachedInstallerPath,
    string ExpectedSha256,
    string ExpectedVersion,
    string ExpectedPublisherThumbprint,
    /// <summary>Fixed compiled-in constant (Package.wxs UpgradeCode) — used to find and uninstall the currently-installed (unhealthy) product before installing the rollback target, since WiX's MajorUpgrade element blocks a same-UpgradeCode downgrade otherwise.</summary>
    string UpgradeCode);

public sealed record RollbackHelperResult(
    string Outcome,
    string ErrorCategory,
    int? UninstallExitCode,
    int? InstallExitCode,
    DateTimeOffset CompletedAtUtc);
