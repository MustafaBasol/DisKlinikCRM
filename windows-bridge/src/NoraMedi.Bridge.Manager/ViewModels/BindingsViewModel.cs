using System.Collections.ObjectModel;
using System.Windows.Input;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.ViewModels;

/// <summary>
/// Device/folder binding management: list existing bindings, pick+validate
/// a local folder, save (add/update), and remove. Folder validation is
/// mandatory before a save is allowed — <see cref="SaveCommand"/> stays
/// disabled until <see cref="ValidateFolderAsync"/> has returned a
/// successful (exists + readable) result for the current path.
/// </summary>
public sealed class BindingsViewModel : ViewModelBase
{
    private readonly IBridgePipeClientService _pipeClient;
    private readonly IFileDialogService _fileDialog;
    private bool _isBusy;
    private string? _watchId;
    private string _folderPath = string.Empty;
    private string _deviceId = string.Empty;
    private string? _modality;
    private bool? _isFolderValid;
    private string? _folderStatusLabel;
    private string? _statusMessage;

    public BindingsViewModel(IBridgePipeClientService pipeClient, IFileDialogService fileDialog)
    {
        _pipeClient = pipeClient;
        _fileDialog = fileDialog;
        Bindings = [];
        RefreshCommand = new AsyncRelayCommand(RefreshAsync, () => !IsBusy);
        BrowseFolderCommand = new RelayCommand(BrowseFolder, () => !IsBusy);
        ValidateFolderCommandInstance = new AsyncRelayCommand(ValidateFolderAsync, () => !IsBusy && !string.IsNullOrWhiteSpace(_folderPath));
        SaveCommand = new AsyncRelayCommand(SaveAsync, () => !IsBusy && IsFolderValid == true && !string.IsNullOrWhiteSpace(_deviceId));
        RemoveCommand = new AsyncRelayCommand(RemoveAsync, () => !IsBusy && !string.IsNullOrEmpty(_watchId));
    }

    public ObservableCollection<FolderBindingInfo> Bindings { get; }

    public bool IsBusy
    {
        get => _isBusy;
        private set => SetProperty(ref _isBusy, value);
    }

    public string? WatchId
    {
        get => _watchId;
        set => SetProperty(ref _watchId, value);
    }

    public string FolderPath
    {
        get => _folderPath;
        set
        {
            if (SetProperty(ref _folderPath, value))
            {
                IsFolderValid = null;
                FolderStatusLabel = null;
            }
        }
    }

    public string DeviceId
    {
        get => _deviceId;
        set => SetProperty(ref _deviceId, value);
    }

    public string? Modality
    {
        get => _modality;
        set => SetProperty(ref _modality, value);
    }

    public bool? IsFolderValid
    {
        get => _isFolderValid;
        private set => SetProperty(ref _isFolderValid, value);
    }

    public string? FolderStatusLabel
    {
        get => _folderStatusLabel;
        private set => SetProperty(ref _folderStatusLabel, value);
    }

    public string? StatusMessage
    {
        get => _statusMessage;
        private set => SetProperty(ref _statusMessage, value);
    }

    public ICommand RefreshCommand { get; }

    public ICommand BrowseFolderCommand { get; }

    public ICommand ValidateFolderCommandInstance { get; }

    public ICommand SaveCommand { get; }

    public ICommand RemoveCommand { get; }

    public event EventHandler? UnauthorizedDetected;

    public async Task RefreshAsync()
    {
        IsBusy = true;
        try
        {
            var result = await _pipeClient.GetBindingsAsync();
            if (!result.Success)
            {
                HandleFailure(result.ErrorKind, out var label);
                StatusMessage = label;
                return;
            }

            Bindings.Clear();
            foreach (var binding in result.Value!)
            {
                Bindings.Add(binding);
            }
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void BrowseFolder()
    {
        var picked = _fileDialog.PickFolder("Select the folder this device saves images to");
        if (picked is not null)
        {
            FolderPath = picked;
        }
    }

    public async Task ValidateFolderAsync()
    {
        if (string.IsNullOrWhiteSpace(_folderPath))
        {
            return;
        }

        IsBusy = true;
        try
        {
            var result = await _pipeClient.ValidateFolderAsync(_folderPath);
            if (!result.Success)
            {
                HandleFailure(result.ErrorKind, out var label);
                IsFolderValid = false;
                FolderStatusLabel = label;
                return;
            }

            var response = result.Value!;
            IsFolderValid = response.Exists && response.Readable;
            FolderStatusLabel = IsFolderValid == true ? StatusLabels.Connected : StatusLabels.FolderInaccessible;
        }
        finally
        {
            IsBusy = false;
        }
    }

    public async Task SaveAsync()
    {
        if (IsFolderValid != true)
        {
            return;
        }

        IsBusy = true;
        StatusMessage = null;
        try
        {
            var result = await _pipeClient.AddOrUpdateFolderBindingAsync(_watchId, _folderPath, _deviceId, _modality);
            if (!result.Success)
            {
                HandleFailure(result.ErrorKind, out var label);
                StatusMessage = label;
                return;
            }

            WatchId = result.Value!.WatchId;
            StatusMessage = StatusLabels.Connected;
            await RefreshAsync();
        }
        finally
        {
            IsBusy = false;
        }
    }

    public async Task RemoveAsync()
    {
        if (string.IsNullOrEmpty(_watchId))
        {
            return;
        }

        IsBusy = true;
        try
        {
            var result = await _pipeClient.RemoveFolderBindingAsync(_watchId);
            if (!result.Success)
            {
                HandleFailure(result.ErrorKind, out var label);
                StatusMessage = label;
                return;
            }

            WatchId = null;
            FolderPath = string.Empty;
            DeviceId = string.Empty;
            Modality = null;
            IsFolderValid = null;
            FolderStatusLabel = null;
            StatusMessage = null;
            await RefreshAsync();
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void HandleFailure(ManagerErrorKind errorKind, out string label)
    {
        if (errorKind == ManagerErrorKind.Unauthorized)
        {
            UnauthorizedDetected?.Invoke(this, EventArgs.Empty);
        }

        label = StatusLabels.FromErrorKind(errorKind);
    }
}
