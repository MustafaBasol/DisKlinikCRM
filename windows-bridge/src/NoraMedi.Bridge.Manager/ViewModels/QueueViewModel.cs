using System.Windows.Input;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.ViewModels;

/// <summary>Upload-queue summary and single-item retry.</summary>
public sealed class QueueViewModel : ViewModelBase
{
    private readonly IBridgePipeClientService _pipeClient;
    private bool _isBusy;
    private int _pending;
    private int _processing;
    private int _failed;
    private int _completed;
    private string _retryIngestKey = string.Empty;
    private string? _retryMessage;
    private bool _retrySucceeded;
    private string? _statusMessage;

    public QueueViewModel(IBridgePipeClientService pipeClient)
    {
        _pipeClient = pipeClient;
        RefreshCommand = new AsyncRelayCommand(RefreshAsync, () => !IsBusy);
        RetryCommand = new AsyncRelayCommand(RetryAsync, () => !IsBusy && !string.IsNullOrWhiteSpace(_retryIngestKey));
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set => SetProperty(ref _isBusy, value);
    }

    public int Pending
    {
        get => _pending;
        private set => SetProperty(ref _pending, value);
    }

    public int Processing
    {
        get => _processing;
        private set => SetProperty(ref _processing, value);
    }

    public int Failed
    {
        get => _failed;
        private set => SetProperty(ref _failed, value);
    }

    public int Completed
    {
        get => _completed;
        private set => SetProperty(ref _completed, value);
    }

    public string RetryIngestKey
    {
        get => _retryIngestKey;
        set => SetProperty(ref _retryIngestKey, value);
    }

    public string? RetryMessage
    {
        get => _retryMessage;
        private set => SetProperty(ref _retryMessage, value);
    }

    public bool RetrySucceeded
    {
        get => _retrySucceeded;
        private set => SetProperty(ref _retrySucceeded, value);
    }

    public string? StatusMessage
    {
        get => _statusMessage;
        private set => SetProperty(ref _statusMessage, value);
    }

    public ICommand RefreshCommand { get; }

    public ICommand RetryCommand { get; }

    public event EventHandler? UnauthorizedDetected;

    public async Task RefreshAsync()
    {
        IsBusy = true;
        try
        {
            var result = await _pipeClient.GetQueueSummaryAsync();
            if (!result.Success)
            {
                StatusMessage = HandleFailure(result.ErrorKind);
                return;
            }

            var payload = result.Value!;
            Pending = payload.Pending;
            Processing = payload.Processing;
            Failed = payload.Failed;
            Completed = payload.Completed;
            StatusMessage = null;
        }
        finally
        {
            IsBusy = false;
        }
    }

    public async Task RetryAsync()
    {
        if (string.IsNullOrWhiteSpace(_retryIngestKey))
        {
            return;
        }

        IsBusy = true;
        try
        {
            var result = await _pipeClient.RetryFailedItemAsync(_retryIngestKey);
            if (!result.Success)
            {
                RetrySucceeded = false;
                RetryMessage = HandleFailure(result.ErrorKind);
                return;
            }

            RetrySucceeded = result.Value!.Ok;
            RetryMessage = result.Value.Ok ? StatusLabels.Connected : StatusLabels.ConnectionRequired;
            if (RetrySucceeded)
            {
                await RefreshAsync();
            }
        }
        finally
        {
            IsBusy = false;
        }
    }

    private string HandleFailure(ManagerErrorKind errorKind)
    {
        if (errorKind == ManagerErrorKind.Unauthorized)
        {
            UnauthorizedDetected?.Invoke(this, EventArgs.Empty);
        }

        return StatusLabels.FromErrorKind(errorKind);
    }
}
