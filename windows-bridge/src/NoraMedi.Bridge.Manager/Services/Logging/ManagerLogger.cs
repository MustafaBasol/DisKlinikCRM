namespace NoraMedi.Bridge.Manager.Services.Logging;

/// <summary>
/// Minimal logger used by the Manager for operational tracing (e.g. "add
/// binding requested", "connection test failed"). Every message is redacted
/// via <see cref="SensitiveLogRedactor"/> before it reaches the sink — this
/// is the only path by which the Manager writes log output, so there is no
/// call site that can bypass redaction.
/// </summary>
public sealed class ManagerLogger
{
    private readonly IManagerLogSink _sink;

    public ManagerLogger(IManagerLogSink sink)
    {
        _sink = sink;
    }

    public void Info(string message) => Write("INFO", message);

    public void Warn(string message) => Write("WARN", message);

    public void Error(string message) => Write("ERROR", message);

    private void Write(string level, string message)
    {
        var redacted = SensitiveLogRedactor.Redact(message);
        _sink.WriteLine($"[{DateTimeOffset.UtcNow:O}] {level} {redacted}");
    }
}
