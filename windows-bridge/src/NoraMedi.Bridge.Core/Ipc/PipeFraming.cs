using System.Buffers.Binary;
using System.Text;

namespace NoraMedi.Bridge.Core.Ipc;

public sealed class PipeMessageTooLargeException(int declaredLength) : Exception($"Pipe message of {declaredLength} bytes exceeds the configured maximum");

/// <summary>
/// Simple 4-byte big-endian length-prefixed framing shared by client and
/// server. Enforces a maximum message size so a malformed or hostile local
/// caller cannot force an unbounded allocation.
/// </summary>
public static class PipeFraming
{
    public const int DefaultMaxMessageBytes = 1024 * 1024; // 1 MiB — comfortably covers a diagnostics bundle, nothing else is close.

    public static async Task WriteMessageAsync(Stream stream, string json, CancellationToken cancellationToken = default)
    {
        var payload = Encoding.UTF8.GetBytes(json);
        var lengthPrefix = new byte[4];
        BinaryPrimitives.WriteInt32BigEndian(lengthPrefix, payload.Length);
        await stream.WriteAsync(lengthPrefix, cancellationToken);
        await stream.WriteAsync(payload, cancellationToken);
        await stream.FlushAsync(cancellationToken);
    }

    /// <summary>Returns null if the stream was closed before a full message arrived (clean disconnect).</summary>
    public static async Task<string?> ReadMessageAsync(Stream stream, int maxMessageBytes = DefaultMaxMessageBytes, CancellationToken cancellationToken = default)
    {
        var lengthBuffer = new byte[4];
        if (!await ReadExactAsync(stream, lengthBuffer, cancellationToken)) return null;

        var length = BinaryPrimitives.ReadInt32BigEndian(lengthBuffer);
        if (length < 0 || length > maxMessageBytes)
        {
            throw new PipeMessageTooLargeException(length);
        }

        var payload = new byte[length];
        if (!await ReadExactAsync(stream, payload, cancellationToken)) return null;
        return Encoding.UTF8.GetString(payload);
    }

    private static async Task<bool> ReadExactAsync(Stream stream, byte[] buffer, CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, buffer.Length - offset), cancellationToken);
            if (read == 0) return false; // graceful EOF/disconnect
            offset += read;
        }
        return true;
    }
}
