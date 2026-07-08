using NoraMedi.Bridge.Core.Http;
using NoraMedi.Bridge.Core.Runtime;
using NoraMedi.Bridge.Service;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options => options.ServiceName = "NoraMediBridge");

builder.Services.AddSingleton(_ => BuildBridgeOptions(builder.Configuration));
builder.Services.AddHttpClient("BridgeApi");
builder.Services.AddSingleton(sp =>
{
    var options = sp.GetRequiredService<BridgeOptions>();
    var httpClient = sp.GetRequiredService<IHttpClientFactory>().CreateClient("BridgeApi");
    return new BridgeApiClient(httpClient, options.ServerUrl);
});
builder.Services.AddSingleton(sp => new BridgeOrchestrator(
    sp.GetRequiredService<BridgeOptions>(),
    sp.GetRequiredService<BridgeApiClient>(),
    AgentVersion.Current,
    sp.GetRequiredService<ILogger<BridgeOrchestrator>>()));

builder.Services.AddHostedService<Worker>();

var host = builder.Build();
host.Run();

static BridgeOptions BuildBridgeOptions(IConfiguration configuration)
{
    var section = configuration.GetSection("BridgeSelfService");
    var programDataRoot = section["ProgramDataRoot"];
    if (string.IsNullOrWhiteSpace(programDataRoot))
    {
        programDataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "NoraMediBridge");
    }

    return new BridgeOptions
    {
        // Defaults to false regardless of what's missing from config — the
        // feature flag must fail closed, never fail open.
        Enabled = section.GetValue<bool?>("Enabled") ?? false,
        ServerUrl = section["ServerUrl"] ?? "https://api.noramedi.com",
        ProgramDataRoot = programDataRoot,
        PipeName = section["PipeName"] ?? "NoraMediBridge",
        HeartbeatIntervalSeconds = section.GetValue<int?>("HeartbeatIntervalSeconds") ?? 60,
        StabilityMs = section.GetValue<int?>("StabilityMs") ?? 5000,
        MaxAttempts = section.GetValue<int?>("MaxAttempts") ?? 100,
        BackoffBaseMs = section.GetValue<int?>("BackoffBaseMs") ?? 60_000,
        BackoffCapMs = section.GetValue<int?>("BackoffCapMs") ?? 900_000,
        DrainPollMs = section.GetValue<int?>("DrainPollMs") ?? 5_000,
        ServiceAccountSid = section["ServiceAccountSid"],
    };
}
