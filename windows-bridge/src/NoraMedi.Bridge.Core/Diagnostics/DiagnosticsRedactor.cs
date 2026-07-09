namespace NoraMedi.Bridge.Core.Diagnostics;

/// <summary>
/// Central place for the redaction rules that apply to every log line,
/// status file, and ExportDiagnostics bundle: credentials, patient data,
/// original file names, full local paths, Authorization headers, and raw
/// DICOM metadata must never appear — only watchId, deviceId, modality,
/// counters, and category labels are safe to emit (mirrors
/// bridge-agent/src/logger.ts's shortIngestKey convention).
/// </summary>
public static class DiagnosticsRedactor
{
    private const string Redacted = "<redacted>";

    /// <summary>Shortens a 64-char ingestKey to an 8-char prefix for correlation without exposing the full hash unnecessarily.</summary>
    public static string ShortIngestKey(string ingestKey) =>
        string.IsNullOrEmpty(ingestKey) || ingestKey.Length <= 8 ? ingestKey : ingestKey[..8] + "…";

    /// <summary>Never returns any part of the credential — used defensively wherever an exception or header value could otherwise leak one.</summary>
    public static string RedactCredential(string? _) => Redacted;

    /// <summary>A local folder path must never leave this process — logs/diagnostics use watchId instead.</summary>
    public static string RedactPath(string? _) => Redacted;

    /// <summary>An original/source file name (which may embed patient identifiers) must never leave this process.</summary>
    public static string RedactFileName(string? _) => Redacted;
}
