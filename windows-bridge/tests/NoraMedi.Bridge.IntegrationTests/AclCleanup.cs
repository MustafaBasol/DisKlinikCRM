using System.Security.AccessControl;
using System.Security.Principal;

namespace NoraMedi.Bridge.IntegrationTests;

/// <summary>
/// ProgramDataAcl.ProtectDirectory/ProtectFile deliberately lock the current
/// (unprivileged test) user out of anything they protect — that IS the
/// feature under test. Windows always grants an object's owner implicit
/// WRITE_DAC regardless of its DACL, so resetting each level's ACL (which
/// only needs WRITE_DAC, not list/traverse rights) before descending into it
/// always succeeds for whichever account created the tree — i.e. the test
/// process itself.
/// </summary>
internal static class AclCleanup
{
    public static void UnlockAndDelete(string root)
    {
        if (Directory.Exists(root))
        {
            UnlockRecursive(root);
            Directory.Delete(root, recursive: true);
        }
        else if (File.Exists(root))
        {
            GrantSelf(new FileInfo(root));
            File.Delete(root);
        }
    }

    private static void UnlockRecursive(string path)
    {
        if (Directory.Exists(path))
        {
            GrantSelf(new DirectoryInfo(path));
            foreach (var child in Directory.GetFileSystemEntries(path))
            {
                UnlockRecursive(child);
            }
        }
        else if (File.Exists(path))
        {
            GrantSelf(new FileInfo(path));
        }
    }

    private static void GrantSelf(DirectoryInfo dir)
    {
        var self = WindowsIdentity.GetCurrent().User!;
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(false, false);
        security.AddAccessRule(new FileSystemAccessRule(self, FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        dir.SetAccessControl(security);
    }

    private static void GrantSelf(FileInfo file)
    {
        var self = WindowsIdentity.GetCurrent().User!;
        var security = new FileSecurity();
        security.SetAccessRuleProtection(false, false);
        security.AddAccessRule(new FileSystemAccessRule(self, FileSystemRights.FullControl, AccessControlType.Allow));
        file.SetAccessControl(security);
    }
}
