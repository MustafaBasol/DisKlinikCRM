using NoraMedi.Bridge.Core.Http;
using NoraMedi.Bridge.Core.Runtime;
using NoraMedi.Bridge.Core.Updates;
using NoraMedi.Bridge.Service;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options => options.ServiceName = "NoraMediBridge");

// Layers a mutable ProgramData override on top of the packaged (Program
// Files) appsettings.json defaults — see ProgramDataConfigOverride for why:
// an MSI upgrade/repair always overwrites the installed appsettings.json,
// so any locally customized Enabled/ServerUrl/PipeName must live here to
// survive it.
ProgramDataConfigOverride.Apply(builder.Configuration, ProgramDataConfigOverride.DefaultPath);

builder.Services.AddSingleton(_ => BuildBridgeOptions(builder.Configuration));
builder.Services.AddHttpClient("BridgeApi");
builder.Services.AddSingleton(sp =>
{
    var options = sp.GetRequiredService<BridgeOptions>();
    var httpClient = sp.GetRequiredService<IHttpClientFactory>().CreateClient("BridgeApi");
    return new BridgeApiClient(httpClient, options.ServerUrl);
});
builder.Services.AddSingleton(sp => BuildUpdateOptions(builder.Configuration, sp.GetRequiredService<BridgeOptions>()));
builder.Services.AddSingleton(sp => new BridgeOrchestrator(
    sp.GetRequiredService<BridgeOptions>(),
    sp.GetRequiredService<BridgeApiClient>(),
    AgentVersion.Current,
    sp.GetRequiredService<ILogger<BridgeOrchestrator>>(),
    sp.GetRequiredService<UpdateOptions>()));

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
        MaxAcquiredFileSizeBytes = section.GetValue<long?>("MaxAcquiredFileSizeBytes") ?? 200L * 1024 * 1024,
        MaxSpoolBytes = section.GetValue<long?>("MaxSpoolBytes") ?? 5L * 1024 * 1024 * 1024,
        MinFreeDiskBytes = section.GetValue<long?>("MinFreeDiskBytes") ?? 500L * 1024 * 1024,
        FailedRetentionDays = section.GetValue<int?>("FailedRetentionDays") ?? 30,
        CompletedRetentionDays = section.GetValue<int?>("CompletedRetentionDays") ?? 7,
    };
}

static UpdateOptions BuildUpdateOptions(IConfiguration configuration, BridgeOptions bridgeOptions)
{
    var section = configuration.GetSection("Updates");
    return new UpdateOptions
    {
        UpdatesDirectory = Path.Combine(bridgeOptions.ProgramDataRoot, "updates"),
        MaxDownloadBytes = section.GetValue<long?>("MaxDownloadBytes") ?? 300L * 1024 * 1024,
        DownloadTimeoutSeconds = section.GetValue<int?>("DownloadTimeoutSeconds") ?? 300,
        // Fail closed: both loosening flags below default to the safe
        // production value regardless of what's missing from config.
        AllowInsecureLocalhostHttp = section.GetValue<bool?>("AllowInsecureLocalhostHttp") ?? false,
        RequireTrustedSignature = section.GetValue<bool?>("RequireTrustedSignature") ?? true,
        CheckIntervalMinutes = section.GetValue<int?>("CheckIntervalMinutes") ?? 240,
        StartupJitterSeconds = section.GetValue<int?>("StartupJitterSeconds") ?? 600,
        BackoffBaseMs = section.GetValue<int?>("BackoffBaseMs") ?? 60_000,
        BackoffCapMs = section.GetValue<int?>("BackoffCapMs") ?? 3_600_000,
        InstallTimeoutSeconds = section.GetValue<int?>("InstallTimeoutSeconds") ?? 180,
        StagedFileRetentionDays = section.GetValue<int?>("StagedFileRetentionDays") ?? 14,
    };
}
