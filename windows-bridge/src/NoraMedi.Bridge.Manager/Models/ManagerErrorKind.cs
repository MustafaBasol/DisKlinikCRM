namespace NoraMedi.Bridge.Manager.Models;

/// <summary>
/// Normalized outcome of a failed IPC call, independent of the raw
/// <c>PipeErrorCodes</c> string or a transport exception. ViewModels branch
/// on this, never on the raw string, so the plain-language label mapping
/// lives in exactly one place (see <see cref="StatusLabels"/>).
/// </summary>
public enum ManagerErrorKind
{
    /// <summary>The named pipe could not be reached at all (Service not running/installed, or connect timed out).</summary>
    ServiceUnavailable,

    /// <summary>The Service answered but refused the operation because the connecting identity is not an administrator.</summary>
    Unauthorized,

    /// <summary>The Service answered but the self-service feature is disabled for this clinic.</summary>
    FeatureDisabled,

    /// <summary>The Service answered "not_found" (e.g. retrying an ingest key or binding that no longer exists).</summary>
    NotFound,

    /// <summary>The request payload was rejected as invalid or too large — normally indicates a Manager bug, not a user mistake.</summary>
    InvalidPayload,

    /// <summary>Anything else — an internal error on the Service side, or an unrecognized error code.</summary>
    Internal,
}
