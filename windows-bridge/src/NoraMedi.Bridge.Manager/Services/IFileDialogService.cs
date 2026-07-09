namespace NoraMedi.Bridge.Manager.Services;

/// <summary>
/// Abstraction over the standard Windows folder-picker and save-file
/// dialogs, so ViewModels can be unit tested without spinning up real WPF
/// dialogs.
/// </summary>
public interface IFileDialogService
{
    /// <summary>Shows a folder picker. Returns the selected path, or null if the user cancelled.</summary>
    string? PickFolder(string title);

    /// <summary>Shows a save-file dialog. Returns the chosen path, or null if the user cancelled.</summary>
    string? PickSaveFile(string title, string defaultFileName, string filter);
}
