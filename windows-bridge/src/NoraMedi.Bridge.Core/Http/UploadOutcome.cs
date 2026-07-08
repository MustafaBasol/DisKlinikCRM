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
    bool NetworkError = false);

public sealed record HeartbeatOutcome(bool Ok, int? StatusCode = null);
