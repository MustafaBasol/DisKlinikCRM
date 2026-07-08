namespace NoraMedi.Bridge.Core.Queue;

/// <summary>
/// delay = min(cap, base * 2^attemptCount) * (1 + jitter), jitter in [0, 0.1).
/// Mirrors bridge-agent/src/uploader.ts computeBackoffMs exactly so pilot
/// clinics see comparable retry cadence whether running the Node or .NET agent.
/// </summary>
public static class BackoffCalculator
{
    public static TimeSpan Compute(int attemptCount, TimeSpan baseDelay, TimeSpan cap, Func<double>? jitterFn = null)
    {
        var jitter = (jitterFn ?? DefaultJitter)();
        var rawMs = Math.Min(cap.TotalMilliseconds, baseDelay.TotalMilliseconds * Math.Pow(2, attemptCount));
        return TimeSpan.FromMilliseconds(Math.Round(rawMs * (1 + jitter)));
    }

    public static TimeSpan CumulativeUpTo(int maxAttempts, TimeSpan baseDelay, TimeSpan cap)
    {
        var total = TimeSpan.Zero;
        for (var i = 0; i < maxAttempts; i++)
        {
            total += Compute(i, baseDelay, cap, static () => 0);
        }
        return total;
    }

    private static double DefaultJitter() => Random.Shared.NextDouble() * 0.1;
}
