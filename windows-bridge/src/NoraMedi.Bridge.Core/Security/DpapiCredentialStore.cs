using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;

namespace NoraMedi.Bridge.Core.Security;

[SupportedOSPlatform("windows")]
public sealed class DpapiCredentialStore : ICredentialStore
{
    private readonly string _path;
    private readonly byte[]? _entropy;
    private readonly string? _extraAccountSid;

    public DpapiCredentialStore(string path, byte[]? entropy = null, string? extraAccountSid = null)
    {
        _path = path;
        _entropy = entropy;
        _extraAccountSid = extraAccountSid;
    }

    public bool Exists => File.Exists(_path);

    public void Save(string plaintextCredential)
    {
        var protectedBytes = CredentialProtector.Protect(Encoding.UTF8.GetBytes(plaintextCredential), _entropy);
        var dir = Path.GetDirectoryName(_path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        var tmp = _path + ".tmp";
        File.WriteAllBytes(tmp, protectedBytes);
        File.Move(tmp, _path, overwrite: true);
        ProgramDataAcl.ProtectFile(_path, _extraAccountSid);
    }

    public string? TryRead()
    {
        if (!File.Exists(_path)) return null;
        try
        {
            var protectedBytes = File.ReadAllBytes(_path);
            var plain = CredentialProtector.Unprotect(protectedBytes, _entropy);
            return Encoding.UTF8.GetString(plain);
        }
        catch (CryptographicException)
        {
            // Blob belongs to a different machine, was tampered with, or DPAPI
            // key material rotated out from under it — treated as "no credential",
            // never surfaced as plaintext or logged.
            return null;
        }
    }

    public string? Fingerprint()
    {
        if (!File.Exists(_path)) return null;
        var bytes = File.ReadAllBytes(_path);
        return Convert.ToHexStringLower(SHA256.HashData(bytes));
    }

    public void Delete()
    {
        if (File.Exists(_path)) File.Delete(_path);
    }
}
