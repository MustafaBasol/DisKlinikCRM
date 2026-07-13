using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Core.Updates;
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

    /// <summary>
    /// Maps a truthful <see cref="UpdateStatusPayload"/> lifecycle/error pair
    /// to a plain label. Never fabricates a progress percentage — the
    /// download byte count, when present, is appended as a plain "X of Y MB"
    /// suffix (see UpdateViewModel), not a synthesized bar value.
    /// VerificationFailed is split by error category: a hash mismatch reads
    /// as an integrity failure, an unsigned/wrong-publisher/tampered
    /// signature reads as a publisher-verification failure — the two are
    /// deliberately distinct so a clinic user's report to support is
    /// actionable.
    /// </summary>
    public static string FromUpdateLifecycle(string lifecycle, string errorCategory) =>
        (Enum.TryParse<UpdateLifecycleState>(lifecycle, out var state) ? state : UpdateLifecycleState.Idle) switch
        {
            UpdateLifecycleState.Checking => Strings.Update_Checking,
            UpdateLifecycleState.UpToDate => Strings.Update_UpToDate,
            UpdateLifecycleState.UpdateAvailable => Strings.Update_Available,
            UpdateLifecycleState.Downloading => Strings.Update_Downloading,
            UpdateLifecycleState.Verifying => Strings.Update_Verifying,
            UpdateLifecycleState.Verified => Strings.Update_ReadyToInstall,
            UpdateLifecycleState.DownloadFailed => Strings.Update_DownloadFailed,
            UpdateLifecycleState.VerificationFailed =>
                errorCategory is "UnsignedPackage" or "WrongPublisher" or "TamperedSignature" ? Strings.Update_PublisherVerificationFailed : Strings.Update_VerificationFailed,
            UpdateLifecycleState.InstallLaunched => Strings.Update_Installing,
            UpdateLifecycleState.Installing => Strings.Update_ServiceRestarting,
            UpdateLifecycleState.Succeeded => Strings.Update_Succeeded,
            UpdateLifecycleState.InstallFailed => Strings.Update_InstallerFailed,
            UpdateLifecycleState.RebootRequired => Strings.Update_RebootRequired,
            UpdateLifecycleState.Interrupted => Strings.Update_Interrupted,
            UpdateLifecycleState.Unsupported => Strings.Update_UnsupportedSourceVersion,
            UpdateLifecycleState.Disabled => Strings.Update_Disabled,
            _ => Strings.Update_Checking,
        };
}
