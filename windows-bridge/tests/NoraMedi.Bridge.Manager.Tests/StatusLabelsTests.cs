using NoraMedi.Bridge.Manager.Models;

namespace NoraMedi.Bridge.Manager.Tests;

public class StatusLabelsTests
{
    [Fact]
    public void FromConnectionState_MapsKnownAndUnknownValues()
    {
        Assert.Equal(StatusLabels.Connected, StatusLabels.FromConnectionState("online"));
        Assert.Equal(StatusLabels.NotConnected, StatusLabels.FromConnectionState("offline"));
        Assert.Equal(StatusLabels.NotConnected, StatusLabels.FromConnectionState("disabled"));
        Assert.Equal(StatusLabels.ServiceUnavailable, StatusLabels.FromConnectionState(null));
        Assert.Equal(StatusLabels.ServiceUnavailable, StatusLabels.FromConnectionState("unexpected-future-value"));
    }

    [Fact]
    public void FromErrorKind_MapsEveryKind()
    {
        Assert.Equal(StatusLabels.ServiceUnavailable, StatusLabels.FromErrorKind(ManagerErrorKind.ServiceUnavailable));
        Assert.Equal(StatusLabels.ActionRequired, StatusLabels.FromErrorKind(ManagerErrorKind.Unauthorized));
        Assert.Equal(StatusLabels.NotConnected, StatusLabels.FromErrorKind(ManagerErrorKind.FeatureDisabled));
        Assert.Equal(StatusLabels.ConnectionRequired, StatusLabels.FromErrorKind(ManagerErrorKind.NotFound));
        Assert.Equal(StatusLabels.ActionRequired, StatusLabels.FromErrorKind(ManagerErrorKind.InvalidPayload));
        Assert.Equal(StatusLabels.ServiceUnavailable, StatusLabels.FromErrorKind(ManagerErrorKind.Internal));
    }

    [Fact]
    public void FromRollbackLifecycle_NoneReturnsNull()
    {
        Assert.Null(StatusLabels.FromRollbackLifecycle("None"));
    }

    [Theory]
    [InlineData("Preparing")]
    [InlineData("Uninstalling")]
    [InlineData("Installing")]
    [InlineData("Succeeded")]
    [InlineData("Failed")]
    [InlineData("InterventionRequired")]
    public void FromRollbackLifecycle_EveryNonNoneStateHasANonEmptyLabel(string lifecycle)
    {
        var label = StatusLabels.FromRollbackLifecycle(lifecycle);
        Assert.False(string.IsNullOrWhiteSpace(label));
    }

    [Fact]
    public void FromRollbackLifecycle_FailedAndInterventionRequired_NeverLeakInternalCategoryNames()
    {
        // Support-facing categories (CacheHashMismatch, LoopPrevented, etc.) must never appear
        // verbatim in the clinic-facing label — only the two generic, actionable messages.
        var failed = StatusLabels.FromRollbackLifecycle("Failed");
        var intervention = StatusLabels.FromRollbackLifecycle("InterventionRequired");
        foreach (var label in new[] { failed, intervention })
        {
            Assert.DoesNotContain("Mismatch", label);
            Assert.DoesNotContain("Untrusted", label);
            Assert.DoesNotContain("LoopPrevented", label);
            Assert.DoesNotContain("Category", label);
        }
    }

    [Fact]
    public void FromRollbackLifecycle_UnrecognizedValue_FallsBackToNone()
    {
        Assert.Null(StatusLabels.FromRollbackLifecycle("SomeFutureState"));
    }
}
