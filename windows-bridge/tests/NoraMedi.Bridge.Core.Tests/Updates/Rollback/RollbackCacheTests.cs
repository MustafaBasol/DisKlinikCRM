using System.Net;
using System.Security.Cryptography;
using System.Text;
using NoraMedi.Bridge.Core.Updates;
using NoraMedi.Bridge.Core.Updates.Rollback;
using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Tests.Updates.Rollback;

public class RollbackCacheTests : IDisposable
{
    private readonly string _updatesDir = Directory.CreateTempSubdirectory("nmb-rollback-updates-").FullName;
    private readonly string _rollbackDir;
    private static readonly string CurrentUserSid = System.Security.Principal.WindowsIdentity.GetCurrent().User!.Value;

    public RollbackCacheTests()
    {
        _rollbackDir = Path.Combine(_updatesDir, "rollback");
    }

    public void Dispose()
    {
        try { Directory.Delete(_updatesDir, recursive: true); } catch (IOException) { }
    }

    private static byte[] Sha256Of(byte[] data) => SHA256.HashData(data);
    private static string HexOf(byte[] hash) => Convert.ToHexStringLower(hash);
    private const string ValidThumbprint = "c123456789012345678901234567890123456789";

    private RollbackCache Make(HttpMessageHandler handler) =>
        new(new UpdateDownloader(new HttpClient(handler), new UpdateOptions { UpdatesDirectory = _updatesDir }, CurrentUserSid), _rollbackDir, CurrentUserSid);

    [Fact]
    public async Task EnsureCachedAsync_ValidPackage_CachesAndWritesManifest()
    {
        var body = Encoding.UTF8.GetBytes("prior-trusted-installer");
        var hash = HexOf(Sha256Of(body));
        var cache = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, body, contentLength: body.Length));
        var package = new RollbackPackageDescriptor("0.4.6", "https://cdn.example.com/prior.exe", hash, ValidThumbprint);

        var outcome = await cache.EnsureCachedAsync(package, CancellationToken.None,
            trustVerifierOverride: (_, _) => SignatureTrustResult.TrustedPublisher,
            pinnedThumbprintOverride: _ => true);

        Assert.Equal(RollbackCacheOutcomeKind.Cached, outcome.Kind);
        Assert.NotNull(outcome.Manifest);
        Assert.Equal("0.4.6", outcome.Manifest!.Version);
        Assert.True(File.Exists(outcome.Manifest.InstallerPath));
        Assert.Equal(body, await File.ReadAllBytesAsync(outcome.Manifest.InstallerPath));

        var reloaded = cache.TryLoadManifest();
        Assert.NotNull(reloaded);
        Assert.Equal(outcome.Manifest.Sha256, reloaded!.Sha256);
    }

    [Fact]
    public async Task EnsureCachedAsync_HashMismatch_DoesNotCache()
    {
        var body = Encoding.UTF8.GetBytes("tampered-bytes");
        var cache = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, body));
        var package = new RollbackPackageDescriptor("0.4.6", "https://cdn.example.com/prior.exe", "a".PadLeft(64, 'a'), ValidThumbprint);

        var outcome = await cache.EnsureCachedAsync(package, CancellationToken.None);

        Assert.Equal(RollbackCacheOutcomeKind.HashMismatch, outcome.Kind);
        Assert.Null(cache.TryLoadManifest());
    }

    [Fact]
    public async Task EnsureCachedAsync_UntrustedSigner_DoesNotCache()
    {
        var body = Encoding.UTF8.GetBytes("some-installer-bytes");
        var hash = HexOf(Sha256Of(body));
        var cache = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, body, contentLength: body.Length));
        var package = new RollbackPackageDescriptor("0.4.6", "https://cdn.example.com/prior.exe", hash, ValidThumbprint);

        var outcome = await cache.EnsureCachedAsync(package, CancellationToken.None,
            trustVerifierOverride: (_, _) => SignatureTrustResult.WrongPublisher,
            pinnedThumbprintOverride: _ => true);

        Assert.Equal(RollbackCacheOutcomeKind.SignatureUntrusted, outcome.Kind);
        Assert.Null(cache.TryLoadManifest());
    }

    [Fact]
    public async Task EnsureCachedAsync_UnpinnedSigner_DoesNotCache_EvenIfAuthenticodeTrusted()
    {
        // Mirrors the same "server narrows, local allowlist is the ceiling" invariant
        // UpdateManager.StageAsync already enforces for forward updates.
        var body = Encoding.UTF8.GetBytes("validly-signed-but-not-noramedi");
        var hash = HexOf(Sha256Of(body));
        var cache = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, body, contentLength: body.Length));
        var package = new RollbackPackageDescriptor("0.4.6", "https://cdn.example.com/prior.exe", hash, ValidThumbprint);

        var outcome = await cache.EnsureCachedAsync(package, CancellationToken.None,
            trustVerifierOverride: (_, _) => SignatureTrustResult.TrustedPublisher,
            pinnedThumbprintOverride: _ => false);

        Assert.Equal(RollbackCacheOutcomeKind.SignatureUntrusted, outcome.Kind);
        Assert.Null(cache.TryLoadManifest());
    }

    [Fact]
    public async Task EnsureCachedAsync_SameVersionAndHashAlreadyCached_SkipsRedownload()
    {
        var body = Encoding.UTF8.GetBytes("same-package-bytes");
        var hash = HexOf(Sha256Of(body));
        var handler = new CountingFakeHandler(HttpStatusCode.OK, body);
        var cache = Make(handler);
        var package = new RollbackPackageDescriptor("0.4.6", "https://cdn.example.com/prior.exe", hash, ValidThumbprint);

        var first = await cache.EnsureCachedAsync(package, CancellationToken.None,
            trustVerifierOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedThumbprintOverride: _ => true);
        var second = await cache.EnsureCachedAsync(package, CancellationToken.None,
            trustVerifierOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedThumbprintOverride: _ => true);

        Assert.Equal(RollbackCacheOutcomeKind.Cached, first.Kind);
        Assert.Equal(RollbackCacheOutcomeKind.AlreadyCached, second.Kind);
        Assert.Equal(1, handler.RequestCount);
    }

    [Fact]
    public async Task EnsureCachedAsync_NewerReleaseRotatesOutThePreviousCachedEntry()
    {
        var bodyA = Encoding.UTF8.GetBytes("version-a-bytes");
        var hashA = HexOf(Sha256Of(bodyA));
        var cacheA = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, bodyA, contentLength: bodyA.Length));
        await cacheA.EnsureCachedAsync(new RollbackPackageDescriptor("0.4.5", "https://cdn.example.com/a.exe", hashA, ValidThumbprint), CancellationToken.None,
            trustVerifierOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedThumbprintOverride: _ => true);

        var bodyB = Encoding.UTF8.GetBytes("version-b-bytes-longer");
        var hashB = HexOf(Sha256Of(bodyB));
        var cacheB = Make(new FakeHttpMessageHandler(HttpStatusCode.OK, bodyB, contentLength: bodyB.Length));
        var outcome = await cacheB.EnsureCachedAsync(new RollbackPackageDescriptor("0.4.6", "https://cdn.example.com/b.exe", hashB, ValidThumbprint), CancellationToken.None,
            trustVerifierOverride: (_, _) => SignatureTrustResult.TrustedPublisher, pinnedThumbprintOverride: _ => true);

        Assert.Equal(RollbackCacheOutcomeKind.Cached, outcome.Kind);
        var manifest = cacheB.TryLoadManifest();
        Assert.Equal("0.4.6", manifest!.Version);
        Assert.Single(Directory.GetFiles(_rollbackDir, "NoraMediBridgeSetup.exe"));
        Assert.Equal(bodyB, await File.ReadAllBytesAsync(manifest.InstallerPath));
    }
}

/// <summary>Counts requests so cache-hit behavior (no redundant download) can be asserted.</summary>
internal sealed class CountingFakeHandler(HttpStatusCode status, byte[] body) : HttpMessageHandler
{
    public int RequestCount { get; private set; }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        RequestCount++;
        var response = new HttpResponseMessage(status) { Content = new ByteArrayContent(body) };
        response.Content.Headers.ContentLength = body.Length;
        response.RequestMessage = new HttpRequestMessage(request.Method, request.RequestUri);
        return Task.FromResult(response);
    }
}
