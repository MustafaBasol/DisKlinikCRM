namespace NoraMedi.Bridge.Core.Security;

/// <summary>
/// Tracks whether the stored bridge credential is currently accepted by the
/// server. Mirrors bridge-agent/src/authState.ts: a 401 pauses all draining
/// and heartbeat traffic; recovery is automatic once the credential file's
/// fingerprint changes (operator re-paired or DPAPI blob was replaced) and a
/// single verification call succeeds — no service restart required.
/// </summary>
public sealed class BridgeAuthState
{
    private readonly ICredentialStore _credentialStore;
    private bool _valid = true;
    private string? _invalidSinceFingerprint;

    public BridgeAuthState(ICredentialStore credentialStore)
    {
        _credentialStore = credentialStore;
    }

    public bool IsValid => _valid;

    /// <summary>Null if there is no usable credential at all (unpaired or corrupted blob).</summary>
    public string? TryGetCredential() => _credentialStore.TryRead();

    public void MarkInvalid()
    {
        _valid = false;
        _invalidSinceFingerprint = _credentialStore.Fingerprint();
    }

    public void MarkValid()
    {
        _valid = true;
        _invalidSinceFingerprint = null;
    }

    /// <summary>
    /// True if the on-disk credential changed since it was marked invalid —
    /// callers should attempt one verification call (e.g. heartbeat) and
    /// call <see cref="MarkValid"/>/<see cref="MarkInvalid"/> based on the result.
    /// </summary>
    public bool CredentialChangedSinceInvalidated()
    {
        if (_valid) return false;
        var fingerprint = _credentialStore.Fingerprint();
        return fingerprint is not null && fingerprint != _invalidSinceFingerprint;
    }
}
