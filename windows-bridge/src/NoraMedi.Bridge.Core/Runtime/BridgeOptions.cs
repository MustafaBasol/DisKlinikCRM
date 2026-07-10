namespace NoraMedi.Bridge.Core.Runtime;

/// <summary>
/// All runtime configuration for one bridge installation. <see cref="Enabled"/>
/// is the release gate for the whole self-service product (spec section
/// "feature hidden until full release gate passes") — false means the
/// service installs and starts cleanly, answers IPC status queries, but
/// never watches folders, never calls the server, and never spends a
/// credential. Defaults to false everywhere on purpose.
/// </summary>
public sealed record BridgeOptions
{
    public bool Enabled { get; init; }

    public required string ServerUrl { get; init; }

    public required string ProgramDataRoot { get; init; }

    public string PipeName { get; init; } = "NoraMediBridge";

    public int HeartbeatIntervalSeconds { get; init; } = 60;

    public int StabilityMs { get; init; } = 5000;

    public int MaxAttempts { get; init; } = 100;

    public int BackoffBaseMs { get; init; } = 60_000;

    public int BackoffCapMs { get; init; } = 900_000;

    public int DrainPollMs { get; init; } = 5_000;

    public string? ServiceAccountSid { get; init; }

    /// <summary>Largest single acquired file the bridge will spool, in bytes. Rejected above this — never read into memory.</summary>
    public long MaxAcquiredFileSizeBytes { get; init; } = 200L * 1024 * 1024;

    /// <summary>Total on-disk budget for spooled (pending/processing/failed) item bytes, in bytes.</summary>
    public long MaxSpoolBytes { get; init; } = 5L * 1024 * 1024 * 1024;

    /// <summary>Minimum free space that must remain on the spool volume after admitting a new item.</summary>
    public long MinFreeDiskBytes { get; init; } = 500L * 1024 * 1024;

    /// <summary>How long a permanently-failed item (row + spool file) is kept for troubleshooting before being purged.</summary>
    public int FailedRetentionDays { get; init; } = 30;

    /// <summary>How long a completed item's row (file already deleted) is kept before being purged.</summary>
    public int CompletedRetentionDays { get; init; } = 7;

    public string SpoolDirectory => Path.Combine(ProgramDataRoot, "spool");

    public string QueueDatabasePath => Path.Combine(ProgramDataRoot, "queue.db");

    public string CredentialPath => Path.Combine(ProgramDataRoot, "credential.bin");

    public string InstallationIdPath => Path.Combine(ProgramDataRoot, "installation-id.txt");

    public string BindingsPath => Path.Combine(ProgramDataRoot, "bindings.json");

    /// <summary>
    /// Scheme+host+port only — never the path/query — so it's safe to put in
    /// a startup log line. Exists so a support engineer can see, without
    /// reading appsettings.json on disk, exactly which server this running
    /// process will actually call; a misconfigured or ignored override
    /// (e.g. editing appsettings.Development.json when the service runs in
    /// the default Production environment) is otherwise invisible until a
    /// pairing/upload attempt inexplicably fails.
    /// </summary>
    public string SafeServerUrlOrigin =>
        Uri.TryCreate(ServerUrl, UriKind.Absolute, out var uri) ? uri.GetLeftPart(UriPartial.Authority) : "invalid";
}
