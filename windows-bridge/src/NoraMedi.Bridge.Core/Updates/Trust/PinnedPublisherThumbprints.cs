namespace NoraMedi.Bridge.Core.Updates.Trust;

/// <summary>
/// The bridge's own compiled-in trust anchor for Authenticode signer
/// identities. This is the piece the server-declared
/// <c>ServerUpdateRelease.PublisherThumbprint</c> alone can never be: a
/// value that is NOT supplied, and cannot be redefined, by the same backend
/// whose response it is meant to constrain.
///
/// The server's declared thumbprint narrows which signer is expected for
/// *this one release*; this list is the independent, bridge-side ceiling on
/// which signers can ever be trusted at all, regardless of what any release
/// descriptor claims. A compromised backend, compromised release
/// configuration (env var), stolen bridge bearer credential, or DNS/TLS
/// interception can all influence the server's declared thumbprint — none
/// of them can edit this compiled-in constant, because it ships inside the
/// already-Authenticode-signed Core assembly and is never read from
/// ProgramData, the registry, or the network.
///
/// Empty until NoraMedi's production code-signing certificate is
/// provisioned (PR 7 scope — see docs/update-architecture.md "Trust
/// model" and "What PR 7 still owns"). While empty,
/// <see cref="AuthenticodeVerifier"/> callers must fail closed: no
/// server-declared thumbprint can substitute for a populated local
/// allowlist. That is the correct default for a LocalSystem-privileged
/// updater — it means production installs are refused until this file is
/// deliberately populated, not that the check is skipped.
///
/// Rotation: add the new thumbprint alongside the current one ("current" +
/// "next") for the overlap window, then remove the retired value once every
/// deployed bridge has updated past the cutover release. Both entries are
/// accepted simultaneously during that window — this is an allowlist, not a
/// single pinned value.
/// </summary>
public static class PinnedPublisherThumbprints
{
    /// <summary>
    /// SHA-1 Authenticode signer thumbprints (40 hex chars, no separators)
    /// this bridge will ever trust to run as LocalSystem. Populated by
    /// NoraMedi engineering at release-signing-certificate provisioning
    /// time — never derived from configuration, the server, or ProgramData.
    /// </summary>
    public static readonly IReadOnlyCollection<string> Values = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        // "PLACEHOLDER-CURRENT-NORAMEDI-CODE-SIGNING-CERT-THUMBPRINT",
        // "PLACEHOLDER-NEXT-NORAMEDI-CODE-SIGNING-CERT-THUMBPRINT",
    };

    /// <summary>True if the normalized thumbprint is one of the compiled-in accepted NoraMedi signer identities.</summary>
    public static bool Contains(string thumbprint)
    {
        var normalized = thumbprint.Trim().Replace(" ", "");
        foreach (var pinned in Values)
        {
            if (string.Equals(pinned.Trim().Replace(" ", ""), normalized, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
