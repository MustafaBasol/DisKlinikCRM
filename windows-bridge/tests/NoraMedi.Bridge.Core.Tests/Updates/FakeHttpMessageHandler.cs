using System.Net;

namespace NoraMedi.Bridge.Core.Tests.Updates;

/// <summary>Minimal single-response fake for byte-content download tests (distinct from ScriptedHttpMessageHandler, which is JSON-only).</summary>
internal sealed class FakeHttpMessageHandler(HttpStatusCode status, byte[]? body, TimeSpan? delay = null, long? contentLength = null, Uri? finalRequestUri = null) : HttpMessageHandler
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

        // Simulates what a real redirect-following handler (SocketsHttpHandler with
        // AllowAutoRedirect=true) leaves behind: RequestMessage.RequestUri reflects the final,
        // resolved URI after following every hop — not the URL DownloadAsync was originally called
        // with. Lets tests exercise UpdateDownloader's post-redirect re-validation without a real
        // network round trip.
        response.RequestMessage = new HttpRequestMessage(request.Method, finalRequestUri ?? request.RequestUri);
        return response;
    }
}
