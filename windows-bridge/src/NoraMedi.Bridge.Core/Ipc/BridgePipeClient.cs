using System.IO.Pipes;
using System.Runtime.Versioning;
using System.Text.Json;

namespace NoraMedi.Bridge.Core.Ipc;

/// <summary>Minimal client for the Named Pipe IPC surface — used by tests today, and by the future Manager app.</summary>
[SupportedOSPlatform("windows")]
public static class BridgePipeClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task<PipeResponse> SendAsync(
        string pipeName, PipeOperation operation, object? payload = null, int connectTimeoutMs = 5000, CancellationToken cancellationToken = default)
    {
        using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await client.ConnectAsync(connectTimeoutMs, cancellationToken);

        var payloadJson = payload is null ? null : JsonSerializer.Serialize(payload, JsonOptions);
        var requestJson = JsonSerializer.Serialize(new PipeRequest(operation.ToString(), payloadJson), JsonOptions);
        await PipeFraming.WriteMessageAsync(client, requestJson, cancellationToken);

        var responseJson = await PipeFraming.ReadMessageAsync(client, PipeFraming.DefaultMaxMessageBytes, cancellationToken);
        if (responseJson is null)
        {
            return PipeResponse.Error(PipeErrorCodes.InternalError);
        }

        return JsonSerializer.Deserialize<PipeResponse>(responseJson, JsonOptions)
            ?? PipeResponse.Error(PipeErrorCodes.InternalError);
    }

    public static T? DeserializePayload<T>(PipeResponse response) =>
        response.PayloadJson is null ? default : JsonSerializer.Deserialize<T>(response.PayloadJson, JsonOptions);
}
