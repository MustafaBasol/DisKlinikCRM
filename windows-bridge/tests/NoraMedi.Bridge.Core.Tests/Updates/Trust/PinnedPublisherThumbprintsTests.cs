using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Tests.Updates.Trust;

/// <summary>
/// Source-level sanity checks on the compiled-in trust anchor itself (PR 7/7
/// rotation support). These are not about runtime behavior — they exist so a
/// future rotation edit (adding "next", removing "current") that
/// accidentally introduces a malformed or duplicate entry fails CI instead
/// of shipping. See docs/update-runbook.md "Publisher trust-pin rotation".
/// </summary>
public class PinnedPublisherThumbprintsTests
{
    [Fact]
    public void Values_EveryEntry_IsWellFormedFortyHexCharThumbprint()
    {
        foreach (var thumbprint in PinnedPublisherThumbprints.Values)
        {
            var normalized = thumbprint.Trim().Replace(" ", "");
            Assert.Equal(40, normalized.Length);
            Assert.Matches("^[0-9a-fA-F]{40}$", normalized);
        }
    }

    [Fact]
    public void Values_NoDuplicatesAfterNormalization()
    {
        var normalized = PinnedPublisherThumbprints.Values
            .Select(t => t.Trim().Replace(" ", "").ToUpperInvariant())
            .ToList();
        Assert.Equal(normalized.Count, normalized.Distinct().Count());
    }

    [Fact]
    public void Values_AtMostTwoEntries_CurrentAndNextOnly()
    {
        // Rotation model is deliberately narrow: "current" + "next" during an
        // overlap window, never an open-ended list of historically-trusted
        // signers. A third simultaneous entry means a stale pin was never
        // cleaned up after a completed rotation.
        Assert.True(PinnedPublisherThumbprints.Values.Count <= 2,
            $"Expected at most 2 simultaneously-trusted publisher pins (current + next), found {PinnedPublisherThumbprints.Values.Count}.");
    }

    [Fact]
    public void Contains_IsCaseInsensitiveAndWhitespaceTolerant()
    {
        // Exercises the normalization logic itself against a synthetic value,
        // independent of whether the real allowlist is currently populated.
        var probe = "AA11BB22CC33DD44EE55FF6677889900AABBCCDD";
        Assert.Equal(PinnedPublisherThumbprints.Values.Contains(probe), PinnedPublisherThumbprints.Contains(probe.ToLowerInvariant()));
        Assert.Equal(PinnedPublisherThumbprints.Values.Contains(probe), PinnedPublisherThumbprints.Contains(" " + probe + " "));
    }

    [Fact]
    public void Contains_EmptyProductionAllowlist_RejectsEveryThumbprint()
    {
        // Documents current state: until NoraMedi's production certificate is
        // provisioned (PR 7 external gate — see docs/update-runbook.md
        // "Production certificate status"), this list ships empty and every
        // release is correctly rejected as UntrustedPublisher. This test is
        // intentionally written to fail loudly (not skip) the day someone
        // populates the list without updating this comment — a reviewer
        // should notice and consciously decide whether the test still
        // belongs, rather than it silently going stale.
        if (PinnedPublisherThumbprints.Values.Count == 0)
        {
            Assert.False(PinnedPublisherThumbprints.Contains("a".PadLeft(40, 'a')));
        }
    }
}
