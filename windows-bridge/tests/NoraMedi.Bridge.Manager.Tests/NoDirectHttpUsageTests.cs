using System.IO;
using System.Reflection;

namespace NoraMedi.Bridge.Manager.Tests;

/// <summary>
/// Security invariant from windows-bridge/docs/security.md: the Manager
/// must never call any NoraMedi HTTP/API endpoint directly — every server
/// interaction is proxied through the Service via the named pipe. This
/// scans the Manager project's own source (not Core, which legitimately
/// owns the service-to-server HTTP client) for HttpClient/RestClient usage
/// and asserts none exists, and cross-checks by reflecting over the built
/// Manager assembly's referenced assemblies.
/// </summary>
public class NoDirectHttpUsageTests
{
    private static string FindManagerSourceDirectory()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "NoraMedi.Bridge.sln")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        var managerSrc = Path.Combine(dir!.FullName, "src", "NoraMedi.Bridge.Manager");
        Assert.True(Directory.Exists(managerSrc), $"Expected to find Manager source at {managerSrc}");
        return managerSrc;
    }

    [Fact]
    public void ManagerSource_ContainsNoHttpOrRestClientUsage()
    {
        var managerSrc = FindManagerSourceDirectory();
        var csFiles = Directory.GetFiles(managerSrc, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}") &&
                        !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
            .ToList();

        Assert.NotEmpty(csFiles);

        var offenders = new List<string>();
        foreach (var file in csFiles)
        {
            var content = File.ReadAllText(file);
            if (content.Contains("HttpClient", StringComparison.Ordinal) ||
                content.Contains("RestClient", StringComparison.Ordinal) ||
                content.Contains("System.Net.Http", StringComparison.Ordinal))
            {
                offenders.Add(file);
            }
        }

        Assert.Empty(offenders);
    }

    [Fact]
    public void ManagerAssembly_DoesNotReferenceSystemNetHttp()
    {
        var managerAssembly = typeof(Manager.ViewModels.MainViewModel).Assembly;

        var referencesHttp = managerAssembly.GetReferencedAssemblies()
            .Any(a => a.Name is "System.Net.Http" or "Microsoft.Extensions.Http");

        Assert.False(referencesHttp, "The Manager assembly must not reference an HTTP client library — all server calls are proxied through the Service via the named pipe.");
    }
}
