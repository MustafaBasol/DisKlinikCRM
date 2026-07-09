using System.Runtime.Versioning;
using System.Security.Cryptography;

namespace NoraMedi.Bridge.Core.Security;

/// <summary>
/// Thin wrapper over Windows DPAPI, LocalMachine scope — the credential can
/// be decrypted by any process running as LocalSystem or an administrator on
/// THIS machine, but not by copying the blob to another machine or reading
/// it as a different, unprivileged user. This is deliberately LocalMachine
/// (not CurrentUser) because the bridge runs as a Windows Service, typically
/// under LocalSystem, with no interactive user profile.
/// </summary>
[SupportedOSPlatform("windows")]
public static class CredentialProtector
{
    public static byte[] Protect(byte[] plaintext, byte[]? entropy = null) =>
        ProtectedData.Protect(plaintext, entropy, DataProtectionScope.LocalMachine);

    /// <summary>Throws <see cref="CryptographicException"/> if the blob is foreign, corrupted, or revoked.</summary>
    public static byte[] Unprotect(byte[] ciphertext, byte[]? entropy = null) =>
        ProtectedData.Unprotect(ciphertext, entropy, DataProtectionScope.LocalMachine);
}
