namespace NoraMedi.Bridge.Core.Updates;

/// <summary>
/// The file-copy mechanics behind <see cref="Runtime.BridgeOrchestrator"/>'s
/// detached UpdateHelper staging (see its doc comment on
/// StageDetachedUpdateHelper for why this exists - PR 7/7 physical
/// acceptance testing found Windows Installer's Restart Manager force-closes
/// UpdateHelper.exe mid-install when it runs from the same directory the MSI
/// is about to overwrite). Kept as a plain static method, independent of
/// AppContext.BaseDirectory/Process.Start, specifically so the copy
/// mechanics - full tree copy, stale-file removal, nested subdirectories -
/// are unit-testable without a real installed helper or a DI refactor of
/// BridgeOrchestrator's constructor.
/// </summary>
public static class DetachedHelperStaging
{
    /// <summary>
    /// Replaces <paramref name="destinationDir"/> with a full copy of
    /// <paramref name="sourceDir"/> (deletes any prior contents first, so a
    /// stale file from a previous version can never linger in the staged
    /// copy). Preserves relative subdirectory structure.
    /// </summary>
    public static void CopyTree(string sourceDir, string destinationDir)
    {
        if (Directory.Exists(destinationDir))
        {
            Directory.Delete(destinationDir, recursive: true);
        }

        Directory.CreateDirectory(destinationDir);
        foreach (var file in Directory.EnumerateFiles(sourceDir, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceDir, file);
            var destination = Path.Combine(destinationDir, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file, destination, overwrite: true);
        }
    }
}
