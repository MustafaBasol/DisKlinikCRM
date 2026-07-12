namespace NoraMedi.Bridge.Core.Updates;

/// <summary>
/// Configuration for the update subsystem. Defaults are the safe,
/// production-shaped defaults — anything that would loosen a security
/// property (insecure HTTP, unsigned installs) requires an explicit opt-in
/// and is documented as test-only in docs/update-architecture.md.
/// </summary>
public sealed record UpdateOptions
{
    /// <summary>Root directory for staged downloads and state.json — always a subdirectory of the bridge's ProgramData root.</summary>
    public required string UpdatesDirectory { get; init; }

    /// <summary>Hard byte-count ceiling for a single downloaded installer. Installers are tens of MB; this gives headroom without accepting an unbounded stream.</summary>
    public long MaxDownloadBytes { get; init; } = 300L * 1024 * 1024;

    public int DownloadTimeoutSeconds { get; init; } = 300;

    /// <summary>Same rule as the server's isAcceptableDownloadUrl: plain HTTP is only ever accepted for localhost/127.0.0.1, and only when this is explicitly true (never in a production deployment).</summary>
    public bool AllowInsecureLocalhostHttp { get; init; }

    /// <summary>
    /// Production default: an installer must carry a valid Authenticode
    /// signature from the publisher thumbprint the server's own release
    /// descriptor declares (authenticated over the paired bridge's bearer
    /// credential — see <see cref="ServerUpdateRelease.PublisherThumbprint"/>).
    /// There is no separate client-side pinned thumbprint: the trust anchor
    /// is "does this specific release's declared signer match its actual
    /// signature", not a static local value, so a key rotation only ever
    /// requires an operational server-side deploy (see
    /// docs/update-architecture.md "Trust model"). Only ever false for the
    /// ephemeral local test-signing harness.
    /// </summary>
    public bool RequireTrustedSignature { get; init; } = true;

    public int CheckIntervalMinutes { get; init; } = 240;

    public int StartupJitterSeconds { get; init; } = 600;

    public int BackoffBaseMs { get; init; } = 60_000;

    public int BackoffCapMs { get; init; } = 3_600_000;

    /// <summary>How long the helper process is given to run the silent installer and reach SCM Running before the launch is declared failed.</summary>
    public int InstallTimeoutSeconds { get; init; } = 180;

    /// <summary>How many days a staged/rejected installer file is kept before the retention sweep deletes it.</summary>
    public int StagedFileRetentionDays { get; init; } = 14;
}
