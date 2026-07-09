using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.Tests;

/// <summary>
/// Exercises the real adapter (not a fake) against a named pipe nobody is
/// listening on, to prove the "Service not running/installed" case maps to
/// <see cref="ManagerErrorKind.ServiceUnavailable"/> rather than bubbling up
/// a raw exception. Uses a short connect timeout so this stays fast.
/// </summary>
public class BridgePipeClientServiceTests
{
    [Fact]
    public async Task GetServiceStatusAsync_NoListeningPipe_MapsToServiceUnavailable()
    {
        var service = new BridgePipeClientService($"NoraMediBridge-Test-NoListener-{Guid.NewGuid():N}", connectTimeoutMs: 200);

        var result = await service.GetServiceStatusAsync();

        Assert.False(result.Success);
        Assert.Equal(ManagerErrorKind.ServiceUnavailable, result.ErrorKind);
    }
}
