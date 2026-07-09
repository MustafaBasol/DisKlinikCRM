using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.Tests.TestSupport;

public sealed class FakeFileDialogService : IFileDialogService
{
    public string? NextPickedFolder { get; set; }
    public string? NextSavePath { get; set; }
    public int PickFolderCallCount { get; private set; }
    public int PickSaveFileCallCount { get; private set; }

    public string? PickFolder(string title)
    {
        PickFolderCallCount++;
        return NextPickedFolder;
    }

    public string? PickSaveFile(string title, string defaultFileName, string filter)
    {
        PickSaveFileCallCount++;
        return NextSavePath;
    }
}
