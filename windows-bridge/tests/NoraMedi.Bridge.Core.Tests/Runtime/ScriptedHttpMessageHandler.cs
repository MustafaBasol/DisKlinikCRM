using System.Net;
using System.Text;

namespace NoraMedi.Bridge.Core.Tests.Runtime;

/// <summary>Routes by request path substring to a queue of canned responses — lets orchestrator-level tests fake the whole server without a real HTTP listener.</summary>
internal sealed class ScriptedHttpMessageHandler : HttpMessageHandler
{
    private readonly Dictionary<string, Queue<(HttpStatusCode Status, string? Json)>> _routes = new();
    public List<string> RequestedPaths { get; } = [];
    public List<string> RequestBodies { get; } = [];

    public ScriptedHttpMessageHandler Enqueue(string pathContains, HttpStatusCode status, string? json = null)
    {
        if (!_routes.TryGetValue(pathContains, out var queue))
        {
            queue = new Queue<(HttpStatusCode, string?)>();
            _routes[pathContains] = queue;
        }
        queue.Enqueue((status, json));
        return this;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri!.AbsolutePath;
        RequestedPaths.Add(path);
        RequestBodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken));

        foreach (var (key, queue) in _routes)
        {
            if (path.Contains(key, StringComparison.Ordinal) && queue.Count > 0)
            {
                var (status, json) = queue.Dequeue();
                var response = new HttpResponseMessage(status)
                {
                    Content = json is null ? null! : new StringContent(json, Encoding.UTF8, "application/json"),
                };
                return response;
            }
        }

        return new HttpResponseMessage(HttpStatusCode.NotFound);
    }
}
