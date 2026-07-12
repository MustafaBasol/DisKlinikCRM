using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using NoraMedi.Bridge.Core.Queue;

namespace NoraMedi.Bridge.Core.Http;

/// <summary>
/// The three server calls the bridge ever makes, matching
/// server/src/routes/imagingBridgePublic.ts byte-for-byte:
///  - GET  /api/public/imaging/bridge/bootstrap
///  - POST /api/public/imaging/bridge/heartbeat
///  - POST /api/public/imaging/bridge/studies (multipart)
/// The credential is a bearer token; nothing here logs it, and this class
/// never persists it — callers (BridgeAuthState/DpapiCredentialStore) own that.
/// </summary>
public sealed class BridgeApiClient
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Used ONLY for serializing the outgoing <see cref="PairRequest"/> body.
    /// Omits null optional fields (machineIdHash, computerDisplayName,
    /// osVersion, architecture, capabilities) instead of writing them as
    /// JSON null — imagingBridgePublicPairSchema's `capabilities` field is
    /// optional but not nullable, so an explicit `"capabilities":null`
    /// (the default when Capabilities is unset) is a schema violation and
    /// the whole request is rejected with 400 before the code is even
    /// looked up. Deliberately scoped to pairing only: heartbeat's
    /// lastSuccessfulUploadAt/lastErrorCategory distinguish omitted (no
    /// update) from explicit null (clear), so <see cref="JsonOptions"/> must
    /// keep writing nulls there.
    /// </summary>
    private static readonly JsonSerializerOptions PairRequestJsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _http;
    private readonly string _serverUrl;

    public BridgeApiClient(HttpClient httpClient, string serverUrl)
    {
        _http = httpClient;
        _serverUrl = serverUrl.TrimEnd('/');
    }

    /// <summary>
    /// Redeems a single-use pairing code (entered by the clinic user in the
    /// Manager UI) for a bridge credential. The service — not the Manager —
    /// performs this call directly, so the plaintext credential is only ever
    /// received here and immediately handed to <see cref="Security.ICredentialStore"/>;
    /// it never travels across the Named Pipe IPC boundary (see docs/security.md).
    /// Distinguishes network failure, invalid/expired code (401), bad request
    /// (400/other 4xx), rate limit (429), server error (5xx) and a malformed
    /// success body, so callers can show/log something more useful than a
    /// single generic failure. Never logs the code, hash, or credential.
    /// </summary>
    public async Task<PairingRedeemResult> RedeemPairingCodeAsync(PairRequest pairRequest, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_serverUrl}/api/public/imaging/bridge/pair")
        {
            Content = JsonContent.Create(pairRequest, options: PairRequestJsonOptions),
        };

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, cancellationToken);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new PairingRedeemResult(PairingResultCategory.NetworkFailure, null, null);
        }

        using (response)
        {
            var statusCode = (int)response.StatusCode;

            if (response.IsSuccessStatusCode)
            {
                PairResponse? body;
                try
                {
                    body = await response.Content.ReadFromJsonAsync<PairResponse>(JsonOptions, cancellationToken);
                }
                catch (JsonException)
                {
                    return new PairingRedeemResult(PairingResultCategory.MalformedResponse, statusCode, null);
                }

                return body is null
                    ? new PairingRedeemResult(PairingResultCategory.MalformedResponse, statusCode, null)
                    : new PairingRedeemResult(PairingResultCategory.Success, statusCode, body);
            }

            var category = statusCode switch
            {
                401 => PairingResultCategory.InvalidOrExpiredCode,
                429 => PairingResultCategory.RateLimited,
                >= 400 and < 500 => PairingResultCategory.BadRequest,
                _ => PairingResultCategory.ServerError,
            };
            return new PairingRedeemResult(category, statusCode, null);
        }
    }

    public async Task<BootstrapResponse?> BootstrapAsync(string credential, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_serverUrl}/api/public/imaging/bridge/bootstrap");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential);

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, cancellationToken);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return null;
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode) return null;
            return await response.Content.ReadFromJsonAsync<BootstrapResponse>(JsonOptions, cancellationToken);
        }
    }

    public async Task<HeartbeatOutcome> HeartbeatAsync(string credential, HeartbeatRequest payload, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_serverUrl}/api/public/imaging/bridge/heartbeat");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential);
        request.Content = JsonContent.Create(payload, options: JsonOptions);

        try
        {
            using var response = await _http.SendAsync(request, cancellationToken);
            var statusCode = (int)response.StatusCode;
            return new HeartbeatOutcome(response.IsSuccessStatusCode, statusCode, ClassifyStatus(statusCode));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new HeartbeatOutcome(false, NetworkError: true);
        }
    }

    /// <summary>
    /// File name sent is always `{ingestKey}{safeExtension}` — the original
    /// source file name is never read or transmitted. `studyDate` is
    /// deliberately never sent: the server stamps its own timestamp.
    /// </summary>
    public async Task<UploadOutcome> UploadStudyAsync(
        string credential, QueueItemRecord meta, byte[] fileBytes, CancellationToken cancellationToken = default)
    {
        using var content = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(fileBytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(meta.ContentType);
        content.Add(fileContent, "file", $"{meta.IngestKey}{meta.SafeExtension}");
        content.Add(new StringContent(meta.IngestKey), "ingestKey");
        content.Add(new StringContent(meta.DeviceId), "deviceId");
        if (!string.IsNullOrEmpty(meta.Modality))
        {
            content.Add(new StringContent(meta.Modality), "modality");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_serverUrl}/api/public/imaging/bridge/studies")
        {
            Content = content,
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credential);

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, cancellationToken);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new UploadOutcome(ResponseCategory.Retryable, NetworkError: true);
        }

        using (response)
        {
            var category = ClassifyStatus((int)response.StatusCode);
            switch (category)
            {
                case ResponseCategory.Success:
                    var body = await response.Content.ReadFromJsonAsync<UploadResponseBody>(JsonOptions, cancellationToken);
                    return new UploadOutcome(category, body?.StudyId, body?.Duplicate ?? false);
                case ResponseCategory.Permanent:
                    return new UploadOutcome(category, ErrorCategory: PermanentErrorCategoryFor((int)response.StatusCode));
                case ResponseCategory.Retryable when response.StatusCode == System.Net.HttpStatusCode.TooManyRequests:
                    return new UploadOutcome(category, RetryAfter: TryGetRetryAfter(response));
                default:
                    return new UploadOutcome(category);
            }
        }
    }

    /// <summary>
    /// Honors a server-supplied <c>Retry-After</c> (delta-seconds or HTTP-date
    /// form) on 429 responses. Returns null for a missing/zero/negative value
    /// so the caller falls back to its own exponential backoff.
    /// </summary>
    private static TimeSpan? TryGetRetryAfter(HttpResponseMessage response)
    {
        var retryAfter = response.Headers.RetryAfter;
        if (retryAfter is null) return null;

        if (retryAfter.Delta is { } delta) return delta > TimeSpan.Zero ? delta : null;

        if (retryAfter.Date is { } date)
        {
            var delay = date - DateTimeOffset.UtcNow;
            return delay > TimeSpan.Zero ? delay : null;
        }

        return null;
    }

    /// <summary>
    /// Mirrors bridge-agent/src/uploader.ts classifyStatus: 200/201 success,
    /// 401 pauses the whole agent (AuthFailure — invalid/revoked credential is
    /// treated as action-required, never silently retried), 429 is retried
    /// honoring Retry-After, every other 4xx is a permanent client error that
    /// will never succeed on retry, and 5xx/anything unexpected is transient.
    /// </summary>
    public static ResponseCategory ClassifyStatus(int status) => status switch
    {
        200 or 201 => ResponseCategory.Success,
        401 => ResponseCategory.AuthFailure,
        429 => ResponseCategory.Retryable,
        >= 400 and < 500 => ResponseCategory.Permanent,
        _ => ResponseCategory.Retryable,
    };

    public static string PermanentErrorCategoryFor(int status) => status switch
    {
        400 => ErrorCategory.BadRequest,
        404 => ErrorCategory.DeviceNotFound,
        413 => ErrorCategory.FileTooLarge,
        _ => ErrorCategory.BadRequest,
    };
}
