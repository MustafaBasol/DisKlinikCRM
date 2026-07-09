namespace NoraMedi.Bridge.Manager.Services;

/// <summary>
/// Detects whether the current process is running elevated, and offers a
/// way to relaunch elevated. Abstracted so ViewModel tests can assert on the
/// "Action required" state without a real elevation prompt (see
/// authorization rules: privileged ops require the Manager to be admin).
/// </summary>
public interface IElevationService
{
    bool IsElevated { get; }

    /// <summary>Relaunches the current executable with the "runas" verb (triggers the UAC prompt) and exits this instance on success.</summary>
    void RestartElevated();
}
