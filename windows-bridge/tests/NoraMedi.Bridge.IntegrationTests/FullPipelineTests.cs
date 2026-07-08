using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using NoraMedi.Bridge.Core.Http;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Core.Runtime;
using NoraMedi.Bridge.Service;

namespace NoraMedi.Bridge.IntegrationTests;

/// <summary>
/// End-to-end: Worker Service host + real Named Pipe transport + real
/// SQLite queue + real folder watcher, against a scripted fake HTTP server
/// standing in for NoraMedi. Exercises the full path a clinic PC would go
/// through: provision via pairing code (through IPC, exactly as the future
/// Manager will call it) → bind a folder → drop a file → see it uploaded →
/// query status/diagnostics over the pipe — without ever touching a real
/// network or a real Windows Service Control Manager registration.
/// </summary>
public class FullPipelineTests : IAsyncLifetime
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-integration-").FullName;
    private readonly List<Worker> _workers = [];

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var worker in _workers) await worker.StopAsync(default);
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    private Worker StartWorker(ScriptedHandler handler, out string pipeName, bool enabled = true)
    {
        pipeName = "nmb-integration-" + Guid.NewGuid().ToString("N");
        var options = new BridgeOptions
        {
            Enabled = enabled,
            ServerUrl = "https://api.example.com",
            ProgramDataRoot = Path.Combine(_root, Guid.NewGuid().ToString("N")),
            PipeName = pipeName,
            HeartbeatIntervalSeconds = 1,
            StabilityMs = 30,
            DrainPollMs = 50,
            MaxAttempts = 3,
            BackoffBaseMs = 10,
            BackoffCapMs = 50,
        };
        var apiClient = new BridgeApiClient(new HttpClient(handler), options.ServerUrl);
        var orchestrator = new BridgeOrchestrator(options, apiClient, "1.0.0-it", NullLogger<BridgeOrchestrator>.Instance);
        var worker = new Worker(orchestrator, options, NullLogger<Worker>.Instance);
        _workers.Add(worker);
        worker.StartAsync(default).GetAwaiter().GetResult();
        return worker;
    }

    private static async Task<T> PollUntil<T>(Func<Task<T>> probe, Func<T, bool> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        T result;
        do
        {
            result = await probe();
            if (condition(result)) return result;
            await Task.Delay(50);
        } while (DateTime.UtcNow < deadline);
        return result;
    }

    [Fact]
    public async Task FullFlow_ProvisionBindDropUpload_ReflectedInStatusAndDiagnosticsOverThePipe()
    {
        var handler = new ScriptedHandler()
            .Enqueue("/bridge/pair", HttpStatusCode.Created,
                """{"bridgeCredential":"nmb_it_token","bridgeAgentId":"agent-it","clinicName":"Integration Clinic","bindings":[],"serverTime":"2026-07-08T00:00:00.000Z"}""")
            .Enqueue("/bridge/studies", HttpStatusCode.Created, """{"ok":true,"studyId":"study-it-1","duplicate":false}""")
            .Enqueue("/bridge/heartbeat", HttpStatusCode.OK, """{"ok":true}""");
        StartWorker(handler, out var pipeName);

        var provisionResponse = await BridgePipeClient.SendAsync(pipeName, PipeOperation.ProvisionWithPairingCode, new ProvisionWithPairingCodeRequest("12345678"));
        Assert.True(provisionResponse.Success);
        var provisionPayload = BridgePipeClient.DeserializePayload<ProvisionWithPairingCodeResponse>(provisionResponse);
        Assert.True(provisionPayload!.Ok);

        var watchDir = Directory.CreateTempSubdirectory("nmb-integration-watch-").FullName;
        var bindResponse = await BridgePipeClient.SendAsync(pipeName, PipeOperation.AddOrUpdateFolderBinding,
            new AddOrUpdateFolderBindingRequest(null, watchDir, "device-it", "IO"));
        Assert.True(bindResponse.Success);

        File.WriteAllBytes(Path.Combine(watchDir, "scan.jpg"), [0xFF, 0xD8, 0xFF, .. "fake-jpeg-bytes"u8]);

        var summaryResponse = await PollUntil(
            () => BridgePipeClient.SendAsync(pipeName, PipeOperation.GetQueueSummary),
            r => BridgePipeClient.DeserializePayload<QueueSummaryResponse>(r)!.Completed == 1,
            TimeSpan.FromSeconds(10));
        var summary = BridgePipeClient.DeserializePayload<QueueSummaryResponse>(summaryResponse)!;
        Assert.Equal(1, summary.Completed);

        var statusResponse = await BridgePipeClient.SendAsync(pipeName, PipeOperation.GetServiceStatus);
        var status = BridgePipeClient.DeserializePayload<ServiceStatusPayload>(statusResponse)!;
        Assert.True(status.Paired);
        Assert.Equal("online", status.ConnectionState);

        var diagnosticsResponse = await BridgePipeClient.SendAsync(pipeName, PipeOperation.ExportDiagnostics);
        var diagnosticsJson = diagnosticsResponse.PayloadJson!;
        Assert.DoesNotContain(watchDir, diagnosticsJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("nmb_it_token", diagnosticsJson, StringComparison.OrdinalIgnoreCase);

        // The server never once saw the local folder path.
        Assert.DoesNotContain(handler.RequestedBodies, body => body.Contains(watchDir, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task RestartAfterCrash_RecoversQueueAndResumesUploading()
    {
        var programDataRoot = Path.Combine(_root, "restart-" + Guid.NewGuid().ToString("N"));
        var pipeName = "nmb-integration-restart-" + Guid.NewGuid().ToString("N");
        var watchDir = Directory.CreateTempSubdirectory("nmb-integration-restart-watch-").FullName;

        BridgeOptions MakeOptions() => new()
        {
            Enabled = true,
            ServerUrl = "https://api.example.com",
            ProgramDataRoot = programDataRoot,
            PipeName = pipeName,
            HeartbeatIntervalSeconds = 1,
            StabilityMs = 30,
            DrainPollMs = 50,
            MaxAttempts = 3,
            BackoffBaseMs = 10,
            BackoffCapMs = 50,
        };

        // First run: pair, bind, enqueue a file, but the server never answers
        // the upload (simulating a crash mid-flight) — then "kill" the process
        // by disposing everything without a clean Complete()/Fail() call.
        var firstHandler = new ScriptedHandler()
            .Enqueue("/bridge/pair", HttpStatusCode.Created,
                """{"bridgeCredential":"nmb_restart_token","bridgeAgentId":"agent-restart","clinicName":"Restart Clinic","bindings":[],"serverTime":"2026-07-08T00:00:00.000Z"}""")
            .Enqueue("/bridge/heartbeat", HttpStatusCode.OK, """{"ok":true}""");
        // Deliberately no /bridge/studies route registered — any upload attempt gets 404 from ScriptedHandler's fallback,
        // which is classified as permanent by the real contract; to simulate an in-flight crash instead we stop the
        // worker BEFORE the drain timer has a chance to run, by using a very slow DrainPollMs on this instance only.
        var firstOptions = MakeOptions() with { DrainPollMs = 60_000 };
        var firstApiClient = new BridgeApiClient(new HttpClient(firstHandler), firstOptions.ServerUrl);
        var firstOrchestrator = new BridgeOrchestrator(firstOptions, firstApiClient, "1.0.0-it", NullLogger<BridgeOrchestrator>.Instance);
        var firstWorker = new Worker(firstOrchestrator, firstOptions, NullLogger<Worker>.Instance);
        await firstWorker.StartAsync(default);

        await BridgePipeClient.SendAsync(pipeName, PipeOperation.ProvisionWithPairingCode, new ProvisionWithPairingCodeRequest("12345678"));
        await BridgePipeClient.SendAsync(pipeName, PipeOperation.AddOrUpdateFolderBinding, new AddOrUpdateFolderBindingRequest(null, watchDir, "device-restart", "IO"));
        File.WriteAllBytes(Path.Combine(watchDir, "scan.jpg"), [0xFF, 0xD8, 0xFF, 0x01]);

        // Let the watcher observe and enqueue the file (no drain yet — DrainPollMs is huge on this instance).
        var pendingSummary = await PollUntil(
            () => BridgePipeClient.SendAsync(pipeName, PipeOperation.GetQueueSummary),
            r => BridgePipeClient.DeserializePayload<QueueSummaryResponse>(r)!.Pending == 1,
            TimeSpan.FromSeconds(10));
        Assert.Equal(1, BridgePipeClient.DeserializePayload<QueueSummaryResponse>(pendingSummary)!.Pending);

        // Hard-stop without graceful drain, simulating a service crash/kill.
        await firstWorker.StopAsync(default);

        // Second run: fresh Worker/Orchestrator over the SAME ProgramData root — this must recover the queue
        // and complete the upload with the fast drain interval and a working /bridge/studies route this time.
        var secondHandler = new ScriptedHandler()
            .Enqueue("/bridge/studies", HttpStatusCode.Created, """{"ok":true,"studyId":"study-restart-1","duplicate":false}""")
            .Enqueue("/bridge/heartbeat", HttpStatusCode.OK, """{"ok":true}""");
        var secondOptions = MakeOptions();
        var secondApiClient = new BridgeApiClient(new HttpClient(secondHandler), secondOptions.ServerUrl);
        var secondOrchestrator = new BridgeOrchestrator(secondOptions, secondApiClient, "1.0.0-it", NullLogger<BridgeOrchestrator>.Instance);
        var secondWorker = new Worker(secondOrchestrator, secondOptions, NullLogger<Worker>.Instance);
        _workers.Add(secondWorker);
        await secondWorker.StartAsync(default);

        var completedSummary = await PollUntil(
            () => BridgePipeClient.SendAsync(pipeName, PipeOperation.GetQueueSummary),
            r => BridgePipeClient.DeserializePayload<QueueSummaryResponse>(r)!.Completed == 1,
            TimeSpan.FromSeconds(10));
        Assert.Equal(1, BridgePipeClient.DeserializePayload<QueueSummaryResponse>(completedSummary)!.Completed);
    }

    private sealed class ScriptedHandler : HttpMessageHandler
    {
        private readonly Dictionary<string, Queue<(HttpStatusCode Status, string? Json)>> _routes = new();
        public List<string> RequestedBodies { get; } = [];

        public ScriptedHandler Enqueue(string pathContains, HttpStatusCode status, string? json = null)
        {
            if (!_routes.TryGetValue(pathContains, out var queue))
            {
                queue = new Queue<(HttpStatusCode, string?)>();
                _routes[pathContains] = queue;
            }
            queue.Enqueue((status, json));
            return this;
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Content is not null)
            {
                RequestedBodies.Add(await request.Content.ReadAsStringAsync(cancellationToken));
            }

            var path = request.RequestUri!.AbsolutePath;
            foreach (var (key, queue) in _routes)
            {
                if (path.Contains(key, StringComparison.Ordinal) && queue.Count > 0)
                {
                    var (status, json) = queue.Dequeue();
                    return new HttpResponseMessage(status)
                    {
                        Content = json is null ? null! : new StringContent(json, Encoding.UTF8, "application/json"),
                    };
                }
            }

            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }
    }
}
