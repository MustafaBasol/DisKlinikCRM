using NoraMedi.Bridge.Core.Diagnostics;

namespace NoraMedi.Bridge.Core.Tests.Diagnostics;

public class DiagnosticsRedactorTests
{
    [Fact]
    public void ShortIngestKey_TruncatesLongHashToPrefix()
    {
        var full = new string('a', 64);
        var shortened = DiagnosticsRedactor.ShortIngestKey(full);

        Assert.Equal("aaaaaaaa…", shortened);
        Assert.True(shortened.Length < full.Length);
    }

    [Fact]
    public void ShortIngestKey_ShortValue_ReturnedUnchanged()
    {
        Assert.Equal("abc", DiagnosticsRedactor.ShortIngestKey("abc"));
    }

    [Fact]
    public void RedactCredential_NeverReturnsAnyPartOfInput()
    {
        var redacted = DiagnosticsRedactor.RedactCredential("nmb_super_secret_token_value");
        Assert.DoesNotContain("nmb_", redacted);
        Assert.DoesNotContain("secret", redacted);
        Assert.Equal("<redacted>", redacted);
    }

    [Fact]
    public void RedactPath_NeverReturnsAnyPartOfInput()
    {
        var redacted = DiagnosticsRedactor.RedactPath(@"C:\DentalSoftware\Export\patient-john-doe-scan.jpg");
        Assert.DoesNotContain("DentalSoftware", redacted);
        Assert.DoesNotContain("john-doe", redacted);
        Assert.Equal("<redacted>", redacted);
    }

    [Fact]
    public void RedactFileName_NeverReturnsAnyPartOfInput()
    {
        var redacted = DiagnosticsRedactor.RedactFileName("jane-smith-xray-2026.dcm");
        Assert.DoesNotContain("jane-smith", redacted);
        Assert.Equal("<redacted>", redacted);
    }
}
