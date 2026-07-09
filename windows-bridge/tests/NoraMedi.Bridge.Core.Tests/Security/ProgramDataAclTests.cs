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

    public void Dispose() => TestSupport.AclCleanup.UnlockAndDelete(_root);
}
