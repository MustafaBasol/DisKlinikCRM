using System.IO.Pipes;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;

namespace NoraMedi.Bridge.Core.Ipc;

/// <summary>Snapshot of the identity that connected to one pipe request, captured under client impersonation. See BridgePipeServer.CaptureClientIdentity.</summary>
public sealed record PipeClientIdentity(string Name, bool IsAdministrator);

/// <summary>
/// One request/response per connection over a Named Pipe.
///
/// Two layers of defense restrict who can do what:
///  1. Connection-level ACL (<see cref="CreateServerStream"/>): grants
///     connect rights to LocalSystem, Administrators, and the well-known
///     INTERACTIVE SID only — never "Everyone"/"Authenticated Users". A
///     Network-logon or Anonymous-logon token carries neither the
///     Administrators nor the INTERACTIVE group SID, so Windows refuses the
///     client's CreateFile(\\.\pipe\...) before our code ever runs. Because
///     this pipe is created with a bare name (no "\\server\" prefix) it is
///     local-machine-only regardless.
///  2. Per-request identity + operation authorization
///     (<see cref="HandleConnectionAsync"/>): every connection is
///     impersonated to confirm it resolved to a real, non-anonymous local
///     identity (a connection that somehow got through layer 1 without one is
///     rejected outright), and mutating/sensitive operations
///     (<see cref="PipeOperationPolicy.IsPrivileged"/> — provisioning,
///     binding changes, retries, network tests) additionally require that
///     identity to be a member of Administrators. Plain read-only status
///     queries only need layer 1 plus a resolved identity.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class BridgePipeServer : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly string _pipeName;
    private readonly IBridgePipeRequestHandler _handler;
    private readonly int _maxInstances;
    private readonly Func<NamedPipeServerStream, PipeClientIdentity?> _identityResolver;
    private CancellationTokenSource? _cts;
    private List<Task>? _acceptLoops;

    public BridgePipeServer(
        string pipeName,
        IBridgePipeRequestHandler handler,
        int maxInstances = 4,
        Func<NamedPipeServerStream, PipeClientIdentity?>? identityResolver = null)
    {
        _pipeName = pipeName;
        _handler = handler;
        _maxInstances = maxInstances;
        _identityResolver = identityResolver ?? CaptureClientIdentity;
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
        // INTERACTIVE (S-1-5-4), not BUILTIN\Users — a token only carries this
        // group for an actual interactive logon session on this console/RDP
        // session. Network-logon and Anonymous-logon tokens carry neither this
        // nor Administrators, so they are refused connect access entirely.
        security.AddAccessRule(new PipeAccessRule(
            new SecurityIdentifier(WellKnownSidType.InteractiveSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));

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

    /// <summary>
    /// Impersonates the connected client just long enough to read its
    /// identity and Administrators membership, then reverts — this thread
    /// never keeps running as the client. Returns null for anonymous,
    /// unresolvable, or impersonation-refused connections, which the caller
    /// treats as unauthorized.
    ///
    /// Deliberately runs <see cref="NamedPipeServerStream.RunAsClient"/> on a
    /// dedicated, throwaway <see cref="Thread"/> rather than inline on the
    /// calling (thread-pool) thread. <c>RunAsClient</c> impersonates by
    /// setting a token on the *current OS thread* and reverting via
    /// <c>RevertToSelf</c> before it returns — correct in isolation, but a
    /// thread-pool thread it runs on is returned to the pool afterward and
    /// can be handed to a *different* connection's async continuation. Found
    /// during PR #149 physical acceptance: with concurrent pipe traffic (the
    /// background heartbeat/update loop plus an interactive caller), a
    /// later, unrelated request's LocalSystem-only file write
    /// (<see cref="Updates.UpdateStateStore.Save"/>) intermittently executed
    /// under a *previous caller's* impersonated (non-admin) token instead of
    /// the service's own LocalSystem identity, surfacing as an
    /// <see cref="UnauthorizedAccessException"/> on
    /// <c>C:\ProgramData\...\updates</c> that every operation-dispatch catch
    /// silently turned into a generic <c>internal_error</c>. A dedicated
    /// <see cref="Thread"/> is never pool-reused, so its impersonate/revert
    /// cycle can never bleed into a different connection's continuation.
    /// </summary>
    private static PipeClientIdentity? CaptureClientIdentity(NamedPipeServerStream server)
    {
        PipeClientIdentity? result = null;
        var thread = new Thread(() =>
        {
            server.RunAsClient(() =>
            {
                using var identity = WindowsIdentity.GetCurrent();
                if (identity is null || identity.IsAnonymous || string.IsNullOrEmpty(identity.Name))
                {
                    return;
                }

                var isAdministrator = identity.IsSystem || new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
                result = new PipeClientIdentity(identity.Name, isAdministrator);
            });
        });
        thread.Start();
        thread.Join();
        return result;
    }

    private async Task HandleConnectionAsync(NamedPipeServerStream server, CancellationToken cancellationToken)
    {
        // Always drain the client's request before writing anything back —
        // responding first and reading second is an ordering the transport
        // was never exercised with and is not needed for correctness here.
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

        PipeClientIdentity? identity;
        try
        {
            identity = _identityResolver(server);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        {
            identity = null;
        }

        if (identity is null)
        {
            await SafeRespond(server, PipeResponse.Error(PipeErrorCodes.Unauthorized), cancellationToken);
            return;
        }

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

        if (!_handler.FeatureEnabled && !PipeOperationPolicy.IsAllowedWhenFeatureDisabled(operation))
        {
            await SafeRespond(server, PipeResponse.Error(PipeErrorCodes.FeatureDisabled), cancellationToken);
            return;
        }

        if (PipeOperationPolicy.IsPrivileged(operation) && !identity.IsAdministrator)
        {
            await SafeRespond(server, PipeResponse.Error(PipeErrorCodes.Unauthorized), cancellationToken);
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

            case PipeOperation.GetUpdateStatus:
                return Ok(await _handler.GetUpdateStatusAsync(cancellationToken));

            case PipeOperation.InstallUpdate:
                return Ok(await _handler.InstallUpdateAsync(new InstallUpdateRequest(), cancellationToken));

            case PipeOperation.ProvisionWithPairingCode:
                {
                    var req = Deserialize<ProvisionWithPairingCodeRequest>(payloadJson);
                    if (req is null) return PipeResponse.Error(PipeErrorCodes.InvalidPayload);
                    return Ok(await _handler.ProvisionWithPairingCodeAsync(req, cancellationToken));
                }

            case PipeOperation.GetAvailableServerBindings:
                return Ok(await _handler.GetAvailableServerBindingsAsync(cancellationToken));

            case PipeOperation.GetRollbackStatus:
                return Ok(await _handler.GetRollbackStatusAsync(cancellationToken));

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
