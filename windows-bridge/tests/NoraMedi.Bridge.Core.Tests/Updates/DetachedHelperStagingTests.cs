using NoraMedi.Bridge.Core.Updates;

namespace NoraMedi.Bridge.Core.Tests.Updates;

/// <summary>
/// Covers the file-copy mechanics behind BridgeOrchestrator's detached
/// UpdateHelper staging. PR 7/7 physical acceptance testing on real hardware
/// found that running UpdateHelper.exe directly from its as-installed
/// location let Windows Installer's Restart Manager force-close it mid
/// install (it holds open the very files the same MSI transaction needs to
/// overwrite), killing the process before it could observe the new service
/// come up and report success - so the crash-loop rollback detector's
/// Lifecycle==Succeeded precondition could never be satisfied. The fix
/// stages a private copy outside the MSI's component set before launching
/// it; these tests cover that the copy is complete, overwrites stale
/// content from a previous version, and preserves subdirectory structure
/// (UpdateHelper.exe's self-contained publish output is not single-file).
/// </summary>
public class DetachedHelperStagingTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-helperstage-").FullName;

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    [Fact]
    public void CopyTree_CopiesAllFiles_IncludingNestedSubdirectories()
    {
        var source = Path.Combine(_root, "source");
        Directory.CreateDirectory(Path.Combine(source, "runtimes", "win-x64"));
        File.WriteAllText(Path.Combine(source, "NoraMedi.Bridge.UpdateHelper.exe"), "exe-bytes");
        File.WriteAllText(Path.Combine(source, "NoraMedi.Bridge.Core.dll"), "dll-bytes");
        File.WriteAllText(Path.Combine(source, "runtimes", "win-x64", "native.dll"), "native-bytes");

        var destination = Path.Combine(_root, "staged");
        DetachedHelperStaging.CopyTree(source, destination);

        Assert.Equal("exe-bytes", File.ReadAllText(Path.Combine(destination, "NoraMedi.Bridge.UpdateHelper.exe")));
        Assert.Equal("dll-bytes", File.ReadAllText(Path.Combine(destination, "NoraMedi.Bridge.Core.dll")));
        Assert.Equal("native-bytes", File.ReadAllText(Path.Combine(destination, "runtimes", "win-x64", "native.dll")));
    }

    [Fact]
    public void CopyTree_DestinationAlreadyHasStaleFiles_RemovesThemBeforeCopying()
    {
        var source = Path.Combine(_root, "source-v2");
        Directory.CreateDirectory(source);
        File.WriteAllText(Path.Combine(source, "NoraMedi.Bridge.UpdateHelper.exe"), "v2-bytes");

        var destination = Path.Combine(_root, "staged");
        Directory.CreateDirectory(destination);
        File.WriteAllText(Path.Combine(destination, "stale-from-v1.dll"), "leftover");
        File.WriteAllText(Path.Combine(destination, "NoraMedi.Bridge.UpdateHelper.exe"), "v1-bytes");

        DetachedHelperStaging.CopyTree(source, destination);

        Assert.False(File.Exists(Path.Combine(destination, "stale-from-v1.dll")), "a file no longer shipped in the new version must not linger in the staged copy");
        Assert.Equal("v2-bytes", File.ReadAllText(Path.Combine(destination, "NoraMedi.Bridge.UpdateHelper.exe")));
    }

    [Fact]
    public void CopyTree_EmptySourceDirectory_ProducesEmptyDestination()
    {
        var source = Path.Combine(_root, "empty-source");
        Directory.CreateDirectory(source);

        var destination = Path.Combine(_root, "staged");
        DetachedHelperStaging.CopyTree(source, destination);

        Assert.True(Directory.Exists(destination));
        Assert.Empty(Directory.EnumerateFileSystemEntries(destination));
    }
}
