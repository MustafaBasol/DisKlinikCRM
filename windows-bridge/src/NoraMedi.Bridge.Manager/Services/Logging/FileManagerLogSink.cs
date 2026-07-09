using System.IO;

namespace NoraMedi.Bridge.Manager.Services.Logging;

/// <summary>Appends redacted log lines to a per-day file under the user's local app data folder.</summary>
public sealed class FileManagerLogSink : IManagerLogSink
{
    private readonly string _filePath;
    private readonly object _gate = new();

    public FileManagerLogSink()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "NoraMediBridge", "Manager", "logs");
        Directory.CreateDirectory(dir);
        _filePath = Path.Combine(dir, $"manager-{DateTime.UtcNow:yyyyMMdd}.log");
    }

    public void WriteLine(string line)
    {
        lock (_gate)
        {
            File.AppendAllLines(_filePath, [line]);
        }
    }
}
