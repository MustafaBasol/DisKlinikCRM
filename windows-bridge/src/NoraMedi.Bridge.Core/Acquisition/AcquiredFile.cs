namespace NoraMedi.Bridge.Core.Acquisition;

/// <summary>A source file that has been observed stable and is ready to be queued.</summary>
public sealed record AcquiredFile(string SourcePath, FolderBinding Binding);

public sealed record FolderAvailability(string WatchId, bool Available);
