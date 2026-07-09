namespace NoraMedi.Bridge.Manager.Services.Logging;

/// <summary>Where a redacted log line ultimately goes. Kept separate from the redactor so tests can capture output without touching disk.</summary>
public interface IManagerLogSink
{
    void WriteLine(string line);
}
