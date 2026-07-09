using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.Tests.TestSupport;

public sealed class FakeElevationService : IElevationService
{
    public bool IsElevated { get; set; }
    public int RestartElevatedCallCount { get; private set; }

    public void RestartElevated() => RestartElevatedCallCount++;
}
