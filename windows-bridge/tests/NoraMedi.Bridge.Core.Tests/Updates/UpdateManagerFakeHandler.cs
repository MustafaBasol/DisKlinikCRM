using System.Net;
using System.Text;

namespace NoraMedi.Bridge.Core.Tests.Updates;

/// <summary>
/// Routes the update-config JSON endpoint and the release download URL
/// through one handler, since a real UpdateManager check exercises both in
/// sequence (config fetch, then byte download) against the same HttpClient.
/// </summary>
internal sealed class UpdateManagerFakeHandler : HttpMessageHandler
{
    public string? ConfigJson { get; set; }
    public HttpStatusCode ConfigStatus { get; set; } = HttpStatusCode.OK;
    public byte[] DownloadBytes { get; set; } = [];
    public HttpStatusCode DownloadStatus { get; set; } = HttpStatusCode.OK;
    public int CallCount { get; private set; }
    public TimeSpan ConfigDelay { get; set; } = TimeSpan.Zero;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        CallCount++;
        var path = request.RequestUri!.AbsolutePath;
        if (path.Contains("/imaging/bridge/update", StringComparison.Ordinal))
        {
            if (ConfigDelay > TimeSpan.Zero) await Task.Delay(ConfigDelay, cancellationToken);
            var response = new HttpResponseMessage(ConfigStatus);
            if (ConfigJson is not null) response.Content = new StringContent(ConfigJson, Encoding.UTF8, "application/json");
            return response;
        }

        var downloadResponse = new HttpResponseMessage(DownloadStatus)
        {
            Content = new ByteArrayContent(DownloadBytes),
        };
        return downloadResponse;
    }
}
