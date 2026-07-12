using NoraMedi.Bridge.Core.Updates;

namespace NoraMedi.Bridge.Core.Tests.Updates;

public class UpdateVersionTests
{
    [Theory]
    [InlineData("0.4.7", true)]
    [InlineData("0.4.7.0", true)]
    [InlineData("1.2", true)]
    [InlineData("1.2.3.4.5", false)]
    [InlineData("1", false)]
    [InlineData("1.2.x", false)]
    [InlineData("1.-2.3", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    [InlineData("latest", false)]
    public void TryParse_AcceptsOnlyWellFormedNumericVersions(string? input, bool expected)
    {
        Assert.Equal(expected, UpdateVersion.TryParse(input, out _));
    }

    [Fact]
    public void IsUpgrade_NewerVersion_ReturnsTrue()
    {
        UpdateVersion.TryParse("0.4.6", out var installed);
        UpdateVersion.TryParse("0.4.7", out var offered);
        Assert.True(UpdateVersion.IsUpgrade(installed, offered));
    }

    [Fact]
    public void IsUpgrade_EqualVersion_ReturnsFalse()
    {
        UpdateVersion.TryParse("0.4.7", out var installed);
        UpdateVersion.TryParse("0.4.7", out var offered);
        Assert.False(UpdateVersion.IsUpgrade(installed, offered));
    }

    [Fact]
    public void IsUpgrade_OlderVersion_ReturnsFalse_AntiDowngrade()
    {
        UpdateVersion.TryParse("0.4.7", out var installed);
        UpdateVersion.TryParse("0.4.6", out var offered);
        Assert.False(UpdateVersion.IsUpgrade(installed, offered));
    }

    [Fact]
    public void CompareTo_ComparesFieldByFieldNotLexically()
    {
        UpdateVersion.TryParse("0.10.0", out var a);
        UpdateVersion.TryParse("0.9.0", out var b);
        Assert.True(a > b); // "0.10.0" > "0.9.0" numerically, would be false lexically
    }

    [Theory]
    [InlineData("0.4.7", true)]
    [InlineData("255.255.65535", true)]
    [InlineData("0.0.0", true)]
    [InlineData("256.0.0", false)]
    [InlineData("0.256.0", false)]
    [InlineData("0.0.65536", false)]
    [InlineData("0.4.7.0", false)] // MSI ProductVersion is exactly 3 fields
    [InlineData("0.4", false)]
    [InlineData("-1.0.0", false)]
    [InlineData("", false)]
    public void IsValidMsiProductVersion_EnforcesThreeFieldRanges(string value, bool expected)
    {
        Assert.Equal(expected, UpdateVersion.IsValidMsiProductVersion(value));
    }
}
