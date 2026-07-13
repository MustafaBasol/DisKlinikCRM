using System.Security.Principal;
using NoraMedi.Bridge.Core.Ipc;

namespace NoraMedi.Bridge.Core.Tests.Ipc;

public class BridgePipeServerTests : IAsyncLifetime
{
    private static readonly PipeClientIdentity AdminIdentity = new("TEST\\admin-user", IsAdministrator: true);

    private readonly string _pipeName = "nmb-test-" + Guid.NewGuid().ToString("N");
    private readonly FakeBridgePipeRequestHandler _handler = new();
    private BridgePipeServer _server = null!;

    public Task InitializeAsync()
    {
        // Every pre-existing behavioral test in this class exercises transport/
        // dispatch, not identity authorization — stub the identity resolver to
        // a fixed administrator so those tests are deterministic regardless of
        // which Windows account actually runs the test process. Authorization
        // itself is covered by PipeAuthorizationTests below, which supply their
        // own resolvers.
        _server = new BridgePipeServer(_pipeName, _handler, maxInstances: 2, identityResolver: _ => AdminIdentity);
        _server.Start();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync() => await _server.DisposeAsync();

    [Fact(Timeout = 15000)]
    public async Task GetServiceStatus_RoundTripsThroughRealPipe()
    {
        var response = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.GetServiceStatus);

        Assert.True(response.Success);
        var payload = BridgePipeClient.DeserializePayload<ServiceStatusPayload>(response);
        Assert.NotNull(payload);
        Assert.Equal("install-123", payload!.InstallationId);
        Assert.Contains(nameof(FakeBridgePipeRequestHandler.GetServiceStatusAsync), _handler.Calls);
    }

    [Fact(Timeout = 15000)]
    public async Task GetBindings_ReturnsRealLocalPath_BecauseThisIsLocalIpcNotServerTraffic()
    {
        var response = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.GetBindings);
        var bindings = BridgePipeClient.DeserializePayload<List<FolderBindingInfo>>(response);

        Assert.NotNull(bindings);
        Assert.Equal(@"C:\Export", bindings![0].Path);
    }

    [Fact(Timeout = 15000)]
    public async Task ValidateFolder_SendsPayloadAndReceivesTypedResponse()
    {
        var tempDir = Directory.CreateTempSubdirectory("nmb-pipe-").FullName;
        try
        {
            var response = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.ValidateFolder, new ValidateFolderRequest(tempDir));
            var result = BridgePipeClient.DeserializePayload<ValidateFolderResponse>(response);

            Assert.True(response.Success);
            Assert.True(result!.Exists);
        }
        finally
        {
            Directory.Delete(tempDir);
        }
    }

    [Fact(Timeout = 15000)]
    public async Task UnknownOperation_ReturnsUnknownOperationError()
    {
        using var client = new System.IO.Pipes.NamedPipeClientStream(".", _pipeName, System.IO.Pipes.PipeDirection.InOut, System.IO.Pipes.PipeOptions.Asynchronous);
        await client.ConnectAsync(5000);
        await PipeFraming.WriteMessageAsync(client, """{"operation":"DeleteEverything","payload":null}""");
        var responseJson = await PipeFraming.ReadMessageAsync(client);

        Assert.Contains(PipeErrorCodes.UnknownOperation, responseJson);
    }

    [Fact(Timeout = 15000)]
    public async Task MalformedJson_ReturnsInvalidPayloadErrorWithoutCrashingServer()
    {
        using (var client = new System.IO.Pipes.NamedPipeClientStream(".", _pipeName, System.IO.Pipes.PipeDirection.InOut, System.IO.Pipes.PipeOptions.Asynchronous))
        {
            await client.ConnectAsync(5000);
            await PipeFraming.WriteMessageAsync(client, "{not valid json");
            var responseJson = await PipeFraming.ReadMessageAsync(client);
            Assert.Contains(PipeErrorCodes.InvalidPayload, responseJson);
        }

        // Server must still be alive and serving other requests after a malformed message.
        var followUp = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.GetServiceStatus);
        Assert.True(followUp.Success);
    }

    [Fact(Timeout = 15000)]
    public async Task ValidOperationWithMalformedPayload_ReturnsInvalidPayloadError()
    {
        using var client = new System.IO.Pipes.NamedPipeClientStream(".", _pipeName, System.IO.Pipes.PipeDirection.InOut, System.IO.Pipes.PipeOptions.Asynchronous);
        await client.ConnectAsync(5000);
        await PipeFraming.WriteMessageAsync(client, """{"operation":"ValidateFolder","payload":"{ this is not the expected shape"}""");
        var responseJson = await PipeFraming.ReadMessageAsync(client);

        Assert.Contains(PipeErrorCodes.InvalidPayload, responseJson);
    }

    [Fact(Timeout = 15000)]
    public async Task OversizedMessage_IsRejectedWithoutCrashingServer()
    {
        // The server enforces its limit on the 4-byte length prefix ALONE,
        // before attempting to read the body (see PipeFraming.ReadMessageAsync) —
        // so this only sends the prefix. Actually writing a real multi-MB body
        // would deadlock the test: the server aborts after the prefix and never
        // drains the rest, and named pipe buffers are far smaller than that,
        // so the client's write would block forever waiting for a reader.
        using (var client = new System.IO.Pipes.NamedPipeClientStream(".", _pipeName, System.IO.Pipes.PipeDirection.InOut, System.IO.Pipes.PipeOptions.Asynchronous))
        {
            await client.ConnectAsync(5000);
            var lengthPrefix = new byte[4];
            System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(lengthPrefix, PipeFraming.DefaultMaxMessageBytes + 1024);
            await client.WriteAsync(lengthPrefix);
            await client.FlushAsync();

            var responseJson = await PipeFraming.ReadMessageAsync(client);
            Assert.NotNull(responseJson);
            Assert.Contains(PipeErrorCodes.PayloadTooLarge, responseJson);
        }

        var followUp = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.GetServiceStatus);
        Assert.True(followUp.Success);
    }

    [Fact(Timeout = 15000)]
    public async Task HandlerException_IsTranslatedToInternalErrorNotConnectionCrash()
    {
        _handler.ThrowOnNextCall = new InvalidOperationException("boom");

        var response = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.GetServiceStatus);

        Assert.False(response.Success);
        Assert.Equal(PipeErrorCodes.InternalError, response.ErrorCode);
    }

    [Fact(Timeout = 15000)]
    public async Task ConcurrentClients_AreAllServedIndependently()
    {
        var tasks = Enumerable.Range(0, 5)
            .Select(_ => BridgePipeClient.SendAsync(_pipeName, PipeOperation.GetQueueSummary))
            .ToArray();

        var responses = await Task.WhenAll(tasks);
        Assert.All(responses, r => Assert.True(r.Success));
    }

    [Fact(Timeout = 15000)]
    public async Task ProvisionWithPairingCode_NeverCarriesACredentialField()
    {
        // Structural guard: the request DTO for this operation has no property
        // that could hold a credential — see docs/security.md's provisioning design.
        var properties = typeof(ProvisionWithPairingCodeRequest).GetProperties().Select(p => p.Name.ToLowerInvariant());
        Assert.DoesNotContain(properties, name => name.Contains("credential") || name.Contains("token"));

        var response = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.ProvisionWithPairingCode, new ProvisionWithPairingCodeRequest("12345678"));
        Assert.True(response.Success);
    }

    [Fact(Timeout = 15000)]
    public async Task CheckForUpdates_ReturnsRealStatusFromHandler()
    {
        var response = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.CheckForUpdates);
        var payload = BridgePipeClient.DeserializePayload<UpdateStatusPayload>(response);

        Assert.Equal("UpToDate", payload!.Lifecycle);
    }

    [Fact(Timeout = 15000)]
    public async Task GetUpdateStatus_RoundTripsThroughRealPipe()
    {
        var response = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.GetUpdateStatus);
        Assert.True(response.Success);
        var payload = BridgePipeClient.DeserializePayload<UpdateStatusPayload>(response);
        Assert.Equal("UpToDate", payload!.Lifecycle);
    }

    [Fact(Timeout = 15000)]
    public async Task InstallUpdate_AsAdministrator_RoundTripsThroughRealPipe()
    {
        var response = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.InstallUpdate, new InstallUpdateRequest());
        Assert.True(response.Success);
        var payload = BridgePipeClient.DeserializePayload<InstallUpdateResponse>(response);
        Assert.False(payload!.Launched); // fake handler has nothing staged to install
    }

    [Fact(Timeout = 15000)]
    public async Task DisposeAsync_CalledTwice_DoesNotThrow()
    {
        await _server.DisposeAsync();
        await _server.DisposeAsync();
    }
}

/// <summary>
/// Regression coverage for a real defect found during PR #149 physical
/// acceptance: <c>BridgePipeServer.CaptureClientIdentity</c> impersonates the
/// connecting client (via <c>NamedPipeServerStream.RunAsClient</c>) to check
/// its identity/Administrators membership, then must revert before request
/// dispatch runs — dispatch includes LocalSystem-only file writes (e.g.
/// <see cref="NoraMedi.Bridge.Core.Updates.UpdateStateStore.Save"/>) that must
/// never execute under the caller's impersonated token. Under concurrent pipe
/// traffic, physical testing observed dispatch intermittently running
/// impersonated, causing those writes to fail with
/// <see cref="UnauthorizedAccessException"/> (silently mapped to a generic
/// <c>internal_error</c> by <c>HandleConnectionAsync</c>'s catch-all).
/// These tests use the server's *real*, non-stubbed identity resolver
/// (every other test in <see cref="BridgePipeServerTests"/> stubs it) so they
/// actually exercise <c>CaptureClientIdentity</c>.
/// </summary>
public class BridgePipeServerImpersonationTests : IAsyncLifetime
{
    private readonly string _pipeName = "nmb-test-imp-" + Guid.NewGuid().ToString("N");
    private readonly FakeBridgePipeRequestHandler _handler = new();
    private BridgePipeServer _server = null!;

    public Task InitializeAsync()
    {
        // No identityResolver override — uses the real CaptureClientIdentity.
        _server = new BridgePipeServer(_pipeName, _handler, maxInstances: 4);
        _server.Start();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync() => await _server.DisposeAsync();

    [Fact(Timeout = 15000)]
    public async Task Dispatch_NeverRunsImpersonated_AfterRealIdentityCapture()
    {
        var response = await BridgePipeClient.SendAsync(_pipeName, PipeOperation.GetServiceStatus);

        Assert.True(response.Success);
        Assert.Single(_handler.ObservedImpersonationLevels);
        Assert.Equal(TokenImpersonationLevel.None, _handler.ObservedImpersonationLevels.Single());
    }

    [Fact(Timeout = 15000)]
    public async Task Dispatch_NeverRunsImpersonated_UnderConcurrentRealIdentityCapture()
    {
        // Many overlapping connections sharing the thread pool is exactly the
        // condition physical testing hit: one connection's identity-capture
        // thread must never leave an impersonation token that a *different*
        // connection's dispatch later inherits.
        var tasks = Enumerable.Range(0, 20)
            .Select(_ => BridgePipeClient.SendAsync(_pipeName, PipeOperation.GetServiceStatus, connectTimeoutMs: 15000))
            .ToArray();

        var responses = await Task.WhenAll(tasks);

        Assert.All(responses, r => Assert.True(r.Success));
        Assert.Equal(20, _handler.ObservedImpersonationLevels.Count);
        Assert.All(_handler.ObservedImpersonationLevels, level => Assert.Equal(TokenImpersonationLevel.None, level));
    }
}
