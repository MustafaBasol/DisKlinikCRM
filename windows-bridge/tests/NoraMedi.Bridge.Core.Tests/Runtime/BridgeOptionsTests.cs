using NoraMedi.Bridge.Core.Runtime;

namespace NoraMedi.Bridge.Core.Tests.Runtime;

public class BridgeOptionsTests
{
    private static BridgeOptions New(string serverUrl) => new()
    {
        Enabled = true,
        ServerUrl = serverUrl,
        ProgramDataRoot = "unused",
    };

    [Theory]
    [InlineData("http://127.0.0.1:5000", "http://127.0.0.1:5000")]
    [InlineData("https://api.noramedi.com", "https://api.noramedi.com")]
    [InlineData("https://api.noramedi.com/", "https://api.noramedi.com")]
    public void SafeServerUrlOrigin_ReturnsSchemeHostPortOnly(string configured, string expectedOrigin)
    {
        Assert.Equal(expectedOrigin, New(configured).SafeServerUrlOrigin);
    }

    [Fact]
    public void SafeServerUrlOrigin_NeverIncludesPathOrQuery()
    {
        var options = New("https://api.noramedi.com/api/public/imaging/bridge/pair?code=12345678");

        Assert.DoesNotContain("pair", options.SafeServerUrlOrigin);
        Assert.DoesNotContain("code=", options.SafeServerUrlOrigin);
        Assert.Equal("https://api.noramedi.com", options.SafeServerUrlOrigin);
    }

    [Fact]
    public void SafeServerUrlOrigin_InvalidUrl_ReturnsPlaceholderRatherThanThrowing()
    {
        Assert.Equal("invalid", New("not-a-url").SafeServerUrlOrigin);
    }
}
