using System.Windows.Input;
using NoraMedi.Bridge.Manager.Models;
using NoraMedi.Bridge.Manager.Services;

namespace NoraMedi.Bridge.Manager.ViewModels;

/// <summary>
/// Pairing-code entry and redemption. The code is always exactly 8 digits;
/// this VM strips any non-digit characters the user types/pastes (spaces,
/// hyphens) and exposes a grouped display string ("1234 5678") purely for
/// readability — the raw 8-digit string is what's sent over the pipe.
/// </summary>
public sealed class PairingViewModel : ViewModelBase
{
    public const int PairingCodeLength = 8;

    private readonly IBridgePipeClientService _pipeClient;
    private string _rawDigits = string.Empty;
    private string? _computerDisplayName;
    private bool _isBusy;
    private string? _resultMessage;
    private bool _isSuccess;

    public PairingViewModel(IBridgePipeClientService pipeClient)
    {
        _pipeClient = pipeClient;
        SubmitCommand = new AsyncRelayCommand(SubmitAsync, () => IsCodeComplete && !IsBusy);
    }

    /// <summary>Raw, digits-only pairing code as currently entered (0-8 chars).</summary>
    public string RawDigits => _rawDigits;

    /// <summary>Human-friendly grouped display, e.g. "1234 5678".</summary>
    public string DisplayText => _rawDigits.Length <= 4
        ? _rawDigits
        : $"{_rawDigits[..4]} {_rawDigits[4..]}";

    public bool IsCodeComplete => _rawDigits.Length == PairingCodeLength;

    public string? ComputerDisplayName
    {
        get => _computerDisplayName;
        set => SetProperty(ref _computerDisplayName, value);
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set => SetProperty(ref _isBusy, value);
    }

    public string? ResultMessage
    {
        get => _resultMessage;
        private set => SetProperty(ref _resultMessage, value);
    }

    public bool IsSuccess
    {
        get => _isSuccess;
        private set => SetProperty(ref _isSuccess, value);
    }

    public ICommand SubmitCommand { get; }

    public event EventHandler? UnauthorizedDetected;

    public event EventHandler? PairingSucceeded;

    /// <summary>
    /// Called from the code-behind on every keystroke/paste. Silently drops
    /// non-digit characters and truncates to <see cref="PairingCodeLength"/>
    /// rather than rejecting the whole input, so pasting a formatted code
    /// like "1234-5678" still works.
    /// </summary>
    public void SetInput(string? typedText)
    {
        var digitsOnly = new string((typedText ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digitsOnly.Length > PairingCodeLength)
        {
            digitsOnly = digitsOnly[..PairingCodeLength];
        }

        _rawDigits = digitsOnly;
        OnPropertyChanged(nameof(RawDigits));
        OnPropertyChanged(nameof(DisplayText));
        OnPropertyChanged(nameof(IsCodeComplete));
    }

    public async Task SubmitAsync()
    {
        if (!IsCodeComplete)
        {
            return;
        }

        IsBusy = true;
        ResultMessage = null;
        try
        {
            var result = await _pipeClient.ProvisionWithPairingCodeAsync(_rawDigits, _computerDisplayName);
            if (!result.Success)
            {
                IsSuccess = false;
                if (result.ErrorKind == ManagerErrorKind.Unauthorized)
                {
                    ResultMessage = StatusLabels.ActionRequired;
                    UnauthorizedDetected?.Invoke(this, EventArgs.Empty);
                }
                else
                {
                    ResultMessage = StatusLabels.FromErrorKind(result.ErrorKind);
                }

                return;
            }

            if (!result.Value!.Ok)
            {
                IsSuccess = false;
                ResultMessage = StatusLabels.FromPairingErrorCategory(result.Value.ErrorCategory);
                return;
            }

            IsSuccess = true;
            ResultMessage = StatusLabels.Connected;
            PairingSucceeded?.Invoke(this, EventArgs.Empty);
        }
        finally
        {
            IsBusy = false;
        }
    }
}
