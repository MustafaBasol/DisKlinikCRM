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

    public string SpoolDirectory => Path.Combine(ProgramDataRoot, "spool");

    public string QueueDatabasePath => Path.Combine(ProgramDataRoot, "queue.db");

    public string CredentialPath => Path.Combine(ProgramDataRoot, "credential.bin");

    public string InstallationIdPath => Path.Combine(ProgramDataRoot, "installation-id.txt");

    public string BindingsPath => Path.Combine(ProgramDataRoot, "bindings.json");
}
