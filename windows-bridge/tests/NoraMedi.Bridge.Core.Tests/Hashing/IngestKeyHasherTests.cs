using NoraMedi.Bridge.Core.Hashing;

namespace NoraMedi.Bridge.Core.Tests.Hashing;

public class IngestKeyHasherTests
{
    [Fact]
    public void ComputeHex_IsDeterministicAndLowercaseHex64()
    {
        byte[] data = [1, 2, 3, 4, 5];
        var hash1 = IngestKeyHasher.ComputeHex(data);
        var hash2 = IngestKeyHasher.ComputeHex(data);

        Assert.Equal(hash1, hash2);
        Assert.Equal(64, hash1.Length);
        Assert.Matches(IngestKeyHasher.Pattern, hash1);
        Assert.Equal(hash1, hash1.ToLowerInvariant());
    }

    [Fact]
    public void ComputeHex_DifferentContent_ProducesDifferentHash()
    {
        Assert.NotEqual(IngestKeyHasher.ComputeHex([1, 2, 3]), IngestKeyHasher.ComputeHex([1, 2, 4]));
    }

    [Fact]
    public async Task ComputeHexAsync_MatchesInMemoryHashForSameBytes()
    {
        var bytes = new byte[50_000];
        Random.Shared.NextBytes(bytes);
        var tempFile = Path.GetTempFileName();
        try
        {
            await File.WriteAllBytesAsync(tempFile, bytes);
            var fileHash = await IngestKeyHasher.ComputeHexAsync(tempFile);
            var memoryHash = IngestKeyHasher.ComputeHex(bytes);
            Assert.Equal(memoryHash, fileHash);
        }
        finally
        {
            File.Delete(tempFile);
        }
    }
}
