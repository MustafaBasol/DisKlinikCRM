using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Configuration.EnvironmentVariables;
using Microsoft.Extensions.Configuration.Json;
using NoraMedi.Bridge.Core.Security;

namespace NoraMedi.Bridge.Service;

/// <summary>
/// Layers a mutable, ProgramData-resident configuration override on top of
/// the packaged (Program Files) appsettings.json/appsettings.{Environment}.json
/// defaults, so a locally customized <c>Enabled</c>/<c>ServerUrl</c>/
/// <c>PipeName</c>/etc. survives an MSI major upgrade or repair.
///
/// Real-hardware testing found that an in-place upgrade reset a paired
/// installation's Enabled=true back to false and its ServerUrl back to the
/// packaged default: Package.wxs harvests everything under
/// $(PublishServiceDir), including appsettings.json, as an ordinary MSI
/// File — every upgrade/repair overwrites it with the build's packaged
/// content, by design (that's how a bug-fixed default ships). There was no
/// separate place for an operator's local override to live, so any manual
/// edit to the installed appsettings.json was destroyed on the next upgrade.
///
/// The fix is deliberately NOT a WiX change: %ProgramData%\NoraMediBridge
/// is already untouched by install/upgrade/repair/uninstall (see
/// Package.wxs's own comment on RemoveLocalDataComponent) because WiX never
/// owns anything under it. Putting the override file there for free reuses
/// that same guarantee — Program.cs just needs to know to read it.
///
/// Effective precedence, low to high: packaged appsettings.json/
/// appsettings.{Environment}.json (added by Host.CreateApplicationBuilder)
/// -> this ProgramData override (inserted here) -> environment variables
/// -> command-line arguments (both already added by
/// Host.CreateApplicationBuilder after environment variables).
/// </summary>
public static class ProgramDataConfigOverride
{
    public static string DefaultPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "NoraMediBridge", "config", "appsettings.json");

    /// <summary>
    /// Locks the override directory down to LocalSystem + Administrators
    /// (mirrors Security.ProgramDataAcl's treatment of the rest of the
    /// bridge's ProgramData tree — this file can hold ServerUrl/PipeName,
    /// never a credential, but an unprivileged write here is still a
    /// meaningful tamper vector: e.g. redirecting ServerUrl to a
    /// attacker-controlled host) and inserts an optional JSON source
    /// reading <paramref name="overridePath"/> immediately before the
    /// environment-variables source in <paramref name="configurationBuilder"/>'s
    /// source list (or at the end if that source isn't present).
    /// </summary>
    /// <param name="extraAccountSid">
    /// Only meaningful for a deployment running the Service under a
    /// dedicated non-LocalSystem account (mirrors BridgeOptions.ServiceAccountSid);
    /// production always installs the Service as LocalSystem (see
    /// Package.wxs's ServiceInstall Account="LocalSystem"), which the
    /// LocalSystem ACE already covers without this. Exists so tests running
    /// as an ordinary, non-elevated user can still read back what they wrote.
    /// </param>
    public static void Apply(IConfigurationBuilder configurationBuilder, string overridePath, string? extraAccountSid = null)
    {
        var directory = Path.GetDirectoryName(overridePath);
        if (!string.IsNullOrEmpty(directory))
        {
            ProgramDataAcl.ProtectDirectory(directory, extraAccountSid);
        }

        // AddJsonFile (rather than constructing JsonConfigurationSource by
        // hand) is what correctly resolves an absolute path into a
        // PhysicalFileProvider rooted at its directory — a hand-built
        // source's Path is otherwise resolved relative to the default
        // FileProvider's root (the app's base directory), silently never
        // matching an absolute ProgramData path. The source is appended by
        // this call; it's immediately removed and re-inserted below at the
        // position that gives it the right precedence.
        configurationBuilder.AddJsonFile(overridePath, optional: true, reloadOnChange: false);
        var source = configurationBuilder.Sources[^1];
        configurationBuilder.Sources.RemoveAt(configurationBuilder.Sources.Count - 1);

        // Host.CreateApplicationBuilder registers TWO EnvironmentVariablesConfigurationSource
        // instances, not one: an early DOTNET_-prefixed bootstrap source (used only to resolve
        // ContentRootPath/EnvironmentName, inserted *before* appsettings.json/
        // appsettings.{Environment}.json) and the real unprefixed one that AddEnvironmentVariables()
        // appends *after* those JSON files, immediately before AddCommandLine(args) — confirmed by
        // dumping builder.Configuration.Sources at runtime. Matching the *first* occurrence (as this
        // used to) grabs the DOTNET_-prefixed bootstrap source and inserts the override before
        // appsettings.json is even loaded, making the packaged file win over ProgramData — the
        // opposite of the documented precedence. Matching the *last* unprefixed source targets the
        // real app env-vars source instead.
        var sources = configurationBuilder.Sources;
        var envVarIndex = -1;
        for (var i = sources.Count - 1; i >= 0; i--)
        {
            if (sources[i] is EnvironmentVariablesConfigurationSource { Prefix: null or "" })
            {
                envVarIndex = i;
                break;
            }
        }

        if (envVarIndex < 0)
        {
            for (var i = sources.Count - 1; i >= 0; i--)
            {
                if (sources[i] is EnvironmentVariablesConfigurationSource)
                {
                    envVarIndex = i;
                    break;
                }
            }
        }

        if (envVarIndex >= 0)
        {
            sources.Insert(envVarIndex, source);
        }
        else
        {
            sources.Add(source);
        }
    }
}
