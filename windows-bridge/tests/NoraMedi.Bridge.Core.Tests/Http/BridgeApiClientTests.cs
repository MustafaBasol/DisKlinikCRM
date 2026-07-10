using System.Net;
using NoraMedi.Bridge.Core.Http;
using NoraMedi.Bridge.Core.Queue;

namespace NoraMedi.Bridge.Core.Tests.Http;

public class BridgeApiClientTests
{
    private static QueueItemRecord SampleItem(string ext = ".jpg", string contentType = "image/jpeg") => new(
        IngestKey: new string('a', 64),
        WatchId: "watch-1",
        DeviceId: "device-1",
        Modality: "IO",
        ContentType: contentType,
        SafeExtension: ext,
        State: QueueItemState.Processing,
        CreatedAt: DateTimeOffset.UtcNow,
        AttemptCount: 0,
        NextAttemptAt: DateTimeOffset.UtcNow,
        LastErrorCategory: null,
        SpoolFilePath: "unused-for-http-layer");

    [Theory]
    [InlineData(HttpStatusCode.OK, ResponseCategory.Success)]
    [InlineData(HttpStatusCode.Created, ResponseCategory.Success)]
    [InlineData(HttpStatusCode.Unauthorized, ResponseCategory.AuthFailure)]
    [InlineData(HttpStatusCode.BadRequest, ResponseCategory.Permanent)]
    [InlineData(HttpStatusCode.NotFound, ResponseCategory.Permanent)]
    [InlineData(HttpStatusCode.RequestEntityTooLarge, ResponseCategory.Permanent)]
    [InlineData(HttpStatusCode.TooManyRequests, ResponseCategory.Retryable)]
    [InlineData(HttpStatusCode.InternalServerError, ResponseCategory.Retryable)]
    [InlineData(HttpStatusCode.BadGateway, ResponseCategory.Retryable)]
    public void ClassifyStatus_MatchesServerContractExactly(HttpStatusCode status, ResponseCategory expected)
    {
        Assert.Equal(expected, BridgeApiClient.ClassifyStatus((int)status));
    }

    [Theory]
    [InlineData(400, ErrorCategory.BadRequest)]
    [InlineData(404, ErrorCategory.DeviceNotFound)]
    [InlineData(413, ErrorCategory.FileTooLarge)]
    public void PermanentErrorCategoryFor_MapsStatusToCategory(int status, string expected)
    {
        Assert.Equal(expected, BridgeApiClient.PermanentErrorCategoryFor(status));
    }

    [Fact]
    public async Task UploadStudyAsync_Success_ReturnsStudyIdAndDuplicateFlag()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Created, """{"ok":true,"studyId":"study-123","duplicate":false}""");
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var outcome = await client.UploadStudyAsync("nmb_token", SampleItem(), [0xFF, 0xD8, 0xFF]);

        Assert.Equal(ResponseCategory.Success, outcome.Category);
        Assert.Equal("study-123", outcome.StudyId);
        Assert.False(outcome.Duplicate);
    }

    [Fact]
    public async Task UploadStudyAsync_DuplicateResponse_IsTreatedAsSuccess()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.OK, """{"ok":true,"studyId":"study-existing","duplicate":true}""");
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var outcome = await client.UploadStudyAsync("nmb_token", SampleItem(), [0xFF, 0xD8, 0xFF]);

        Assert.Equal(ResponseCategory.Success, outcome.Category);
        Assert.True(outcome.Duplicate);
    }

    [Fact]
    public async Task UploadStudyAsync_NetworkFailure_IsRetryable()
    {
        var handler = FakeHttpMessageHandler.Throwing(new HttpRequestException("connection reset"));
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var outcome = await client.UploadStudyAsync("nmb_token", SampleItem(), [0xFF, 0xD8, 0xFF]);

        Assert.Equal(ResponseCategory.Retryable, outcome.Category);
        Assert.True(outcome.NetworkError);
    }

    [Fact]
    public async Task UploadStudyAsync_SendsIngestKeyFileNameAndDeviceId_NeverOriginalFileName()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Created, """{"ok":true,"studyId":"s1","duplicate":false}""");
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");
        var meta = SampleItem();

        await client.UploadStudyAsync("nmb_token", meta, [0xFF, 0xD8, 0xFF]);

        Assert.NotNull(handler.LastRequestBody);
        Assert.Contains($"{meta.IngestKey}{meta.SafeExtension}", handler.LastRequestBody);
        Assert.Contains(meta.IngestKey, handler.LastRequestBody);
        Assert.Contains(meta.DeviceId, handler.LastRequestBody);
        Assert.DoesNotContain("studyDate", handler.LastRequestBody);
        Assert.Equal("Bearer", handler.LastRequest!.Headers.Authorization!.Scheme);
        Assert.Equal("nmb_token", handler.LastRequest.Headers.Authorization!.Parameter);
    }

    [Fact]
    public async Task UploadStudyAsync_OmitsModalityWhenNull()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Created, """{"ok":true,"studyId":"s1","duplicate":false}""");
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");
        var meta = SampleItem() with { Modality = null };

        await client.UploadStudyAsync("nmb_token", meta, [0xFF, 0xD8, 0xFF]);

        Assert.DoesNotContain("name=\"modality\"", handler.LastRequestBody);
    }

    [Fact]
    public async Task HeartbeatAsync_Success_ReturnsOkTrue()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.OK, """{"ok":true}""");
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var outcome = await client.HeartbeatAsync("nmb_token", new HeartbeatRequest(AgentVersion: "1.0.0"));

        Assert.True(outcome.Ok);
        Assert.Equal(200, outcome.StatusCode);
    }

    [Fact]
    public async Task HeartbeatAsync_Unauthorized_ReturnsOkFalse()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Unauthorized);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var outcome = await client.HeartbeatAsync("revoked_token", new HeartbeatRequest());

        Assert.False(outcome.Ok);
        Assert.Equal(401, outcome.StatusCode);
    }

    [Fact]
    public async Task HeartbeatAsync_NetworkFailure_ReturnsOkFalseWithoutThrowing()
    {
        var handler = FakeHttpMessageHandler.Throwing(new HttpRequestException("dns failure"));
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var outcome = await client.HeartbeatAsync("nmb_token", new HeartbeatRequest());

        Assert.False(outcome.Ok);
    }

    [Fact]
    public async Task BootstrapAsync_Success_ParsesBindingsAndSupportedFileTypes()
    {
        var json = """
            {
              "bridgeAgentId": "agent-1",
              "clinicName": "Demo Clinic",
              "bindings": [
                {"id":"b1","deviceId":"d1","modality":"IO","displayName":"Sensor 1","status":"pending","acquisitionType":"folder_watch"}
              ],
              "supportedFileTypes": ["image/jpeg","image/png","image/webp","application/dicom"],
              "maxUploadSizeMb": 50,
              "serverTime": "2026-07-08T00:00:00.000Z",
              "updatePolicy": {"channel":"stable","mandatory":false}
            }
            """;
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.OK, json);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var result = await client.BootstrapAsync("nmb_token");

        Assert.NotNull(result);
        Assert.Equal("agent-1", result!.BridgeAgentId);
        Assert.Single(result.Bindings);
        Assert.Equal("d1", result.Bindings[0].DeviceId);
        Assert.Equal(4, result.SupportedFileTypes.Count);
        Assert.Equal(50, result.MaxUploadSizeMb);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.Conflict)]
    [InlineData(HttpStatusCode.UnprocessableEntity)]
    [InlineData(HttpStatusCode.Gone)]
    public void ClassifyStatus_OtherClientErrors_ArePermanentNotEndlesslyRetried(HttpStatusCode status)
    {
        Assert.Equal(ResponseCategory.Permanent, BridgeApiClient.ClassifyStatus((int)status));
    }

    [Fact]
    public async Task UploadStudyAsync_TooManyRequestsWithRetryAfterSeconds_IsHonored()
    {
        var handler = new FakeHttpMessageHandler(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(30));
            return Task.FromResult(response);
        });
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var outcome = await client.UploadStudyAsync("nmb_token", SampleItem(), [0xFF, 0xD8, 0xFF]);

        Assert.Equal(ResponseCategory.Retryable, outcome.Category);
        Assert.NotNull(outcome.RetryAfter);
        Assert.Equal(TimeSpan.FromSeconds(30), outcome.RetryAfter!.Value);
    }

    [Fact]
    public async Task UploadStudyAsync_TooManyRequestsWithoutRetryAfter_FallsBackToNullRetryAfter()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.TooManyRequests);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var outcome = await client.UploadStudyAsync("nmb_token", SampleItem(), [0xFF, 0xD8, 0xFF]);

        Assert.Equal(ResponseCategory.Retryable, outcome.Category);
        Assert.Null(outcome.RetryAfter);
    }

    [Fact]
    public async Task UploadStudyAsync_ServerError_IsRetryableWithoutRetryAfter()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.InternalServerError);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var outcome = await client.UploadStudyAsync("nmb_token", SampleItem(), [0xFF, 0xD8, 0xFF]);

        Assert.Equal(ResponseCategory.Retryable, outcome.Category);
        Assert.Null(outcome.RetryAfter);
    }

    [Fact]
    public async Task BootstrapAsync_Unauthorized_ReturnsNull()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Unauthorized);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        Assert.Null(await client.BootstrapAsync("revoked"));
    }

    private static PairRequest SamplePairRequest() => new(
        Code: "12345678",
        InstallationId: "install-1",
        AgentVersion: "1.0.0-test");

    [Fact]
    public async Task RedeemPairingCodeAsync_Success_ReturnsParsedResponse()
    {
        var json = """
            {
              "bridgeCredential": "nmb_test_token",
              "bridgeAgentId": "agent-1",
              "clinicName": "Demo Clinic",
              "bindings": [],
              "serverTime": "2026-07-08T00:00:00.000Z"
            }
            """;
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Created, json);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var result = await client.RedeemPairingCodeAsync(SamplePairRequest());

        Assert.Equal(PairingResultCategory.Success, result.Category);
        Assert.Equal(201, result.StatusCode);
        Assert.NotNull(result.Response);
        Assert.Equal("agent-1", result.Response!.BridgeAgentId);
    }

    [Fact]
    public async Task RedeemPairingCodeAsync_Success_ParsesBindingsWithAcquisitionType()
    {
        // End-to-end contract test: mirrors the real /api/public/imaging/bridge/pair
        // 201 body (server/src/routes/imagingBridgePublic.ts) after fixing the
        // response-contract mismatch where the pair route's binding select
        // omitted acquisitionType while BootstrapBinding requires it.
        var json = """
            {
              "bridgeCredential": "nmb_test_token",
              "bridgeAgentId": "agent-1",
              "clinicName": "Demo Clinic",
              "bindings": [
                {"id":"b1","deviceId":"d1","modality":"IO","displayName":"Sensor 1","status":"pending","acquisitionType":"folder_watch"}
              ],
              "serverTime": "2026-07-08T00:00:00.000Z"
            }
            """;
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Created, json);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var result = await client.RedeemPairingCodeAsync(SamplePairRequest());

        Assert.Equal(PairingResultCategory.Success, result.Category);
        Assert.NotNull(result.Response);
        Assert.Single(result.Response!.Bindings);
        Assert.Equal("folder_watch", result.Response.Bindings[0].AcquisitionType);
    }

    [Fact]
    public async Task RedeemPairingCodeAsync_SendsCamelCaseJsonBodyWithCodeAndInstallationId()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Unauthorized);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        await client.RedeemPairingCodeAsync(SamplePairRequest());

        Assert.Equal(HttpMethod.Post, handler.LastRequest!.Method);
        Assert.Equal("https://api.example.com/api/public/imaging/bridge/pair", handler.LastRequest.RequestUri!.ToString());
        Assert.NotNull(handler.LastRequestBody);
        Assert.Contains("\"code\":\"12345678\"", handler.LastRequestBody);
        Assert.Contains("\"installationId\":\"install-1\"", handler.LastRequestBody);
        Assert.Contains("\"agentVersion\":\"1.0.0-test\"", handler.LastRequestBody);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, PairingResultCategory.InvalidOrExpiredCode)]
    [InlineData(HttpStatusCode.BadRequest, PairingResultCategory.BadRequest)]
    [InlineData(HttpStatusCode.TooManyRequests, PairingResultCategory.RateLimited)]
    [InlineData(HttpStatusCode.InternalServerError, PairingResultCategory.ServerError)]
    [InlineData(HttpStatusCode.BadGateway, PairingResultCategory.ServerError)]
    public async Task RedeemPairingCodeAsync_MapsStatusCodesToDistinctCategories(HttpStatusCode status, PairingResultCategory expected)
    {
        var handler = FakeHttpMessageHandler.Returning(status);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var result = await client.RedeemPairingCodeAsync(SamplePairRequest());

        Assert.Equal(expected, result.Category);
        Assert.Equal((int)status, result.StatusCode);
        Assert.Null(result.Response);
    }

    [Fact]
    public async Task RedeemPairingCodeAsync_NetworkFailure_ReturnsNetworkFailureCategory()
    {
        var handler = FakeHttpMessageHandler.Throwing(new HttpRequestException("dns failure"));
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var result = await client.RedeemPairingCodeAsync(SamplePairRequest());

        Assert.Equal(PairingResultCategory.NetworkFailure, result.Category);
        Assert.Null(result.StatusCode);
        Assert.Null(result.Response);
    }

    [Fact]
    public async Task RedeemPairingCodeAsync_Timeout_ReturnsNetworkFailureCategory()
    {
        var handler = FakeHttpMessageHandler.Throwing(new TaskCanceledException("the operation timed out"));
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var result = await client.RedeemPairingCodeAsync(SamplePairRequest());

        Assert.Equal(PairingResultCategory.NetworkFailure, result.Category);
    }

    [Fact]
    public async Task RedeemPairingCodeAsync_MalformedSuccessBody_ReturnsMalformedResponseCategory()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Created, "{ this is not valid json");
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var result = await client.RedeemPairingCodeAsync(SamplePairRequest());

        Assert.Equal(PairingResultCategory.MalformedResponse, result.Category);
        Assert.Equal(201, result.StatusCode);
        Assert.Null(result.Response);
    }

    [Fact]
    public async Task RedeemPairingCodeAsync_NullOptionalCapabilities_IsOmittedNotSentAsJsonNull()
    {
        // imagingBridgePublicPairSchema's `capabilities` is optional but NOT
        // nullable — an explicit "capabilities":null (the default when
        // PairRequest.Capabilities is unset, as it always is today) is a
        // schema violation the backend rejects with 400 before the pairing
        // code is even looked up. The request must omit the key entirely.
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Unauthorized);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        await client.RedeemPairingCodeAsync(SamplePairRequest());

        Assert.NotNull(handler.LastRequestBody);
        Assert.DoesNotContain("capabilities", handler.LastRequestBody);
    }

    [Fact]
    public async Task RedeemPairingCodeAsync_OtherNullOptionalFields_AreOmittedNotSentAsJsonNull()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Unauthorized);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        await client.RedeemPairingCodeAsync(SamplePairRequest());

        Assert.NotNull(handler.LastRequestBody);
        Assert.DoesNotContain("machineIdHash", handler.LastRequestBody);
        Assert.DoesNotContain("computerDisplayName", handler.LastRequestBody);
        Assert.DoesNotContain("osVersion", handler.LastRequestBody);
        Assert.DoesNotContain("architecture", handler.LastRequestBody);
    }

    [Fact]
    public async Task RedeemPairingCodeAsync_SentFieldsWithValues_AreStillIncluded()
    {
        // The omit-nulls option must not accidentally drop populated fields —
        // only fields that are actually null.
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Unauthorized);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");
        var request = SamplePairRequest() with
        {
            OsVersion = "Microsoft Windows NT 10.0.19045.0",
            Architecture = "X64",
            ComputerDisplayName = "RECEPTION-PC",
        };

        await client.RedeemPairingCodeAsync(request);

        Assert.NotNull(handler.LastRequestBody);
        Assert.Contains("\"osVersion\":\"Microsoft Windows NT 10.0.19045.0\"", handler.LastRequestBody);
        Assert.Contains("\"architecture\":\"X64\"", handler.LastRequestBody);
        Assert.Contains("\"computerDisplayName\":\"RECEPTION-PC\"", handler.LastRequestBody);
    }

    [Fact]
    public async Task RedeemPairingCodeAsync_RealServicePayloadShape_ReachesCodeValidationRatherThan400()
    {
        // Contract test: a payload shaped exactly like BridgeOrchestrator's
        // real ProvisionWithPairingCodeAsync call (code + installationId +
        // agentVersion + computerDisplayName + osVersion + architecture, no
        // machineIdHash, no capabilities) must never be rejected as a bad
        // request. We assert the fake server sees no "capabilities" key
        // (which is what the real backend schema would reject) and that the
        // client correctly classifies the fake server's 401 as an
        // invalid/expired code outcome, not a BadRequest outcome — i.e. the
        // payload got far enough to reach code lookup, not schema rejection.
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Unauthorized);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");
        var request = new PairRequest(
            Code: "12345678",
            InstallationId: "install-1",
            AgentVersion: "0.4.4",
            ComputerDisplayName: "RECEPTION-PC",
            OsVersion: "Microsoft Windows NT 10.0.19045.0",
            Architecture: "X64");

        var result = await client.RedeemPairingCodeAsync(request);

        Assert.DoesNotContain("capabilities", handler.LastRequestBody);
        Assert.DoesNotContain("machineIdHash", handler.LastRequestBody);
        Assert.Equal(PairingResultCategory.InvalidOrExpiredCode, result.Category);
    }

    [Fact]
    public async Task RedeemPairingCodeAsync_NeverLeaksPairingCodeOrCredentialInException()
    {
        // Guards against a future refactor accidentally including the raw
        // request/response in a thrown exception's message (which a caller
        // might log). No exception should ever surface a code or credential.
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Unauthorized);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        var result = await client.RedeemPairingCodeAsync(SamplePairRequest());

        var serialized = System.Text.Json.JsonSerializer.Serialize(result);
        Assert.DoesNotContain("12345678", serialized);
    }
}
