namespace NoraMedi.Bridge.Core.Acquisition;

/// <summary>
/// The only shipped <see cref="IImagingAcquisitionAdapter"/>: watches one or
/// more local folders (each bound to a NoraMedi ImagingDevice) and raises
/// <see cref="FileAcquired"/> once a file is judged stable. Source files are
/// only ever read, never renamed, moved, or deleted — vendor archiving
/// behavior is left untouched (see docs/architecture.md).
/// </summary>
public sealed class FolderWatchAdapter : IImagingAcquisitionAdapter
{
    private readonly List<SingleFolderWatcher> _watchers;

    public FolderWatchAdapter(
        IEnumerable<FolderBinding> bindings,
        TimeSpan stabilityWindow,
        TimeSpan? pollInterval = null)
    {
        var interval = pollInterval ?? TimeSpan.FromMilliseconds(500);
        _watchers = bindings
            .Select(binding => new SingleFolderWatcher(binding, stabilityWindow, interval, RaiseFileAcquired))
            .ToList();
    }

    public string AdapterType => "folder_watch";

    public event EventHandler<AcquiredFile>? FileAcquired;

    public void Start()
    {
        foreach (var watcher in _watchers) watcher.Start();
    }

    public void Stop()
    {
        foreach (var watcher in _watchers) watcher.Stop();
    }

    public IReadOnlyList<FolderAvailability> GetAvailability() =>
        _watchers.Select(w => new FolderAvailability(w.WatchId, w.Available)).ToList();

    /// <summary>Runs one poll tick on every bound folder synchronously — for deterministic tests.</summary>
    public void TickAll()
    {
        foreach (var watcher in _watchers) watcher.Tick();
    }

    private void RaiseFileAcquired(string sourcePath, FolderBinding binding) =>
        FileAcquired?.Invoke(this, new AcquiredFile(sourcePath, binding));

    public ValueTask DisposeAsync()
    {
        Stop();
        foreach (var watcher in _watchers) watcher.Dispose();
        return ValueTask.CompletedTask;
    }
}
