using NoraMedi.Bridge.Manager.Services.Logging;

namespace NoraMedi.Bridge.Manager.Tests.TestSupport;

public sealed class CapturingLogSink : IManagerLogSink
{
    public List<string> Lines { get; } = [];

    public void WriteLine(string line) => Lines.Add(line);
}
