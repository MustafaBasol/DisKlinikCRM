using NoraMedi.Bridge.Core.Acquisition;

namespace NoraMedi.Bridge.Core.Tests.Acquisition;

public class FolderWatchAdapterTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-watch-").FullName;

    [Fact]
    public void TickAll_StableFile_RaisesFileAcquiredExactlyOnce()
    {
        var binding = FolderBinding.Create("watch-1", _root, "device-1", "IO");
        var adapter = new FolderWatchAdapter([binding], TimeSpan.FromMilliseconds(20));
        var acquired = new List<AcquiredFile>();
        adapter.FileAcquired += (_, file) => acquired.Add(file);

        File.WriteAllBytes(Path.Combine(_root, "scan.jpg"), [0xFF, 0xD8, 0xFF]);

        adapter.TickAll(); // first observation: size recorded, not yet stable
        Thread.Sleep(30);
        adapter.TickAll(); // stable now: should emit
        adapter.TickAll(); // must not emit twice

        Assert.Single(acquired);
        Assert.Equal("watch-1", acquired[0].Binding.WatchId);
        Assert.EndsWith("scan.jpg", acquired[0].SourcePath);
    }

    [Fact]
    public void TickAll_GrowingFile_DoesNotEmitUntilSizeStopsChanging()
    {
        var binding = FolderBinding.Create("watch-1", _root, "device-1", "IO");
        var adapter = new FolderWatchAdapter([binding], TimeSpan.FromMilliseconds(30));
        var acquired = new List<AcquiredFile>();
        adapter.FileAcquired += (_, file) => acquired.Add(file);

        var path = Path.Combine(_root, "export.png");
        File.WriteAllBytes(path, new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });
        adapter.TickAll();

        // Simulate the vendor writer still appending — size keeps changing,
        // so the stability window must keep resetting.
        Thread.Sleep(15);
        File.AppendAllBytes(path, [0x00, 0x00, 0x00, 0x10]);
        adapter.TickAll();
        Assert.Empty(acquired);

        Thread.Sleep(15);
        File.AppendAllBytes(path, [0x01, 0x02]);
        adapter.TickAll();
        Assert.Empty(acquired);

        // Now it stops changing long enough to cross the stability window.
        Thread.Sleep(40);
        adapter.TickAll();
        Assert.Single(acquired);
    }

    [Theory]
    [InlineData("draft.tmp")]
    [InlineData("partial.part")]
    [InlineData("download.crdownload")]
    [InlineData(".hidden.jpg")]
    [InlineData("no-extension")]
    [InlineData("document.pdf")]
    public void TickAll_IgnoredOrUnsupportedFiles_NeverRaisesFileAcquired(string fileName)
    {
        var binding = FolderBinding.Create("watch-1", _root, "device-1", "IO");
        var adapter = new FolderWatchAdapter([binding], TimeSpan.FromMilliseconds(1));
        var acquired = new List<AcquiredFile>();
        adapter.FileAcquired += (_, file) => acquired.Add(file);

        File.WriteAllBytes(Path.Combine(_root, fileName), [0xFF, 0xD8, 0xFF]);
        adapter.TickAll();
        Thread.Sleep(10);
        adapter.TickAll();

        Assert.Empty(acquired);
    }

    [Fact]
    public void TickAll_MissingFolder_ReportsUnavailableThenRecovers()
    {
        var missingPath = Path.Combine(_root, "does-not-exist-yet");
        var binding = FolderBinding.Create("watch-1", missingPath, "device-1", "IO");
        var adapter = new FolderWatchAdapter([binding], TimeSpan.FromMilliseconds(1));

        adapter.TickAll();
        Assert.False(adapter.GetAvailability().Single().Available);

        Directory.CreateDirectory(missingPath);
        adapter.TickAll();
        Assert.True(adapter.GetAvailability().Single().Available);
    }

    [Fact]
    public void TickAll_NeverModifiesOrRenamesSourceFile()
    {
        var binding = FolderBinding.Create("watch-1", _root, "device-1", "IO");
        var adapter = new FolderWatchAdapter([binding], TimeSpan.FromMilliseconds(10));
        var path = Path.Combine(_root, "scan.jpg");
        var originalBytes = new byte[] { 0xFF, 0xD8, 0xFF, 0x01, 0x02, 0x03 };
        File.WriteAllBytes(path, originalBytes);

        adapter.TickAll();
        Thread.Sleep(20);
        adapter.TickAll();

        Assert.True(File.Exists(path));
        Assert.Equal(originalBytes, File.ReadAllBytes(path));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
