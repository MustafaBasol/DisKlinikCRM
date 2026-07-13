using System.Text.Json;
using NoraMedi.Bridge.Core.Security;

namespace NoraMedi.Bridge.Core.Updates.Rollback;

internal sealed record BootHealthState(string Version, int RestartCount, DateTimeOffset WindowStartUtc);

/// <summary>
/// The one health signal this process can honestly self-report without an
/// external observer: "did I keep crashing and getting relaunched by SCM
/// right after this version was installed?" Explicitly NOT based on backend/
/// heartbeat reachability — docs/update-runbook.md "Rollback does not
/// require the backend" — a clinic with no internet must never trigger a
/// rollback of an otherwise-healthy build.
///
/// Each call to <see cref="RecordBootAndCheckCrashLoop"/> represents one
/// process start. If the same version restarts more than
/// <see cref="MaxRestartsBeforeRollback"/> times inside
/// <see cref="StabilizationWindow"/> of its first post-install boot, that is
/// treated as a crash loop and the caller should trigger an automatic
/// one-step rollback. A version that survives the window without exceeding
/// the threshold is never revisited — the counter only ever applies during
/// each version's own initial stabilization window.
/// </summary>
public sealed class PostUpdateHealthTracker(string updatesDirectory, string? extraAccountSid = null)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const int MaxRestartsBeforeRollback = 3;
    private static readonly TimeSpan StabilizationWindow = TimeSpan.FromMinutes(10);
    private readonly string _path = Path.Combine(updatesDirectory, "boot-health.json");

    public bool RecordBootAndCheckCrashLoop(string currentVersion)
    {
        var now = DateTimeOffset.UtcNow;
        var state = Load();

        if (state is null || !string.Equals(state.Version, currentVersion, StringComparison.OrdinalIgnoreCase) || now - state.WindowStartUtc > StabilizationWindow)
        {
            Save(new BootHealthState(currentVersion, 1, now));
            return false;
        }

        var count = state.RestartCount + 1;
        Save(state with { RestartCount = count });
        return count > MaxRestartsBeforeRollback;
    }

    private BootHealthState? Load()
    {
        if (!File.Exists(_path)) return null;
        try
        {
            var json = File.ReadAllText(_path);
            return JsonSerializer.Deserialize<BootHealthState>(json, JsonOptions);
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private void Save(BootHealthState state)
    {
        Directory.CreateDirectory(updatesDirectory);
        var json = JsonSerializer.Serialize(state, JsonOptions);
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, json);
        File.Move(tmp, _path, overwrite: true);
        ProgramDataAcl.ProtectFile(_path, extraAccountSid);
    }
}
