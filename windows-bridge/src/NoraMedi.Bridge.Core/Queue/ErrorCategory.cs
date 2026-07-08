namespace NoraMedi.Bridge.Core.Queue;

/// <summary>
/// Mirrors bridge-agent/src/queue.ts ErrorCategory exactly — used in
/// diagnostics/status output and troubleshooting docs, never in server
/// communication.
/// </summary>
public static class ErrorCategory
{
    public const string BadRequest = "bad_request";
    public const string DeviceNotFound = "device_not_found";
    public const string FileTooLarge = "file_too_large";
    public const string MaxAttemptsExceeded = "max_attempts_exceeded";
    public const string QuarantinedOrphan = "quarantined_orphan";
    public const string QuarantinedMalformedMetadata = "quarantined_malformed_metadata";
    public const string UnsupportedFileType = "unsupported_file_type";
}
