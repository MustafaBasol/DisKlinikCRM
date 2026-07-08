using NoraMedi.Bridge.Core.Queue;

namespace NoraMedi.Bridge.Core.Tests.Queue;

public class SqliteBridgeQueueTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-queue-").FullName;
    private static readonly byte[] JpegBytes = [0xFF, 0xD8, 0xFF, 0x01, 0x02, 0x03];

    private SqliteBridgeQueue NewQueue() =>
        new(Path.Combine(_root, "spool"), Path.Combine(_root, "queue.db"));

    [Fact]
    public void Enqueue_ValidFile_CreatesPendingRowAndSpoolFile()
    {
        using var queue = NewQueue();
        var item = queue.Enqueue(JpegBytes, "watch-1", "device-1", "IO");

        Assert.NotNull(item);
        Assert.Equal(QueueItemState.Pending, item!.State);
        Assert.Equal("image/jpeg", item.ContentType);
        Assert.True(File.Exists(item.SpoolFilePath));
        Assert.Equal(JpegBytes, File.ReadAllBytes(item.SpoolFilePath));
    }

    [Fact]
    public void Enqueue_UnsupportedContent_ReturnsNullAndPersistsNothing()
    {
        using var queue = NewQueue();
        var item = queue.Enqueue([0x00, 0x01, 0x02], "watch-1", "device-1", null);

        Assert.Null(item);
        Assert.Empty(queue.ListReadyPending());
    }

    [Fact]
    public void Enqueue_DuplicateContent_IsNoOpSecondTime()
    {
        using var queue = NewQueue();
        var first = queue.Enqueue(JpegBytes, "watch-1", "device-1", "IO");
        var second = queue.Enqueue(JpegBytes, "watch-1", "device-1", "IO");

        Assert.NotNull(first);
        Assert.Null(second);
        Assert.Single(queue.ListReadyPending());
    }

    [Fact]
    public void ListReadyPending_RespectsNextAttemptAt()
    {
        using var queue = NewQueue();
        var item = queue.Enqueue(JpegBytes, "watch-1", "device-1", "IO")!;
        queue.MoveToProcessing(item.IngestKey);
        queue.RetryLater(item.IngestKey, attemptCount: 1, nextAttemptAt: DateTimeOffset.UtcNow.AddHours(1));

        Assert.Empty(queue.ListReadyPending(DateTimeOffset.UtcNow));
        Assert.Single(queue.ListReadyPending(DateTimeOffset.UtcNow.AddHours(2)));
    }

    [Fact]
    public void FullLifecycle_PendingProcessingCompleted_TransitionsCorrectly()
    {
        using var queue = NewQueue();
        var item = queue.Enqueue(JpegBytes, "watch-1", "device-1", "IO")!;

        queue.MoveToProcessing(item.IngestKey);
        Assert.Equal(QueueItemState.Processing, queue.Find(item.IngestKey)!.State);

        queue.Complete(item.IngestKey);
        var completed = queue.Find(item.IngestKey)!;
        Assert.Equal(QueueItemState.Completed, completed.State);
        // Success frees the spooled image bytes but the state row remains for diagnostics.
        Assert.False(Directory.Exists(Path.GetDirectoryName(item.SpoolFilePath)));
    }

    [Fact]
    public void FullLifecycle_PermanentFailure_KeepsFileAndRecordsErrorCategory()
    {
        using var queue = NewQueue();
        var item = queue.Enqueue(JpegBytes, "watch-1", "device-1", "IO")!;
        queue.MoveToProcessing(item.IngestKey);

        queue.Fail(item.IngestKey, ErrorCategory.DeviceNotFound);

        var failed = queue.Find(item.IngestKey)!;
        Assert.Equal(QueueItemState.Failed, failed.State);
        Assert.Equal(ErrorCategory.DeviceNotFound, failed.LastErrorCategory);
        Assert.True(File.Exists(item.SpoolFilePath));
    }

    [Fact]
    public void RequeueFailed_ResetsAttemptsAndReturnsToPending()
    {
        using var queue = NewQueue();
        var item = queue.Enqueue(JpegBytes, "watch-1", "device-1", "IO")!;
        queue.MoveToProcessing(item.IngestKey);
        queue.Fail(item.IngestKey, ErrorCategory.MaxAttemptsExceeded, attemptCount: 100);

        var requeued = queue.RequeueFailed(item.IngestKey);

        Assert.Equal(QueueItemState.Pending, requeued.State);
        Assert.Equal(0, requeued.AttemptCount);
        Assert.Null(requeued.LastErrorCategory);
        Assert.Single(queue.ListReadyPending());
    }

    [Fact]
    public void RecoverOnStartup_ItemLeftInProcessing_ReturnsToPending()
    {
        var spoolRoot = Path.Combine(_root, "spool");
        var dbPath = Path.Combine(_root, "queue.db");
        string ingestKey;
        using (var queue = new SqliteBridgeQueue(spoolRoot, dbPath))
        {
            var item = queue.Enqueue(JpegBytes, "watch-1", "device-1", "IO")!;
            ingestKey = item.IngestKey;
            queue.MoveToProcessing(ingestKey); // simulates a crash mid-upload: no Complete()/Fail() call follows
        }

        using var recovered = new SqliteBridgeQueue(spoolRoot, dbPath);
        recovered.RecoverOnStartup();

        Assert.Equal(QueueItemState.Pending, recovered.Find(ingestKey)!.State);
    }

    [Fact]
    public void RecoverOnStartup_OrphanedStagingDirWithNoDbRow_IsDeletedWithoutCrashing()
    {
        var spoolRoot = Path.Combine(_root, "spool");
        var dbPath = Path.Combine(_root, "queue.db");
        Directory.CreateDirectory(spoolRoot);
        var orphanStaging = Path.Combine(spoolRoot, ".staging-" + new string('a', 64));
        Directory.CreateDirectory(orphanStaging);
        File.WriteAllBytes(Path.Combine(orphanStaging, "file.jpg"), JpegBytes);

        using var queue = new SqliteBridgeQueue(spoolRoot, dbPath);
        queue.RecoverOnStartup();

        Assert.False(Directory.Exists(orphanStaging));
    }

    [Fact]
    public void RecoverOnStartup_PendingRowWithMissingSpoolFile_IsQuarantinedNotDeleted()
    {
        var spoolRoot = Path.Combine(_root, "spool");
        var dbPath = Path.Combine(_root, "queue.db");
        string ingestKey;
        using (var queue = new SqliteBridgeQueue(spoolRoot, dbPath))
        {
            var item = queue.Enqueue(JpegBytes, "watch-1", "device-1", "IO")!;
            ingestKey = item.IngestKey;
            Directory.Delete(Path.GetDirectoryName(item.SpoolFilePath)!, recursive: true);
        }

        using var recovered = new SqliteBridgeQueue(spoolRoot, dbPath);
        recovered.RecoverOnStartup();

        var record = recovered.Find(ingestKey)!;
        Assert.Equal(QueueItemState.Failed, record.State);
        Assert.Equal(ErrorCategory.QuarantinedOrphan, record.LastErrorCategory);
    }

    [Fact]
    public void RecoverOnStartup_StagingDirCrashedBeforeRename_IsRecoveredIntoFinalLocation()
    {
        var spoolRoot = Path.Combine(_root, "spool");
        var dbPath = Path.Combine(_root, "queue.db");

        // Simulate the exact crash window Enqueue leaves: DB row inserted,
        // but the rename from staging to final directory never happened.
        string ingestKey;
        using (var queue = new SqliteBridgeQueue(spoolRoot, dbPath))
        {
            var probe = queue.Enqueue(JpegBytes, "watch-1", "device-1", "IO")!;
            ingestKey = probe.IngestKey;
            var finalDir = Path.GetDirectoryName(probe.SpoolFilePath)!;
            var stagingDir = Path.Combine(spoolRoot, $".staging-{ingestKey}");
            Directory.Move(finalDir, stagingDir);
        }

        using var recovered = new SqliteBridgeQueue(spoolRoot, dbPath);
        recovered.RecoverOnStartup();

        var record = recovered.Find(ingestKey)!;
        Assert.Equal(QueueItemState.Pending, record.State);
        Assert.True(File.Exists(record.SpoolFilePath));
    }

    [Fact]
    public void Counts_ReflectsAllFourStates()
    {
        using var queue = NewQueue();
        var pending = queue.Enqueue(JpegBytes, "watch-1", "device-1", "IO")!;
        var processing = queue.Enqueue([0xFF, 0xD8, 0xFF, 0x09], "watch-1", "device-1", "IO")!;
        var failed = queue.Enqueue([0xFF, 0xD8, 0xFF, 0x08], "watch-1", "device-1", "IO")!;
        var completed = queue.Enqueue([0xFF, 0xD8, 0xFF, 0x07], "watch-1", "device-1", "IO")!;

        queue.MoveToProcessing(processing.IngestKey);
        queue.MoveToProcessing(failed.IngestKey);
        queue.Fail(failed.IngestKey, ErrorCategory.BadRequest);
        queue.MoveToProcessing(completed.IngestKey);
        queue.Complete(completed.IngestKey);
        _ = pending;

        var counts = queue.Counts();
        Assert.Equal(1, counts[QueueItemState.Pending]);
        Assert.Equal(1, counts[QueueItemState.Processing]);
        Assert.Equal(1, counts[QueueItemState.Failed]);
        Assert.Equal(1, counts[QueueItemState.Completed]);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
