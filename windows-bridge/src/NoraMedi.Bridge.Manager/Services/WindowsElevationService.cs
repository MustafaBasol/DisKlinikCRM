using System.Diagnostics;
using System.Security.Principal;
using System.Windows;

namespace NoraMedi.Bridge.Manager.Services;

/// <summary>Real elevation check/relaunch backed by <see cref="WindowsIdentity"/> and <see cref="Process"/>.</summary>
public sealed class WindowsElevationService : IElevationService
{
    public bool IsElevated
    {
        get
        {
            using var identity = WindowsIdentity.GetCurrent();
            var principal = new WindowsPrincipal(identity);
            return principal.IsInRole(WindowsBuiltInRole.Administrator);
        }
    }

    public void RestartElevated()
    {
        var exePath = Process.GetCurrentProcess().MainModule?.FileName;
        if (string.IsNullOrEmpty(exePath))
        {
            return;
        }

        var startInfo = new ProcessStartInfo(exePath)
        {
            UseShellExecute = true,
            Verb = "runas",
        };

        try
        {
            Process.Start(startInfo);
            Application.Current.Shutdown();
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // User declined the UAC prompt — stay in the current (unelevated) instance.
        }
    }
}
