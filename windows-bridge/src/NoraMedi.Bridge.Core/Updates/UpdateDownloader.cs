using System.Security.Cryptography;
using NoraMedi.Bridge.Core.Security;

namespace NoraMedi.Bridge.Core.Updates;

public enum DownloadOutcomeKind
{
    Success,
    RejectedUrl,
    NetworkFailure,
    HttpFailure,
    TooLarge,
    Cancelled,
    HashMismatch,
}

public sealed record DownloadOutcome(DownloadOutcomeKind Kind, string? StagedPath, long Bytes);

/// <summary>
/// Downloads a release installer to an ACL-protected staging directory,
/// verifying SHA-256 while streaming (no separate re-read pass), then
/// atomically promotes it to its final staged name only once the hash
/// matches — a partial or hash-mismatched download is deleted immediately
/// and never executed or left half-written under the final name. See
/// docs/update-architecture.md "Download & staging".
/// </summary>
public sealed class UpdateDownloader(HttpClient httpClient, UpdateOptions options, string? extraAccountSid = null)
{
    public async Task<DownloadOutcome> DownloadAsync(
        string downloadUrl, string expectedSha256, CancellationToken cancellationToken, IProgress<(long downloaded, long? total)>? progress = null)
    {
        if (!IsAcceptableDownloadUrl(downloadUrl))
        {
            return new DownloadOutcome(DownloadOutcomeKind.RejectedUrl, null, 0);
        }

        // Deliberately no ProgramDataAcl.ProtectDirectory here — both
        // directories are always under the bridge's already-ACL'd
        // ProgramData root and inherit its ACEs on creation; see the
        // matching note in UpdateStateStore.Save.
        Directory.CreateDirectory(options.UpdatesDirectory);
        var stagingDir = Path.Combine(options.UpdatesDirectory, "staging");
        Directory.CreateDirectory(stagingDir);

        var tempPath = Path.Combine(stagingDir, $"{Guid.NewGuid():N}.download");

        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(options.DownloadTimeoutSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

        try
        {
            using var response = await httpClient.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead, linkedCts.Token);
            if (!response.IsSuccessStatusCode)
            {
                return new DownloadOutcome(DownloadOutcomeKind.HttpFailure, null, 0);
            }

            // HttpClient follows redirects transparently (AllowAutoRedirect defaults to true on the
            // real SocketsHttpHandler this class is constructed with in production), so
            // IsAcceptableDownloadUrl(downloadUrl) above only validated the *starting* URL — a CDN
            // issuing an https→http (or https→attacker-host) redirect would otherwise have its
            // response body trusted here without ever being scheme-checked. A redirect-following
            // handler sets response.RequestMessage.RequestUri to the actually-resolved final URI;
            // re-validate it before a single byte of the body is streamed to disk. (A handler that
            // never populates RequestMessage — as some minimal test doubles don't — is treated as "no
            // redirect happened", falling back to the already-validated starting URL rather than
            // spuriously rejecting every request.)
            if (response.RequestMessage?.RequestUri is { } finalUri && !IsAcceptableDownloadUrl(finalUri.ToString()))
            {
                return new DownloadOutcome(DownloadOutcomeKind.RejectedUrl, null, 0);
            }

            if (response.Content.Headers.ContentLength is { } declaredLength && declaredLength > options.MaxDownloadBytes)
            {
                return new DownloadOutcome(DownloadOutcomeKind.TooLarge, null, 0);
            }

            await using var httpStream = await response.Content.ReadAsStreamAsync(linkedCts.Token);
            await using var fileStream = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None);

            using var sha256 = SHA256.Create();
            var buffer = new byte[81920];
            long totalRead = 0;
            int read;
            while ((read = await httpStream.ReadAsync(buffer, linkedCts.Token)) > 0)
            {
                totalRead += read;
                if (totalRead > options.MaxDownloadBytes)
                {
                    fileStream.Close();
                    TryDelete(tempPath);
                    return new DownloadOutcome(DownloadOutcomeKind.TooLarge, null, totalRead);
                }

                sha256.TransformBlock(buffer, 0, read, null, 0);
                await fileStream.WriteAsync(buffer.AsMemory(0, read), linkedCts.Token);
                progress?.Report((totalRead, response.Content.Headers.ContentLength));
            }

            sha256.TransformFinalBlock([], 0, 0);
            await fileStream.FlushAsync(linkedCts.Token);
            fileStream.Close();

            var actualHash = Convert.ToHexStringLower(sha256.Hash!);
            if (!string.Equals(actualHash, expectedSha256.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                TryDelete(tempPath);
                return new DownloadOutcome(DownloadOutcomeKind.HashMismatch, null, totalRead);
            }

            var finalPath = Path.Combine(options.UpdatesDirectory, $"NoraMediBridgeSetup-{Guid.NewGuid():N}.exe");
            File.Move(tempPath, finalPath, overwrite: false);
            ProgramDataAcl.ProtectFile(finalPath, extraAccountSid);

            return new DownloadOutcome(DownloadOutcomeKind.Success, finalPath, totalRead);
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            TryDelete(tempPath);
            return new DownloadOutcome(DownloadOutcomeKind.NetworkFailure, null, 0);
        }
        catch (OperationCanceledException)
        {
            TryDelete(tempPath);
            return new DownloadOutcome(DownloadOutcomeKind.Cancelled, null, 0);
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or UnauthorizedAccessException)
        {
            TryDelete(tempPath);
            return new DownloadOutcome(DownloadOutcomeKind.NetworkFailure, null, 0);
        }
    }

    /// <summary>Mirrors server/src/services/imaging/releaseMetadataValidation.ts's isAcceptableDownloadUrl exactly: HTTPS always, plain HTTP only for localhost/127.0.0.1 and only when explicitly allowed.</summary>
    public bool IsAcceptableDownloadUrl(string rawUrl)
    {
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme == Uri.UriSchemeHttps) return true;
        return uri.Scheme == Uri.UriSchemeHttp
            && options.AllowInsecureLocalhostHttp
            && (uri.Host == "localhost" || uri.Host == "127.0.0.1");
    }

    /// <summary>Deletes staged/rejected installer files older than the configured retention window — never touches state.json.</summary>
    public void CleanupStaleFiles(DateTimeOffset now)
    {
        if (!Directory.Exists(options.UpdatesDirectory)) return;
        var cutoff = now - TimeSpan.FromDays(options.StagedFileRetentionDays);

        foreach (var path in Directory.EnumerateFiles(options.UpdatesDirectory, "NoraMediBridgeSetup-*.exe"))
        {
            TryDeleteIfOlderThan(path, cutoff);
        }

        var stagingDir = Path.Combine(options.UpdatesDirectory, "staging");
        if (!Directory.Exists(stagingDir)) return;
        foreach (var path in Directory.EnumerateFiles(stagingDir, "*.download"))
        {
            TryDeleteIfOlderThan(path, cutoff);
        }
    }

    private static void TryDeleteIfOlderThan(string path, DateTimeOffset cutoff)
    {
        try
        {
            if (File.GetLastWriteTimeUtc(path) < cutoff.UtcDateTime) File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}
