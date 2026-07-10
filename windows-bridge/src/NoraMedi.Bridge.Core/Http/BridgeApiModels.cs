using System.Text.Json.Serialization;

namespace NoraMedi.Bridge.Core.Http;

/// <summary>Response shape of GET /api/public/imaging/bridge/bootstrap.</summary>
public sealed record BootstrapResponse(
    [property: JsonPropertyName("bridgeAgentId")] string BridgeAgentId,
    [property: JsonPropertyName("clinicName")] string ClinicName,
    [property: JsonPropertyName("bindings")] IReadOnlyList<BootstrapBinding> Bindings,
    [property: JsonPropertyName("supportedFileTypes")] IReadOnlyList<string> SupportedFileTypes,
    [property: JsonPropertyName("maxUploadSizeMb")] int MaxUploadSizeMb,
    [property: JsonPropertyName("serverTime")] string ServerTime,
    [property: JsonPropertyName("updatePolicy")] UpdatePolicy? UpdatePolicy);

public sealed record BootstrapBinding(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("deviceId")] string DeviceId,
    [property: JsonPropertyName("modality")] string Modality,
    [property: JsonPropertyName("displayName")] string DisplayName,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("acquisitionType")] string AcquisitionType);

public sealed record UpdatePolicy(
    [property: JsonPropertyName("channel")] string Channel,
    [property: JsonPropertyName("mandatory")] bool Mandatory);

/// <summary>Request body of POST /api/public/imaging/bridge/heartbeat — every field optional per imagingBridgeHeartbeatSchema.</summary>
public sealed record HeartbeatRequest(
    [property: JsonPropertyName("agentVersion")] string? AgentVersion = null,
    [property: JsonPropertyName("osVersion")] string? OsVersion = null,
    [property: JsonPropertyName("architecture")] string? Architecture = null,
    [property: JsonPropertyName("capabilities")] IReadOnlyDictionary<string, object>? Capabilities = null,
    [property: JsonPropertyName("pendingCount")] int? PendingCount = null,
    [property: JsonPropertyName("failedCount")] int? FailedCount = null,
    [property: JsonPropertyName("lastSuccessfulUploadAt")] string? LastSuccessfulUploadAt = null,
    [property: JsonPropertyName("lastErrorCategory")] string? LastErrorCategory = null);

internal sealed record UploadResponseBody(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("studyId")] string? StudyId,
    [property: JsonPropertyName("duplicate")] bool? Duplicate);

/// <summary>
/// Request body of POST /api/public/imaging/bridge/pair — redeems a
/// single-use 8-digit pairing code for a bridge credential. This is issued
/// directly by the service (see docs/security.md "provisioning without a
/// plaintext credential over IPC"), never relayed by the Manager app.
/// </summary>
public sealed record PairRequest(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("installationId")] string InstallationId,
    [property: JsonPropertyName("agentVersion")] string AgentVersion,
    [property: JsonPropertyName("machineIdHash")] string? MachineIdHash = null,
    [property: JsonPropertyName("computerDisplayName")] string? ComputerDisplayName = null,
    [property: JsonPropertyName("osVersion")] string? OsVersion = null,
    [property: JsonPropertyName("architecture")] string? Architecture = null,
    [property: JsonPropertyName("capabilities")] IReadOnlyDictionary<string, object>? Capabilities = null);

public sealed record PairResponse(
    [property: JsonPropertyName("bridgeCredential")] string BridgeCredential,
    [property: JsonPropertyName("bridgeAgentId")] string BridgeAgentId,
    [property: JsonPropertyName("clinicName")] string ClinicName,
    [property: JsonPropertyName("bindings")] IReadOnlyList<BootstrapBinding> Bindings,
    [property: JsonPropertyName("serverTime")] string ServerTime);

/// <summary>
/// Coarse-grained outcome of a pairing-code redemption attempt, distinct
/// enough for the Manager to show an actionable message without ever
/// seeing the pairing code, hash, or credential itself (those never leave
/// <see cref="BridgeApiClient.RedeemPairingCodeAsync"/> / the credential
/// store). Mirrors server/src/routes/imagingBridgePublic.ts's response
/// matrix for POST /api/public/imaging/bridge/pair.
/// </summary>
public enum PairingResultCategory
{
    Success,

    /// <summary>The HTTP request itself never completed (DNS/connect/timeout) — nothing to do with the code.</summary>
    NetworkFailure,

    /// <summary>401 — the server intentionally returns this generic status for wrong/expired/already-used/locked codes alike.</summary>
    InvalidOrExpiredCode,

    /// <summary>400 or other 4xx — the request payload itself was rejected; normally indicates a Manager/Service bug, not a user mistake.</summary>
    BadRequest,

    /// <summary>429 — either the per-IP or per-code rate limit was hit.</summary>
    RateLimited,

    /// <summary>5xx — the server could not process an otherwise well-formed request.</summary>
    ServerError,

    /// <summary>A 2xx response body that didn't deserialize into <see cref="PairResponse"/>.</summary>
    MalformedResponse,
}

/// <summary>
/// Result of <see cref="BridgeApiClient.RedeemPairingCodeAsync"/>: never
/// carries a raw exception or the request body, only what's safe to log
/// (see <see cref="StatusCode"/>/<see cref="Category"/>) and, on success,
/// the parsed <see cref="PairResponse"/>.
/// </summary>
public sealed record PairingRedeemResult(PairingResultCategory Category, int? StatusCode, PairResponse? Response);
