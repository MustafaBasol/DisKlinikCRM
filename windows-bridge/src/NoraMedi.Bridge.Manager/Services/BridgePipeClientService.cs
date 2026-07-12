using System.IO;
using NoraMedi.Bridge.Core.Diagnostics;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Manager.Models;

namespace NoraMedi.Bridge.Manager.Services;

/// <summary>
/// Real implementation of <see cref="IBridgePipeClientService"/> — the only
/// class in the Manager that touches <see cref="BridgePipeClient"/>. It
/// never calls any NoraMedi HTTP/API endpoint directly; every operation is
/// proxied through the local Service via the named pipe (see
/// windows-bridge/docs/security.md).
/// </summary>
public sealed class BridgePipeClientService : IBridgePipeClientService
{
    private readonly string _pipeName;
    private readonly int _connectTimeoutMs;

    public BridgePipeClientService(string? pipeName = null, int? connectTimeoutMs = null)
    {
        _pipeName = pipeName ?? BridgeManagerConstants.DefaultPipeName;
        _connectTimeoutMs = connectTimeoutMs ?? BridgeManagerConstants.ConnectTimeoutMs;
    }

    public async Task<PipeCallResult<ServiceStatusPayload>> GetServiceStatusAsync(CancellationToken cancellationToken = default) =>
        await SendAsync<ServiceStatusPayload>(PipeOperation.GetServiceStatus, payload: null, cancellationToken);

    public async Task<PipeCallResult<IReadOnlyList<FolderBindingInfo>>> GetBindingsAsync(CancellationToken cancellationToken = default) =>
        await SendAsync<IReadOnlyList<FolderBindingInfo>>(PipeOperation.GetBindings, payload: null, cancellationToken);

    public async Task<PipeCallResult<ValidateFolderResponse>> ValidateFolderAsync(string path, CancellationToken cancellationToken = default) =>
        await SendAsync<ValidateFolderResponse>(PipeOperation.ValidateFolder, new ValidateFolderRequest(path), cancellationToken);

    public async Task<PipeCallResult<AddOrUpdateFolderBindingResponse>> AddOrUpdateFolderBindingAsync(
        string? watchId, string path, string deviceId, string? modality, CancellationToken cancellationToken = default) =>
        await SendAsync<AddOrUpdateFolderBindingResponse>(
            PipeOperation.AddOrUpdateFolderBinding,
            new AddOrUpdateFolderBindingRequest(watchId, path, deviceId, modality),
            cancellationToken);

    public async Task<PipeCallResult<bool>> RemoveFolderBindingAsync(string watchId, CancellationToken cancellationToken = default)
    {
        var result = await SendRawAsync(PipeOperation.RemoveFolderBinding, new RemoveFolderBindingRequest(watchId), cancellationToken);
        return result.Success ? PipeCallResult<bool>.Ok(true) : PipeCallResult<bool>.Fail(result.ErrorKind, result.RawErrorCode);
    }

    public async Task<PipeCallResult<TestConnectionResponse>> TestConnectionAsync(CancellationToken cancellationToken = default) =>
        await SendAsync<TestConnectionResponse>(PipeOperation.TestConnection, payload: null, cancellationToken);

    public async Task<PipeCallResult<QueueSummaryResponse>> GetQueueSummaryAsync(CancellationToken cancellationToken = default) =>
        await SendAsync<QueueSummaryResponse>(PipeOperation.GetQueueSummary, payload: null, cancellationToken);

    public async Task<PipeCallResult<RetryFailedItemResponse>> RetryFailedItemAsync(string ingestKey, CancellationToken cancellationToken = default) =>
        await SendAsync<RetryFailedItemResponse>(PipeOperation.RetryFailedItem, new RetryFailedItemRequest(ingestKey), cancellationToken);

    public async Task<PipeCallResult<DiagnosticsSnapshot>> ExportDiagnosticsAsync(CancellationToken cancellationToken = default) =>
        await SendAsync<DiagnosticsSnapshot>(PipeOperation.ExportDiagnostics, payload: null, cancellationToken);

    public async Task<PipeCallResult<UpdateStatusPayload>> CheckForUpdatesAsync(CancellationToken cancellationToken = default) =>
        await SendAsync<UpdateStatusPayload>(PipeOperation.CheckForUpdates, payload: null, cancellationToken);

    public async Task<PipeCallResult<UpdateStatusPayload>> GetUpdateStatusAsync(CancellationToken cancellationToken = default) =>
        await SendAsync<UpdateStatusPayload>(PipeOperation.GetUpdateStatus, payload: null, cancellationToken);

    public async Task<PipeCallResult<InstallUpdateResponse>> InstallUpdateAsync(CancellationToken cancellationToken = default) =>
        await SendAsync<InstallUpdateResponse>(PipeOperation.InstallUpdate, new InstallUpdateRequest(), cancellationToken);

    public async Task<PipeCallResult<ProvisionWithPairingCodeResponse>> ProvisionWithPairingCodeAsync(
        string pairingCode, string? computerDisplayName, CancellationToken cancellationToken = default) =>
        await SendAsync<ProvisionWithPairingCodeResponse>(
            PipeOperation.ProvisionWithPairingCode,
            new ProvisionWithPairingCodeRequest(pairingCode, computerDisplayName),
            cancellationToken);

    public async Task<PipeCallResult<GetAvailableServerBindingsResponse>> GetAvailableServerBindingsAsync(CancellationToken cancellationToken = default) =>
        await SendAsync<GetAvailableServerBindingsResponse>(PipeOperation.GetAvailableServerBindings, payload: null, cancellationToken);

    private async Task<PipeCallResult<T>> SendAsync<T>(PipeOperation operation, object? payload, CancellationToken cancellationToken)
    {
        var raw = await SendRawAsync(operation, payload, cancellationToken);
        if (!raw.Success)
        {
            return PipeCallResult<T>.Fail(raw.ErrorKind, raw.RawErrorCode);
        }

        try
        {
            var value = BridgePipeClient.DeserializePayload<T>(raw.Response!);
            return value is null
                ? PipeCallResult<T>.Fail(ManagerErrorKind.Internal)
                : PipeCallResult<T>.Ok(value);
        }
        catch (Exception)
        {
            // Malformed/unexpected payload shape — never surface the raw exception to the UI.
            return PipeCallResult<T>.Fail(ManagerErrorKind.Internal);
        }
    }

    private async Task<RawResult> SendRawAsync(PipeOperation operation, object? payload, CancellationToken cancellationToken)
    {
        PipeResponse response;
        try
        {
            response = await BridgePipeClient.SendAsync(_pipeName, operation, payload, _connectTimeoutMs, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // ConnectAsync timed out reaching the pipe: Service not running or not installed.
            return RawResult.Fail(ManagerErrorKind.ServiceUnavailable);
        }
        catch (TimeoutException)
        {
            return RawResult.Fail(ManagerErrorKind.ServiceUnavailable);
        }
        catch (IOException)
        {
            return RawResult.Fail(ManagerErrorKind.ServiceUnavailable);
        }
        catch (UnauthorizedAccessException)
        {
            // Thrown when Windows refuses the pipe CreateFile connect itself
            // (access denied) — this means the Service IS running but the
            // connecting identity isn't allowed to talk to it, not that the
            // Service is unreachable. Must map to Unauthorized so the
            // existing "restart as Administrator" elevation UX handles it,
            // the same path used for a privileged-operation "unauthorized"
            // pipe error-code response.
            return RawResult.Fail(ManagerErrorKind.Unauthorized);
        }

        if (response.Success)
        {
            return RawResult.Ok(response);
        }

        return RawResult.Fail(MapErrorCode(response.ErrorCode), response.ErrorCode);
    }

    private static ManagerErrorKind MapErrorCode(string? errorCode) => errorCode switch
    {
        PipeErrorCodes.Unauthorized => ManagerErrorKind.Unauthorized,
        PipeErrorCodes.FeatureDisabled => ManagerErrorKind.FeatureDisabled,
        PipeErrorCodes.NotFound => ManagerErrorKind.NotFound,
        PipeErrorCodes.InvalidPayload => ManagerErrorKind.InvalidPayload,
        PipeErrorCodes.PayloadTooLarge => ManagerErrorKind.InvalidPayload,
        PipeErrorCodes.UnknownOperation => ManagerErrorKind.Internal,
        PipeErrorCodes.InternalError => ManagerErrorKind.Internal,
        _ => ManagerErrorKind.Internal,
    };

    private readonly struct RawResult
    {
        private RawResult(bool success, PipeResponse? response, ManagerErrorKind errorKind, string? rawErrorCode)
        {
            Success = success;
            Response = response;
            ErrorKind = errorKind;
            RawErrorCode = rawErrorCode;
        }

        public bool Success { get; }
        public PipeResponse? Response { get; }
        public ManagerErrorKind ErrorKind { get; }
        public string? RawErrorCode { get; }

        public static RawResult Ok(PipeResponse response) => new(true, response, default, null);
        public static RawResult Fail(ManagerErrorKind kind, string? rawErrorCode = null) => new(false, null, kind, rawErrorCode);
    }
}
