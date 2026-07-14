using System.Windows.Input;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.ViewModels;

/// <summary>
/// Composition root for the app's screens. Owns no IPC/business logic of
/// its own beyond wiring: it forwards the shared <see cref="IElevationService"/>
/// and listens for any child VM's "unauthorized" signal to show the single,
/// unmissable "Action required — restart as Administrator" state described
/// in the spec (never a silent failure, never a generic error).
/// </summary>
public sealed class MainViewModel : ViewModelBase
{
    private readonly IElevationService _elevationService;
    private bool _isElevationRequired;

    public MainViewModel(
        IBridgePipeClientService pipeClient,
        IFileDialogService fileDialog,
        IElevationService elevationService)
    {
        _elevationService = elevationService;

        Status = new StatusViewModel(pipeClient);
        Pairing = new PairingViewModel(pipeClient);
        Bindings = new BindingsViewModel(pipeClient, fileDialog);
        Queue = new QueueViewModel(pipeClient);
        Diagnostics = new DiagnosticsViewModel(pipeClient, fileDialog);
        Update = new UpdateViewModel(pipeClient);

        Status.UnauthorizedDetected += (_, _) => IsElevationRequired = true;
        Pairing.UnauthorizedDetected += (_, _) => IsElevationRequired = true;
        Bindings.UnauthorizedDetected += (_, _) => IsElevationRequired = true;
        Queue.UnauthorizedDetected += (_, _) => IsElevationRequired = true;
        Diagnostics.UnauthorizedDetected += (_, _) => IsElevationRequired = true;

        // One-shot refresh after a successful pairing — never a polling
        // timer, just a single reaction to the event the pairing flow raises.
        Pairing.PairingSucceeded += async (_, _) => await RefreshAllAsync();

        RestartElevatedCommand = new RelayCommand(_elevationService.RestartElevated);
        RefreshAllCommand = new AsyncRelayCommand(RefreshAllAsync, () => true);
    }

    public StatusViewModel Status { get; }

    public PairingViewModel Pairing { get; }

    public BindingsViewModel Bindings { get; }

    public QueueViewModel Queue { get; }

    public DiagnosticsViewModel Diagnostics { get; }

    public UpdateViewModel Update { get; }

    public bool IsElevationRequired
    {
        get => _isElevationRequired;
        set => SetProperty(ref _isElevationRequired, value);
    }

    public bool IsElevated => _elevationService.IsElevated;

    public ICommand RestartElevatedCommand { get; }

    /// <summary>Always-available manual refresh — the only way status/bindings/catalog are ever re-fetched besides startup and a successful pairing. There is deliberately no background polling/retry timer.</summary>
    public ICommand RefreshAllCommand { get; }

    /// <summary>
    /// Startup load: status AND the current folder bindings, then — only if
    /// already paired — the server's available-device catalog too (it is
    /// meaningless before pairing).
    /// </summary>
    public async Task InitializeAsync() => await RefreshAllAsync();

    private async Task RefreshAllAsync()
    {
        await Status.RefreshAsync();
        await Bindings.RefreshAsync();
        if (Status.Paired)
        {
            await Bindings.RefreshAvailableServerBindingsAsync();
        }
        await Update.RefreshRollbackStatusAsync();
    }
}
