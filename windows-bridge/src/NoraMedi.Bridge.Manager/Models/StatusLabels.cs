using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Resources;

namespace NoraMedi.Bridge.Manager.Models;

/// <summary>
/// The only place internal state/error codes are translated into the
/// plain-language labels a clinic user sees. Every screen must go through
/// here rather than inventing its own wording, and no raw pipe error code,
/// GUID, or exception message may reach the UI outside a details expander.
/// Values are sourced from Strings.resx (see Resources/Strings.Designer.cs)
/// so a future translation pass covers these too.
/// </summary>
public static class StatusLabels
{
    public static string NotConnected => Strings.Status_NotConnected;
    public static string Connected => Strings.Status_Connected;
    public static string ServiceUnavailable => Strings.Status_ServiceUnavailable;
    public static string FolderInaccessible => Strings.Status_FolderInaccessible;
    public static string ConnectionRequired => Strings.Status_ConnectionRequired;
    public static string ActionRequired => Strings.Status_ActionRequired;

    /// <summary>Maps <c>ServiceStatusPayload.ConnectionState</c> ("disabled" | "online" | "offline") to a dashboard status label. "disabled" is handled by the caller as its own full-screen gate, not this label, but is included for completeness.</summary>
    public static string FromConnectionState(string? connectionState) => connectionState switch
    {
        "online" => Connected,
        "offline" => NotConnected,
        "disabled" => NotConnected,
        _ => ServiceUnavailable,
    };

    /// <summary>Maps a failed IPC call's normalized error kind to the plain label to show for that action.</summary>
    public static string FromErrorKind(ManagerErrorKind kind) => kind switch
    {
        ManagerErrorKind.ServiceUnavailable => ServiceUnavailable,
        ManagerErrorKind.Unauthorized => ActionRequired,
        ManagerErrorKind.FeatureDisabled => NotConnected,
        ManagerErrorKind.NotFound => ConnectionRequired,
        ManagerErrorKind.InvalidPayload => ActionRequired,
        ManagerErrorKind.Internal => ServiceUnavailable,
        _ => ServiceUnavailable,
    };

    public static string Pairing_InvalidOrExpiredCode => Strings.Pairing_InvalidOrExpiredCode;
    public static string Pairing_RateLimited => Strings.Pairing_RateLimited;
    public static string Pairing_InvalidRequest => Strings.Pairing_InvalidRequest;
    public static string Pairing_ServerError => Strings.Pairing_ServerError;
    public static string Pairing_NetworkFailure => Strings.Pairing_NetworkFailure;
    public static string Pairing_FeatureDisabled => Msg_FeatureDisabled;

    private static string Msg_FeatureDisabled => Strings.Msg_FeatureDisabled;

    /// <summary>Maps a failed pairing attempt's typed reason to the plain, actionable label shown under the pairing code field.</summary>
    public static string FromPairingErrorCategory(PairingErrorCategory? category) => category switch
    {
        PairingErrorCategory.FeatureDisabled => Pairing_FeatureDisabled,
        PairingErrorCategory.InvalidOrExpiredCode => Pairing_InvalidOrExpiredCode,
        PairingErrorCategory.RateLimited => Pairing_RateLimited,
        PairingErrorCategory.InvalidRequest => Pairing_InvalidRequest,
        PairingErrorCategory.ServerError => Pairing_ServerError,
        PairingErrorCategory.NetworkFailure => Pairing_NetworkFailure,
        _ => Pairing_InvalidOrExpiredCode,
    };
}
