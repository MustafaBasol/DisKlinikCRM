using System.Threading;
using Microsoft.Data.Sqlite;
using NoraMedi.Bridge.Core.Security;
using NoraMedi.Bridge.Core.Validation;

namespace NoraMedi.Bridge.Core.Queue;

/// <summary>
/// Persistent, crash-safe ingest queue. Item bytes live in a private spool
/// directory (one subfolder per ingestKey, ACL-protected by the caller —
/// see Security.ProgramDataAcl); item metadata and state machine live in a
/// SQLite database in the same root. The pairing of "file on disk" +
/// "row in the database" is made crash-safe by writing the file to a
/// `.staging-&lt;ingestKey&gt;` directory first and only recording the DB row
/// pointing at the final path afterward — <see cref="RecoverOnStartup"/>
/// reconciles any inconsistency left by a mid-operation crash, and NEVER
/// silently deletes an acquired image.
/// </summary>
public sealed class SqliteBridgeQueue : IDisposable
{
    private readonly string _spoolRoot;
    private readonly string? _extraAccountSid;
    private readonly SqliteConnection _connection;
    private readonly Lock _gate = new();

    public SqliteBridgeQueue(string spoolRoot, string databasePath, string? extraAccountSid = null)
    {
        _spoolRoot = spoolRoot;
        _extraAccountSid = extraAccountSid;
        // Protects the spool tree itself even though BridgeOrchestrator already
        // locks down ProgramDataRoot before constructing this queue — a second,
        // explicit layer so this type is safe to use standalone (as the tests do).
        ProgramDataAcl.ProtectDirectory(_spoolRoot, _extraAccountSid);
        Directory.CreateDirectory(Path.GetDirectoryName(databasePath) ?? _spoolRoot);

        // Pooling=False: this connection is held for the queue's entire lifetime
        // (single owner, no benefit from pooling), and pooling was otherwise
        // keeping the native sqlite3 handle open after Dispose — which breaks
        // clean shutdown/uninstall scenarios where the ProgramData tree must
        // be removable immediately.
        _connection = new SqliteConnection($"Data Source={databasePath};Pooling=False");
        _connection.Open();
        using (var pragma = _connection.CreateCommand())
        {
            // TRUNCATE (not WAL): this queue has exactly one writer (the owning
            // service process) so WAL's concurrent-reader benefit doesn't apply,
            // and WAL requires a memory-mapped -shm file that some AV/EDR
            // products and restricted/virtualized filesystems block or hang on —
            // a real risk on clinic PCs, not just this build environment.
            pragma.CommandText = "PRAGMA journal_mode=TRUNCATE; PRAGMA synchronous=NORMAL;";
            pragma.ExecuteNonQuery();
        }
        Initialize();
        ProgramDataAcl.ProtectFile(databasePath, _extraAccountSid);
    }

    private void Initialize()
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS queue_items (
                ingest_key TEXT PRIMARY KEY,
                watch_id TEXT NOT NULL,
                device_id TEXT NOT NULL,
                modality TEXT NULL,
                content_type TEXT NOT NULL,
                safe_extension TEXT NOT NULL,
                state TEXT NOT NULL,
                created_at TEXT NOT NULL,
                attempt_count INTEGER NOT NULL,
                next_attempt_at TEXT NOT NULL,
                last_error_category TEXT NULL,
                spool_file_path TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_queue_items_state ON queue_items(state, next_attempt_at);
            """;
        cmd.ExecuteNonQuery();
    }

    private string ItemDir(string ingestKey) => Path.Combine(_spoolRoot, ingestKey);

    private string StagingDir(string ingestKey) => Path.Combine(_spoolRoot, $".staging-{ingestKey}");

    /// <summary>
    /// Validates, hashes, and enqueues acquired bytes. Returns null (no-op,
    /// logged by caller) for unsupported content or an already-known
    /// ingestKey — the source file is never touched either way.
    /// </summary>
    public QueueItemRecord? Enqueue(ReadOnlySpan<byte> bytes, string watchId, string deviceId, string? modality)
    {
        var contentType = FileSignatureValidator.DetectContentType(bytes);
        if (contentType is null) return null;
        var safeExtension = FileSignatureValidator.SafeExtensionFor(contentType)!;
        var ingestKey = Hashing.IngestKeyHasher.ComputeHex(bytes);

        lock (_gate)
        {
            if (Exists(ingestKey)) return null;

            var stagingDir = StagingDir(ingestKey);
            if (Directory.Exists(stagingDir)) Directory.Delete(stagingDir, recursive: true);
            Directory.CreateDirectory(stagingDir);
            var stagedFile = Path.Combine(stagingDir, $"file{safeExtension}");
            File.WriteAllBytes(stagedFile, bytes.ToArray());

            var now = DateTimeOffset.UtcNow;
            var finalDir = ItemDir(ingestKey);
            var finalFile = Path.Combine(finalDir, $"file{safeExtension}");
            var sizeBytes = (long)bytes.Length;

            InsertRow(ingestKey, watchId, deviceId, modality, contentType, safeExtension, now, finalFile, sizeBytes);
            Directory.Move(stagingDir, finalDir);

            return new QueueItemRecord(ingestKey, watchId, deviceId, modality, contentType, safeExtension,
                QueueItemState.Pending, now, 0, now, null, finalFile, sizeBytes);
        }
    }

    private bool Exists(string ingestKey)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = "SELECT 1 FROM queue_items WHERE ingest_key = $key";
        cmd.Parameters.AddWithValue("$key", ingestKey);
        return cmd.ExecuteScalar() is not null;
    }

    private void InsertRow(string ingestKey, string watchId, string deviceId, string? modality,
        string contentType, string safeExtension, DateTimeOffset now, string spoolFilePath, long sizeBytes)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = """
            INSERT INTO queue_items
                (ingest_key, watch_id, device_id, modality, content_type, safe_extension,
                 state, created_at, attempt_count, next_attempt_at, last_error_category, spool_file_path, size_bytes)
            VALUES
                ($key, $watch, $device, $modality, $contentType, $ext,
                 $state, $createdAt, 0, $nextAttempt, NULL, $spoolPath, $size)
            """;
        cmd.Parameters.AddWithValue("$key", ingestKey);
        cmd.Parameters.AddWithValue("$watch", watchId);
        cmd.Parameters.AddWithValue("$device", deviceId);
        cmd.Parameters.AddWithValue("$modality", (object?)modality ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$contentType", contentType);
        cmd.Parameters.AddWithValue("$ext", safeExtension);
        cmd.Parameters.AddWithValue("$state", QueueItemState.Pending.ToDbValue());
        cmd.Parameters.AddWithValue("$createdAt", now.ToString("O"));
        cmd.Parameters.AddWithValue("$nextAttempt", now.ToString("O"));
        cmd.Parameters.AddWithValue("$spoolPath", spoolFilePath);
        cmd.Parameters.AddWithValue("$size", sizeBytes);
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// Sum of on-disk bytes for items that still occupy spool storage
    /// (pending/processing/failed — completed items have already had their
    /// spool directory deleted by <see cref="Complete"/>). Used as an admission
    /// check before writing a newly acquired file — see BridgeOrchestrator.
    /// </summary>
    public long TotalSpoolBytes()
    {
        lock (_gate)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = """
                SELECT COALESCE(SUM(size_bytes), 0) FROM queue_items
                WHERE state IN ($pending, $processing, $failed)
                """;
            cmd.Parameters.AddWithValue("$pending", QueueItemState.Pending.ToDbValue());
            cmd.Parameters.AddWithValue("$processing", QueueItemState.Processing.ToDbValue());
            cmd.Parameters.AddWithValue("$failed", QueueItemState.Failed.ToDbValue());
            return Convert.ToInt64(cmd.ExecuteScalar());
        }
    }

    /// <summary>
    /// Deletes failed items (row + any remaining spool file) older than
    /// <paramref name="failedRetention"/> and completed rows (file already
    /// gone) older than <paramref name="completedRetention"/>, so the queue
    /// database and spool tree cannot grow unbounded from permanently failed
    /// or long-completed items. Pending/processing items are never purged.
    /// </summary>
    public void PurgeExpired(DateTimeOffset now, TimeSpan failedRetention, TimeSpan completedRetention)
    {
        lock (_gate)
        {
            PurgeState(QueueItemState.Failed, now - failedRetention, deleteSpoolDir: true);
            PurgeState(QueueItemState.Completed, now - completedRetention, deleteSpoolDir: false);
        }
    }

    private void PurgeState(QueueItemState state, DateTimeOffset cutoff, bool deleteSpoolDir)
    {
        if (deleteSpoolDir)
        {
            foreach (var record in ListByState(state))
            {
                if (record.CreatedAt > cutoff) continue;
                if (Directory.Exists(ItemDir(record.IngestKey)))
                {
                    Directory.Delete(ItemDir(record.IngestKey), recursive: true);
                }
            }
        }

        using var cmd = _connection.CreateCommand();
        cmd.CommandText = "DELETE FROM queue_items WHERE state = $state AND created_at <= $cutoff";
        cmd.Parameters.AddWithValue("$state", state.ToDbValue());
        cmd.Parameters.AddWithValue("$cutoff", cutoff.ToString("O"));
        cmd.ExecuteNonQuery();
    }

    public IReadOnlyList<QueueItemRecord> ListReadyPending(DateTimeOffset? now = null)
    {
        var cutoff = now ?? DateTimeOffset.UtcNow;
        lock (_gate)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = """
                SELECT * FROM queue_items
                WHERE state = $state AND next_attempt_at <= $now
                ORDER BY created_at ASC
                """;
            cmd.Parameters.AddWithValue("$state", QueueItemState.Pending.ToDbValue());
            cmd.Parameters.AddWithValue("$now", cutoff.ToString("O"));
            return ReadAll(cmd);
        }
    }

    public IReadOnlyList<QueueItemRecord> ListByState(QueueItemState state)
    {
        lock (_gate)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT * FROM queue_items WHERE state = $state ORDER BY created_at ASC";
            cmd.Parameters.AddWithValue("$state", state.ToDbValue());
            return ReadAll(cmd);
        }
    }

    public QueueItemRecord? Find(string ingestKey)
    {
        lock (_gate)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT * FROM queue_items WHERE ingest_key = $key";
            cmd.Parameters.AddWithValue("$key", ingestKey);
            return ReadAll(cmd).FirstOrDefault();
        }
    }

    public void MoveToProcessing(string ingestKey) => SetState(ingestKey, QueueItemState.Processing);

    /// <summary>Success: marks completed and frees the spooled image bytes (row kept for diagnostics).</summary>
    public void Complete(string ingestKey)
    {
        lock (_gate)
        {
            var record = Find(ingestKey) ?? throw new InvalidOperationException($"Unknown ingestKey {ingestKey}");
            SetStateInternal(ingestKey, QueueItemState.Completed);
            if (Directory.Exists(ItemDir(ingestKey)))
            {
                Directory.Delete(ItemDir(ingestKey), recursive: true);
            }
            _ = record;
        }
    }

    /// <summary>Retryable failure: back to pending with updated attempt bookkeeping.</summary>
    public void RetryLater(string ingestKey, int attemptCount, DateTimeOffset nextAttemptAt)
    {
        lock (_gate)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = """
                UPDATE queue_items
                SET state = $state, attempt_count = $attempts, next_attempt_at = $next
                WHERE ingest_key = $key
                """;
            cmd.Parameters.AddWithValue("$state", QueueItemState.Pending.ToDbValue());
            cmd.Parameters.AddWithValue("$attempts", attemptCount);
            cmd.Parameters.AddWithValue("$next", nextAttemptAt.ToString("O"));
            cmd.Parameters.AddWithValue("$key", ingestKey);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>Permanent failure: item and its file are kept under failed/ for troubleshooting, never deleted.</summary>
    public void Fail(string ingestKey, string errorCategory, int? attemptCount = null)
    {
        lock (_gate)
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = attemptCount is null
                ? "UPDATE queue_items SET state = $state, last_error_category = $err WHERE ingest_key = $key"
                : "UPDATE queue_items SET state = $state, last_error_category = $err, attempt_count = $attempts WHERE ingest_key = $key";
            cmd.Parameters.AddWithValue("$state", QueueItemState.Failed.ToDbValue());
            cmd.Parameters.AddWithValue("$err", errorCategory);
            cmd.Parameters.AddWithValue("$key", ingestKey);
            if (attemptCount is not null) cmd.Parameters.AddWithValue("$attempts", attemptCount.Value);
            cmd.ExecuteNonQuery();
        }
    }

    /// <summary>Manual retry of a failed item: resets attempts and re-enters the pending queue.</summary>
    public QueueItemRecord RequeueFailed(string ingestKey)
    {
        lock (_gate)
        {
            var record = Find(ingestKey) ?? throw new InvalidOperationException($"Unknown ingestKey {ingestKey}");
            if (record.State != QueueItemState.Failed)
                throw new InvalidOperationException($"Item {ingestKey} is not in failed state");

            var now = DateTimeOffset.UtcNow;
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = """
                UPDATE queue_items
                SET state = $state, attempt_count = 0, next_attempt_at = $next, last_error_category = NULL
                WHERE ingest_key = $key
                """;
            cmd.Parameters.AddWithValue("$state", QueueItemState.Pending.ToDbValue());
            cmd.Parameters.AddWithValue("$next", now.ToString("O"));
            cmd.Parameters.AddWithValue("$key", ingestKey);
            cmd.ExecuteNonQuery();

            return record with { State = QueueItemState.Pending, AttemptCount = 0, NextAttemptAt = now, LastErrorCategory = null };
        }
    }

    private void SetState(string ingestKey, QueueItemState state)
    {
        lock (_gate) { SetStateInternal(ingestKey, state); }
    }

    private void SetStateInternal(string ingestKey, QueueItemState state)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText = "UPDATE queue_items SET state = $state WHERE ingest_key = $key";
        cmd.Parameters.AddWithValue("$state", state.ToDbValue());
        cmd.Parameters.AddWithValue("$key", ingestKey);
        cmd.ExecuteNonQuery();
    }

    public IReadOnlyDictionary<QueueItemState, int> Counts()
    {
        lock (_gate)
        {
            var result = new Dictionary<QueueItemState, int>
            {
                [QueueItemState.Pending] = 0,
                [QueueItemState.Processing] = 0,
                [QueueItemState.Failed] = 0,
                [QueueItemState.Completed] = 0,
            };
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT state, COUNT(*) FROM queue_items GROUP BY state";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                result[QueueItemStateExtensions.ParseDbValue(reader.GetString(0))] = reader.GetInt32(1);
            }
            return result;
        }
    }

    /// <summary>
    /// Startup reconciliation, idempotent and crash-safe:
    ///  - `.staging-*` directories with no matching DB row are orphans from a
    ///    crash between file-write and DB-insert — deleted (nothing referenced them yet).
    ///  - `.staging-*` directories WITH a matching pending-state DB row are the
    ///    crash-between-insert-and-rename case — renamed into place, never lost.
    ///  - rows left in 'processing' (service died mid-upload) go back to 'pending'.
    ///  - any pending/processing row whose spool file is missing is quarantined
    ///    to 'failed' with quarantined_orphan — the row (and any surviving file)
    ///    is kept, never silently dropped.
    /// </summary>
    public void RecoverOnStartup()
    {
        lock (_gate)
        {
            foreach (var stagingDir in Directory.EnumerateDirectories(_spoolRoot, ".staging-*"))
            {
                var ingestKey = Path.GetFileName(stagingDir)![".staging-".Length..];
                var record = Find(ingestKey);
                var finalDir = ItemDir(ingestKey);

                if (record is null)
                {
                    Directory.Delete(stagingDir, recursive: true);
                    continue;
                }

                if (!Directory.Exists(finalDir))
                {
                    Directory.Move(stagingDir, finalDir);
                }
                else
                {
                    Directory.Delete(stagingDir, recursive: true);
                }
            }

            using (var cmd = _connection.CreateCommand())
            {
                cmd.CommandText = "UPDATE queue_items SET state = $pending WHERE state = $processing";
                cmd.Parameters.AddWithValue("$pending", QueueItemState.Pending.ToDbValue());
                cmd.Parameters.AddWithValue("$processing", QueueItemState.Processing.ToDbValue());
                cmd.ExecuteNonQuery();
            }

            foreach (var record in ListByState(QueueItemState.Pending))
            {
                if (!File.Exists(record.SpoolFilePath))
                {
                    Fail(record.IngestKey, ErrorCategory.QuarantinedOrphan);
                }
            }
        }
    }

    private static List<QueueItemRecord> ReadAll(SqliteCommand cmd)
    {
        var results = new List<QueueItemRecord>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            results.Add(new QueueItemRecord(
                IngestKey: reader.GetString(reader.GetOrdinal("ingest_key")),
                WatchId: reader.GetString(reader.GetOrdinal("watch_id")),
                DeviceId: reader.GetString(reader.GetOrdinal("device_id")),
                Modality: reader.IsDBNull(reader.GetOrdinal("modality")) ? null : reader.GetString(reader.GetOrdinal("modality")),
                ContentType: reader.GetString(reader.GetOrdinal("content_type")),
                SafeExtension: reader.GetString(reader.GetOrdinal("safe_extension")),
                State: QueueItemStateExtensions.ParseDbValue(reader.GetString(reader.GetOrdinal("state"))),
                CreatedAt: DateTimeOffset.Parse(reader.GetString(reader.GetOrdinal("created_at"))),
                AttemptCount: reader.GetInt32(reader.GetOrdinal("attempt_count")),
                NextAttemptAt: DateTimeOffset.Parse(reader.GetString(reader.GetOrdinal("next_attempt_at"))),
                LastErrorCategory: reader.IsDBNull(reader.GetOrdinal("last_error_category")) ? null : reader.GetString(reader.GetOrdinal("last_error_category")),
                SpoolFilePath: reader.GetString(reader.GetOrdinal("spool_file_path")),
                SizeBytes: reader.GetInt64(reader.GetOrdinal("size_bytes"))));
        }
        return results;
    }

    public void Dispose() => _connection.Dispose();
}
