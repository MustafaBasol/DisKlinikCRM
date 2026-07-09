using System.Threading;
using NoraMedi.Bridge.Core.Validation;

namespace NoraMedi.Bridge.Core.Acquisition;

/// <summary>
/// Polls a single bound folder on a timer rather than relying solely on
/// native filesystem notification APIs — the same deliberate choice the
/// Node reference agent makes (chokidar usePolling=true) because native
/// events are not reliable on UNC network shares, which clinics commonly
/// export to. Depth is always 0 (top-level files only), matching the
/// reference agent and the server's flat per-study upload model.
///
/// Before a file is ever handed to <see cref="_onStableFile"/> it must pass
/// every one of: known extension, not a Windows-hidden file, not a
/// reparse point (symlink/junction — never followed), size and last-write
/// timestamp unchanged across the full stability window, no larger than
/// <see cref="_maxFileSizeBytes"/>, and its leading bytes matching the
/// content type its extension claims. The source file is only ever opened
/// for a shared read to peek those bytes — never renamed, moved, deleted,
/// or opened exclusively (source immutability; vendor archiving behavior is
/// left untouched — see docs/architecture.md).
/// </summary>
internal sealed class SingleFolderWatcher : IDisposable
{
    private readonly FolderBinding _binding;
    private readonly TimeSpan _stabilityWindow;
    private readonly TimeSpan _pollInterval;
    private readonly long _maxFileSizeBytes;
    private readonly Action<string, FolderBinding> _onStableFile;
    private readonly Dictionary<string, (long Size, DateTimeOffset LastWriteUtc, DateTimeOffset ObservedAt)> _pending = new();
    private readonly HashSet<string> _emitted = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _rejected = new(StringComparer.OrdinalIgnoreCase);
    private readonly Lock _gate = new();
    private Timer? _timer;
    private volatile bool _available;

    public SingleFolderWatcher(
        FolderBinding binding,
        TimeSpan stabilityWindow,
        TimeSpan pollInterval,
        Action<string, FolderBinding> onStableFile,
        long maxFileSizeBytes = long.MaxValue)
    {
        _binding = binding;
        _stabilityWindow = stabilityWindow;
        _pollInterval = pollInterval;
        _onStableFile = onStableFile;
        _maxFileSizeBytes = maxFileSizeBytes;
    }

    public string WatchId => _binding.WatchId;

    public bool Available => _available;

    public void Start()
    {
        _timer = new Timer(_ => Tick(), null, TimeSpan.Zero, _pollInterval);
    }

    public void Stop()
    {
        _timer?.Dispose();
        _timer = null;

        // Timer.Dispose() does not wait for an already-running callback to
        // finish — without this, a Tick() started just before Stop() was
        // called could still be mid-flight (including the synchronous
        // _onStableFile → BridgeOrchestrator.OnFileAcquired call chain, which
        // reads/writes the queue) after the caller assumes the watcher is
        // fully stopped and goes on to dispose the queue out from under it.
        // Tick() holds _gate for its entire body, so blocking on it here is
        // exactly "wait for any in-flight tick to finish".
        lock (_gate)
        {
        }
    }

    /// <summary>Runs one poll synchronously — exposed for deterministic unit tests.</summary>
    public void Tick()
    {
        lock (_gate)
        {
            if (!Directory.Exists(_binding.Path))
            {
                _available = false;
                _pending.Clear();
                return;
            }

            _available = true;
            var now = DateTimeOffset.UtcNow;
            var currentFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            IEnumerable<string> entries;
            try
            {
                entries = Directory.EnumerateFiles(_binding.Path);
            }
            catch (IOException)
            {
                // Transient share/permission hiccup — treated as unavailable this tick only.
                _available = false;
                return;
            }
            catch (UnauthorizedAccessException)
            {
                _available = false;
                return;
            }

            foreach (var path in entries)
            {
                if (IsIgnoredByNameOrExtension(path)) continue;

                FileInfo info;
                try
                {
                    info = new FileInfo(path);
                    if (!info.Exists) continue;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    continue;
                }

                // Windows Hidden attribute and reparse points (symlinks/junctions)
                // are never eligible acquisitions, regardless of extension —
                // a hidden or redirected file is not a genuine vendor export.
                if (info.Attributes.HasFlag(FileAttributes.Hidden)) continue;
                if (info.Attributes.HasFlag(FileAttributes.ReparsePoint)) continue;
                if (info.Length > _maxFileSizeBytes) continue;

                currentFiles.Add(path);
                if (_emitted.Contains(path) || _rejected.Contains(path)) continue;

                var size = info.Length;
                var lastWriteUtc = info.LastWriteTimeUtc;

                if (_pending.TryGetValue(path, out var existing) && existing.Size == size && existing.LastWriteUtc == lastWriteUtc)
                {
                    if (now - existing.ObservedAt >= _stabilityWindow)
                    {
                        switch (ValidateContent(path))
                        {
                            case ContentValidation.Valid:
                                _pending.Remove(path);
                                _emitted.Add(path);
                                _onStableFile(path, _binding);
                                break;
                            case ContentValidation.Invalid:
                                _pending.Remove(path);
                                _rejected.Add(path);
                                break;
                            case ContentValidation.Retry:
                            default:
                                // Still locked by the writer or momentarily unreadable — try again next tick.
                                break;
                        }
                    }
                }
                else
                {
                    _pending[path] = (size, lastWriteUtc, now);
                }
            }

            Prune(_pending.Keys.ToList(), currentFiles, key => _pending.Remove(key));
            Prune(_emitted.ToList(), currentFiles, key => _emitted.Remove(key));
            Prune(_rejected.ToList(), currentFiles, key => _rejected.Remove(key));
        }
    }

    /// <summary>
    /// Reads the leading bytes of a stable candidate (shared read only — the
    /// source is never opened exclusively or modified) and confirms its magic
    /// bytes match the content type its extension claims.
    /// </summary>
    private static ContentValidation ValidateContent(string path)
    {
        var extension = Path.GetExtension(path);
        var expectedContentType = FileSignatureValidator.ExpectedContentTypeForExtension(extension);
        if (expectedContentType is null) return ContentValidation.Invalid;

        byte[] header;
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            header = new byte[Math.Min(stream.Length, 512)];
            var totalRead = 0;
            while (totalRead < header.Length)
            {
                var read = stream.Read(header, totalRead, header.Length - totalRead);
                if (read == 0) break;
                totalRead += read;
            }
            if (totalRead < header.Length) Array.Resize(ref header, totalRead);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return ContentValidation.Retry;
        }

        var detected = FileSignatureValidator.DetectContentType(header);
        return detected == expectedContentType ? ContentValidation.Valid : ContentValidation.Invalid;
    }

    private enum ContentValidation
    {
        Valid,
        Invalid,
        Retry,
    }

    private static void Prune(IEnumerable<string> keys, HashSet<string> currentFiles, Action<string> remove)
    {
        foreach (var key in keys)
        {
            if (!currentFiles.Contains(key)) remove(key);
        }
    }

    private bool IsIgnoredByNameOrExtension(string filePath)
    {
        var name = Path.GetFileName(filePath);
        if (name.StartsWith('.')) return true;
        var ext = Path.GetExtension(name).ToLowerInvariant();
        if (ext is ".tmp" or ".part" or ".partial" or ".crdownload") return true;
        if (ext.Length == 0) return true;
        return !_binding.Extensions.Contains(ext, StringComparer.OrdinalIgnoreCase);
    }

    public void Dispose() => Stop();
}
