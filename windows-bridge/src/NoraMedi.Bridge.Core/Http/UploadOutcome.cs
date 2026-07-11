namespace NoraMedi.Bridge.Core.Http;

/// <summary>
/// Mirrors bridge-agent/src/uploader.ts ResponseCategory exactly:
/// 201/200 (including duplicate:true) is success; 401 pauses the whole
/// agent; 400/404/413 are permanent (never retried); everything else
/// (429/5xx/network) is retried with backoff.
/// </summary>
public enum ResponseCategory
{
    Success,
    Retryable,
    Permanent,
    AuthFailure,
}

public sealed record UploadOutcome(
    ResponseCategory Category,
    string? StudyId = null,
    bool Duplicate = false,
    string? ErrorCategory = null,
    bool NetworkError = false,
    TimeSpan? RetryAfter = null);

/// <summary>
/// Result of <see cref="BridgeApiClient.HeartbeatAsync"/>. Category reuses
/// <see cref="ResponseCategory"/>'s status-code buckets (401 is AuthFailure,
/// 429/5xx are Retryable, other 4xx are Permanent) so callers can log/branch
/// on the same vocabulary as uploads without inventing a parallel enum.
/// Category is null exactly when NetworkError is true (the request itself
/// never completed, so there is no status to classify). Never carries the
/// credential, token, or any patient/study data — see BridgeOrchestrator's
/// heartbeat diagnostics log line for what is safe to persist.
/// </summary>
public sealed record HeartbeatOutcome(bool Ok, int? StatusCode = null, ResponseCategory? Category = null, bool NetworkError = false);
