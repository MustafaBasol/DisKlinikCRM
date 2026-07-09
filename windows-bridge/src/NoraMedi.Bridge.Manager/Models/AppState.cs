namespace NoraMedi.Bridge.Manager.Models;

/// <summary>
/// The Manager's top-level screen state, derived from the latest
/// <c>GetServiceStatus</c> result (and, transiently, from an "unauthorized"
/// response to a privileged operation). Exactly one of these is active at a
/// time and gates which screen/actions are shown.
/// </summary>
public enum AppState
{
    /// <summary>No status fetched yet (app just launched).</summary>
    Initializing,

    /// <summary>The named pipe could not be reached — Service not running or not installed.</summary>
    ServiceUnavailable,

    /// <summary>The Service answered but the self-service feature is off for this clinic.</summary>
    FeatureDisabled,

    /// <summary>Service reachable, feature on, but not yet paired (ConnectionState == "offline").</summary>
    NotConnected,

    /// <summary>Service reachable, feature on, paired and authenticated (ConnectionState == "online").</summary>
    Connected,

    /// <summary>A privileged operation was refused because the Manager isn't running elevated.</summary>
    ActionRequiredElevation,
}
