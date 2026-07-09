namespace NoraMedi.Bridge.Manager.Services;

/// <summary>
/// Single source of truth for values the Manager needs to agree with the
/// Service on. The pipe name mirrors <c>BridgeOptions.PipeName</c>'s default
/// in NoraMedi.Bridge.Core/Runtime/BridgeOptions.cs — keep both in sync if
/// that default ever changes.
/// </summary>
public static class BridgeManagerConstants
{
    public const string DefaultPipeName = "NoraMediBridge";

    /// <summary>How long the Manager waits for the Service to accept a pipe connection before treating it as unavailable.</summary>
    public const int ConnectTimeoutMs = 3000;

    /// <summary>Idle poll interval for the status dashboard.</summary>
    public static readonly TimeSpan StatusPollInterval = TimeSpan.FromSeconds(5);
}
