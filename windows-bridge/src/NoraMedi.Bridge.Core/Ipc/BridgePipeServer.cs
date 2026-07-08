using System.IO.Pipes;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;

namespace NoraMedi.Bridge.Core.Ipc;

/// <summary>
/// One request/response per connection over a Named Pipe. Connection ACL is
/// restricted to LocalSystem, Administrators, and interactive/authenticated
/// Users — never "Everyone" or anonymous — so only a locally logged-in
/// account (the future Manager app's normal, non-admin run context) can
/// reach it at all; Named Pipes opened this way (no leading "\\server\")
/// are local-machine only regardless.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class BridgePipeServer : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly string _pipeName;
    private readonly IBridgePipeRequestHandler _handler;
    private readonly int _maxInstances;
    private CancellationTokenSource? _cts;
    private List<Task>? _acceptLoops;

    public BridgePipeServer(string pipeName, IBridgePipeRequestHandler handler, int maxInstances = 4)
    {
        _pipeName = pipeName;
        _handler = handler;
        _maxInstances = maxInstances;
    }

    public void Start()
    {
        if (_cts is not null) return;
        var cts = new CancellationTokenSource();
        _cts = cts;
        // Capture the token by value, not the mutable `_cts` field — these
        // Task.Run delegates execute on the thread pool at some later,
        // unpredictable time, and DisposeAsync nulls `_cts` before that
        // point to make repeated Dispose calls safe (see DisposeAsync).
        var token = cts.Token;
        _acceptLoops = Enumerable.Range(0, _maxInstances)
            .Select(_ => Task.Run(() => AcceptLoopAsync(token)))
            .ToList();
    }

    private async Task AcceptLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            NamedPipeServerStream server;
            try
            {
                server = CreateServerStream();
            }
            catch (Exception) when (cancellationToken.IsCancellationRequested)
            {
                // Shutting down: a racing create-vs-cancel can surface as IOException
                // OR UnauthorizedAccessException from the OS — either is expected here.
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // All instances momentarily busy, or a transient ACL/timing race — brief backoff, then retry.
                await Task.Delay(50, cancellationToken).ContinueWith(_ => { }, TaskScheduler.Default);
                continue;
            }

            await using (server)
            {
                try
                {
                    await server.WaitForConnectionAsync(cancellationToken);
                    await HandleConnectionAsync(server, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                }
                catch (IOException)
                {
                    // Client disconnected mid-message — move on to the next connection.
                }
            }
        }
    }

    private NamedPipeServerStream CreateServerStream()
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));

        return NamedPipeServerStreamAcl.Create(
            _pipeName,
            PipeDirection.InOut,
            _maxInstances,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous,
            inBufferSize: 0,
            outBufferSize: 0,
            pipeSecurity: security);
    }

    private async Task HandleConnectionAsync(NamedPipeServerStream server, CancellationToken cancellationToken)
    {
        string? requestJson;
        try
        {
            requestJson = await PipeFraming.ReadMessageAsync(server, PipeFraming.DefaultMaxMessageBytes, cancellationToken);
        }
        catch (PipeMessageTooLargeException)
        {
            await SafeRespond(server, PipeResponse.Error(PipeErrorCodes.PayloadTooLarge), cancellationToken);
            return;
        }

        if (requestJson is null) return; // client disconnected before sending anything

        PipeRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<PipeRequest>(requestJson, JsonOptions);
        }
        catch (JsonException)
        {
            await SafeRespond(server, PipeResponse.Error(PipeErrorCodes.InvalidPayload), cancellationToken);
            return;
        }

        if (request is null || !Enum.TryParse<PipeOperation>(request.Operation, ignoreCase: false, out var operation))
        {
            await SafeRespond(server, PipeResponse.Error(PipeErrorCodes.UnknownOperation), cancellationToken);
            return;
        }

        PipeResponse response;
        try
        {
            response = await DispatchAsync(operation, request.PayloadJson, cancellationToken);
        }
        catch (Exception)
        {
            response = PipeResponse.Error(PipeErrorCodes.InternalError);
        }

        await SafeRespond(server, response, cancellationToken);
    }

    private async Task<PipeResponse> DispatchAsync(PipeOperation operation, string? payloadJson, CancellationToken cancellationToken)
    {
        switch (operation)
        {
            case PipeOperation.GetServiceStatus:
                return Ok(await _handler.GetServiceStatusAsync(cancellationToken));

            case PipeOperation.GetBindings:
                return Ok(await _handler.GetBindingsAsync(cancellationToken));

            case PipeOperation.ValidateFolder:
                {
                    var req = Deserialize<ValidateFolderRequest>(payloadJson);
                    if (req is null) return PipeResponse.Error(PipeErrorCodes.InvalidPayload);
                    return Ok(await _handler.ValidateFolderAsync(req, cancellationToken));
                }

            case PipeOperation.AddOrUpdateFolderBinding:
                {
                    var req = Deserialize<AddOrUpdateFolderBindingRequest>(payloadJson);
                    if (req is null) return PipeResponse.Error(PipeErrorCodes.InvalidPayload);
                    return Ok(await _handler.AddOrUpdateFolderBindingAsync(req, cancellationToken));
                }

            case PipeOperation.RemoveFolderBinding:
                {
                    var req = Deserialize<RemoveFolderBindingRequest>(payloadJson);
                    if (req is null) return PipeResponse.Error(PipeErrorCodes.InvalidPayload);
                    await _handler.RemoveFolderBindingAsync(req, cancellationToken);
                    return PipeResponse.Ok();
                }

            case PipeOperation.TestConnection:
                return Ok(await _handler.TestConnectionAsync(cancellationToken));

            case PipeOperation.GetQueueSummary:
                return Ok(await _handler.GetQueueSummaryAsync(cancellationToken));

            case PipeOperation.RetryFailedItem:
                {
                    var req = Deserialize<RetryFailedItemRequest>(payloadJson);
                    if (req is null) return PipeResponse.Error(PipeErrorCodes.InvalidPayload);
                    return Ok(await _handler.RetryFailedItemAsync(req, cancellationToken));
                }

            case PipeOperation.ExportDiagnostics:
                return Ok(await _handler.ExportDiagnosticsAsync(cancellationToken));

            case PipeOperation.CheckForUpdates:
                return Ok(await _handler.CheckForUpdatesAsync(cancellationToken));

            case PipeOperation.ProvisionWithPairingCode:
                {
                    var req = Deserialize<ProvisionWithPairingCodeRequest>(payloadJson);
                    if (req is null) return PipeResponse.Error(PipeErrorCodes.InvalidPayload);
                    return Ok(await _handler.ProvisionWithPairingCodeAsync(req, cancellationToken));
                }

            default:
                return PipeResponse.Error(PipeErrorCodes.UnknownOperation);
        }
    }

    private static PipeResponse Ok<T>(T payload) => PipeResponse.Ok(JsonSerializer.Serialize(payload, JsonOptions));

    private static T? Deserialize<T>(string? json) where T : class
    {
        if (string.IsNullOrEmpty(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<T>(json, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static async Task SafeRespond(Stream stream, PipeResponse response, CancellationToken cancellationToken)
    {
        try
        {
            await PipeFraming.WriteMessageAsync(stream, JsonSerializer.Serialize(response, JsonOptions), cancellationToken);
        }
        catch (IOException)
        {
            // Client already gone — nothing to do.
        }
    }

    public async ValueTask DisposeAsync()
    {
        var cts = _cts;
        if (cts is null) return;
        _cts = null; // guards against a double-dispose racing this exact block (Worker.StopAsync can be called more than once)
        await cts.CancelAsync();
        if (_acceptLoops is not null)
        {
            try
            {
                await Task.WhenAll(_acceptLoops);
            }
            catch (OperationCanceledException)
            {
            }
        }
        cts.Dispose();
    }
}
