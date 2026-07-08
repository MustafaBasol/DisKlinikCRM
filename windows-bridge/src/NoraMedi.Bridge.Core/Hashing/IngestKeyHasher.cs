using System.Security.Cryptography;

namespace NoraMedi.Bridge.Core.Hashing;

/// <summary>
/// Computes the sha256 hex digest the server calls "ingestKey" — the same
/// format the server independently recomputes and compares against
/// (server/src/routes/imagingBridgePublic.ts). Exactly 64 lowercase hex chars.
/// </summary>
public static class IngestKeyHasher
{
    public static readonly System.Text.RegularExpressions.Regex Pattern =
        new("^[a-f0-9]{64}$", System.Text.RegularExpressions.RegexOptions.Compiled);

    public static string ComputeHex(ReadOnlySpan<byte> data)
    {
        Span<byte> hash = stackalloc byte[32];
        SHA256.HashData(data, hash);
        return Convert.ToHexStringLower(hash);
    }

    public static async Task<string> ComputeHexAsync(string filePath, CancellationToken cancellationToken = default)
    {
        await using var stream = File.OpenRead(filePath);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexStringLower(hash);
    }
}
