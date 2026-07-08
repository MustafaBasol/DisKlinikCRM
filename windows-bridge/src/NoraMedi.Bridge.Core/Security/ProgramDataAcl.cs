using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;

namespace NoraMedi.Bridge.Core.Security;

/// <summary>
/// Locks down the bridge's ProgramData tree (credential blob, spool
/// directory, SQLite database, logs) to LocalSystem + Administrators only,
/// breaking inheritance so a misconfigured parent ACL can never grant an
/// unprivileged user access. An optional extra SID is added for
/// deployments using a dedicated service account instead of LocalSystem
/// (e.g. because the watched folder is a UNC share LocalSystem cannot reach).
/// </summary>
[SupportedOSPlatform("windows")]
public static class ProgramDataAcl
{
    public static void ProtectDirectory(string path, string? extraAccountSid = null)
    {
        Directory.CreateDirectory(path);
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);

        foreach (var rule in BuildRules(extraAccountSid, forDirectory: true))
        {
            security.AddAccessRule(rule);
        }

        new DirectoryInfo(path).SetAccessControl(security);
    }

    public static void ProtectFile(string path, string? extraAccountSid = null)
    {
        var security = new FileSecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);

        foreach (var rule in BuildRules(extraAccountSid, forDirectory: false))
        {
            security.AddAccessRule(rule);
        }

        new FileInfo(path).SetAccessControl(security);
    }

    private static IEnumerable<FileSystemAccessRule> BuildRules(string? extraAccountSid, bool forDirectory)
    {
        var inheritance = forDirectory
            ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit
            : InheritanceFlags.None;

        yield return new FileSystemAccessRule(
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            FileSystemRights.FullControl,
            inheritance,
            PropagationFlags.None,
            AccessControlType.Allow);

        yield return new FileSystemAccessRule(
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            FileSystemRights.FullControl,
            inheritance,
            PropagationFlags.None,
            AccessControlType.Allow);

        if (!string.IsNullOrEmpty(extraAccountSid))
        {
            yield return new FileSystemAccessRule(
                new SecurityIdentifier(extraAccountSid),
                FileSystemRights.Modify,
                inheritance,
                PropagationFlags.None,
                AccessControlType.Allow);
        }
    }
}
