using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace NoraMedi.Bridge.Service.Tests;

/// <summary>
/// Regression coverage for the real-hardware finding: an MSI upgrade
/// overwrote the installed appsettings.json (Package.wxs harvests it as an
/// ordinary File under $(PublishServiceDir)) and silently reset a paired
/// installation's Enabled/ServerUrl back to packaged defaults.
/// ProgramDataConfigOverride layers an optional %ProgramData%-resident
/// override on top of those packaged defaults, in the precedence order
/// packaged defaults -> ProgramData override -> environment variables.
/// </summary>
public class ProgramDataConfigOverrideTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("nmb-config-override-").FullName;
    private readonly List<string> _envVarsToClear = [];

    // ProtectDirectory locks the directory to LocalSystem + Administrators
    // only; tests run as an ordinary, non-elevated user, so — exactly like a
    // real deployment using a dedicated non-LocalSystem service account —
    // most tests here pass their own identity as the extra SID to retain
    // read access to what they just wrote. The one test that verifies the
    // real production lockdown (no extra SID) is the exception.
    private static readonly string CurrentUserSid = WindowsIdentity.GetCurrent().User!.Value;

    public void Dispose()
    {
        foreach (var name in _envVarsToClear)
        {
            Environment.SetEnvironmentVariable(name, null);
        }
        AclCleanup.UnlockAndDelete(_root);
        foreach (var contentRoot in _contentRootsToClean)
        {
            Directory.Delete(contentRoot, recursive: true);
        }
    }

    private string OverridePath => Path.Combine(_root, "config", "appsettings.json");

    private void SetEnvVar(string name, string value)
    {
        Environment.SetEnvironmentVariable(name, value);
        _envVarsToClear.Add(name);
    }

    [Fact]
    public void ProgramDataOverride_WinsOverPackagedDefault()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(OverridePath)!);
        File.WriteAllText(OverridePath, """{"BridgeSelfService":{"Enabled":true,"ServerUrl":"http://127.0.0.1:5000"}}""");

        var builder = new ConfigurationBuilder();
        builder.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["BridgeSelfService:Enabled"] = "false",
            ["BridgeSelfService:ServerUrl"] = "https://api.noramedi.com",
        });
        builder.AddEnvironmentVariables();

        ProgramDataConfigOverride.Apply(builder, OverridePath, CurrentUserSid);
        var config = builder.Build();

        Assert.Equal("True", config["BridgeSelfService:Enabled"]);
        Assert.Equal("http://127.0.0.1:5000", config["BridgeSelfService:ServerUrl"]);
    }

    [Fact]
    public void EnvironmentVariable_StillWinsOverProgramDataOverride()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(OverridePath)!);
        File.WriteAllText(OverridePath, """{"BridgeSelfService":{"Enabled":true,"ServerUrl":"http://127.0.0.1:5000"}}""");
        SetEnvVar("BridgeSelfService__ServerUrl", "https://env-override.example.com");

        var builder = new ConfigurationBuilder();
        builder.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["BridgeSelfService:Enabled"] = "false",
            ["BridgeSelfService:ServerUrl"] = "https://api.noramedi.com",
        });
        builder.AddEnvironmentVariables();

        ProgramDataConfigOverride.Apply(builder, OverridePath, CurrentUserSid);
        var config = builder.Build();

        Assert.Equal("True", config["BridgeSelfService:Enabled"]); // still ProgramData, no env override for this key
        Assert.Equal("https://env-override.example.com", config["BridgeSelfService:ServerUrl"]); // env wins
    }

    [Fact]
    public void MissingOverrideFile_FallsBackToPackagedDefaultWithoutThrowing()
    {
        var builder = new ConfigurationBuilder();
        builder.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["BridgeSelfService:Enabled"] = "false",
            ["BridgeSelfService:ServerUrl"] = "https://api.noramedi.com",
        });
        builder.AddEnvironmentVariables();

        ProgramDataConfigOverride.Apply(builder, OverridePath, CurrentUserSid); // file never written

        var config = builder.Build();
        Assert.Equal("false", config["BridgeSelfService:Enabled"]);
        Assert.Equal("https://api.noramedi.com", config["BridgeSelfService:ServerUrl"]);
    }

    [Fact]
    public void Apply_LocksDownTheOverrideDirectory_ToLocalSystemAndAdministratorsOnly()
    {
        var builder = new ConfigurationBuilder();
        ProgramDataConfigOverride.Apply(builder, OverridePath); // no extra SID — proves the real production lockdown

        var directory = Path.GetDirectoryName(OverridePath)!;
        Assert.True(Directory.Exists(directory));

        var security = new DirectoryInfo(directory).GetAccessControl();
        Assert.True(security.AreAccessRulesProtected);

        var currentUserSid = WindowsIdentity.GetCurrent().User!;
        var rules = security.GetAccessRules(true, false, typeof(SecurityIdentifier))
            .Cast<FileSystemAccessRule>()
            .ToList();

        // Only LocalSystem/Administrators are granted — the test's own
        // identity (an ordinary user account in CI/dev) must NOT appear,
        // proving this isn't left world-writable.
        Assert.DoesNotContain(rules, r => ((SecurityIdentifier)r.IdentityReference).Equals(currentUserSid));
    }

    [Fact]
    public void Apply_InsertsOverrideBeforeEnvironmentVariables_NotAfter()
    {
        // If inserted AFTER (or appended to the end of) the sources list, the
        // ProgramData override would incorrectly outrank environment
        // variables — this pins the ordering contract directly rather than
        // only inferring it from Build() output.
        var builder = new ConfigurationBuilder();
        builder.AddEnvironmentVariables();
        var envVarSourceCountBefore = builder.Sources.Count;

        ProgramDataConfigOverride.Apply(builder, OverridePath, CurrentUserSid);

        var envVarIndex = builder.Sources.ToList().FindIndex(s => s.GetType().Name == "EnvironmentVariablesConfigurationSource");
        var jsonIndex = builder.Sources.ToList().FindIndex(s => s.GetType().Name == "JsonConfigurationSource");
        Assert.True(jsonIndex >= 0 && envVarIndex >= 0);
        Assert.True(jsonIndex < envVarIndex, "ProgramData override must be inserted before the environment-variables source");
        Assert.Equal(envVarSourceCountBefore + 1, builder.Sources.Count);
    }

    // Real-hardware regression: Host.CreateApplicationBuilder(args) — exactly what
    // Program.cs calls — registers TWO EnvironmentVariablesConfigurationSource
    // instances (an early DOTNET_-prefixed bootstrap source added *before*
    // appsettings.json, and the real unprefixed one added *after* it). The tests
    // above build a bare ConfigurationBuilder by hand and only ever see the single,
    // correct source, so they could not catch a bug that only manifests against the
    // real two-source composition. These tests use the actual
    // Host.CreateApplicationBuilder pipeline, with ContentRootPath redirected to a
    // temp directory so a real packaged appsettings.json can be planted, to pin the
    // full precedence chain end to end.
    private HostApplicationBuilder NewRealHostBuilder(string packagedPipeName, string[]? args = null)
    {
        var contentRoot = Directory.CreateTempSubdirectory("nmb-hostbuilder-").FullName;
        _contentRootsToClean.Add(contentRoot);
        File.WriteAllText(
            Path.Combine(contentRoot, "appsettings.json"),
            "{\"BridgeSelfService\":{\"PipeName\":\"" + packagedPipeName + "\"}}");

        return Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
        {
            ContentRootPath = contentRoot,
            EnvironmentName = "Production",
            Args = args ?? [],
        });
    }

    private readonly List<string> _contentRootsToClean = [];

    [Fact]
    public void RealHostBuilder_PackagedJsonVsProgramData_ProgramDataWins()
    {
        var builder = NewRealHostBuilder(packagedPipeName: "NoraMediBridge-Test");
        Directory.CreateDirectory(Path.GetDirectoryName(OverridePath)!);
        File.WriteAllText(OverridePath, """{"BridgeSelfService":{"PipeName":"NoraMediBridge"}}""");

        ProgramDataConfigOverride.Apply(builder.Configuration, OverridePath, CurrentUserSid);

        Assert.Equal("NoraMediBridge", builder.Configuration["BridgeSelfService:PipeName"]);
    }

    [Fact]
    public void RealHostBuilder_ProgramDataVsEnvironmentVariable_EnvironmentWins()
    {
        var builder = NewRealHostBuilder(packagedPipeName: "NoraMediBridge-Test");
        Directory.CreateDirectory(Path.GetDirectoryName(OverridePath)!);
        File.WriteAllText(OverridePath, """{"BridgeSelfService":{"PipeName":"NoraMediBridge"}}""");
        SetEnvVar("BridgeSelfService__PipeName", "NoraMediBridge-FromEnv");

        ProgramDataConfigOverride.Apply(builder.Configuration, OverridePath, CurrentUserSid);

        Assert.Equal("NoraMediBridge-FromEnv", builder.Configuration["BridgeSelfService:PipeName"]);
    }

    [Fact]
    public void RealHostBuilder_EnvironmentVariableVsCommandLine_CommandLineWins()
    {
        var builder = NewRealHostBuilder(
            packagedPipeName: "NoraMediBridge-Test",
            args: ["--BridgeSelfService:PipeName=NoraMediBridge-FromCommandLine"]);
        Directory.CreateDirectory(Path.GetDirectoryName(OverridePath)!);
        File.WriteAllText(OverridePath, """{"BridgeSelfService":{"PipeName":"NoraMediBridge"}}""");
        SetEnvVar("BridgeSelfService__PipeName", "NoraMediBridge-FromEnv");

        ProgramDataConfigOverride.Apply(builder.Configuration, OverridePath, CurrentUserSid);

        Assert.Equal("NoraMediBridge-FromCommandLine", builder.Configuration["BridgeSelfService:PipeName"]);
    }

    [Fact]
    public void RealHostBuilder_PackagedTestPipeNameVsProgramDataRealPipeName_EffectiveResultIsReal()
    {
        // The exact scenario from the physical Scenario B finding: packaged
        // appsettings.json still says "NoraMediBridge-Test" (a dev/test build
        // artifact) but the migrated ProgramData override says "NoraMediBridge" —
        // no environment variables or command-line args are present, so the
        // effective PipeName must be the ProgramData one.
        var builder = NewRealHostBuilder(packagedPipeName: "NoraMediBridge-Test");
        Directory.CreateDirectory(Path.GetDirectoryName(OverridePath)!);
        File.WriteAllText(OverridePath, """{"BridgeSelfService":{"PipeName":"NoraMediBridge"}}""");

        ProgramDataConfigOverride.Apply(builder.Configuration, OverridePath, CurrentUserSid);

        Assert.Equal("NoraMediBridge", builder.Configuration["BridgeSelfService:PipeName"]);
    }
}
