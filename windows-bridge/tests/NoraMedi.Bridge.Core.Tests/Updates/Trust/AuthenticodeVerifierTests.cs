using System.Text;
using NoraMedi.Bridge.Core.Updates.Trust;

namespace NoraMedi.Bridge.Core.Tests.Updates.Trust;

/// <summary>
/// Exercises the REAL <see cref="AuthenticodeVerifier.Verify"/> — the actual WinVerifyTrust
/// P/Invoke and X509Certificate parsing, not the <c>trustVerifierOverride</c> test seam every
/// other update test uses. This closes a real coverage gap: prior to this file, no test in the
/// repository ever invoked the WinVerifyTrust code path at all.
///
/// The "wrong signer" and "tampered signature" cases genuinely require a Windows SDK
/// <c>signtool.exe</c> plus a code-signing certificate to produce an actually-Authenticode-signed
/// PE — neither is available in this CI/dev sandbox (no signtool.exe found under Windows Kits).
/// Those two cases remain covered only by the physical acceptance test harness referenced in
/// docs/update-architecture.md ("local test-signing only" carve-out) and are NOT re-verified by
/// this automated suite. This is a known, documented residual gap — see the final PR #149 review.
/// </summary>
[System.Runtime.Versioning.SupportedOSPlatform("windows")]
public sealed class AuthenticodeVerifierTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"nmb-authcode-{Guid.NewGuid():N}.exe");

    public void Dispose()
    {
        try { File.Delete(_path); } catch (IOException) { }
    }

    [Fact]
    public void Verify_UnsignedFile_ReturnsUnsigned_ViaRealWinVerifyTrust()
    {
        File.WriteAllBytes(_path, Encoding.UTF8.GetBytes("not a signed PE, just plain bytes"));

        var result = AuthenticodeVerifier.Verify(_path, "a".PadLeft(40, 'a'));

        Assert.Equal(SignatureTrustResult.Unsigned, result);
    }

    [Fact]
    public void Verify_UnsignedRealExecutable_ReturnsUnsigned_ViaRealWinVerifyTrust()
    {
        // Copy this very test assembly's own unsigned managed DLL — a real, well-formed PE, just
        // without an Authenticode signature — to confirm WinVerifyTrust correctly walks a genuine
        // PE header structure (not only a garbage byte stream) and still reports Unsigned.
        var selfPath = typeof(AuthenticodeVerifierTests).Assembly.Location;
        File.Copy(selfPath, _path, overwrite: true);

        var result = AuthenticodeVerifier.Verify(_path, "a".PadLeft(40, 'a'));

        Assert.Equal(SignatureTrustResult.Unsigned, result);
    }
}
