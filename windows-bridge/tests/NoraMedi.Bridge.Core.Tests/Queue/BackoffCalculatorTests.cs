using NoraMedi.Bridge.Core.Queue;

namespace NoraMedi.Bridge.Core.Tests.Queue;

public class BackoffCalculatorTests
{
    private static readonly TimeSpan Base = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan Cap = TimeSpan.FromMinutes(15);

    [Theory]
    [InlineData(0, 60_000)]
    [InlineData(1, 120_000)]
    [InlineData(2, 240_000)]
    [InlineData(3, 480_000)]
    public void Compute_NoJitter_DoublesEachAttemptUpToCap(int attempt, double expectedMs)
    {
        var delay = BackoffCalculator.Compute(attempt, Base, Cap, jitterFn: static () => 0);
        Assert.Equal(expectedMs, delay.TotalMilliseconds);
    }

    [Fact]
    public void Compute_BeyondCapExponent_NeverExceedsCap()
    {
        var delay = BackoffCalculator.Compute(20, Base, Cap, jitterFn: static () => 0);
        Assert.Equal(Cap.TotalMilliseconds, delay.TotalMilliseconds);
    }

    [Fact]
    public void Compute_JitterAppliesUpToTenPercent()
    {
        var delay = BackoffCalculator.Compute(0, Base, Cap, jitterFn: static () => 0.1);
        Assert.Equal(66_000, delay.TotalMilliseconds);
    }

    [Fact]
    public void Compute_DefaultJitter_StaysWithinExpectedBand()
    {
        for (var i = 0; i < 50; i++)
        {
            var delay = BackoffCalculator.Compute(2, Base, Cap);
            Assert.InRange(delay.TotalMilliseconds, 240_000, 240_000 * 1.1 + 1);
        }
    }

    [Fact]
    public void CumulativeUpTo_MatchesSumOfIndividualDelays()
    {
        var cumulative = BackoffCalculator.CumulativeUpTo(5, Base, Cap);
        double expected = 0;
        for (var i = 0; i < 5; i++)
        {
            expected += BackoffCalculator.Compute(i, Base, Cap, jitterFn: static () => 0).TotalMilliseconds;
        }
        Assert.Equal(expected, cumulative.TotalMilliseconds);
    }
}
