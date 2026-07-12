using System.Net;
using System.Security.Cryptography;
using System.Text;
using NoraMedi.Bridge.Core.Updates;

namespace NoraMedi.Bridge.Core.Tests.Updates;

public class UpdateDownloaderTests : IDisposable
{
    private readonly string _updatesDir = Directory.CreateTempSubdirectory("nmb-updates-").FullName;
    private static readonly string CurrentUserSid = System.Security.Principal.WindowsIdentity.GetCurrent().User!.Value;

    public void Dispose()
    {
        try { Directory.Delete(_updatesDir, recursive: true); } catch (IOException) { }
    }

    private UpdateDownloader Make(HttpMessageHandler handler, UpdateOptions? options = null) =>
        new(new HttpClient(handler), options ?? new UpdateOptions { UpdatesDirectory = _updatesDir }, CurrentUserSid);

    private static byte[] Sha256Of(byte[] data) => SHA256.HashData(data);
    private static string HexOf(byte[] hash) => Convert.ToHexStringLower(hash);

    [Fact]
    public async Task DownloadAsync_SuccessfulDownload_StagesFileAndMatchesHash()
    {
        var body = Encoding.UTF8.GetBytes("fake-installer-bytes");
        var expectedHash = HexOf(Sha256Of(body));
        var downloader = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, body, contentLength: body.Length));

        var outcome = await downloader.DownloadAsync("https://example.com/setup.exe", expectedHash, CancellationToken.None);

        Assert.Equal(DownloadOutcomeKind.Success, outcome.Kind);
        Assert.NotNull(outcome.StagedPath);
        Assert.True(File.Exists(outcome.StagedPath));
        Assert.Equal(body, await File.ReadAllBytesAsync(outcome.StagedPath!));
    }

    [Fact]
    public async Task DownloadAsync_HashMismatch_DeletesFileAndReturnsHashMismatch()
    {
        var body = Encoding.UTF8.GetBytes("actual-bytes");
        var downloader = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, body));

        var outcome = await downloader.DownloadAsync("https://example.com/setup.exe", "a".PadLeft(64, 'a'), CancellationToken.None);

        Assert.Equal(DownloadOutcomeKind.HashMismatch, outcome.Kind);
        Assert.Null(outcome.StagedPath);
        Assert.Empty(Directory.GetFiles(_updatesDir, "NoraMediBridgeSetup-*.exe"));
    }

    [Fact]
    public async Task DownloadAsync_DeclaredContentLengthExceedsMax_RejectedBeforeReadingBody()
    {
        var options = new UpdateOptions { UpdatesDirectory = _updatesDir, MaxDownloadBytes = 10 };
        var body = Encoding.UTF8.GetBytes("this is way more than ten bytes of content");
        var downloader = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, body, contentLength: body.Length), options);

        var outcome = await downloader.DownloadAsync("https://example.com/setup.exe", HexOf(Sha256Of(body)), CancellationToken.None);

        Assert.Equal(DownloadOutcomeKind.TooLarge, outcome.Kind);
    }

    [Fact]
    public async Task DownloadAsync_ActualBytesExceedMaxWithNoDeclaredLength_StillRejected()
    {
        var options = new UpdateOptions { UpdatesDirectory = _updatesDir, MaxDownloadBytes = 5 };
        var body = Encoding.UTF8.GetBytes("way more than five bytes");
        // No Content-Length header supplied — enforcement must happen during streaming, not only via the header.
        var downloader = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, body), options);

        var outcome = await downloader.DownloadAsync("https://example.com/setup.exe", HexOf(Sha256Of(body)), CancellationToken.None);

        Assert.Equal(DownloadOutcomeKind.TooLarge, outcome.Kind);
    }

    [Fact]
    public async Task DownloadAsync_HttpFailureStatus_ReturnsHttpFailure()
    {
        var downloader = Make(new FakeHttpMessageHandler(HttpStatusCode.NotFound, null));

        var outcome = await downloader.DownloadAsync("https://example.com/setup.exe", "a".PadLeft(64, 'a'), CancellationToken.None);

        Assert.Equal(DownloadOutcomeKind.HttpFailure, outcome.Kind);
    }

    [Fact]
    public async Task DownloadAsync_PlainHttpInProduction_RejectedBeforeAnyRequest()
    {
        var downloader = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, [1, 2, 3]));

        var outcome = await downloader.DownloadAsync("http://cdn.example.com/setup.exe", "a".PadLeft(64, 'a'), CancellationToken.None);

        Assert.Equal(DownloadOutcomeKind.RejectedUrl, outcome.Kind);
    }

    [Fact]
    public async Task DownloadAsync_LocalhostHttp_AllowedOnlyWhenExplicitlyEnabled()
    {
        var body = Encoding.UTF8.GetBytes("dev-payload");
        var hash = HexOf(Sha256Of(body));

        var disallowed = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, body));
        var disallowedOutcome = await disallowed.DownloadAsync("http://localhost:5000/setup.exe", hash, CancellationToken.None);
        Assert.Equal(DownloadOutcomeKind.RejectedUrl, disallowedOutcome.Kind);

        var allowedOptions = new UpdateOptions { UpdatesDirectory = _updatesDir, AllowInsecureLocalhostHttp = true };
        var allowed = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, body, contentLength: body.Length), allowedOptions);
        var allowedOutcome = await allowed.DownloadAsync("http://localhost:5000/setup.exe", hash, CancellationToken.None);
        Assert.Equal(DownloadOutcomeKind.Success, allowedOutcome.Kind);
    }

    [Fact]
    public async Task DownloadAsync_RedirectsFromHttpsToHttp_RejectedAfterResolution()
    {
        // Starting URL passes IsAcceptableDownloadUrl (https), but the handler resolved it (as
        // SocketsHttpHandler's AllowAutoRedirect would for a real 30x) to a plain-http final URI.
        // The pre-request scheme check alone can't catch this — only re-validating the resolved URI does.
        var body = Encoding.UTF8.GetBytes("payload");
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, body, contentLength: body.Length, finalRequestUri: new Uri("http://evil.example.com/setup.exe"));
        var downloader = Make(handler);

        var outcome = await downloader.DownloadAsync("https://cdn.example.com/setup.exe", HexOf(Sha256Of(body)), CancellationToken.None);

        Assert.Equal(DownloadOutcomeKind.RejectedUrl, outcome.Kind);
        Assert.Empty(Directory.GetFiles(_updatesDir, "NoraMediBridgeSetup-*.exe"));
    }

    [Fact]
    public async Task DownloadAsync_RedirectsToDifferentHttpsHost_StillAccepted()
    {
        // A same-scheme (https) redirect to a different host is not itself a security downgrade —
        // only scheme/localhost-exception rules from IsAcceptableDownloadUrl apply.
        var body = Encoding.UTF8.GetBytes("payload");
        var handler = new FakeHttpMessageHandler(HttpStatusCode.OK, body, contentLength: body.Length, finalRequestUri: new Uri("https://cdn2.example.com/setup.exe"));
        var downloader = Make(handler);

        var outcome = await downloader.DownloadAsync("https://cdn.example.com/setup.exe", HexOf(Sha256Of(body)), CancellationToken.None);

        Assert.Equal(DownloadOutcomeKind.Success, outcome.Kind);
    }

    [Fact]
    public async Task DownloadAsync_MalformedUrl_RejectedUrl()
    {
        var downloader = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, [1]));

        var outcome = await downloader.DownloadAsync("not-a-url", "a".PadLeft(64, 'a'), CancellationToken.None);

        Assert.Equal(DownloadOutcomeKind.RejectedUrl, outcome.Kind);
    }

    [Fact]
    public async Task DownloadAsync_Cancelled_NoFileLeftBehind()
    {
        var options = new UpdateOptions { UpdatesDirectory = _updatesDir };
        var downloader = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, Encoding.UTF8.GetBytes("payload"), delay: TimeSpan.FromSeconds(5)), options);
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var outcome = await downloader.DownloadAsync("https://example.com/setup.exe", "a".PadLeft(64, 'a'), cts.Token);

        Assert.Equal(DownloadOutcomeKind.Cancelled, outcome.Kind);
        var stagingDir = Path.Combine(_updatesDir, "staging");
        if (Directory.Exists(stagingDir)) Assert.Empty(Directory.GetFiles(stagingDir));
    }

    [Fact]
    public void CleanupStaleFiles_RemovesOnlyFilesOlderThanRetention_NeverTouchesStateJson()
    {
        Directory.CreateDirectory(_updatesDir);
        var staleFile = Path.Combine(_updatesDir, "NoraMediBridgeSetup-stale.exe");
        var freshFile = Path.Combine(_updatesDir, "NoraMediBridgeSetup-fresh.exe");
        var stateFile = Path.Combine(_updatesDir, "state.json");
        File.WriteAllText(staleFile, "x");
        File.WriteAllText(freshFile, "y");
        File.WriteAllText(stateFile, "{}");
        File.SetLastWriteTimeUtc(staleFile, DateTime.UtcNow.AddDays(-30));

        var options = new UpdateOptions { UpdatesDirectory = _updatesDir, StagedFileRetentionDays = 14 };
        var downloader = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, null), options);

        downloader.CleanupStaleFiles(DateTimeOffset.UtcNow);

        Assert.False(File.Exists(staleFile));
        Assert.True(File.Exists(freshFile));
        Assert.True(File.Exists(stateFile));
    }
}
