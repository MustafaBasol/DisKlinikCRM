using NoraMedi.Bridge.Core.Security;

namespace NoraMedi.Bridge.Core.Tests.Security;

public class InstallationIdProviderTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-instid-").FullName;
    private string Path_ => System.IO.Path.Combine(_root, "installation-id.txt");

    [Fact]
    public void GetOrCreate_FirstCall_GeneratesAndPersistsId()
    {
        var id = InstallationIdProvider.GetOrCreate(Path_);

        Assert.False(string.IsNullOrWhiteSpace(id));
        Assert.True(File.Exists(Path_));
        Assert.Equal(id, File.ReadAllText(Path_).Trim());
    }

    [Fact]
    public void GetOrCreate_SubsequentCalls_ReturnSameId()
    {
        var first = InstallationIdProvider.GetOrCreate(Path_);
        var second = InstallationIdProvider.GetOrCreate(Path_);
        var third = InstallationIdProvider.GetOrCreate(Path_);

        Assert.Equal(first, second);
        Assert.Equal(first, third);
    }

    [Fact]
    public void GetOrCreate_EmptyExistingFile_RegeneratesId()
    {
        Directory.CreateDirectory(_root);
        File.WriteAllText(Path_, "   ");

        var id = InstallationIdProvider.GetOrCreate(Path_);
        Assert.False(string.IsNullOrWhiteSpace(id));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
