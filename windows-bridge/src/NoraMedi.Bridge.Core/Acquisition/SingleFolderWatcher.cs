using System.Threading;

namespace NoraMedi.Bridge.Core.Acquisition;

/// <summary>
/// Polls a single bound folder on a timer rather than relying solely on
/// native filesystem notification APIs — the same deliberate choice the
/// Node reference agent makes (chokidar usePolling=true) because native
/// events are not reliable on UNC network shares, which clinics commonly
/// export to. Depth is always 0 (top-level files only), matching the
/// reference agent and the server's flat per-study upload model.
/// </summary>
internal sealed class SingleFolderWatcher : IDisposable
{
    private readonly FolderBinding _binding;
    private readonly TimeSpan _stabilityWindow;
    private readonly TimeSpan _pollInterval;
    private readonly Action<string, FolderBinding> _onStableFile;
    private readonly Dictionary<string, (long Size, DateTimeOffset ObservedAt)> _pending = new();
    private readonly HashSet<string> _emitted = new(StringComparer.OrdinalIgnoreCase);
    private readonly Lock _gate = new();
    private Timer? _timer;
    private volatile bool _available;

    public SingleFolderWatcher(
        FolderBinding binding,
        TimeSpan stabilityWindow,
        TimeSpan pollInterval,
        Action<string, FolderBinding> onStableFile)
    {
        _binding = binding;
        _stabilityWindow = stabilityWindow;
        _pollInterval = pollInterval;
        _onStableFile = onStableFile;
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
                if (IsIgnored(path)) continue;
                currentFiles.Add(path);
                if (_emitted.Contains(path)) continue;

                long size;
                try
                {
                    size = new FileInfo(path).Length;
                }
                catch (IOException)
                {
                    continue;
                }
                catch (UnauthorizedAccessException)
                {
                    continue;
                }

                if (_pending.TryGetValue(path, out var existing) && existing.Size == size)
                {
                    if (now - existing.ObservedAt >= _stabilityWindow)
                    {
                        _pending.Remove(path);
                        _emitted.Add(path);
                        _onStableFile(path, _binding);
                    }
                }
                else
                {
                    _pending[path] = (size, now);
                }
            }

            PruneMissing(_pending.Keys.ToList(), currentFiles, _pending);
            PruneMissing(_emitted.ToList(), currentFiles, null, _emitted);
        }
    }

    private static void PruneMissing(
        IEnumerable<string> keys,
        HashSet<string> currentFiles,
        Dictionary<string, (long Size, DateTimeOffset ObservedAt)>? pendingDict = null,
        HashSet<string>? emittedSet = null)
    {
        foreach (var key in keys)
        {
            if (!currentFiles.Contains(key))
            {
                pendingDict?.Remove(key);
                emittedSet?.Remove(key);
            }
        }
    }

    private bool IsIgnored(string filePath)
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
