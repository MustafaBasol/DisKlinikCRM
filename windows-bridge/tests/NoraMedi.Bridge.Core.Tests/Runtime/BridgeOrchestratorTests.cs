using System.Net;
using Microsoft.Extensions.Logging.Abstractions;
using NoraMedi.Bridge.Core.Http;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Core.Runtime;

namespace NoraMedi.Bridge.Core.Tests.Runtime;

public class BridgeOrchestratorTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-orch-").FullName;
    private readonly List<BridgeOrchestrator> _created = [];

    private BridgeOrchestrator NewOrchestrator(ScriptedHttpMessageHandler? handler = null, bool enabled = true)
    {
        var options = new BridgeOptions
        {
            Enabled = enabled,
            ServerUrl = "https://api.example.com",
            ProgramDataRoot = Path.Combine(_root, Guid.NewGuid().ToString("N")),
            HeartbeatIntervalSeconds = 1,
            StabilityMs = 30,
            DrainPollMs = 50,
            MaxAttempts = 3,
            BackoffBaseMs = 10,
            BackoffCapMs = 50,
        };
        var apiClient = new BridgeApiClient(new HttpClient(handler ?? new ScriptedHttpMessageHandler()), options.ServerUrl);
        var orchestrator = new BridgeOrchestrator(options, apiClient, "1.0.0-test", NullLogger<BridgeOrchestrator>.Instance);
        _created.Add(orchestrator);
        return orchestrator;
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
    public async Task Disabled_NeverStartsWatcherEvenWithABoundFolder()
    {
        var orchestrator = NewOrchestrator(enabled: false);
        var watchDir = Directory.CreateTempSubdirectory("nmb-orch-watch-").FullName;
        await orchestrator.AddOrUpdateFolderBindingAsync(new AddOrUpdateFolderBindingRequest(null, watchDir, "device-1", "IO"), default);

        orchestrator.Start();
        File.WriteAllBytes(Path.Combine(watchDir, "scan.jpg"), [0xFF, 0xD8, 0xFF]);
        await Task.Delay(300);

        var summary = await orchestrator.GetQueueSummaryAsync(default);
        Assert.Equal(0, summary.Pending + summary.Processing + summary.Failed + summary.Completed);

        var status = await orchestrator.GetServiceStatusAsync(default);
        Assert.Equal("disabled", status.ConnectionState);
    }

    [Fact]
    public async Task ProvisionWithPairingCode_Success_PersistsCredentialAndReportsPaired()
    {
        var handler = new ScriptedHttpMessageHandler().Enqueue(
            "/bridge/pair", HttpStatusCode.Created,
            """{"bridgeCredential":"nmb_test_token","bridgeAgentId":"agent-1","clinicName":"Demo Clinic","bindings":[],"serverTime":"2026-07-08T00:00:00.000Z"}""");
        var orchestrator = NewOrchestrator(handler);

        var response = await orchestrator.ProvisionWithPairingCodeAsync(new ProvisionWithPairingCodeRequest("12345678"), default);

        Assert.True(response.Ok);
        Assert.Equal("agent-1", response.BridgeAgentId);
        var status = await orchestrator.GetServiceStatusAsync(default);
        Assert.True(status.Paired);
    }

    [Fact]
    public async Task ProvisionWithPairingCode_Rejected_DoesNotPersistAnything()
    {
        var handler = new ScriptedHttpMessageHandler().Enqueue("/bridge/pair", HttpStatusCode.Unauthorized);
        var orchestrator = NewOrchestrator(handler);

        var response = await orchestrator.ProvisionWithPairingCodeAsync(new ProvisionWithPairingCodeRequest("00000000"), default);

        Assert.False(response.Ok);
        var status = await orchestrator.GetServiceStatusAsync(default);
        Assert.False(status.Paired);
    }

    [Fact]
    public async Task EndToEnd_FolderDropToServerUpload_CompletesThroughRealQueueAndWatcher()
    {
        var handler = new ScriptedHttpMessageHandler()
            .Enqueue("/bridge/pair", HttpStatusCode.Created,
                """{"bridgeCredential":"nmb_test_token","bridgeAgentId":"agent-1","clinicName":"Demo","bindings":[],"serverTime":"2026-07-08T00:00:00.000Z"}""")
            .Enqueue("/bridge/studies", HttpStatusCode.Created, """{"ok":true,"studyId":"study-1","duplicate":false}""")
            .Enqueue("/bridge/heartbeat", HttpStatusCode.OK, """{"ok":true}""");
        var orchestrator = NewOrchestrator(handler);

        await orchestrator.ProvisionWithPairingCodeAsync(new ProvisionWithPairingCodeRequest("12345678"), default);
        var watchDir = Directory.CreateTempSubdirectory("nmb-orch-e2e-").FullName;
        await orchestrator.AddOrUpdateFolderBindingAsync(new AddOrUpdateFolderBindingRequest(null, watchDir, "device-1", "IO"), default);
        orchestrator.Start();

        File.WriteAllBytes(Path.Combine(watchDir, "scan.jpg"), [0xFF, 0xD8, 0xFF, 0x01, 0x02, 0x03]);

        var summary = await PollUntil(
            () => orchestrator.GetQueueSummaryAsync(default),
            s => s.Completed == 1,
            TimeSpan.FromSeconds(10));

        Assert.Equal(1, summary.Completed);
        Assert.Equal(0, summary.Pending);
        Assert.Equal(0, summary.Failed);

        // Source file must never be touched, renamed, or deleted by the pipeline.
        Assert.True(File.Exists(Path.Combine(watchDir, "scan.jpg")));

        // Never sends the local folder path to the server — only watchId/deviceId travel in the upload.
        Assert.DoesNotContain(handler.RequestedPaths, p => p.Contains(watchDir, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task PermanentFailure_ThenManualRetry_Succeeds()
    {
        var handler = new ScriptedHttpMessageHandler()
            .Enqueue("/bridge/pair", HttpStatusCode.Created,
                """{"bridgeCredential":"nmb_test_token","bridgeAgentId":"agent-1","clinicName":"Demo","bindings":[],"serverTime":"2026-07-08T00:00:00.000Z"}""")
            .Enqueue("/bridge/studies", HttpStatusCode.NotFound) // deviceId unknown to server -> permanent failure
            .Enqueue("/bridge/heartbeat", HttpStatusCode.OK, """{"ok":true}""");
        var orchestrator = NewOrchestrator(handler);

        await orchestrator.ProvisionWithPairingCodeAsync(new ProvisionWithPairingCodeRequest("12345678"), default);
        var watchDir = Directory.CreateTempSubdirectory("nmb-orch-fail-").FullName;
        await orchestrator.AddOrUpdateFolderBindingAsync(new AddOrUpdateFolderBindingRequest(null, watchDir, "device-1", "IO"), default);
        orchestrator.Start();
        File.WriteAllBytes(Path.Combine(watchDir, "scan.jpg"), [0xFF, 0xD8, 0xFF]);

        var failedSummary = await PollUntil(
            () => orchestrator.GetQueueSummaryAsync(default),
            s => s.Failed == 1,
            TimeSpan.FromSeconds(10));
        Assert.Equal(1, failedSummary.Failed);

        // Find the ingestKey via diagnostics isn't exposed; recompute it directly since content is known.
        var ingestKey = NoraMedi.Bridge.Core.Hashing.IngestKeyHasher.ComputeHex([0xFF, 0xD8, 0xFF]);
        handler.Enqueue("/bridge/studies", HttpStatusCode.Created, """{"ok":true,"studyId":"study-1","duplicate":false}""");
        var retryResult = await orchestrator.RetryFailedItemAsync(new RetryFailedItemRequest(ingestKey), default);
        Assert.True(retryResult.Ok);

        var completedSummary = await PollUntil(
            () => orchestrator.GetQueueSummaryAsync(default),
            s => s.Completed == 1,
            TimeSpan.FromSeconds(10));
        Assert.Equal(1, completedSummary.Completed);
        Assert.Equal(0, completedSummary.Failed);
    }

    [Fact]
    public async Task ValidateFolder_ExistingAndMissingFolders_ReportedAccurately()
    {
        var orchestrator = NewOrchestrator();
        var existingDir = Directory.CreateTempSubdirectory("nmb-orch-validate-").FullName;

        var okResult = await orchestrator.ValidateFolderAsync(new ValidateFolderRequest(existingDir), default);
        Assert.True(okResult.Exists);
        Assert.True(okResult.Readable);

        var missingResult = await orchestrator.ValidateFolderAsync(new ValidateFolderRequest(Path.Combine(existingDir, "does-not-exist")), default);
        Assert.False(missingResult.Exists);
    }

    [Fact]
    public async Task AddThenRemoveFolderBinding_ReflectedInGetBindings()
    {
        var orchestrator = NewOrchestrator();
        var watchDir = Directory.CreateTempSubdirectory("nmb-orch-binding-").FullName;

        var added = await orchestrator.AddOrUpdateFolderBindingAsync(new AddOrUpdateFolderBindingRequest(null, watchDir, "device-1", "IO"), default);
        var bindingsAfterAdd = await orchestrator.GetBindingsAsync(default);
        Assert.Contains(bindingsAfterAdd, b => b.WatchId == added.WatchId && b.Path == watchDir);

        await orchestrator.RemoveFolderBindingAsync(new RemoveFolderBindingRequest(added.WatchId), default);
        var bindingsAfterRemove = await orchestrator.GetBindingsAsync(default);
        Assert.DoesNotContain(bindingsAfterRemove, b => b.WatchId == added.WatchId);
    }

    [Fact]
    public async Task ExportDiagnostics_NeverIncludesLocalFolderPath()
    {
        var orchestrator = NewOrchestrator();
        var watchDir = Directory.CreateTempSubdirectory("nmb-orch-diag-").FullName;
        await orchestrator.AddOrUpdateFolderBindingAsync(new AddOrUpdateFolderBindingRequest(null, watchDir, "device-1", "IO"), default);
        orchestrator.Start();
        await Task.Delay(600); // let the watcher observe availability at least once

        var snapshot = await orchestrator.ExportDiagnosticsAsync(default);
        var json = System.Text.Json.JsonSerializer.Serialize(snapshot);

        Assert.DoesNotContain(watchDir, json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task TestConnection_WithoutCredential_ReportsNotPaired()
    {
        var orchestrator = NewOrchestrator();
        var result = await orchestrator.TestConnectionAsync(default);
        Assert.False(result.Reachable);
    }

    public void Dispose()
    {
        foreach (var orchestrator in _created)
        {
            orchestrator.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
