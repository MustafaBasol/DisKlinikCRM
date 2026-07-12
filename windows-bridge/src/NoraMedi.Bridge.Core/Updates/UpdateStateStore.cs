using System.Text.Json;
using NoraMedi.Bridge.Core.Security;

namespace NoraMedi.Bridge.Core.Updates;

/// <summary>
/// Persists <see cref="UpdateState"/> to <c>updates\state.json</c> under the
/// ProgramData root, atomically (temp file + <c>File.Move(overwrite: true)</c>,
/// the same pattern <see cref="DpapiCredentialStore.Save"/> uses) and ACL'd
/// the same way (see <see cref="ProgramDataAcl"/>). A missing or corrupt file
/// is never surfaced as an exception — it resolves to <c>Idle</c>, the same
/// "treat unreadable as absent" rule <see cref="DpapiCredentialStore.TryRead"/>
/// already applies to the credential blob, so a corrupted state file can
/// never crash the service or the background loop.
/// </summary>
public sealed class UpdateStateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = false };

    private readonly string _path;
    private readonly string? _extraAccountSid;
    private readonly object _gate = new();

    public UpdateStateStore(string updatesDirectory, string? extraAccountSid = null)
    {
        _path = Path.Combine(updatesDirectory, "state.json");
        _extraAccountSid = extraAccountSid;
    }

    public UpdateState Load(string currentInstalledVersion)
    {
        lock (_gate)
        {
            if (!File.Exists(_path)) return UpdateState.Idle(currentInstalledVersion);

            try
            {
                var json = File.ReadAllText(_path);
                var state = JsonSerializer.Deserialize<UpdateState>(json, JsonOptions);
                if (state is null) return UpdateState.Idle(currentInstalledVersion);

                // InstalledVersion is never trusted from the persisted file: after a
                // successful self-update the running binary's actual version has
                // changed, but this file may still hold whatever the pre-update
                // process last wrote. Always reconcile it to the live caller-supplied
                // AgentVersion.Current so "post-install version verification" reflects
                // reality, not stale history.
                return state.InstalledVersion == currentInstalledVersion
                    ? state
                    : state with { InstalledVersion = currentInstalledVersion };
            }
            catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
            {
                return UpdateState.Idle(currentInstalledVersion);
            }
        }
    }

    public void Save(UpdateState state)
    {
        lock (_gate)
        {
            var dir = Path.GetDirectoryName(_path)!;
            // Deliberately does NOT call ProgramDataAcl.ProtectDirectory here:
            // this directory is always a subdirectory of the bridge's
            // already-ACL'd ProgramData root (see BridgeOrchestrator's
            // constructor), so it inherits that root's LocalSystem+
            // Administrators-only ACEs automatically on creation — the same
            // "protect the root once, ProtectFile per write thereafter"
            // pattern DpapiCredentialStore.Save uses.
            Directory.CreateDirectory(dir);

            var json = JsonSerializer.Serialize(state, JsonOptions);
            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, _path, overwrite: true);
            ProgramDataAcl.ProtectFile(_path, _extraAccountSid);
        }
    }

    /// <summary>
    /// Called once on service start: any non-terminal state left over from a
    /// process that never reached a terminal state (crash, forced stop, an
    /// in-flight download/install interrupted by a reboot) is truthfully
    /// reclassified as <c>Interrupted</c> rather than silently resumed or
    /// silently discarded — the Manager must be able to tell the difference
    /// between "nothing happened" and "something was cut off".
    /// </summary>
    public UpdateState ReconcileOnStartup(string currentInstalledVersion)
    {
        var state = Load(currentInstalledVersion);
        if (!state.IsInProgress) return state;

        var interrupted = state with
        {
            Lifecycle = UpdateLifecycleState.Interrupted,
            UpdatedAtUtc = DateTimeOffset.UtcNow,
        };
        Save(interrupted);
        return interrupted;
    }
}
