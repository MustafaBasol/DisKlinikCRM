namespace NoraMedi.Bridge.Core.Diagnostics;

/// <summary>
/// The full contents of the Named Pipe ExportDiagnostics operation and the
/// on-disk status snapshot. Every field here is allowlisted as safe: no
/// folder paths (watchId only), no credential, no patient data, no original
/// file names, no DICOM tags.
/// </summary>
public sealed record DiagnosticsSnapshot(
    string AgentVersion,
    string InstallationId,
    DateTimeOffset StartedAt,
    string ConnectionState,
    string AuthState,
    DateTimeOffset? LastHeartbeatAt,
    int PendingCount,
    int ProcessingCount,
    int FailedCount,
    int CompletedCount,
    IReadOnlyList<WatchFolderDiagnostics> WatchedFolders);

public sealed record WatchFolderDiagnostics(string WatchId, bool Available);
