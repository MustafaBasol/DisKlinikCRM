using System.Text.RegularExpressions;

namespace NoraMedi.Bridge.Manager.Services.Logging;

/// <summary>
/// Defense-in-depth scrubbing applied to every log line before it reaches a
/// sink. Two categories are redacted regardless of call site or intent:
/// local filesystem paths, and 8-digit pairing codes (however the human
/// grouped the digits while typing). This does not depend on call sites
/// remembering to avoid logging these values — it strips them even if a
/// future change accidentally interpolates one into a message.
/// </summary>
public static partial class SensitiveLogRedactor
{
    private const string PathPlaceholder = "[path-redacted]";
    private const string PairingCodePlaceholder = "[code-redacted]";

    public static string Redact(string message)
    {
        if (string.IsNullOrEmpty(message))
        {
            return message;
        }

        var result = WindowsDrivePathPattern().Replace(message, PathPlaceholder);
        result = UncPathPattern().Replace(result, PathPlaceholder);
        result = PairingCodePattern().Replace(result, PairingCodePlaceholder);
        return result;
    }

    // e.g. C:\Users\clinic\Scans\Xray, D:\data\file.dcm
    [GeneratedRegex(@"[A-Za-z]:\\[^\s""']*")]
    private static partial Regex WindowsDrivePathPattern();

    // e.g. \\SERVER\Share\Folder
    [GeneratedRegex(@"\\\\[^\s""']+")]
    private static partial Regex UncPathPattern();

    // 8 digits, optionally grouped with spaces/hyphens in pairs (e.g. "1234-5678", "1234 5678", "12345678")
    [GeneratedRegex(@"\b\d{4}[\s-]?\d{4}\b")]
    private static partial Regex PairingCodePattern();
}
