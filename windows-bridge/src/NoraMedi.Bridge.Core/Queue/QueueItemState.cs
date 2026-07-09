namespace NoraMedi.Bridge.Core.Queue;

public enum QueueItemState
{
    Pending,
    Processing,
    Failed,
    Completed,
}

public static class QueueItemStateExtensions
{
    public static string ToDbValue(this QueueItemState state) => state switch
    {
        QueueItemState.Pending => "pending",
        QueueItemState.Processing => "processing",
        QueueItemState.Failed => "failed",
        QueueItemState.Completed => "completed",
        _ => throw new ArgumentOutOfRangeException(nameof(state)),
    };

    public static QueueItemState ParseDbValue(string value) => value switch
    {
        "pending" => QueueItemState.Pending,
        "processing" => QueueItemState.Processing,
        "failed" => QueueItemState.Failed,
        "completed" => QueueItemState.Completed,
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, "Unknown queue item state"),
    };
}
