using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.Tests.TestSupport;

public sealed class FakeFileDialogService : IFileDialogService
{
    public string? NextPickedFolder { get; set; }
    public string? NextSavePath { get; set; }
    public int PickFolderCallCount { get; private set; }
    public int PickSaveFileCallCount { get; private set; }
    public string? LastPickFolderTitle { get; private set; }
    public string? LastPickSaveFileTitle { get; private set; }
    public string? LastPickSaveFileFilter { get; private set; }

    public string? PickFolder(string title)
    {
        PickFolderCallCount++;
        LastPickFolderTitle = title;
        return NextPickedFolder;
    }

    public string? PickSaveFile(string title, string defaultFileName, string filter)
    {
        PickSaveFileCallCount++;
        LastPickSaveFileTitle = title;
        LastPickSaveFileFilter = filter;
        return NextSavePath;
    }
}
