namespace NoraMedi.Bridge.Core.Acquisition;

/// <summary>
/// One local folder bound to a NoraMedi ImagingDevice. The full folder path
/// (<see cref="Path"/>) is a local operating detail and must never be sent to
/// the server — only <see cref="WatchId"/> ever leaves this process (see
/// Diagnostics.DiagnosticsRedactor).
/// </summary>
public sealed record FolderBinding(
    string WatchId,
    string Path,
    string DeviceId,
    string? Modality,
    IReadOnlyList<string> Extensions)
{
    public static FolderBinding Create(string watchId, string path, string deviceId, string? modality, IReadOnlyList<string>? extensions = null) =>
        new(watchId, path, deviceId, modality, extensions is { Count: > 0 } ? extensions : Validation.FileSignatureValidator.WatchedExtensions);
}
