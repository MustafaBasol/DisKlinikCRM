using System.IO;
using System.Text.Json;
using System.Windows.Input;
using NoraMedi.Bridge.Core.Diagnostics;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.ViewModels;

/// <summary>
/// Diagnostics export: fetches the (already server-redacted)
/// <see cref="DiagnosticsSnapshot"/> and lets the user save it verbatim —
/// this view model must never add a field beyond what the snapshot already
/// carries (no paths, no credentials, no patient data).
/// </summary>
public sealed class DiagnosticsViewModel : ViewModelBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly IBridgePipeClientService _pipeClient;
    private readonly IFileDialogService _fileDialog;
    private bool _isBusy;
    private string? _statusMessage;
    private bool _lastExportSucceeded;
    private DiagnosticsSnapshot? _lastSnapshot;

    public DiagnosticsViewModel(IBridgePipeClientService pipeClient, IFileDialogService fileDialog)
    {
        _pipeClient = pipeClient;
        _fileDialog = fileDialog;
        ExportCommand = new AsyncRelayCommand(ExportAsync, () => !IsBusy);
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set => SetProperty(ref _isBusy, value);
    }

    public string? StatusMessage
    {
        get => _statusMessage;
        private set => SetProperty(ref _statusMessage, value);
    }

    public bool LastExportSucceeded
    {
        get => _lastExportSucceeded;
        private set => SetProperty(ref _lastExportSucceeded, value);
    }

    /// <summary>Exposed for tests: the last snapshot fetched, before serialization to disk.</summary>
    public DiagnosticsSnapshot? LastSnapshot => _lastSnapshot;

    public ICommand ExportCommand { get; }

    public event EventHandler? UnauthorizedDetected;

    public async Task ExportAsync()
    {
        IsBusy = true;
        LastExportSucceeded = false;
        try
        {
            var result = await _pipeClient.ExportDiagnosticsAsync();
            if (!result.Success)
            {
                if (result.ErrorKind == ManagerErrorKind.Unauthorized)
                {
                    UnauthorizedDetected?.Invoke(this, EventArgs.Empty);
                }

                StatusMessage = StatusLabels.FromErrorKind(result.ErrorKind);
                return;
            }

            _lastSnapshot = result.Value;

            var targetPath = _fileDialog.PickSaveFile(
                "Save diagnostics",
                $"noramedi-bridge-diagnostics-{DateTime.UtcNow:yyyyMMdd-HHmmss}.json",
                "JSON files (*.json)|*.json");

            if (targetPath is null)
            {
                StatusMessage = null;
                return;
            }

            var json = JsonSerializer.Serialize(_lastSnapshot, JsonOptions);
            await File.WriteAllTextAsync(targetPath, json);
            LastExportSucceeded = true;
            StatusMessage = StatusLabels.Connected;
        }
        finally
        {
            IsBusy = false;
        }
    }
}
