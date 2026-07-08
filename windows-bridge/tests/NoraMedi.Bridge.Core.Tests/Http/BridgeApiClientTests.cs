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

    [Fact]
    public async Task BootstrapAsync_Unauthorized_ReturnsNull()
    {
        var handler = FakeHttpMessageHandler.Returning(HttpStatusCode.Unauthorized);
        var client = new BridgeApiClient(new HttpClient(handler), "https://api.example.com");

        Assert.Null(await client.BootstrapAsync("revoked"));
    }
}
