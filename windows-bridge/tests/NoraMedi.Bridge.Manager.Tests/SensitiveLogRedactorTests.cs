using NoraMedi.Bridge.Manager.Services.Logging;
using NoraMedi.Bridge.Manager.Tests.TestSupport;

namespace NoraMedi.Bridge.Manager.Tests;

public class SensitiveLogRedactorTests
{
    [Theory]
    [InlineData("pairing code entered: 12345678", "12345678")]
    [InlineData("pairing code entered: 1234-5678", "1234-5678")]
    [InlineData("pairing code entered: 1234 5678", "1234 5678")]
    public void Redact_StripsPairingCodesRegardlessOfGrouping(string message, string codeSubstring)
    {
        var redacted = SensitiveLogRedactor.Redact(message);

        Assert.DoesNotContain(codeSubstring, redacted);
        Assert.Contains("[code-redacted]", redacted);
    }

    [Theory]
    [InlineData(@"binding path: C:\Users\clinic\Scans\Xray")]
    [InlineData(@"binding path: D:\Imaging\PANO\folder")]
    [InlineData(@"binding path: \\SERVER\Share\Scans")]
    public void Redact_StripsLocalAndUncPaths(string message)
    {
        var redacted = SensitiveLogRedactor.Redact(message);

        Assert.Contains("[path-redacted]", redacted);
        Assert.DoesNotContain(@"C:\", redacted);
        Assert.DoesNotContain(@"D:\", redacted);
        Assert.DoesNotContain(@"\\SERVER", redacted);
    }

    [Fact]
    public void Redact_LeavesUnrelatedTextUntouched()
    {
        var message = "Service status refreshed: connectionState=online, pendingCount=3";

        var redacted = SensitiveLogRedactor.Redact(message);

        Assert.Equal(message, redacted);
    }

    [Fact]
    public void ManagerLogger_NeverEmitsPairingCodeOrPathToSink()
    {
        var sink = new CapturingLogSink();
        var logger = new ManagerLogger(sink);

        logger.Info(@"Add binding requested for path C:\Users\clinic\Scans\Pano, pairing code 12345678 in flight");

        var line = Assert.Single(sink.Lines);
        Assert.DoesNotContain(@"C:\Users\clinic\Scans\Pano", line);
        Assert.DoesNotContain("12345678", line);
        Assert.Contains("[path-redacted]", line);
        Assert.Contains("[code-redacted]", line);
    }
}
