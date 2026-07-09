using System.Windows.Input;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Services;
using NoraMedi.Bridge.Manager.Services.Logging;

namespace NoraMedi.Bridge.Manager.ViewModels;

/// <summary>
/// Drives the status dashboard: polls/reads <c>GetServiceStatus</c>, derives
/// the top-level <see cref="AppState"/>, and runs the connection test. This
/// is also where "service unavailable" vs "not connected" vs "disabled" is
/// decided — every other ViewModel just reacts to <see cref="State"/>.
/// </summary>
public sealed class StatusViewModel : ViewModelBase
{
    private readonly IBridgePipeClientService _pipeClient;
    private readonly ManagerLogger? _logger;
    private AppState _state = AppState.Initializing;
    private string _statusLabel = StatusLabels.ServiceUnavailable;
    private string? _agentVersion;
    private bool _paired;
    private bool _isBusy;
    private string? _testConnectionMessage;
    private bool _isTestConnectionSuccessful;

    public StatusViewModel(IBridgePipeClientService pipeClient, ManagerLogger? logger = null)
    {
        _pipeClient = pipeClient;
        _logger = logger;
        RefreshCommand = new AsyncRelayCommand(RefreshAsync, () => !IsBusy);
        TestConnectionCommand = new AsyncRelayCommand(TestConnectionAsync, () => !IsBusy && State == AppState.Connected);
    }

    public AppState State
    {
        get => _state;
        private set => SetProperty(ref _state, value);
    }

    public string StatusLabel
    {
        get => _statusLabel;
        private set => SetProperty(ref _statusLabel, value);
    }

    public string? AgentVersion
    {
        get => _agentVersion;
        private set => SetProperty(ref _agentVersion, value);
    }

    public bool Paired
    {
        get => _paired;
        private set => SetProperty(ref _paired, value);
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set => SetProperty(ref _isBusy, value);
    }

    public string? TestConnectionMessage
    {
        get => _testConnectionMessage;
        private set => SetProperty(ref _testConnectionMessage, value);
    }

    public bool IsTestConnectionSuccessful
    {
        get => _isTestConnectionSuccessful;
        private set => SetProperty(ref _isTestConnectionSuccessful, value);
    }

    public ICommand RefreshCommand { get; }

    public ICommand TestConnectionCommand { get; }

    /// <summary>Raised whenever a call comes back "unauthorized" — the shell listens and shows the elevation screen.</summary>
    public event EventHandler? UnauthorizedDetected;

    public async Task RefreshAsync()
    {
        IsBusy = true;
        try
        {
            var result = await _pipeClient.GetServiceStatusAsync();
            if (!result.Success)
            {
                ApplyFailure(result.ErrorKind);
                return;
            }

            var payload = result.Value!;
            AgentVersion = payload.AgentVersion;
            Paired = payload.Paired;

            State = payload.ConnectionState switch
            {
                "disabled" => AppState.FeatureDisabled,
                "online" => AppState.Connected,
                "offline" => AppState.NotConnected,
                _ => AppState.ServiceUnavailable,
            };
            StatusLabel = StatusLabels.FromConnectionState(payload.ConnectionState);
            _logger?.Info($"Service status refreshed: connectionState={payload.ConnectionState}");
        }
        finally
        {
            IsBusy = false;
        }
    }

    public async Task TestConnectionAsync()
    {
        IsBusy = true;
        try
        {
            var result = await _pipeClient.TestConnectionAsync();
            if (!result.Success)
            {
                if (result.ErrorKind == ManagerErrorKind.Unauthorized)
                {
                    State = AppState.ActionRequiredElevation;
                    StatusLabel = StatusLabels.ActionRequired;
                    UnauthorizedDetected?.Invoke(this, EventArgs.Empty);
                }
                else
                {
                    IsTestConnectionSuccessful = false;
                    TestConnectionMessage = StatusLabels.FromErrorKind(result.ErrorKind);
                }
                return;
            }

            IsTestConnectionSuccessful = result.Value!.Reachable;
            TestConnectionMessage = result.Value.Reachable ? StatusLabels.Connected : StatusLabels.NotConnected;
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void ApplyFailure(ManagerErrorKind errorKind)
    {
        if (errorKind == ManagerErrorKind.Unauthorized)
        {
            State = AppState.ActionRequiredElevation;
            StatusLabel = StatusLabels.ActionRequired;
            UnauthorizedDetected?.Invoke(this, EventArgs.Empty);
            return;
        }

        State = errorKind == ManagerErrorKind.FeatureDisabled ? AppState.FeatureDisabled : AppState.ServiceUnavailable;
        StatusLabel = StatusLabels.FromErrorKind(errorKind);
    }
}
