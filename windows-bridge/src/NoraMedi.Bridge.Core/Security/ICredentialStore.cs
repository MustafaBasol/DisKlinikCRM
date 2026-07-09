namespace NoraMedi.Bridge.Core.Security;

/// <summary>
/// Persists the single bridge credential (bearer token from
/// POST /api/public/imaging/bridge/pair) to disk, DPAPI-protected. Never
/// exposes the raw on-disk bytes — only the plaintext credential (to callers
/// that need to send it) or an opaque fingerprint (to detect rotation
/// without decrypting, mirroring bridge-agent/src/authState.ts's
/// tokenFileFingerprint approach).
/// </summary>
public interface ICredentialStore
{
    void Save(string plaintextCredential);

    /// <summary>Null if missing, corrupted, or foreign-machine (DPAPI failure) — never throws.</summary>
    string? TryRead();

    /// <summary>sha256 of the raw encrypted bytes on disk; null if the file does not exist.</summary>
    string? Fingerprint();

    bool Exists { get; }

    void Delete();
}
