using System.Security.Cryptography;
using System.Text.Json;
using NoraMedi.Bridge.Core.Security;
using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Updates.Rollback;

public enum RollbackCacheOutcomeKind
{
    Cached,
    AlreadyCached,
    DownloadFailed,
    HashMismatch,
    SignatureUntrusted,
}

public sealed record RollbackCacheOutcome(RollbackCacheOutcomeKind Kind, RollbackCacheManifest? Manifest);

/// <summary>
/// Holds exactly one previously-trusted installer under
/// <c>updates\rollback\</c> — the bridge's own local rollback target,
/// independent of anything the server declares at the moment a rollback is
/// actually attempted (the server might be unreachable then; that must never
/// block a rollback decision — see docs/update-runbook.md "Rollback does not
/// require the backend").
///
/// Populated BEFORE a new version installs (<see cref="EnsureCachedAsync"/>,
/// called from <see cref="UpdateManager"/>'s staging step once the new
/// release's own verification has already passed) — never lazily fetched
/// at rollback time, since the whole point is that rollback works even
/// offline.
/// </summary>
public sealed class RollbackCache(UpdateDownloader downloader, string rollbackDirectory, string? extraAccountSid = null)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = false };
    private string ManifestPath => Path.Combine(rollbackDirectory, "manifest.json");

    /// <summary>
    /// Downloads and independently verifies <paramref name="package"/>, then
    /// atomically replaces whatever was previously cached. A no-op (returns
    /// <see cref="RollbackCacheOutcomeKind.AlreadyCached"/>) if the requested
    /// version+hash is already the cached entry — avoids re-downloading the
    /// same rollback target on every update check.
    /// </summary>
    public async Task<RollbackCacheOutcome> EnsureCachedAsync(
        RollbackPackageDescriptor package,
        CancellationToken cancellationToken,
        Func<string, string, SignatureTrustResult>? trustVerifierOverride = null,
        Func<string, bool>? pinnedThumbprintOverride = null)
    {
        var existing = TryLoadManifest();
        if (existing is not null
            && string.Equals(existing.Version, package.Version, StringComparison.OrdinalIgnoreCase)
            && string.Equals(existing.Sha256, package.Sha256, StringComparison.OrdinalIgnoreCase)
            && File.Exists(existing.InstallerPath))
        {
            return new RollbackCacheOutcome(RollbackCacheOutcomeKind.AlreadyCached, existing);
        }

        var download = await downloader.DownloadAsync(package.DownloadUrl, package.Sha256, cancellationToken);
        if (download.Kind == DownloadOutcomeKind.HashMismatch)
        {
            return new RollbackCacheOutcome(RollbackCacheOutcomeKind.HashMismatch, null);
        }
        if (download.Kind != DownloadOutcomeKind.Success || download.StagedPath is null)
        {
            return new RollbackCacheOutcome(RollbackCacheOutcomeKind.DownloadFailed, null);
        }

        var trust = trustVerifierOverride is not null
            ? trustVerifierOverride(download.StagedPath, package.PublisherThumbprint)
            : AuthenticodeVerifier.Verify(download.StagedPath, package.PublisherThumbprint);
        var isPinned = pinnedThumbprintOverride is not null
            ? pinnedThumbprintOverride(package.PublisherThumbprint)
            : PinnedPublisherThumbprints.Contains(package.PublisherThumbprint);

        if (trust != SignatureTrustResult.TrustedPublisher || !isPinned)
        {
            TryDelete(download.StagedPath);
            return new RollbackCacheOutcome(RollbackCacheOutcomeKind.SignatureUntrusted, null);
        }

        Directory.CreateDirectory(rollbackDirectory);
        var finalPath = Path.Combine(rollbackDirectory, "NoraMediBridgeSetup.exe");
        var tmpPath = finalPath + ".tmp";

        // Replace-in-place: copy the newly verified file to a temp name in the
        // rollback dir, delete the previous cached installer, then rename —
        // never a window where two rollback installers coexist.
        File.Copy(download.StagedPath, tmpPath, overwrite: true);
        TryDelete(download.StagedPath);
        if (File.Exists(finalPath)) TryDelete(finalPath);
        File.Move(tmpPath, finalPath, overwrite: true);
        ProgramDataAcl.ProtectFile(finalPath, extraAccountSid);

        var manifest = new RollbackCacheManifest(package.Version, finalPath, package.Sha256, package.PublisherThumbprint, DateTimeOffset.UtcNow);
        SaveManifest(manifest);
        return new RollbackCacheOutcome(RollbackCacheOutcomeKind.Cached, manifest);
    }

    public RollbackCacheManifest? TryLoadManifest()
    {
        if (!File.Exists(ManifestPath)) return null;
        try
        {
            var json = File.ReadAllText(ManifestPath);
            return JsonSerializer.Deserialize<RollbackCacheManifest>(json, JsonOptions);
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private void SaveManifest(RollbackCacheManifest manifest)
    {
        Directory.CreateDirectory(rollbackDirectory);
        var json = JsonSerializer.Serialize(manifest, JsonOptions);
        var tmp = ManifestPath + ".tmp";
        File.WriteAllText(tmp, json);
        File.Move(tmp, ManifestPath, overwrite: true);
        ProgramDataAcl.ProtectFile(ManifestPath, extraAccountSid);
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}
