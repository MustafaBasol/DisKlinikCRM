namespace NoraMedi.Bridge.Core.Queue;

public sealed record QueueItemRecord(
    string IngestKey,
    string WatchId,
    string DeviceId,
    string? Modality,
    string ContentType,
    string SafeExtension,
    QueueItemState State,
    DateTimeOffset CreatedAt,
    int AttemptCount,
    DateTimeOffset NextAttemptAt,
    string? LastErrorCategory,
    string SpoolFilePath);
