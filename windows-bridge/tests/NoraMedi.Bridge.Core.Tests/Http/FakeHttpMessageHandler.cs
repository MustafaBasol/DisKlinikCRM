using System.Net;

namespace NoraMedi.Bridge.Core.Tests.Http;

/// <summary>Records the last request and returns a scripted response — the .NET analogue of injecting `fetchImpl` in the Node tests.</summary>
internal sealed class FakeHttpMessageHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, Task<HttpResponseMessage>> _responder;

    public HttpRequestMessage? LastRequest { get; private set; }
    public string? LastRequestBody { get; private set; }

    public FakeHttpMessageHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> responder)
    {
        _responder = responder;
    }

    public static FakeHttpMessageHandler Returning(HttpStatusCode status, string? jsonBody = null) =>
        new(_ => Task.FromResult(new HttpResponseMessage(status)
        {
            Content = jsonBody is null ? null! : new StringContent(jsonBody, System.Text.Encoding.UTF8, "application/json"),
        }));

    public static FakeHttpMessageHandler Throwing(Exception exception) =>
        new(_ => throw exception);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastRequest = request;
        if (request.Content is not null)
        {
            LastRequestBody = await request.Content.ReadAsStringAsync(cancellationToken);
        }
        return await _responder(request);
    }
}
