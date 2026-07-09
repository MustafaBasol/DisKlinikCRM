namespace NoraMedi.Bridge.Core.Acquisition;

/// <summary>
/// Extensibility point for imaging acquisition sources. <see cref="FolderWatchAdapter"/>
/// is the only implementation shipped today; future phases (vendor SDKs, TWAIN/WIA,
/// DICOM C-STORE) plug in behind this same contract without touching the queue,
/// uploader, or service host.
/// </summary>
public interface IImagingAcquisitionAdapter : IAsyncDisposable
{
    string AdapterType { get; }

    void Start();

    void Stop();

    /// <summary>Raised once per source file, only after it is judged stable.</summary>
    event EventHandler<AcquiredFile>? FileAcquired;

    IReadOnlyList<FolderAvailability> GetAvailability();
}
