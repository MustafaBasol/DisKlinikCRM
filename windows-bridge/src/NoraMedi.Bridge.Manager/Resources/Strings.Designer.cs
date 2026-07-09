using System.Globalization;
using System.Reflection;
using System.Resources;

namespace NoraMedi.Bridge.Manager.Resources;

/// <summary>
/// Hand-written strongly-typed accessor over Strings.resx (kept simple and
/// explicit rather than relying on IDE-generated designer codegen, so
/// `dotnet build` on the command line doesn't need a design-time step).
/// English-only content today; adding a Strings.xx.resx satellite resource
/// file is enough to localize since every lookup goes through here.
/// </summary>
public static class Strings
{
    private static readonly ResourceManager ResourceManager =
        new("NoraMedi.Bridge.Manager.Resources.Strings", Assembly.GetExecutingAssembly());

    public static string AppTitle => Get();

    public static string Status_NotConnected => Get();
    public static string Status_Connected => Get();
    public static string Status_ServiceUnavailable => Get();
    public static string Status_FolderInaccessible => Get();
    public static string Status_ConnectionRequired => Get();
    public static string Status_ActionRequired => Get();

    public static string Tab_Status => Get();
    public static string Tab_Pairing => Get();
    public static string Tab_Bindings => Get();
    public static string Tab_Queue => Get();
    public static string Tab_Diagnostics => Get();
    public static string Tab_Updates => Get();

    public static string Button_Refresh => Get();
    public static string Button_RefreshAll => Get();
    public static string Button_TestConnection => Get();
    public static string Button_Submit => Get();
    public static string Button_Browse => Get();
    public static string Button_Validate => Get();
    public static string Button_Save => Get();
    public static string Button_Remove => Get();
    public static string Button_Retry => Get();
    public static string Button_Export => Get();
    public static string Button_CheckForUpdates => Get();
    public static string Button_RestartElevated => Get();

    public static string Label_PairingCode => Get();
    public static string Label_ComputerName => Get();
    public static string Label_DeviceId => Get();
    public static string Label_Modality => Get();
    public static string Label_FolderPath => Get();
    public static string Label_IngestKey => Get();
    public static string Label_AgentVersion => Get();
    public static string Label_Paired => Get();
    public static string Label_Pending => Get();
    public static string Label_Processing => Get();
    public static string Label_Failed => Get();
    public static string Label_Completed => Get();
    public static string Label_SelectDevice => Get();

    public static string Msg_FeatureDisabled => Get();
    public static string Msg_ElevationRequired => Get();
    public static string Msg_ServiceUnavailable => Get();
    public static string Msg_NoAvailableServerBindings => Get();

    public static string Dialog_FolderPickerTitle => Get();
    public static string Dialog_SaveDiagnosticsTitle => Get();
    public static string Dialog_SaveDiagnosticsFilter => Get();

    private static string Get([System.Runtime.CompilerServices.CallerMemberName] string name = "") =>
        ResourceManager.GetString(name, CultureInfo.CurrentUICulture) ?? name;
}
