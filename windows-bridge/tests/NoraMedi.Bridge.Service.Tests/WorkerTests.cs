using Microsoft.Extensions.Logging.Abstractions;
using NoraMedi.Bridge.Core.Http;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Core.Runtime;
using NoraMedi.Bridge.Service;

namespace NoraMedi.Bridge.Service.Tests;

/// <summary>
/// Exercises the Worker as the real OS-integration shell: starting it stands
/// up the Named Pipe IPC surface; stopping it must cleanly tear down both the
/// pipe and the orchestrator with no hung handles or thrown exceptions —
/// this is what a real Windows Service start/stop/recovery cycle depends on.
/// </summary>
public class WorkerTests : IAsyncLifetime
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-worker-").FullName;
    private readonly List<Worker> _workers = [];

    // BridgeOrchestrator ACL-protects ProgramDataRoot to LocalSystem +
    // Administrators only. The test process is neither, so — exactly like a
    // real deployment running as a dedicated, non-Admin service account —
    // ServiceAccountSid is set to the test process's own identity below.
    private static readonly string CurrentUserSid = System.Security.Principal.WindowsIdentity.GetCurrent().User!.Value;

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var worker in _workers)
        {
            await worker.StopAsync(default);
        }
        AclCleanup.UnlockAndDelete(_root);
    }

    private Worker NewWorker(bool enabled, out string pipeName)
    {
        pipeName = "nmb-worker-test-" + Guid.NewGuid().ToString("N");
        var options = new BridgeOptions
        {
            Enabled = enabled,
            ServerUrl = "https://api.example.com",
            ProgramDataRoot = Path.Combine(_root, Guid.NewGuid().ToString("N")),
            PipeName = pipeName,
            HeartbeatIntervalSeconds = 60,
            DrainPollMs = 5000,
            ServiceAccountSid = CurrentUserSid,
        };
        var apiClient = new BridgeApiClient(new HttpClient(new NeverRespondingHandler()), options.ServerUrl);
        var orchestrator = new BridgeOrchestrator(options, apiClient, "1.0.0-test", NullLogger<BridgeOrchestrator>.Instance);
        var worker = new Worker(orchestrator, options, NullLogger<Worker>.Instance);
        _workers.Add(worker);
        return worker;
    }

    [Fact]
    public async Task StartAsync_StandsUpPipeServer_RespondingToStatusQuery()
    {
        var worker = NewWorker(enabled: true, out var pipeName);

        await worker.StartAsync(default);
        var response = await BridgePipeClient.SendAsync(pipeName, PipeOperation.GetServiceStatus);

        Assert.True(response.Success);
    }

    [Fact]
    public async Task DisabledMode_StillAnswersIpcButReportsDisabledConnectionState()
    {
        var worker = NewWorker(enabled: false, out var pipeName);

        await worker.StartAsync(default);
        var response = await BridgePipeClient.SendAsync(pipeName, PipeOperation.GetServiceStatus);
        var payload = BridgePipeClient.DeserializePayload<ServiceStatusPayload>(response);

        Assert.True(response.Success);
        Assert.Equal("disabled", payload!.ConnectionState);
    }

    [Fact]
    public async Task UnpairedMode_ReportsPairedFalseAndValidAuthState()
    {
        var worker = NewWorker(enabled: true, out var pipeName);

        await worker.StartAsync(default);
        var response = await BridgePipeClient.SendAsync(pipeName, PipeOperation.GetServiceStatus);
        var payload = BridgePipeClient.DeserializePayload<ServiceStatusPayload>(response);

        Assert.False(payload!.Paired);
        Assert.Equal("valid", payload.AuthState); // never contacted the server yet, so nothing has invalidated it
    }

    [Fact]
    public async Task StopAsync_ClosesThePipe_SubsequentConnectionAttemptFails()
    {
        var worker = NewWorker(enabled: true, out var pipeName);
        await worker.StartAsync(default);
        await BridgePipeClient.SendAsync(pipeName, PipeOperation.GetServiceStatus); // confirm it was actually up

        await worker.StopAsync(default);

        await Assert.ThrowsAnyAsync<Exception>(() =>
            BridgePipeClient.SendAsync(pipeName, PipeOperation.GetServiceStatus, connectTimeoutMs: 500));
    }

    [Fact]
    public async Task StopAsync_IsIdempotent_CanBeCalledTwiceWithoutThrowing()
    {
        var worker = NewWorker(enabled: true, out _);
        await worker.StartAsync(default);

        await worker.StopAsync(default);
        await worker.StopAsync(default);
    }

    private sealed class NeverRespondingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new HttpRequestException("no network in this test");
    }
}
