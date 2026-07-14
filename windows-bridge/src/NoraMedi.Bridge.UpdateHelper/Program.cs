using System.Text.Json;
using NoraMedi.Bridge.Core.Updates;
using NoraMedi.Bridge.Core.Updates.Rollback;

// NoraMedi.Bridge.UpdateHelper — the narrow, purpose-built process the
// Service launches to hand off a self-update or a one-step rollback (see
// docs/update-architecture.md "Self-update handoff" and
// docs/update-runbook.md "Rollback execution"). Two invocation shapes:
//   <instructionPath>              — forward update (PR 6/7)
//   rollback <instructionPath>     — rollback (PR 7/7)
// Re-validates the staged/cached installer's hash and publisher signature
// itself (defense in depth), runs the fixed silent-install (and, for
// rollback, uninstall-first) commands, waits for the NoraMediBridge service
// to come back to Running, and writes a bounded, redacted result file for
// the Service to read back. Does not remain resident after writing its result.

var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);

if (args.Length == 2 && string.Equals(args[0], "rollback", StringComparison.OrdinalIgnoreCase))
{
    return await RunRollbackAsync(args[1], jsonOptions);
}

if (args.Length != 1 || string.IsNullOrWhiteSpace(args[0]))
{
    return 1;
}

var instructionPath = args[0];
string? resultDirectory = null;

try
{
    resultDirectory = Path.GetDirectoryName(Path.GetFullPath(instructionPath));

    UpdateHelperInstruction? instruction;
    try
    {
        var json = File.ReadAllText(instructionPath);
        instruction = JsonSerializer.Deserialize<UpdateHelperInstruction>(json, jsonOptions);
    }
    catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
    {
        WriteResult(resultDirectory, new UpdateHelperResult("InstallFailed", nameof(UpdateErrorCategory.CorruptState), null, false, DateTimeOffset.UtcNow), jsonOptions);
        return 1;
    }

    if (instruction is null)
    {
        WriteResult(resultDirectory, new UpdateHelperResult("InstallFailed", nameof(UpdateErrorCategory.CorruptState), null, false, DateTimeOffset.UtcNow), jsonOptions);
        return 1;
    }

    var runner = new UpdateHelperRunner(new ProcessSilentInstallerRunner(), new WindowsServiceStateProvider());
    var result = await runner.RunAsync(instruction, TimeSpan.FromSeconds(180), TimeSpan.FromSeconds(120), CancellationToken.None);

    WriteResult(resultDirectory, result, jsonOptions);
    return result.Outcome == "InstallFailed" ? 1 : 0;
}
catch (Exception)
{
    // Absolute last resort: never exit silently without a result the
    // Service can read back — an unhandled exception here must still
    // produce a truthful "failed" state rather than leaving the Service
    // waiting on a helper result that will never arrive.
    if (resultDirectory is not null)
    {
        WriteResult(resultDirectory, new UpdateHelperResult("InstallFailed", nameof(UpdateErrorCategory.Unknown), null, false, DateTimeOffset.UtcNow), jsonOptions);
    }
    return 1;
}

static void WriteResult(string? directory, UpdateHelperResult result, JsonSerializerOptions jsonOptions)
{
    if (directory is null) return;
    try
    {
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, $"helper-result-{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}.json");
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(result, jsonOptions));
        File.Move(tmp, path, overwrite: true);
    }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
    {
        // Nothing further to do — the Service's next reconciliation pass will
        // eventually see this as an Interrupted state if no result ever appears.
    }
}

static async Task<int> RunRollbackAsync(string instructionPath, JsonSerializerOptions jsonOptions)
{
    string? resultDirectory = null;
    try
    {
        resultDirectory = Path.GetDirectoryName(Path.GetFullPath(instructionPath));

        RollbackHelperInstruction? instruction;
        try
        {
            var json = File.ReadAllText(instructionPath);
            instruction = JsonSerializer.Deserialize<RollbackHelperInstruction>(json, jsonOptions);
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            WriteRollbackResult(resultDirectory, new RollbackHelperResult("Failed", nameof(RollbackErrorCategory.Unknown), null, null, DateTimeOffset.UtcNow), jsonOptions);
            return 1;
        }

        if (instruction is null)
        {
            WriteRollbackResult(resultDirectory, new RollbackHelperResult("Failed", nameof(RollbackErrorCategory.Unknown), null, null, DateTimeOffset.UtcNow), jsonOptions);
            return 1;
        }

        var runner = new UpdateHelperRunner(new ProcessSilentInstallerRunner(), new WindowsServiceStateProvider(), productUninstaller: new WindowsMsiProductUninstaller());
        var result = await runner.RunRollbackAsync(instruction, TimeSpan.FromSeconds(180), TimeSpan.FromSeconds(120), CancellationToken.None);

        WriteRollbackResult(resultDirectory, result, jsonOptions);
        return result.Outcome == "Failed" ? 1 : 0;
    }
    catch (Exception)
    {
        if (resultDirectory is not null)
        {
            WriteRollbackResult(resultDirectory, new RollbackHelperResult("Failed", nameof(RollbackErrorCategory.Unknown), null, null, DateTimeOffset.UtcNow), jsonOptions);
        }
        return 1;
    }
}

static void WriteRollbackResult(string? directory, RollbackHelperResult result, JsonSerializerOptions jsonOptions)
{
    if (directory is null) return;
    try
    {
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, $"rollback-helper-result-{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}.json");
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(result, jsonOptions));
        File.Move(tmp, path, overwrite: true);
    }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
    {
    }
}
