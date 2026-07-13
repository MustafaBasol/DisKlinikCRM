using System.Text.Json;
using NoraMedi.Bridge.Core.Security;

namespace NoraMedi.Bridge.Core.Updates.Rollback;

/// <summary>
/// Persists <see cref="RollbackState"/> to <c>updates\rollback-state.json</c>,
/// atomically and ACL-protected — same pattern as <see cref="UpdateStateStore"/>.
/// A missing/corrupt file resolves to <see cref="RollbackState.Idle"/>, never
/// an exception (mirrors the same "corrupted = absent" rule used everywhere
/// else in ProgramData persistence).
/// </summary>
public sealed class RollbackStateStore(string updatesDirectory, string? extraAccountSid = null)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = false };
    private readonly string _path = Path.Combine(updatesDirectory, "rollback-state.json");
    private readonly object _gate = new();

    public RollbackState Load()
    {
        lock (_gate)
        {
            if (!File.Exists(_path)) return RollbackState.Idle;
            try
            {
                var json = File.ReadAllText(_path);
                return JsonSerializer.Deserialize<RollbackState>(json, JsonOptions) ?? RollbackState.Idle;
            }
            catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
            {
                return RollbackState.Idle;
            }
        }
    }

    public void Save(RollbackState state)
    {
        lock (_gate)
        {
            Directory.CreateDirectory(updatesDirectory);
            var json = JsonSerializer.Serialize(state, JsonOptions);
            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, _path, overwrite: true);
            ProgramDataAcl.ProtectFile(_path, extraAccountSid);
        }
    }

    /// <summary>
    /// Called once on service start, immediately (same timing guarantee as
    /// <see cref="UpdateStateStore.ReconcileOnStartup"/>): a rollback left
    /// in a non-terminal state by a crash/kill is reclassified as
    /// InterventionRequired — a stale "Uninstalling"/"Installing" state must
    /// never be silently resumed (that would risk a second uninstall/install
    /// against a machine already left in an unknown intermediate state).
    /// </summary>
    public RollbackState ReconcileOnStartup()
    {
        var state = Load();
        if (!state.IsInProgress) return state;

        var reconciled = state with
        {
            Lifecycle = RollbackLifecycleState.InterventionRequired,
            ErrorCategory = RollbackErrorCategory.Unknown,
            UpdatedAtUtc = DateTimeOffset.UtcNow,
        };
        Save(reconciled);
        return reconciled;
    }
}
