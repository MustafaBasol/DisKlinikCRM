using System.Windows.Input;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Core.Updates;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.ViewModels;

/// <summary>
/// Real update state machine UI (PR 6/7) — every label is truthful, sourced
/// from a real <see cref="UpdateStatusPayload"/> round-trip; no fabricated
/// progress percentage (see docs/update-architecture.md "Manager UX").
/// While a check/download/verify/install is in flight, polls
/// <see cref="IBridgePipeClientService.GetUpdateStatusAsync"/> on a short
/// timer purely to refresh the label/byte-count — never to re-trigger a
/// check or install.
/// </summary>
public sealed class UpdateViewModel : ViewModelBase, IDisposable
{
    private readonly IBridgePipeClientService _pipeClient;
    private System.Threading.Timer? _pollTimer;

    private bool _isBusy;
    private string? _message;
    private bool _isSupported = true;
    private string? _installedVersion;
    private string? _offeredVersion;
    private long _downloadedBytes;
    private long? _totalBytes;
    private bool _canInstall;
    private bool _isIndeterminate;
    private bool _rebootRequired;

    public UpdateViewModel(IBridgePipeClientService pipeClient)
    {
        _pipeClient = pipeClient;
        CheckForUpdatesCommand = new AsyncRelayCommand(CheckForUpdatesAsync, () => !IsBusy);
        InstallUpdateCommand = new AsyncRelayCommand(InstallUpdateAsync, () => !IsBusy && CanInstall);
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

    public string? InstalledVersion
    {
        get => _installedVersion;
        private set => SetProperty(ref _installedVersion, value);
    }

    public string? OfferedVersion
    {
        get => _offeredVersion;
        private set
        {
            if (SetProperty(ref _offeredVersion, value)) OnPropertyChanged(nameof(HasOfferedVersion));
        }
    }

    public bool HasOfferedVersion => !string.IsNullOrEmpty(_offeredVersion);

    /// <summary>Plain "X of Y MB" text, populated only while downloading and only from a real reported byte count — never a synthesized value. Null otherwise.</summary>
    public string? DownloadProgressText
    {
        get
        {
            if (_totalBytes is not { } total || total <= 0) return null;
            var downloadedMb = (_downloadedBytes / 1024.0 / 1024.0).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture);
            var totalMb = (total / 1024.0 / 1024.0).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture);
            return $"{downloadedMb} / {totalMb} MB";
        }
    }

    /// <summary>True while a phase is in progress with no measurable percentage — the UI shows an indeterminate spinner, never a fake bar value.</summary>
    public bool IsIndeterminate
    {
        get => _isIndeterminate;
        private set => SetProperty(ref _isIndeterminate, value);
    }

    public bool CanInstall
    {
        get => _canInstall;
        private set
        {
            if (SetProperty(ref _canInstall, value)) (InstallUpdateCommand as AsyncRelayCommand)?.RaiseCanExecuteChanged();
        }
    }

    public bool RebootRequired
    {
        get => _rebootRequired;
        private set => SetProperty(ref _rebootRequired, value);
    }

    public ICommand CheckForUpdatesCommand { get; }

    public ICommand InstallUpdateCommand { get; }

    public async Task CheckForUpdatesAsync()
    {
        IsBusy = true;
        try
        {
            var result = await _pipeClient.CheckForUpdatesAsync();
            if (!result.Success)
            {
                IsSupported = false;
                Message = StatusLabels.FromErrorKind(result.ErrorKind);
                return;
            }

            Apply(result.Value!);
            StartPollingIfInProgress(result.Value!.Lifecycle);
        }
        finally
        {
            IsBusy = false;
        }
    }

    public async Task InstallUpdateAsync()
    {
        if (!CanInstall) return;

        IsBusy = true;
        try
        {
            var result = await _pipeClient.InstallUpdateAsync();
            if (!result.Success)
            {
                IsSupported = false;
                Message = StatusLabels.FromErrorKind(result.ErrorKind);
                return;
            }

            Apply(result.Value!.Status);
            StartPollingIfInProgress(result.Value.Status.Lifecycle);
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void StartPollingIfInProgress(string lifecycle)
    {
        _pollTimer?.Dispose();
        _pollTimer = null;

        if (!Enum.TryParse<UpdateLifecycleState>(lifecycle, out var state)) return;
        var inProgress = state is UpdateLifecycleState.Downloading or UpdateLifecycleState.Verifying
            or UpdateLifecycleState.InstallLaunched or UpdateLifecycleState.Installing;
        if (!inProgress) return;

        _pollTimer = new System.Threading.Timer(_ => _ = PollOnceAsync(), null, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(2));
    }

    private async Task PollOnceAsync()
    {
        var result = await _pipeClient.GetUpdateStatusAsync();
        if (!result.Success || result.Value is null) return;

        Apply(result.Value);

        if (!Enum.TryParse<UpdateLifecycleState>(result.Value.Lifecycle, out var state)
            || state is not (UpdateLifecycleState.Downloading or UpdateLifecycleState.Verifying
                or UpdateLifecycleState.InstallLaunched or UpdateLifecycleState.Installing))
        {
            _pollTimer?.Dispose();
            _pollTimer = null;
        }
    }

    private void Apply(UpdateStatusPayload status)
    {
        IsSupported = true;
        InstalledVersion = status.InstalledVersion;
        OfferedVersion = status.OfferedVersion;
        _downloadedBytes = status.DownloadedBytes;
        _totalBytes = status.TotalBytes;
        RebootRequired = status.RebootRequired;
        Message = StatusLabels.FromUpdateLifecycle(status.Lifecycle, status.ErrorCategory);
        OnPropertyChanged(nameof(DownloadProgressText));

        var parsed = Enum.TryParse<UpdateLifecycleState>(status.Lifecycle, out var state) ? state : UpdateLifecycleState.Idle;
        CanInstall = parsed == UpdateLifecycleState.Verified;
        IsIndeterminate = parsed is UpdateLifecycleState.Checking or UpdateLifecycleState.Downloading
            or UpdateLifecycleState.Verifying or UpdateLifecycleState.InstallLaunched or UpdateLifecycleState.Installing;
    }

    public void Dispose()
    {
        _pollTimer?.Dispose();
        _pollTimer = null;
    }
}
