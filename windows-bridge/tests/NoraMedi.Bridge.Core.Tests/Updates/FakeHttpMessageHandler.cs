using System.Net;

namespace NoraMedi.Bridge.Core.Tests.Updates;

/// <summary>Minimal single-response fake for byte-content download tests (distinct from ScriptedHttpMessageHandler, which is JSON-only).</summary>
internal sealed class FakeHttpMessageHandler(HttpStatusCode status, byte[]? body, TimeSpan? delay = null, long? contentLength = null) : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (delay is { } d) await Task.Delay(d, cancellationToken);

        var response = new HttpResponseMessage(status);
        if (body is not null)
        {
            response.Content = new ByteArrayContent(body);
            if (contentLength is { } len) response.Content.Headers.ContentLength = len;
        }
        return response;
    }
}
