using System.Windows.Input;
using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.ViewModels;

/// <summary>
/// Update-status placeholder. Always surfaces the truthful "not supported,
/// install manually" message from <c>CheckForUpdatesResponse.NotSupported()</c>
/// — no fake progress bar, no simulated "checking..." beyond the real IPC
/// round-trip.
/// </summary>
public sealed class UpdateViewModel : ViewModelBase
{
    private readonly IBridgePipeClientService _pipeClient;
    private bool _isBusy;
    private string? _message;
    private bool _isSupported;

    public UpdateViewModel(IBridgePipeClientService pipeClient)
    {
        _pipeClient = pipeClient;
        CheckForUpdatesCommand = new AsyncRelayCommand(CheckForUpdatesAsync, () => !IsBusy);
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set => SetProperty(ref _isBusy, value);
    }

    public string? Message
    {
        get => _message;
        private set => SetProperty(ref _message, value);
    }

    public bool IsSupported
    {
        get => _isSupported;
        private set => SetProperty(ref _isSupported, value);
    }

    public ICommand CheckForUpdatesCommand { get; }

    public async Task CheckForUpdatesAsync()
    {
        IsBusy = true;
        try
        {
            var result = await _pipeClient.CheckForUpdatesAsync();
            if (!result.Success)
            {
                IsSupported = false;
                Message = Models.StatusLabels.FromErrorKind(result.ErrorKind);
                return;
            }

            IsSupported = result.Value!.Supported;
            Message = result.Value.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }
}
