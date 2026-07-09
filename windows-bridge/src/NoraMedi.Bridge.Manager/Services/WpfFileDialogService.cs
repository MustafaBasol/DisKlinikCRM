using Microsoft.Win32;

namespace NoraMedi.Bridge.Manager.Services;

/// <summary>Real folder/save-file pickers backed by the standard WPF/Win32 dialogs.</summary>
public sealed class WpfFileDialogService : IFileDialogService
{
    public string? PickFolder(string title)
    {
        var dialog = new OpenFolderDialog { Title = title };
        return dialog.ShowDialog() == true ? dialog.FolderName : null;
    }

    public string? PickSaveFile(string title, string defaultFileName, string filter)
    {
        var dialog = new SaveFileDialog
        {
            Title = title,
            FileName = defaultFileName,
            Filter = filter,
        };
        return dialog.ShowDialog() == true ? dialog.FileName : null;
    }
}
