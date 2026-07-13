using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography.X509Certificates;

namespace NoraMedi.Bridge.Core.Updates.Trust;

public enum SignatureTrustResult
{
    /// <summary>Valid Authenticode signature, chain builds and is trusted, signer thumbprint matches the pinned publisher.</summary>
    TrustedPublisher,
    Unsigned,
    /// <summary>Signature parses but WinVerifyTrust rejects the chain (tampered file, revoked/expired/untrusted cert).</summary>
    InvalidOrTamperedSignature,
    /// <summary>Signature is valid and trusted, but the signer is not the pinned NoraMedi publisher thumbprint.</summary>
    WrongPublisher,
}

/// <summary>
/// Verifies Windows Authenticode signatures against a pinned expected
/// publisher certificate thumbprint — never "any signature Windows
/// currently trusts". Two independent checks both have to pass:
///  1. WinVerifyTrust (via wintrust.dll) confirms the signature is
///     structurally valid, the file is unmodified since signing, and the
///     certificate chain is trusted by this machine.
///  2. The signer certificate's SHA-1 thumbprint matches
///     <c>expectedPublisherThumbprint</c> exactly (case-insensitive hex
///     comparison) — a differently-issued certificate for the same or a
///     spoofed subject name is rejected even if #1 passes.
/// See docs/update-architecture.md "Trust model" for the rationale and the
/// local-test-signing carve-out.
/// </summary>
[SupportedOSPlatform("windows")]
public static class AuthenticodeVerifier
{
    public static SignatureTrustResult Verify(string filePath, string expectedPublisherThumbprint)
    {
        if (!WinVerifyTrustSignatureIsValid(filePath))
        {
            // Distinguish "never signed" from "signed but rejected" for a more useful error state.
            return TryGetSignerThumbprint(filePath) is null ? SignatureTrustResult.Unsigned : SignatureTrustResult.InvalidOrTamperedSignature;
        }

        var thumbprint = TryGetSignerThumbprint(filePath);
        if (thumbprint is null) return SignatureTrustResult.Unsigned;

        var normalizedExpected = expectedPublisherThumbprint.Trim().Replace(" ", "").ToUpperInvariant();
        var normalizedActual = thumbprint.Trim().Replace(" ", "").ToUpperInvariant();

        return string.Equals(normalizedActual, normalizedExpected, StringComparison.Ordinal)
            ? SignatureTrustResult.TrustedPublisher
            : SignatureTrustResult.WrongPublisher;
    }

    private static string? TryGetSignerThumbprint(string filePath)
    {
        try
        {
#pragma warning disable SYSLIB0057 // CreateFromSignedFile is the supported way to read an Authenticode signer cert from a PE/MSI file; the replacement API does not cover this scenario.
            using var cert = X509Certificate.CreateFromSignedFile(filePath);
#pragma warning restore SYSLIB0057
            using var cert2 = new X509Certificate2(cert);
            return cert2.Thumbprint;
        }
        catch (Exception ex) when (ex is System.Security.Cryptography.CryptographicException or IOException or UnauthorizedAccessException)
        {
            // CreateFromSignedFile throws CryptographicException for an unsigned file — same
            // treatment as any other "no signer found" case: return null, never throw.
            return null;
        }
    }

    private static bool WinVerifyTrustSignatureIsValid(string filePath)
    {
        var fileInfo = new WINTRUST_FILE_INFO
        {
            cbStruct = (uint)Marshal.SizeOf<WINTRUST_FILE_INFO>(),
            pcwszFilePath = filePath,
        };

        var trustData = new WINTRUST_DATA
        {
            cbStruct = (uint)Marshal.SizeOf<WINTRUST_DATA>(),
            dwUIChoice = WTD_UI_NONE,
            fdwRevocationChecks = WTD_REVOKE_NONE,
            dwUnionChoice = WTD_CHOICE_FILE,
            dwStateAction = WTD_STATEACTION_VERIFY,
            dwProvFlags = WTD_SAFER_FLAG,
            pFile = Marshal.AllocHGlobal(Marshal.SizeOf<WINTRUST_FILE_INFO>()),
        };

        var actionGuid = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE"); // WINTRUST_ACTION_GENERIC_VERIFY_V2

        try
        {
            Marshal.StructureToPtr(fileInfo, trustData.pFile, false);
            var trustDataPtr = Marshal.AllocHGlobal(Marshal.SizeOf<WINTRUST_DATA>());
            try
            {
                Marshal.StructureToPtr(trustData, trustDataPtr, false);
                var result = WinVerifyTrust(IntPtr.Zero, ref actionGuid, trustDataPtr);

                // Always release the WinVerifyTrust state, regardless of the verification result.
                trustData.dwStateAction = WTD_STATEACTION_CLOSE;
                Marshal.StructureToPtr(trustData, trustDataPtr, false);
                WinVerifyTrust(IntPtr.Zero, ref actionGuid, trustDataPtr);

                return result == 0; // ERROR_SUCCESS
            }
            finally
            {
                Marshal.FreeHGlobal(trustDataPtr);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(trustData.pFile);
        }
    }

    private const uint WTD_UI_NONE = 2;
    private const uint WTD_REVOKE_NONE = 0;
    private const uint WTD_CHOICE_FILE = 1;
    private const uint WTD_STATEACTION_VERIFY = 1;
    private const uint WTD_STATEACTION_CLOSE = 2;
    // WTD_SAFER_FLAG (0x100): matches Explorer's own Authenticode check, allows a locally-trusted
    // (e.g. imported test) root without silently downgrading revocation/chain requirements otherwise.
    private const uint WTD_SAFER_FLAG = 0x100;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WINTRUST_FILE_INFO
    {
        public uint cbStruct;
        public string pcwszFilePath;
        public IntPtr hFile;
        public IntPtr pgKnownSubject;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WINTRUST_DATA
    {
        public uint cbStruct;
        public IntPtr pPolicyCallbackData;
        public IntPtr pSIPClientData;
        public uint dwUIChoice;
        public uint fdwRevocationChecks;
        public uint dwUnionChoice;
        public IntPtr pFile;
        public uint dwStateAction;
        public IntPtr hWVTStateData;
        public IntPtr pwszURLReference;
        public uint dwProvFlags;
        public uint dwUIContext;
        public IntPtr pSignatureSettings;
    }

    [DllImport("wintrust.dll", ExactSpelling = true, SetLastError = true)]
    private static extern uint WinVerifyTrust(IntPtr hwnd, ref Guid pgActionID, IntPtr pWVTData);
}
