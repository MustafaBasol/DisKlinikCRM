using System.Collections.ObjectModel;
using System.Linq;
using System.Windows.Input;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Resources;
using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.ViewModels;

/// <summary>
/// Device/folder binding management: list existing bindings, pick+validate
/// a local folder, save (add/update), and remove. Folder validation is
/// mandatory before a save is allowed — <see cref="SaveCommand"/> stays
/// disabled until <see cref="ValidateFolderAsync"/> has returned a
/// successful (exists + readable) result for the current path.
///
/// Device selection is driven entirely by <see cref="AvailableServerBindings"/>
/// (the server's known device/binding catalog) — the user picks a device
/// from that list via <see cref="SelectedAvailableBinding"/>; the raw
/// <see cref="DeviceId"/>/<see cref="Modality"/> a call actually sends are
/// derived from that selection and never typed by hand.
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
    private FolderBindingInfo? _selectedBinding;
    private AvailableServerBindingInfo? _selectedAvailableBinding;

    public BindingsViewModel(IBridgePipeClientService pipeClient, IFileDialogService fileDialog)
    {
        _pipeClient = pipeClient;
        _fileDialog = fileDialog;
        Bindings = [];
        AvailableServerBindings = [];
        RefreshCommand = new AsyncRelayCommand(RefreshAsync, () => !IsBusy);
        BrowseFolderCommand = new RelayCommand(BrowseFolder, () => !IsBusy);
        ValidateFolderCommandInstance = new AsyncRelayCommand(ValidateFolderAsync, () => !IsBusy && !string.IsNullOrWhiteSpace(_folderPath));
        SaveCommand = new AsyncRelayCommand(SaveAsync, () => !IsBusy && IsFolderValid == true && !string.IsNullOrWhiteSpace(_deviceId));
        RemoveCommand = new AsyncRelayCommand(RemoveAsync, () => !IsBusy && !string.IsNullOrEmpty(_watchId));
    }

    public ObservableCollection<FolderBindingInfo> Bindings { get; }

    /// <summary>The server's known device/binding catalog (see PipeOperation.GetAvailableServerBindings) — the source the device selector picks from.</summary>
    public ObservableCollection<AvailableServerBindingInfo> AvailableServerBindings { get; }

    /// <summary>True once a refresh has completed and the catalog came back empty — drives the "no devices available yet" empty state, never fabricated rows.</summary>
    public bool HasNoAvailableServerBindings => AvailableServerBindings.Count == 0;

    /// <summary>Complement of <see cref="HasNoAvailableServerBindings"/> — drives showing the device selector itself.</summary>
    public bool HasAvailableServerBindings => !HasNoAvailableServerBindings;

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

    /// <summary>Bound to the bindings DataGrid's SelectedItem — populates the edit form with the chosen binding's current values so it can be updated or removed in place.</summary>
    public FolderBindingInfo? SelectedBinding
    {
        get => _selectedBinding;
        set
        {
            if (!SetProperty(ref _selectedBinding, value) || value is null)
            {
                return;
            }

            WatchId = value.WatchId;
            FolderPath = value.Path; // resets IsFolderValid/FolderStatusLabel via the FolderPath setter
            IsFolderValid = value.Available;
            FolderStatusLabel = value.Available ? StatusLabels.Connected : StatusLabels.FolderInaccessible;

            // Set the backing field directly (not the property) so we don't
            // let SelectedAvailableBinding's setter clobber DeviceId/Modality
            // below with an empty value when the catalog has no match yet.
            _selectedAvailableBinding = AvailableServerBindings.FirstOrDefault(b => b.DeviceId == value.DeviceId);
            OnPropertyChanged(nameof(SelectedAvailableBinding));
            DeviceId = value.DeviceId;
            Modality = value.Modality;
        }
    }

    /// <summary>
    /// The device the user picked from <see cref="AvailableServerBindings"/>.
    /// This — never free-typed text — is what supplies <see cref="DeviceId"/>
    /// and <see cref="Modality"/> for the next save.
    /// </summary>
    public AvailableServerBindingInfo? SelectedAvailableBinding
    {
        get => _selectedAvailableBinding;
        set
        {
            if (!SetProperty(ref _selectedAvailableBinding, value))
            {
                return;
            }

            DeviceId = value?.DeviceId ?? string.Empty;
            Modality = value?.Modality;
        }
    }

    public ICommand RefreshCommand { get; }

    public ICommand BrowseFolderCommand { get; }

    public ICommand ValidateFolderCommandInstance { get; }

    public ICommand SaveCommand { get; }

    public ICommand RemoveCommand { get; }

    /// <summary>Alias for <see cref="SaveCommand"/> exposed under the name the UI/tests use when a row is selected for editing — same command, same in-place-update behavior (AddOrUpdateFolderBindingAsync with the existing WatchId).</summary>
    public ICommand UpdateSelectedBindingCommand => SaveCommand;

    /// <summary>Alias for <see cref="RemoveCommand"/> exposed under the name the UI/tests use when a row is selected for removal.</summary>
    public ICommand RemoveSelectedBindingCommand => RemoveCommand;

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

    /// <summary>
    /// Loads the server's known device/binding catalog so the device
    /// selector has something to show. A successful call with zero entries
    /// is a valid, truthful outcome (see <see cref="HasNoAvailableServerBindings"/>) —
    /// never replaced with fabricated devices.
    /// </summary>
    public async Task RefreshAvailableServerBindingsAsync()
    {
        IsBusy = true;
        try
        {
            var result = await _pipeClient.GetAvailableServerBindingsAsync();
            if (!result.Success)
            {
                HandleFailure(result.ErrorKind, out var label);
                StatusMessage = label;
                return;
            }

            AvailableServerBindings.Clear();
            foreach (var binding in result.Value!.Bindings)
            {
                AvailableServerBindings.Add(binding);
            }

            OnPropertyChanged(nameof(HasNoAvailableServerBindings));
            OnPropertyChanged(nameof(HasAvailableServerBindings));
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void BrowseFolder()
    {
        var picked = _fileDialog.PickFolder(Strings.Dialog_FolderPickerTitle);
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
            _selectedBinding = null;
            OnPropertyChanged(nameof(SelectedBinding));
            _selectedAvailableBinding = null;
            OnPropertyChanged(nameof(SelectedAvailableBinding));
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
