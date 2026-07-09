using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
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

    /// <summary>
    /// Regression test for the reported bug where an UnauthorizedAccessException
    /// thrown during the Named Pipe *connect* was mapped to ServiceUnavailable
    /// — conflating "access denied" with "service not running" and hiding the
    /// elevation-required UX. A pipe whose ACL explicitly denies the current
    /// identity reproduces the real "access denied on connect" failure mode
    /// (Windows refuses CreateFile with ERROR_ACCESS_DENIED, which .NET
    /// surfaces as UnauthorizedAccessException from ConnectAsync), so this
    /// must map to Unauthorized, not ServiceUnavailable.
    /// </summary>
    [Fact]
    public async Task GetServiceStatusAsync_ConnectDeniedByAcl_MapsToUnauthorized()
    {
        var pipeName = $"NoraMediBridge-Test-Denied-{Guid.NewGuid():N}";
        var security = new PipeSecurity();
        using var currentUser = WindowsIdentity.GetCurrent();
        security.AddAccessRule(new PipeAccessRule(currentUser.User!, PipeAccessRights.ReadWrite, AccessControlType.Deny));

        await using var server = NamedPipeServerStreamAcl.Create(
            pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 0, 0, security);

        var service = new BridgePipeClientService(pipeName, connectTimeoutMs: 2000);

        var result = await service.GetServiceStatusAsync();

        Assert.False(result.Success);
        Assert.Equal(ManagerErrorKind.Unauthorized, result.ErrorKind);
    }
}
