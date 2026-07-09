using System.Text.Json.Serialization;

namespace NoraMedi.Bridge.Core.Ipc;

/// <summary>One request per pipe connection: an operation name plus a raw JSON payload specific to that operation.</summary>
public sealed record PipeRequest(
    [property: JsonPropertyName("operation")] string Operation,
    [property: JsonPropertyName("payload")] string? PayloadJson);

public sealed record PipeResponse(
    [property: JsonPropertyName("success")] bool Success,
    [property: JsonPropertyName("errorCode")] string? ErrorCode,
    [property: JsonPropertyName("payload")] string? PayloadJson)
{
    public static PipeResponse Ok(string? payloadJson = null) => new(true, null, payloadJson);
    public static PipeResponse Error(string errorCode) => new(false, errorCode, null);
}

public static class PipeErrorCodes
{
    public const string UnknownOperation = "unknown_operation";
    public const string InvalidPayload = "invalid_payload";
    public const string PayloadTooLarge = "payload_too_large";
    public const string Unauthorized = "unauthorized";
    public const string FeatureDisabled = "feature_disabled";
    public const string NotFound = "not_found";
    public const string InternalError = "internal_error";
}
