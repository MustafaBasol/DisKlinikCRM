namespace NoraMedi.Bridge.Core.Security;

/// <summary>
/// A stable, non-secret per-machine identifier sent to the server at pairing
/// time (installationId field — see imagingBridgePublicPairSchema). Not a
/// secret: it identifies the installation, not the credential.
/// </summary>
public static class InstallationIdProvider
{
    public static string GetOrCreate(string path)
    {
        if (File.Exists(path))
        {
            var existing = File.ReadAllText(path).Trim();
            if (!string.IsNullOrEmpty(existing)) return existing;
        }

        var id = Guid.NewGuid().ToString("N");
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        var tmp = path + ".tmp";
        File.WriteAllText(tmp, id);
        File.Move(tmp, path, overwrite: true);
        return id;
    }
}
