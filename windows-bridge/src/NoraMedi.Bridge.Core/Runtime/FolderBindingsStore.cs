using System.Text.Json;
using NoraMedi.Bridge.Core.Acquisition;

namespace NoraMedi.Bridge.Core.Runtime;

/// <summary>
/// Persists local folder-to-device bindings as JSON in ProgramData (ACL
/// protected by the caller — see Security.ProgramDataAcl). This is the
/// bridge's own local record of "watch this folder for this device"; it is
/// never sent to the server as a folder path, only as watchId/deviceId.
/// </summary>
public sealed class FolderBindingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly string _path;
    private readonly string? _extraAccountSid;
    private readonly Lock _gate = new();

    public FolderBindingsStore(string path, string? extraAccountSid = null)
    {
        _path = path;
        _extraAccountSid = extraAccountSid;
    }

    public IReadOnlyList<FolderBinding> Load()
    {
        lock (_gate)
        {
            if (!File.Exists(_path)) return [];
            var json = File.ReadAllText(_path);
            return JsonSerializer.Deserialize<List<FolderBinding>>(json, JsonOptions) ?? [];
        }
    }

    public FolderBinding AddOrUpdate(string? watchId, string path, string deviceId, string? modality)
    {
        lock (_gate)
        {
            var bindings = Load().ToList();
            var id = watchId ?? DeriveWatchId(deviceId, bindings.Count);
            var binding = FolderBinding.Create(id, path, deviceId, modality);

            var index = bindings.FindIndex(b => b.WatchId == id);
            if (index >= 0) bindings[index] = binding;
            else bindings.Add(binding);

            Save(bindings);
            return binding;
        }
    }

    public bool Remove(string watchId)
    {
        lock (_gate)
        {
            var bindings = Load().ToList();
            var removed = bindings.RemoveAll(b => b.WatchId == watchId) > 0;
            if (removed) Save(bindings);
            return removed;
        }
    }

    private void Save(IReadOnlyList<FolderBinding> bindings)
    {
        var dir = Path.GetDirectoryName(_path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(bindings, JsonOptions));
        File.Move(tmp, _path, overwrite: true);
        Security.ProgramDataAcl.ProtectFile(_path, _extraAccountSid);
    }

    private static string DeriveWatchId(string deviceId, int index)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes($"{deviceId}:{index}:{Guid.NewGuid()}"));
        return Convert.ToHexStringLower(bytes)[..12];
    }
}
