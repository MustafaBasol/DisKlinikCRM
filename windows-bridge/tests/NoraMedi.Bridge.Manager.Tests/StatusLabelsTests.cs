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
}
