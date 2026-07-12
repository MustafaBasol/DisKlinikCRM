namespace NoraMedi.Bridge.Core.Updates;

/// <summary>
/// The entire instruction surface handed to NoraMedi.Bridge.UpdateHelper.
/// Written by the Service to an ACL-protected file under
/// <c>updates\</c> and passed to the helper as a single file-path argument
/// (never command-line text) — the helper re-validates every field itself
/// before acting on it (see docs/update-architecture.md "Self-update
/// handoff"). Deliberately has no "arguments"/"command"/"executable" field:
/// the helper only ever resolves and runs the one fixed installer file this
/// instruction names, with one fixed, hardcoded silent-install command line.
/// </summary>
public sealed record UpdateHelperInstruction(
    string StagedInstallerPath,
    string ExpectedSha256,
    string ExpectedVersion,
    bool RequireTrustedSignature,
    string? ExpectedPublisherThumbprint);

/// <summary>
/// Written by the helper on completion; read back by the Service's
/// background loop to transition the persisted <see cref="UpdateState"/> to
/// its true terminal state. Bounded, redacted — never a full command line
/// or exception detail beyond a short category.
/// </summary>
public sealed record UpdateHelperResult(
    string Outcome,
    string ErrorCategory,
    int? ProcessExitCode,
    bool RebootRequired,
    DateTimeOffset CompletedAtUtc);
