using NoraMedi.Bridge.Core.Runtime;

namespace NoraMedi.Bridge.Core.Tests.Runtime;

public class FolderBindingsStoreTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-bindings-").FullName;
    private string StorePath => Path.Combine(_root, "bindings.json");

    [Fact]
    public void Load_NoFileYet_ReturnsEmpty()
    {
        var store = new FolderBindingsStore(StorePath);
        Assert.Empty(store.Load());
    }

    [Fact]
    public void AddOrUpdate_NewBinding_PersistsAndIsLoadable()
    {
        var store = new FolderBindingsStore(StorePath);
        var binding = store.AddOrUpdate(null, @"C:\Export", "device-1", "IO");

        var reloaded = new FolderBindingsStore(StorePath).Load();
        Assert.Single(reloaded);
        Assert.Equal(binding.WatchId, reloaded[0].WatchId);
        Assert.Equal(@"C:\Export", reloaded[0].Path);
    }

    [Fact]
    public void AddOrUpdate_ExistingWatchId_ReplacesInPlaceRatherThanDuplicating()
    {
        var store = new FolderBindingsStore(StorePath);
        var binding = store.AddOrUpdate("watch-1", @"C:\Export", "device-1", "IO");
        store.AddOrUpdate("watch-1", @"C:\Export2", "device-1", "PANO");

        var all = store.Load();
        Assert.Single(all);
        Assert.Equal(@"C:\Export2", all[0].Path);
        Assert.Equal("PANO", all[0].Modality);
        _ = binding;
    }

    [Fact]
    public void Remove_ExistingWatchId_ReturnsTrueAndDeletes()
    {
        var store = new FolderBindingsStore(StorePath);
        var binding = store.AddOrUpdate(null, @"C:\Export", "device-1", "IO");

        var removed = store.Remove(binding.WatchId);

        Assert.True(removed);
        Assert.Empty(store.Load());
    }

    [Fact]
    public void Remove_UnknownWatchId_ReturnsFalseWithoutThrowing()
    {
        var store = new FolderBindingsStore(StorePath);
        Assert.False(store.Remove("does-not-exist"));
    }

    [Fact]
    public void AddOrUpdate_MultipleDistinctBindings_AllPersist()
    {
        var store = new FolderBindingsStore(StorePath);
        store.AddOrUpdate(null, @"C:\Export1", "device-1", "IO");
        store.AddOrUpdate(null, @"C:\Export2", "device-2", "PANO");

        Assert.Equal(2, store.Load().Count);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
