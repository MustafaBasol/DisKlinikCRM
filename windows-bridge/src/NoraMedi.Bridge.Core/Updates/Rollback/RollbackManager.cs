using Microsoft.Extensions.Logging;
using NoraMedi.Bridge.Core.Security;
using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Updates.Rollback;

/// <summary>
/// Composition root for the rollback subsystem — decides WHETHER a rollback
/// may run (single-flight, loop-prevented, independently re-verified against
/// the bridge's own compiled-in trust anchor) and produces the fixed,
/// non-caller-influenceable instruction for the helper process to execute.
/// It does not itself run msiexec or spawn the helper — see
/// <see cref="Runtime.BridgeOrchestrator"/>'s rollback launch glue, which
/// mirrors <c>TryLaunchUpdateHelper</c> for the forward-update path.
///
/// Narrow scope, deliberately: this restores only the exact version that was
/// cached immediately before the update currently being rolled back from —
/// never an arbitrary older version, never a caller-supplied path/URL. See
/// docs/update-runbook.md "Rollback state machine" for the full guarantees
/// and limitations (in particular: this is uninstall-then-install, not a
/// transactional swap — see that doc for the exact failure window).
/// </summary>
public sealed class RollbackManager(
    RollbackCache cache,
    RollbackStateStore stateStore,
    string upgradeCode,
    ILogger logger,
    Func<string, string, SignatureTrustResult>? trustVerifierOverride = null,
    Func<string, bool>? pinnedThumbprintOverride = null)
{
    private readonly object _gate = new();

    public RollbackState CurrentState => stateStore.Load();

    /// <summary>Call once on Service start, before anything else touches rollback state — same ordering guarantee <see cref="UpdateManager.ReconcileHelperResultOnStartup"/> gives the forward-update path.</summary>
    public void ReconcileOnStartup() => stateStore.ReconcileOnStartup();

    public Task EnsureRollbackTargetCachedAsync(RollbackPackageDescriptor package, CancellationToken cancellationToken) =>
        cache.EnsureCachedAsync(package, cancellationToken, trustVerifierOverride, pinnedThumbprintOverride);

    /// <summary>
    /// Attempts to prepare a rollback for <paramref name="offeredVersionThatFailed"/>
    /// (the version whose post-install health check just failed). Returns the
    /// verified instruction to hand the helper process, or null if rollback
    /// cannot proceed — in every null case the persisted state has already
    /// been set to a truthful terminal state (never left ambiguous).
    /// </summary>
    public RollbackHelperInstruction? TryPrepareRollback(string offeredVersionThatFailed)
    {
        lock (_gate)
        {
            var state = stateStore.Load();

            if (state.IsInProgress)
            {
                // Deliberately returns without persisting anything: a rollback is actively
                // running, and overwriting its in-flight state here (even with a dedicated
                // "already in progress" category) would race the thread actually driving it.
                return null;
            }

            // Loop prevention: a rollback already attempted (successfully or not) for
            // this exact offered version is never retried automatically. A second
            // "InstallUpdate/rollback" cycle offering the SAME broken version again
            // would otherwise be able to spin uninstall/install forever.
            if (string.Equals(state.AttemptedForOfferedVersion, offeredVersionThatFailed, StringComparison.OrdinalIgnoreCase)
                && state.Lifecycle is RollbackLifecycleState.Failed or RollbackLifecycleState.InterventionRequired or RollbackLifecycleState.Succeeded)
            {
                logger.LogWarning("rollback.loop_prevented offeredVersion={Version} priorLifecycle={Lifecycle}", offeredVersionThatFailed, state.Lifecycle);
                Persist(RollbackLifecycleState.InterventionRequired, RollbackErrorCategory.LoopPrevented, offeredVersionThatFailed, state.TargetVersion);
                return null;
            }

            var manifest = cache.TryLoadManifest();
            if (manifest is null || !File.Exists(manifest.InstallerPath))
            {
                logger.LogWarning("rollback.no_cached_package offeredVersion={Version}", offeredVersionThatFailed);
                Persist(RollbackLifecycleState.InterventionRequired, RollbackErrorCategory.NoCachedPackage, offeredVersionThatFailed, null);
                return null;
            }

            // Independent re-verification of the cached file — the manifest is our
            // own prior record, not something to trust blindly a second time; the
            // file could in principle have been tampered with (or truncated by a
            // crash) between caching and this rollback attempt.
            var actualHash = ComputeSha256(manifest.InstallerPath);
            if (!string.Equals(actualHash, manifest.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                logger.LogWarning("rollback.cache_hash_mismatch offeredVersion={Version}", offeredVersionThatFailed);
                Persist(RollbackLifecycleState.InterventionRequired, RollbackErrorCategory.CacheHashMismatch, offeredVersionThatFailed, manifest.Version);
                return null;
            }

            var trust = trustVerifierOverride is not null
                ? trustVerifierOverride(manifest.InstallerPath, manifest.PublisherThumbprint)
                : AuthenticodeVerifier.Verify(manifest.InstallerPath, manifest.PublisherThumbprint);
            var isPinned = pinnedThumbprintOverride is not null
                ? pinnedThumbprintOverride(manifest.PublisherThumbprint)
                : PinnedPublisherThumbprints.Contains(manifest.PublisherThumbprint);

            if (trust != SignatureTrustResult.TrustedPublisher || !isPinned)
            {
                logger.LogWarning("rollback.cache_signer_untrusted offeredVersion={Version}", offeredVersionThatFailed);
                Persist(RollbackLifecycleState.InterventionRequired, RollbackErrorCategory.CacheSignerUntrusted, offeredVersionThatFailed, manifest.Version);
                return null;
            }

            // The rollback target must be a genuinely different, older release
            // than the one that just failed — never a no-op "rollback" to the
            // same version, which would leave the unhealthy build in place.
            if (string.Equals(manifest.Version, offeredVersionThatFailed, StringComparison.OrdinalIgnoreCase))
            {
                logger.LogWarning("rollback.target_version_mismatch offeredVersion={Version}", offeredVersionThatFailed);
                Persist(RollbackLifecycleState.InterventionRequired, RollbackErrorCategory.TargetVersionMismatch, offeredVersionThatFailed, manifest.Version);
                return null;
            }

            Persist(RollbackLifecycleState.Preparing, RollbackErrorCategory.None, offeredVersionThatFailed, manifest.Version);
            return new RollbackHelperInstruction(manifest.InstallerPath, manifest.Sha256, manifest.Version, manifest.PublisherThumbprint, upgradeCode);
        }
    }

    /// <summary>Called immediately before the helper process is actually launched — mirrors <c>UpdateManager.TryLaunchInstall</c>'s Verified→InstallLaunched transition.</summary>
    public void MarkLaunched(string offeredVersionThatFailed, string targetVersion)
    {
        lock (_gate)
        {
            Persist(RollbackLifecycleState.Uninstalling, RollbackErrorCategory.None, offeredVersionThatFailed, targetVersion);
        }
    }

    /// <summary>Called by the Service after re-reading the helper's rollback result log.</summary>
    public void RecordResult(RollbackHelperResult result, string offeredVersionThatFailed, string targetVersion)
    {
        lock (_gate)
        {
            if (result.Outcome == nameof(RollbackLifecycleState.Succeeded))
            {
                Persist(RollbackLifecycleState.Succeeded, RollbackErrorCategory.None, offeredVersionThatFailed, targetVersion);
                return;
            }

            var category = Enum.TryParse<RollbackErrorCategory>(result.ErrorCategory, out var parsed) ? parsed : RollbackErrorCategory.Unknown;
            // A rollback that itself fails is always terminal/InterventionRequired —
            // never retried automatically (that would risk an uninstall/install
            // storm on a machine that may already be in a partially-installed state).
            logger.LogError("rollback.failed offeredVersion={Version} category={Category}", offeredVersionThatFailed, category);
            Persist(RollbackLifecycleState.InterventionRequired, category, offeredVersionThatFailed, targetVersion);
        }
    }

    private void Persist(RollbackLifecycleState lifecycle, RollbackErrorCategory category, string? offeredVersion, string? targetVersion)
    {
        stateStore.Save(new RollbackState(lifecycle, category, offeredVersion, targetVersion, DateTimeOffset.UtcNow));
    }

    private static string ComputeSha256(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var sha256 = System.Security.Cryptography.SHA256.Create();
        return Convert.ToHexStringLower(sha256.ComputeHash(stream));
    }
}
