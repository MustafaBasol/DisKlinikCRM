using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using NoraMedi.Bridge.Core.Http;
using NoraMedi.Bridge.Core.Updates;
using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Tests.Updates;

public class UpdateBackgroundLoopTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("nmb-bgloop-").FullName;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly string CurrentUserSid = System.Security.Principal.WindowsIdentity.GetCurrent().User!.Value;

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    private static string ConfigJson(string mode, object? release) => JsonSerializer.Serialize(new { mode, release }, JsonOptions);

    private static object Release(string version, string sha256, bool signed = false, string? publisherThumbprint = null) => new
    {
        version,
        downloadUrl = "https://cdn.example.com/setup.exe",
        sha256,
        signed,
        publisherThumbprint,
        minimumSourceVersion = (string?)null,
        notes = (string?)null,
    };

    private (UpdateBackgroundLoop loop, List<UpdateState> installed) Make(
        UpdateManagerFakeHandler handler, bool hasActiveUpload, UpdatePolicyMode mode,
        Func<string, string, SignatureTrustResult>? trustOverride = null, string installedVersion = "0.4.6")
    {
        var apiClient = new BridgeApiClient(new HttpClient(handler), "https://api.noramedi.test");
        var options = new UpdateOptions { UpdatesDirectory = _dir, RequireTrustedSignature = false, StartupJitterSeconds = 1, CheckIntervalMinutes = 60 };
        var stateStore = new UpdateStateStore(_dir, CurrentUserSid);
        var downloader = new UpdateDownloader(new HttpClient(handler), options, CurrentUserSid);
        var manager = new UpdateManager(options, stateStore, downloader, apiClient, installedVersion, NullLogger.Instance, trustOverride);

        var installed = new List<UpdateState>();
        var loop = new UpdateBackgroundLoop(
            manager, downloader, options,
            () => "cred",
            () => hasActiveUpload,
            () => mode,
            state => installed.Add(state),
            NullLogger.Instance);
        return (loop, installed);
    }

    [Fact]
    public async Task TickAsync_NotifyMode_VerifiedRelease_NeverInstallsAutomatically()
    {
        var body = Encoding.UTF8.GetBytes("payload");
        var handler = new UpdateManagerFakeHandler { ConfigJson = ConfigJson("notify", Release("0.4.7", Convert.ToHexStringLower(SHA256.HashData(body)))), DownloadBytes = body };
        var (loop, installed) = Make(handler, hasActiveUpload: false, mode: UpdatePolicyMode.Notify);

        await loop.TickAsync(CancellationToken.None);

        Assert.Empty(installed);
    }

    [Fact]
    public async Task TickAsync_AutomaticMode_VerifiedRelease_UploadInFlight_DefersInstall()
    {
        var body = Encoding.UTF8.GetBytes("payload");
        var handler = new UpdateManagerFakeHandler { ConfigJson = ConfigJson("automatic", Release("0.4.7", Convert.ToHexStringLower(SHA256.HashData(body)))), DownloadBytes = body };
        var (loop, installed) = Make(handler, hasActiveUpload: true, mode: UpdatePolicyMode.Automatic);

        await loop.TickAsync(CancellationToken.None);

        Assert.Empty(installed);
    }

    [Fact]
    public async Task TickAsync_AutomaticMode_VerifiedRelease_NoUploadInFlight_TriggersInstall()
    {
        var body = Encoding.UTF8.GetBytes("payload");
        var handler = new UpdateManagerFakeHandler { ConfigJson = ConfigJson("automatic", Release("0.4.7", Convert.ToHexStringLower(SHA256.HashData(body)))), DownloadBytes = body };
        var (loop, installed) = Make(handler, hasActiveUpload: false, mode: UpdatePolicyMode.Automatic);

        await loop.TickAsync(CancellationToken.None);

        Assert.Single(installed);
        Assert.Equal(UpdateLifecycleState.Verified, installed[0].Lifecycle);
    }

    [Fact]
    public async Task TickAsync_DisabledMode_NeverInstalls()
    {
        var body = Encoding.UTF8.GetBytes("payload");
        var handler = new UpdateManagerFakeHandler { ConfigJson = ConfigJson("automatic", Release("0.4.7", Convert.ToHexStringLower(SHA256.HashData(body)))), DownloadBytes = body };
        var (loop, installed) = Make(handler, hasActiveUpload: false, mode: UpdatePolicyMode.Disabled);

        await loop.TickAsync(CancellationToken.None);

        Assert.Empty(installed);
    }

    [Fact]
    public async Task TickAsync_RepeatedNetworkFailures_BacksOffAndSkipsSubsequentTick()
    {
        var handler = new UpdateManagerFakeHandler { ConfigStatus = HttpStatusCode.InternalServerError };
        var (loop, _) = Make(handler, hasActiveUpload: false, mode: UpdatePolicyMode.Notify);

        await loop.TickAsync(CancellationToken.None);
        var callsAfterFirstTick = handler.CallCount;
        await loop.TickAsync(CancellationToken.None); // still within backoff window — should be skipped, not re-hit the server

        Assert.Equal(callsAfterFirstTick, handler.CallCount);
    }
}
