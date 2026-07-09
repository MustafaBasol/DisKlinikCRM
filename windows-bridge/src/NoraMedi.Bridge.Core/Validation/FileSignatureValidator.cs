namespace NoraMedi.Bridge.Core.Validation;

/// <summary>
/// Mirrors server/src/services/imaging/imagingUploadValidation.ts and
/// bridge-agent/src/fileType.ts byte-for-byte: only these four content types
/// are ever accepted, detected by magic bytes rather than file extension.
/// </summary>
public static class FileSignatureValidator
{
    public static IReadOnlyDictionary<string, string> SafeExtensionByContentType { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["image/jpeg"] = ".jpg",
            ["image/png"] = ".png",
            ["image/webp"] = ".webp",
            ["application/dicom"] = ".dcm",
        };

    public static IReadOnlyList<string> WatchedExtensions { get; } =
        new[] { ".jpg", ".jpeg", ".png", ".webp", ".dcm", ".dicom" };

    private static readonly byte[] JpegMagic = { 0xFF, 0xD8, 0xFF };
    private static readonly byte[] PngMagic = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };

    /// <summary>
    /// Detects one of the four server-accepted content types from magic bytes.
    /// Returns null for anything else — callers must never enqueue an
    /// unrecognized file (see FolderWatchAdapter).
    /// </summary>
    public static string? DetectContentType(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 132 && bytes.Slice(128, 4).SequenceEqual("DICM"u8))
        {
            return "application/dicom";
        }

        if (bytes.Length >= JpegMagic.Length && bytes[..JpegMagic.Length].SequenceEqual(JpegMagic))
        {
            return "image/jpeg";
        }

        if (bytes.Length >= PngMagic.Length && bytes[..PngMagic.Length].SequenceEqual(PngMagic))
        {
            return "image/png";
        }

        if (bytes.Length >= 12 &&
            bytes[..4].SequenceEqual("RIFF"u8) &&
            bytes.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return "image/webp";
        }

        return null;
    }

    public static string? SafeExtensionFor(string contentType) =>
        SafeExtensionByContentType.TryGetValue(contentType, out var ext) ? ext : null;

    /// <summary>
    /// The content type a watched file's extension claims to be — used to
    /// reject an extension/magic-byte mismatch (e.g. a renamed .exe dropped
    /// in as "scan.jpg") before it is ever queued. Both accepted spellings of
    /// the JPEG and DICOM extensions map to the same content type.
    /// </summary>
    public static string? ExpectedContentTypeForExtension(string extension) => extension.ToLowerInvariant() switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".dcm" or ".dicom" => "application/dicom",
        _ => null,
    };
}
