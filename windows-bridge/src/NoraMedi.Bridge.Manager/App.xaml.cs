using System.Windows;
using NoraMedi.Bridge.Manager.Services;
using NoraMedi.Bridge.Manager.ViewModels;
using NoraMedi.Bridge.Manager.Views;

namespace NoraMedi.Bridge.Manager;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var pipeClient = new BridgePipeClientService();
        var fileDialog = new WpfFileDialogService();
        var elevationService = new WindowsElevationService();
        var mainViewModel = new MainViewModel(pipeClient, fileDialog, elevationService);

        var window = new MainWindow(mainViewModel);
        window.Show();

        _ = mainViewModel.InitializeAsync();
    }
}
