using System.Threading;
using System.Windows;
using NoraMedi.Bridge.Manager.Tests.TestSupport;
using NoraMedi.Bridge.Manager.ViewModels;
using NoraMedi.Bridge.Manager.Views;

namespace NoraMedi.Bridge.Manager.Tests;

/// <summary>
/// Regression guard for invalid XAML — e.g. the reported <c>Width="*"</c> on
/// a non-Grid-column/row element (a XAML parse-time exception at
/// InitializeComponent) and a Visibility-returning converter bound to a
/// bool-typed target property (a binding-time exception once WPF evaluates
/// it). Constructs the real <see cref="MainWindow"/> — with fakes standing
/// in for IPC/dialogs/elevation — on a dedicated STA thread, since any WPF
/// Window requires STA. This does NOT call Show() or pump a full message
/// loop (no interactive desktop session is guaranteed in every build
/// environment this runs in), so it does not exercise real rendering/user
/// interaction — only that XAML parsing plus an initial measure/arrange
/// pass (which forces WPF to evaluate the data bindings/converters) succeed
/// without throwing. That is the closest feasible static verification for
/// catching this class of regression going forward.
/// </summary>
public class MainWindowXamlTests
{
    private static readonly Lock ApplicationInitLock = new();

    [Fact]
    public void MainWindow_ConstructsParsesXamlAndEvaluatesBindings_WithoutThrowing()
    {
        Exception? caught = null;

        var thread = new Thread(() =>
        {
            try
            {
                EnsureApplicationResourcesLoaded();

                var viewModel = new MainViewModel(
                    new FakeBridgePipeClientService(), new FakeFileDialogService(), new FakeElevationService());
                var window = new MainWindow(viewModel);

                // Force layout so bindings/converters actually evaluate —
                // this is what makes an EnumEqualsConverter-on-a-bool-target
                // mismatch throw, not just parsing the markup.
                window.Measure(new Size(720, 520));
                window.Arrange(new Rect(0, 0, 720, 520));
            }
            catch (Exception ex)
            {
                caught = ex;
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();

        Assert.Null(caught);
    }

    private static void EnsureApplicationResourcesLoaded()
    {
        lock (ApplicationInitLock)
        {
            if (Application.Current is not null)
            {
                return;
            }

            _ = new Application();
            Application.Current!.Resources.MergedDictionaries.Add(new ResourceDictionary
            {
                // Pack URI authority is the assembly's AssemblyName
                // (NoraMediBridge.Manager), not its default namespace/project
                // name (NoraMedi.Bridge.Manager) — see the csproj's
                // <AssemblyName> — mismatching the two fails resolution.
                Source = new Uri("/NoraMediBridge.Manager;component/Views/SharedStyles.xaml", UriKind.Relative),
            });
        }
    }
}
