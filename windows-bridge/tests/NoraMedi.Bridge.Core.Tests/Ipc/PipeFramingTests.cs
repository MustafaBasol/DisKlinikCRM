using NoraMedi.Bridge.Core.Ipc;

namespace NoraMedi.Bridge.Core.Tests.Ipc;

public class PipeFramingTests
{
    [Fact]
    public async Task WriteThenRead_RoundTripsMessageExactly()
    {
        using var stream = new MemoryStream();
        await PipeFraming.WriteMessageAsync(stream, """{"hello":"world"}""");
        stream.Position = 0;

        var result = await PipeFraming.ReadMessageAsync(stream);
        Assert.Equal("""{"hello":"world"}""", result);
    }

    [Fact]
    public async Task ReadMessage_EmptyStream_ReturnsNull()
    {
        using var stream = new MemoryStream();
        Assert.Null(await PipeFraming.ReadMessageAsync(stream));
    }

    [Fact]
    public async Task ReadMessage_TruncatedLengthPrefix_ReturnsNull()
    {
        using var stream = new MemoryStream([0x00, 0x01]); // only 2 of 4 length bytes
        Assert.Null(await PipeFraming.ReadMessageAsync(stream));
    }

    [Fact]
    public async Task ReadMessage_TruncatedPayload_ReturnsNull()
    {
        using var stream = new MemoryStream();
        await PipeFraming.WriteMessageAsync(stream, "0123456789");
        stream.SetLength(stream.Length - 3); // chop off part of the payload
        stream.Position = 0;

        Assert.Null(await PipeFraming.ReadMessageAsync(stream));
    }

    [Fact]
    public async Task ReadMessage_DeclaredLengthExceedsMax_ThrowsWithoutAllocatingHugeBuffer()
    {
        // Declares a 10 MB payload but the max is 1 MiB — must be rejected
        // from the length prefix alone, before attempting to read that much
        // (only the 4-byte prefix is written; a real 10 MB body never follows).
        using var stream = new MemoryStream();
        var lengthPrefix = new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(lengthPrefix, 10 * 1024 * 1024);
        stream.Write(lengthPrefix);
        stream.Position = 0;

        await Assert.ThrowsAsync<PipeMessageTooLargeException>(() => PipeFraming.ReadMessageAsync(stream, maxMessageBytes: 1024 * 1024));
    }

    [Fact]
    public async Task ReadMessage_NegativeDeclaredLength_Throws()
    {
        using var stream = new MemoryStream();
        var lengthPrefix = new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(lengthPrefix, -1);
        stream.Write(lengthPrefix);
        stream.Position = 0;

        await Assert.ThrowsAsync<PipeMessageTooLargeException>(() => PipeFraming.ReadMessageAsync(stream));
    }

    [Fact]
    public async Task WriteThenRead_HandlesMultiByteUtf8Content()
    {
        using var stream = new MemoryStream();
        const string message = "Klinik İzleme Köprüsü 🦷";
        await PipeFraming.WriteMessageAsync(stream, message);
        stream.Position = 0;

        Assert.Equal(message, await PipeFraming.ReadMessageAsync(stream));
    }

    [Fact]
    public async Task WriteThenRead_MultipleMessagesOnSameStream_AreIndependentlyFramed()
    {
        using var stream = new MemoryStream();
        await PipeFraming.WriteMessageAsync(stream, "first");
        await PipeFraming.WriteMessageAsync(stream, "second");
        stream.Position = 0;

        Assert.Equal("first", await PipeFraming.ReadMessageAsync(stream));
        Assert.Equal("second", await PipeFraming.ReadMessageAsync(stream));
    }
}
