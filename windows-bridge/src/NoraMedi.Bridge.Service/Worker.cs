using System.IO.Pipes;
using NoraMedi.Bridge.Core.Ipc;
using NoraMedi.Bridge.Core.Runtime;

namespace NoraMedi.Bridge.Service;

/// <summary>
/// Thin OS-integration shell: starts/stops the <see cref="BridgeOrchestrator"/>
/// (all bridging logic) and the <see cref="BridgePipeServer"/> (local IPC for
/// the future Manager app). Runs equally well as a registered Windows Service
/// (LocalSystem or a configured -ServiceAccount) or interactively for
/// development/testing via `dotnet run`.
/// </summary>
public sealed class Worker(
    BridgeOrchestrator orchestrator,
    BridgeOptions options,
    ILogger<Worker> logger,
    Func<NamedPipeServerStream, PipeClientIdentity?>? pipeIdentityResolver = null) : BackgroundService
{
    private BridgePipeServer? _pipeServer;

    public override Task StartAsync(CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "NoraMedi Bridge service starting. Self-service enabled={Enabled}, pipe={PipeName}",
            options.Enabled, options.PipeName);

        orchestrator.Start();
        _pipeServer = new BridgePipeServer(options.PipeName, orchestrator, identityResolver: pipeIdentityResolver);
        _pipeServer.Start();

        return base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // Expected on shutdown.
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        logger.LogInformation("NoraMedi Bridge service stopping.");

        if (_pipeServer is not null) await _pipeServer.DisposeAsync();
        await orchestrator.DisposeAsync();

        await base.StopAsync(cancellationToken);
    }
}
