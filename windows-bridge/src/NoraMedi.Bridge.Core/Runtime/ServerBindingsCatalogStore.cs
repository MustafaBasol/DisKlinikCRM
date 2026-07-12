using System.Text.Json;
using NoraMedi.Bridge.Core.Ipc;

namespace NoraMedi.Bridge.Core.Runtime;

/// <summary>
/// Persists the server's device/binding catalog (as returned by pairing or
/// bootstrap — see <see cref="Http.BootstrapBinding"/>) so the Manager's
/// device selector survives a Service restart without needing to be online
/// at that exact moment. Deliberately a separate file from
/// <see cref="FolderBindingsStore"/>: this one mirrors server-side state
/// (deviceId/displayName/modality/status/acquisitionType), the other is the
/// bridge's own local "watch this folder for this device" record — neither
/// ever carries the bridge credential.
/// </summary>
public sealed class ServerBindingsCatalogStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly string _path;
    private readonly string? _extraAccountSid;
    private readonly Lock _gate = new();

    public ServerBindingsCatalogStore(string path, string? extraAccountSid = null)
    {
        _path = path;
        _extraAccountSid = extraAccountSid;
    }

    public IReadOnlyList<AvailableServerBindingInfo> Load()
    {
        lock (_gate)
        {
            if (!File.Exists(_path)) return [];
            var json = File.ReadAllText(_path);
            return JsonSerializer.Deserialize<List<AvailableServerBindingInfo>>(json, JsonOptions) ?? [];
        }
    }

    public void Save(IReadOnlyList<AvailableServerBindingInfo> catalog)
    {
        lock (_gate)
        {
            var dir = Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(catalog, JsonOptions));
            File.Move(tmp, _path, overwrite: true);
            Security.ProgramDataAcl.ProtectFile(_path, _extraAccountSid);
        }
    }
}
