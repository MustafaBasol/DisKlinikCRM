using System.Security.AccessControl;
using System.Security.Principal;
using NoraMedi.Bridge.Core.Security;

namespace NoraMedi.Bridge.Core.Tests.Security;

public class ProgramDataAclTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-acl-").FullName;

    [Fact]
    public void ProtectDirectory_BreaksInheritanceAndGrantsOnlySystemAndAdmins()
    {
        var target = Path.Combine(_root, "protected-dir");
        ProgramDataAcl.ProtectDirectory(target);

        var security = new DirectoryInfo(target).GetAccessControl(AccessControlSections.Access);
        Assert.True(security.AreAccessRulesProtected);

        var rules = security.GetAccessRules(true, false, typeof(SecurityIdentifier));
        var sids = rules.Cast<FileSystemAccessRule>().Select(r => (SecurityIdentifier)r.IdentityReference).ToList();

        Assert.Contains(sids, sid => sid.IsWellKnown(WellKnownSidType.LocalSystemSid));
        Assert.Contains(sids, sid => sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid));
        Assert.DoesNotContain(sids, sid => sid.IsWellKnown(WellKnownSidType.WorldSid));
        Assert.DoesNotContain(sids, sid => sid.IsWellKnown(WellKnownSidType.AuthenticatedUserSid));
    }

    [Fact]
    public void ProtectFile_BreaksInheritanceAndGrantsOnlySystemAndAdmins()
    {
        var target = Path.Combine(_root, "credential.bin");
        File.WriteAllBytes(target, [1, 2, 3]);
        ProgramDataAcl.ProtectFile(target);

        var security = new FileInfo(target).GetAccessControl(AccessControlSections.Access);
        Assert.True(security.AreAccessRulesProtected);

        var rules = security.GetAccessRules(true, false, typeof(SecurityIdentifier));
        var sids = rules.Cast<FileSystemAccessRule>().Select(r => (SecurityIdentifier)r.IdentityReference).ToList();
        Assert.Contains(sids, sid => sid.IsWellKnown(WellKnownSidType.LocalSystemSid));
        Assert.Contains(sids, sid => sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid));
    }

    [Fact]
    public void ProtectDirectory_WithServiceAccountSid_AlsoGrantsThatAccount()
    {
        // A well-known SID stands in for a real domain service account SID here —
        // production callers pass the actual configured -ServiceAccount SID.
        var serviceAccountSid = new SecurityIdentifier(WellKnownSidType.NetworkServiceSid, null).Value;
        var target = Path.Combine(_root, "shared-service-dir");

        ProgramDataAcl.ProtectDirectory(target, serviceAccountSid);

        var security = new DirectoryInfo(target).GetAccessControl(AccessControlSections.Access);
        var rules = security.GetAccessRules(true, false, typeof(SecurityIdentifier));
        var sids = rules.Cast<FileSystemAccessRule>().Select(r => (SecurityIdentifier)r.IdentityReference).ToList();

        Assert.Contains(sids, sid => sid.IsWellKnown(WellKnownSidType.NetworkServiceSid));
    }

    public void Dispose()
    {
        // ProtectDirectory/ProtectFile deliberately locks the current (unprivileged
        // test) user out — restore access before cleanup. Windows always grants the
        // object's owner implicit WRITE_DAC, so this is safe even though the DACL
        // above denies the owner every other right.
        if (Directory.Exists(_root))
        {
            RestoreOwnerAccess(_root);
            Directory.Delete(_root, recursive: true);
        }
    }

    private static void RestoreOwnerAccess(string root)
    {
        // Non-recursive by design: locked-down subdirectories can't be traversed
        // INTO until their own ACL is reset first, so only fix up root and its
        // immediate children (sufficient for how these tests nest paths).
        var self = WindowsIdentity.GetCurrent().User!;
        void Grant(string dir)
        {
            var security = new DirectorySecurity();
            security.SetAccessRuleProtection(false, false);
            security.AddAccessRule(new FileSystemAccessRule(self, FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            new DirectoryInfo(dir).SetAccessControl(security);
        }

        Grant(root);
        foreach (var dir in Directory.GetDirectories(root))
        {
            Grant(dir);
        }
        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            var security = new FileSecurity();
            security.SetAccessRuleProtection(false, false);
            security.AddAccessRule(new FileSystemAccessRule(self, FileSystemRights.FullControl, AccessControlType.Allow));
            new FileInfo(file).SetAccessControl(security);
        }
    }
}
